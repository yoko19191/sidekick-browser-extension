/**
 * Extension-side MCP Bridge client.
 * Connects outbound from the MV3 service worker to the local Sidekick MCP server over WebSocket
 * (`ws://127.0.0.1:<port>/ws`) and dispatches browser inspection & action RPCs to `TabDriver`.
 */
import { WebAgent } from "./loop";
import { isRestrictedUrl, siteOf } from "./risk";
import { agentStore } from "./store";
import { TabDriver } from "./tab-driver";
import type { ActionRequest } from "./types";
import { agentStreamFn, toPiModel } from "@/src/lib/llm";
import type { PageContent, ProviderConfig } from "@/src/lib/types";

export const MCP_BRIDGE_STORAGE_KEY = "mcpBridge";
export const DEFAULT_MCP_PORT = 17395;

export interface McpBridgeConfig {
  enabled: boolean;
  port: number;
  token: string;
}

export interface McpBridgeStatus extends McpBridgeConfig {
  connected: boolean;
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
  return { enabled, port, token };
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
): Promise<unknown> {
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
      const action = params.action as ActionRequest | undefined;
      if (!action?.name) throw new Error("Missing action.name");
      const driver = new TabDriver(tabId, deps.ensureInjected);
      const result = await driver.execute({ name: action.name, args: action.args ?? {} });
      const includeSnapshot = params.includeSnapshot !== false;
      const snapshot = includeSnapshot ? await driver.snapshot().catch(() => undefined) : undefined;
      return { tabId, ...result, snapshot };
    }

    case "page.screenshot": {
      const tab = await resolveTargetTab(params.tabId as number | undefined);
      if (!tab.id) throw new Error("No active tab");
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

export class McpBridgeClient {
  private cfg: McpBridgeConfig = { enabled: false, port: DEFAULT_MCP_PORT, token: "" };
  private ws: WebSocket | null = null;
  private connected = false;
  private lastError?: string;
  private lastCommandAt?: number;
  private lastTool?: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: BridgeDeps) {}

  async start(): Promise<void> {
    this.cfg = await loadBridgeConfig();
    if (this.cfg.enabled) this.connect();
  }

  getStatus(): McpBridgeStatus {
    if (this.cfg.enabled && !this.connected && !this.ws && !this.reconnectTimer) {
      this.connect();
    }
    return {
      ...this.cfg,
      connected: this.connected,
      lastError: this.lastError,
      lastCommandAt: this.lastCommandAt,
      lastTool: this.lastTool,
    };
  }

  async configure(patch: Partial<McpBridgeConfig>): Promise<McpBridgeStatus> {
    const next = await saveBridgeConfig({ ...this.cfg, ...patch });
    const changed = next.enabled !== this.cfg.enabled || next.port !== this.cfg.port || next.token !== this.cfg.token;
    this.cfg = next;
    if (changed) {
      this.disconnect();
      if (this.cfg.enabled) this.connect();
    }
    return this.getStatus();
  }

  reconnect(): McpBridgeStatus {
    this.disconnect();
    if (this.cfg.enabled) this.connect();
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
  }

  private disconnect() {
    this.clearTimers();
    this.connected = false;
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
    if (!this.cfg.enabled || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cfg.enabled) this.connect();
    }, 3000);
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
          try {
            const result = await dispatchBridgeMethod(msg.method, msg.params ?? {}, this.deps);
            ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
          } catch (e) {
            ws.send(JSON.stringify({ id: msg.id, ok: false, error: (e as Error)?.message ?? String(e) }));
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => {
        this.lastError = `Cannot connect to ws://127.0.0.1:${this.cfg.port}/ws`;
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
