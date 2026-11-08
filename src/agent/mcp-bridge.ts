/**
 * Extension-side MCP Bridge client.
 * Connects outbound from the MV3 service worker to the local Sidekick MCP server over WebSocket
 * (`ws://127.0.0.1:<port>/ws`) and dispatches browser inspection & action RPCs to `TabDriver`.
 */
import { cdpController, hasDebuggerPermission } from "./cdp";
import { WebAgent } from "./loop";
import { isRestrictedUrl, siteOf } from "./risk";
import { agentStore } from "./store";
import { TabDriver } from "./tab-driver";
import type { ActionRequest } from "./types";
import { agentStreamFn, toPiModel } from "@/src/lib/llm";
import type { PageContent, ProviderConfig } from "@/src/lib/types";

export const MCP_BRIDGE_STORAGE_KEY = "mcpBridge";
export const DEFAULT_MCP_PORT = 17395;

export type McpIndicatorState = "off" | "idle" | "active" | "error";

export interface McpBridgeConfig {
  enabled: boolean;
  port: number;
  token: string;
  /** Optional CDP Enhanced Mode via `chrome.debugger` (default false). */
  cdpEnabled?: boolean;
}

export interface McpBridgeStatus extends McpBridgeConfig {
  connected: boolean;
  indicator?: McpIndicatorState;
  cdpAttachedTabs?: number[];
  lastError?: string;
  lastCommandAt?: number;
  lastTool?: string;
}

export interface BridgeDeps {
  ensureInjected(tabId: number): Promise<void>;
  resolveModel(): Promise<{ provider: ProviderConfig; modelId: string; apiKey?: string }>;
}

export function normalizeBridgeConfig(raw: unknown): McpBridgeConfig {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : false;
  const portNum = Number(obj.port);
  const port = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535 ? portNum : DEFAULT_MCP_PORT;
  const token = typeof obj.token === "string" ? obj.token.trim() : "";
  const cdpEnabled = typeof obj.cdpEnabled === "boolean" ? obj.cdpEnabled : false;
  return { enabled, port, token, cdpEnabled };
}

export async function loadBridgeConfig(): Promise<McpBridgeConfig> {
  const r = await chrome.storage.local.get(MCP_BRIDGE_STORAGE_KEY);
  return normalizeBridgeConfig(r[MCP_BRIDGE_STORAGE_KEY]);
}

export async function saveBridgeConfig(cfg: McpBridgeConfig): Promise<McpBridgeConfig> {
  const normalized = normalizeBridgeConfig(cfg);
  await chrome.storage.local.set({ [MCP_BRIDGE_STORAGE_KEY]: normalized });
  return normalized;
}

async function resolveTargetTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (typeof tabId === "number") {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.id) throw new Error(`Tab ${tabId} not found`);
    return tab;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id && active.url && !isRestrictedUrl(active.url)) return active;
  const allTabs = await chrome.tabs.query({});
  const webTabs = allTabs
    .filter((t) => t.id != null && t.url && !isRestrictedUrl(t.url))
    .sort((a, b) => ((b as { lastAccessed?: number }).lastAccessed ?? 0) - ((a as { lastAccessed?: number }).lastAccessed ?? 0));
  if (webTabs[0]?.id) return webTabs[0];
  if (active?.id) return active;
  throw new Error("No active browser tab found");
}

async function assertTabAllowed(tab: chrome.tabs.Tab, ensureInjected: (tabId: number) => Promise<void>): Promise<number> {
  if (!tab.id) throw new Error("Invalid tab id");
  const url = tab.url ?? "";
  if (!url || isRestrictedUrl(url)) {
    throw new Error(`Cannot operate restricted or ungranted page: ${url || "(hidden URL - grant host permission first)"}`);
  }
  const site = siteOf(url);
  if (site) {
    const policy = await agentStore.getPolicy(site);
    if (policy?.neverAct) {
      throw new Error(`Site ${site} is in the user's never-act blocklist`);
    }
  }
  await ensureInjected(tab.id);
  return tab.id;
}

export async function dispatchBridgeMethod(
  method: string,
  params: Record<string, unknown>,
  deps: BridgeDeps,
  cfg?: McpBridgeConfig,
): Promise<unknown> {
  const useCdp = Boolean(cfg?.cdpEnabled && (await hasDebuggerPermission()));
  switch (method) {
    case "ping":
      return { pong: true, ts: Date.now() };

    case "tabs.list": {
      const tabs = await chrome.tabs.query({});
      return {
        tabs: tabs
          .filter((t) => t.id != null)
          .map((t) => ({
            id: t.id!,
            windowId: t.windowId,
            active: !!t.active,
            title: t.title ?? "",
            url: t.url ?? "",
            favIconUrl: t.favIconUrl ?? "",
          })),
      };
    }

    case "tabs.activate": {
      const tabId = Number(params.tabId);
      if (!Number.isInteger(tabId)) throw new Error("tabId is required");
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab?.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      return { ok: true, tabId, title: tab?.title ?? "", url: tab?.url ?? "" };
    }

    case "tabs.open": {
      const url = String(params.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are allowed");
      const active = params.active !== false;
      const tab = await chrome.tabs.create({ url, active });
      return { ok: true, tabId: tab.id, url: tab.url ?? url };
    }

    case "tabs.close": {
      const tabId = Number(params.tabId);
      if (!Number.isInteger(tabId)) throw new Error("tabId is required");
      await chrome.tabs.remove(tabId);
      return { ok: true, tabId };
    }

    case "page.snapshot": {
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const driver = new TabDriver(tabId, deps.ensureInjected);
      const snap = await driver.snapshot();
      return { tabId, ...snap };
    }

    case "page.extract": {
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const res = await chrome.tabs.sendMessage(tabId, { type: "page:extract" });
      return { tabId, ...(res as PageContent) };
    }

    case "page.action": {
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const action = params.action as { name: string; args?: Record<string, unknown> } | undefined;
      if (!action?.name) throw new Error("Missing action.name");
      const args = action.args ?? {};
      const driver = new TabDriver(tabId, deps.ensureInjected);

      // Hover action (supported in both standard and CDP enhanced mode)
      if (action.name === "hover") {
        let x = typeof args.x === "number" ? args.x : undefined;
        let y = typeof args.y === "number" ? args.y : undefined;
        let label = "";
        if (typeof args.index === "string") {
          const r = await chrome.tabs.sendMessage(tabId, { type: "agent:box", index: args.index, hover: true, action: "hover" });
          if (!r?.ok || !r.data) throw new Error(`element ${args.index} not found`);
          x = r.data.x;
          y = r.data.y;
          label = ` ${args.index} (${r.data.tag})`;
        } else if (x !== undefined && y !== undefined) {
          await chrome.tabs.sendMessage(tabId, { type: "agent:highlight", x, y, action: "hover" }).catch(() => {});
        }
        if (x === undefined || y === undefined) throw new Error("hover requires either index or { x, y }");
        if (useCdp) {
          await cdpController.mouseHover(tabId, x, y);
        }
        const snapshot = params.includeSnapshot !== false ? await driver.snapshot().catch(() => undefined) : undefined;
        return { tabId, ok: true, message: `hovered${label} at (${x}, ${y})${useCdp ? " [CDP]" : ""}`, snapshot };
      }

      // Coordinate click or CDP-enhanced trusted click
      if (action.name === "click" && (useCdp || (typeof args.x === "number" && typeof args.y === "number"))) {
        if (typeof args.x === "number" && typeof args.y === "number") {
          if (!useCdp) throw new Error("Coordinate click { x, y } requires CDP Enhanced Mode to be enabled");
          await chrome.tabs.sendMessage(tabId, { type: "agent:highlight", x: args.x, y: args.y, action: "click" }).catch(() => {});
          await cdpController.mouseClick(tabId, args.x, args.y);
          await new Promise((r) => setTimeout(r, 150));
          const snapshot = params.includeSnapshot !== false ? await driver.snapshot().catch(() => undefined) : undefined;
          return { tabId, ok: true, message: `clicked (${args.x}, ${args.y}) [CDP]`, snapshot };
        }
        if (typeof args.index === "string" && useCdp) {
          const r = await chrome.tabs.sendMessage(tabId, { type: "agent:box", index: args.index, action: "click" });
          if (r?.ok && r.data && r.data.width > 0 && r.data.height > 0) {
            if (r.data.target === "_blank" && r.data.href && /^https?:\/\//i.test(r.data.href)) {
              const navRes = await driver.execute({ name: "navigate", args: { url: r.data.href } });
              const snapshot = params.includeSnapshot !== false ? await driver.snapshot().catch(() => undefined) : undefined;
              return { tabId, ...navRes, snapshot };
            }
            await cdpController.mouseClick(tabId, r.data.x, r.data.y);
            await new Promise((res) => setTimeout(res, 150));
            const snapshot = params.includeSnapshot !== false ? await driver.snapshot().catch(() => undefined) : undefined;
            return { tabId, ok: true, message: `clicked ${args.index} at (${r.data.x}, ${r.data.y}) [CDP]`, snapshot };
          }
        }
      }

      const result = await driver.execute({ name: action.name as ActionRequest["name"], args });
      const includeSnapshot = params.includeSnapshot !== false;
      const snapshot = includeSnapshot ? await driver.snapshot().catch(() => undefined) : undefined;
      return { tabId, ...result, snapshot };
    }

    case "page.screenshot": {
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      if (!tab.id) throw new Error("No active tab");
      await chrome.tabs.sendMessage(tab.id, { type: "agent:highlight", clear: true }).catch(() => {});
      if (useCdp) {
        const shot = await cdpController.captureScreenshot(tab.id, Boolean(params.fullPage));
        return {
          tabId: tab.id,
          url: tab.url ?? "",
          title: tab.title ?? "",
          mimeType: shot.mimeType,
          base64: shot.base64,
          cdp: true,
        };
      }
      if (!tab.active) {
        await chrome.tabs.update(tab.id, { active: true });
        await new Promise((r) => setTimeout(r, 120));
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      return {
        tabId: tab.id,
        url: tab.url ?? "",
        title: tab.title ?? "",
        mimeType: "image/jpeg",
        base64,
      };
    }

    case "cdp.console": {
      if (!cfg?.cdpEnabled) {
        throw new Error("CDP Enhanced Mode is disabled. Turn on 'CDP Enhanced Mode' in Sidekick Settings -> Web Bridge.");
      }
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const logs = await cdpController.getConsoleLogs(tabId, {
        level: params.level as string | undefined,
        clear: Boolean(params.clear),
      });
      return { tabId, logs };
    }

    case "cdp.network": {
      if (!cfg?.cdpEnabled) {
        throw new Error("CDP Enhanced Mode is disabled. Turn on 'CDP Enhanced Mode' in Sidekick Settings -> Web Bridge.");
      }
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const requests = await cdpController.getNetworkRequests(tabId, {
        urlFilter: params.urlFilter as string | undefined,
        onlyErrors: Boolean(params.onlyErrors),
        clear: Boolean(params.clear),
      });
      return { tabId, requests };
    }

    case "cdp.evaluate": {
      if (!cfg?.cdpEnabled) {
        throw new Error("CDP Enhanced Mode is disabled. Turn on 'CDP Enhanced Mode' in Sidekick Settings -> Web Bridge.");
      }
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const expression = String(params.expression ?? "");
      if (!expression.trim()) throw new Error("expression is required");
      const out = await cdpController.evaluate(tabId, expression);
      return { tabId, ...out };
    }

    case "agent.run_task": {
      const task = String(params.task ?? "").trim();
      if (!task) throw new Error("task is required");
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      const tabId = await assertTabAllowed(tab, deps.ensureInjected);
      const r = await deps.resolveModel();
      const site = siteOf(tab.url ?? "");
      const policy = site ? await agentStore.getPolicy(site) : undefined;
      const never = (await agentStore.listPolicies()).filter((p) => p.neverAct).map((p) => p.site);
      const startedAt = Date.now();
      const recorded: import("./types").StepRecord[] = [];
      const agent = new WebAgent({
        model: toPiModel(r.provider, r.modelId, r.apiKey),
        streamFn: agentStreamFn(r.provider.kind),
        getApiKey: () => r.apiKey,
        driver: new TabDriver(tabId, deps.ensureInjected),
        never,
        allowedKinds: policy?.allowKinds,
        hooks: {
          confirm: async () => "deny",
          askUser: async (q) => `Cannot ask interactive question over MCP: ${q}`,
          onStep: (step) => recorded.push(step),
        },
      });
      const outcome = await agent.run(task);
      await agentStore
        .saveRun(
          {
            id: `mcp-${startedAt}`,
            task: `[MCP] ${task}`,
            url: tab.url ?? "",
            status: outcome.status,
            success: outcome.status === "done" ? outcome.success : undefined,
            text: outcome.status === "done" ? outcome.text : undefined,
            error: outcome.status === "error" ? outcome.error : undefined,
            steps: outcome.steps,
            startedAt,
            endedAt: Date.now(),
          },
          recorded,
        )
        .catch(() => {});
      return { tabId, outcome, steps: recorded };
    }

    default:
      throw new Error(`Unknown bridge method: ${method}`);
  }
}

const ICON_SIZES = [16, 32, 48, 128] as const;
const INDICATOR_COLORS: Record<Exclude<McpIndicatorState, "off">, string> = {
  active: "#22c55e", // Green: actively operating
  idle: "#3b82f6",   // Blue: connected, waiting for commands
  error: "#ef4444",  // Red: connection failed or command error
};

let baseBitmapsPromise: Promise<Map<number, ImageBitmap>> | null = null;

async function loadBaseBitmaps(): Promise<Map<number, ImageBitmap>> {
  if (!baseBitmapsPromise) {
    baseBitmapsPromise = (async () => {
      const map = new Map<number, ImageBitmap>();
      for (const size of ICON_SIZES) {
        const res = await fetch(chrome.runtime.getURL(`icon/${size}.png`));
        const blob = await res.blob();
        map.set(size, await createImageBitmap(blob));
      }
      return map;
    })().catch((e) => {
      baseBitmapsPromise = null;
      throw e;
    });
  }
  return baseBitmapsPromise;
}

async function applyToolbarIconIndicator(state: McpIndicatorState): Promise<void> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined" || !globalThis.chrome?.action?.setIcon) {
    return;
  }
  try {
    const bitmaps = await loadBaseBitmaps();
    const imageData: Record<number, ImageData> = {};
    for (const size of ICON_SIZES) {
      const bmp = bitmaps.get(size);
      if (!bmp) continue;
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(bmp, 0, 0, size, size);
      if (state !== "off") {
        const cx = size * 0.77;
        const cy = size * 0.77;
        const r = Math.max(2.6, size * 0.19);
        const halo = Math.max(1.2, size * 0.065);
        // White contrast ring
        ctx.beginPath();
        ctx.arc(cx, cy, r + halo, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        // Status dot
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = INDICATOR_COLORS[state];
        ctx.fill();
      }
      imageData[size] = ctx.getImageData(0, 0, size, size);
    }
    await chrome.action.setIcon({ imageData });
  } catch {
    /* ignore in headless or unsupported environments */
  }
}

export class McpBridgeClient {
  private cfg: McpBridgeConfig = { enabled: false, port: DEFAULT_MCP_PORT, token: "" };
  private ws: WebSocket | null = null;
  private connected = false;
  private inflight = 0;
  private activeHoldUntil = 0;
  private lastError?: string;
  private lastCommandAt?: number;
  private lastTool?: string;
  private lastIndicator: McpIndicatorState = "off";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private activeHoldTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: BridgeDeps) {}

  async start(): Promise<void> {
    this.cfg = await loadBridgeConfig();
    if (this.cfg.enabled) this.connect();
    else this.syncIndicator();
  }

  computeIndicator(): McpIndicatorState {
    if (!this.cfg.enabled) return "off";
    if (!this.connected) return "error";
    if (this.inflight > 0 || Date.now() < this.activeHoldUntil) return "active";
    if (this.lastError) return "error";
    return "idle";
  }

  private syncIndicator() {
    const next = this.computeIndicator();
    if (next !== this.lastIndicator) {
      this.lastIndicator = next;
      void applyToolbarIconIndicator(next);
    }
  }

  getStatus(): McpBridgeStatus {
    if (this.cfg.enabled && !this.connected && !this.ws && !this.reconnectTimer) {
      this.connect();
    }
    const indicator = this.computeIndicator();
    return {
      ...this.cfg,
      connected: this.connected,
      indicator,
      cdpAttachedTabs: cdpController.getAttachedTabs(),
      lastError: this.lastError,
      lastCommandAt: this.lastCommandAt,
      lastTool: this.lastTool,
    };
  }

  async configure(patch: Partial<McpBridgeConfig>): Promise<McpBridgeStatus> {
    const next = await saveBridgeConfig({ ...this.cfg, ...patch });
    const wsChanged = next.enabled !== this.cfg.enabled || next.port !== this.cfg.port || next.token !== this.cfg.token;
    const cdpTurnedOff = (this.cfg.cdpEnabled && !next.cdpEnabled) || !next.enabled;
    this.cfg = next;
    if (cdpTurnedOff) {
      await cdpController.detachAll();
    }
    if (wsChanged) {
      this.disconnect();
      if (this.cfg.enabled) this.connect();
      else this.syncIndicator();
    }
    return this.getStatus();
  }

  reconnect(): McpBridgeStatus {
    this.disconnect();
    if (this.cfg.enabled) this.connect();
    else this.syncIndicator();
    return this.getStatus();
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.activeHoldTimer) {
      clearTimeout(this.activeHoldTimer);
      this.activeHoldTimer = null;
    }
  }

  private disconnect() {
    this.clearTimers();
    this.connected = false;
    this.inflight = 0;
    this.activeHoldUntil = 0;
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private scheduleReconnect() {
    this.syncIndicator();
    if (!this.cfg.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg.enabled) this.connect();
    }, 3000);
  }

  private markActiveHold() {
    this.activeHoldUntil = Date.now() + 2200;
    if (this.activeHoldTimer) clearTimeout(this.activeHoldTimer);
    this.activeHoldTimer = setTimeout(() => {
      this.activeHoldTimer = null;
      this.syncIndicator();
    }, 2250);
  }

  private connect() {
    if (!this.cfg.enabled || typeof WebSocket === "undefined") return;
    this.disconnect();
    const qs = this.cfg.token ? `?token=${encodeURIComponent(this.cfg.token)}` : "";
    const url = `ws://127.0.0.1:${this.cfg.port}/ws${qs}`;
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        this.lastError = undefined;
        this.syncIndicator();
        try {
          ws.send(JSON.stringify({ type: "hello", client: "sidekick-extension", version: "0.1.0" }));
        } catch {
          /* ignore */
        }
        this.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
          }
        }, 15_000);
      };
      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { id?: string | number; method?: string; params?: Record<string, unknown> };
          if (!msg.method || msg.id === undefined) return;
          this.lastCommandAt = Date.now();
          this.lastTool = msg.method;
          this.inflight++;
          this.lastError = undefined;
          this.syncIndicator();
          try {
            const result = await dispatchBridgeMethod(msg.method, msg.params ?? {}, this.deps, this.cfg);
            this.inflight = Math.max(0, this.inflight - 1);
            this.markActiveHold();
            this.syncIndicator();
            ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
          } catch (e) {
            this.inflight = Math.max(0, this.inflight - 1);
            const errMsg = (e as Error)?.message ?? String(e);
            this.lastError = errMsg;
            this.syncIndicator();
            ws.send(JSON.stringify({ id: msg.id, ok: false, error: errMsg }));
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => {
        this.lastError = `Cannot connect to ws://127.0.0.1:${this.cfg.port}/ws`;
        this.syncIndicator();
      };
      ws.onclose = () => {
        this.connected = false;
        this.clearTimers();
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch (e) {
      this.connected = false;
      this.lastError = (e as Error)?.message ?? String(e);
      this.scheduleReconnect();
    }
  }
}
