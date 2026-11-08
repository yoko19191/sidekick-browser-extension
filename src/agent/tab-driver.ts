/** PageDriver backed by a browser tab: talks to the content-script host via chrome.tabs.sendMessage. */
import { cdpController } from "./cdp";
import { isRestrictedUrl } from "./risk";
import type { ActionRequest, ActionResult, ElementInfo, PageDriver, PageSnapshot, PageTabSummary } from "./types";

/** Same error shape fetch() uses on abort, so callers can tell a stop from a failure by `name`. */
const aborted = () => new DOMException("aborted", "AbortError");

/** Sleep that rejects as soon as `signal` aborts, so stop never waits out a timer. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(aborted());
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(aborted()); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolve `p`, or reject immediately when `signal` aborts. */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** How long after a click/key the driver still attributes a newly opened tab to it. */
export const POPUP_GRACE_MS = 150;

/**
 * Tell the model about tabs the page opened by script. The agent stays in its own tab (it has no access grant for
 * the new one); the URL is only visible when the user granted that site, and is page data, so it is escaped.
 */
function popupNote(tabs: chrome.tabs.Tab[]): string {
  const urls = tabs.map((t) => t.pendingUrl || t.url).filter((u): u is string => !!u && /^https?:/i.test(u));
  const where = urls.length ? ` (${urls.map((u) => u.replace(/</g, "‹").replace(/>/g, "›").slice(0, 200)).join(", ")})` : "";
  return `The page opened ${tabs.length > 1 ? `${tabs.length} new tabs` : "a new tab"}${where} that the agent cannot operate; it keeps working in this tab. Use navigate with the URL if you need that page, or ask_user.`;
}

export interface TabDriverOptions {
  /** Automatically switch the active tab when a click/Enter opens a new tab. */
  autoFollowNewTab?: boolean;
  /** Optional check for whether CDP Enhanced Mode is active. */
  useCdp?: () => Promise<boolean>;
}

export class TabDriver implements PageDriver {
  private currentTabId: number;
  private tabHistory: number[] = [];

  constructor(
    tabId: number,
    private readonly ensureInjected: (tabId: number) => Promise<void>,
    private readonly opts: TabDriverOptions = {},
  ) {
    this.currentTabId = tabId;
  }

  get activeTabId(): number {
    return this.currentTabId;
  }

  private async call<T>(msg: Record<string, unknown>, targetTabId = this.currentTabId): Promise<T> {
    await this.waitLoaded(targetTabId);
    let r: { ok: boolean; data?: T; error?: string } | undefined;
    try {
      r = await chrome.tabs.sendMessage(targetTabId, msg);
    } catch {
      // page navigated: the old content script is gone, inject again
      await this.ensureInjected(targetTabId);
      r = await chrome.tabs.sendMessage(targetTabId, msg);
    }
    if (!r?.ok) throw new Error(r?.error ?? "content script did not answer");
    return r.data as T;
  }

  /** Wait (max 10 s) for the tab to finish loading after a navigation. */
  private async waitLoaded(targetTabId = this.currentTabId) {
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = await chrome.tabs.get(targetTabId);
      if (tab.status === "complete") return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  private async listOpenTabs(): Promise<PageTabSummary[] | undefined> {
    if (!globalThis.chrome?.tabs?.query) return undefined;
    try {
      const all = await chrome.tabs.query({ currentWindow: true });
      return all
        .filter((t) => t.id != null && t.url && !isRestrictedUrl(t.url))
        .map((t) => ({
          id: t.id!,
          title: t.title ?? "",
          url: t.url ?? "",
          active: t.id === this.currentTabId,
        }));
    } catch {
      return undefined;
    }
  }

  async snapshot(): Promise<PageSnapshot> {
    const snap = await this.call<PageSnapshot>({ type: "agent:snapshot" });
    const tabs = await this.listOpenTabs();
    return tabs ? { ...snap, tabs } : snap;
  }

  async describe(index: string): Promise<ElementInfo | undefined> {
    return (await this.call<ElementInfo | null>({ type: "agent:describe", index })) ?? undefined;
  }

  async screenshot(): Promise<{ data: string; mimeType: string }> {
    await this.call({ type: "agent:highlight", clear: true }).catch(() => {});
    const useCdp = (await this.opts.useCdp?.()) ?? false;
    if (useCdp) {
      const shot = await cdpController.captureScreenshot(this.currentTabId, false);
      return { data: shot.base64, mimeType: shot.mimeType };
    }
    const tab = await chrome.tabs.get(this.currentTabId);
    if (!tab.active && chrome.tabs.update) {
      await chrome.tabs.update(this.currentTabId, { active: true });
      await new Promise((r) => setTimeout(r, 120));
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 75 });
    const comma = dataUrl.indexOf(",");
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return { data, mimeType: "image/jpeg" };
  }

  async execute(action: ActionRequest, signal?: AbortSignal): Promise<ActionResult> {
    if (action.name === "wait") {
      const sec = Math.max(0, Math.min(10, Number(action.args.seconds) || 0));
      await abortableSleep(sec * 1000, signal);
      return { ok: true, message: `waited ${sec}s` };
    }
    if (action.name === "navigate" && typeof action.args.url === "string") {
      await chrome.tabs.update(this.currentTabId, { url: action.args.url });
      await new Promise((r) => setTimeout(r, 300));
      await raceAbort(this.waitLoaded(), signal);
      return { ok: true, message: `navigated to ${action.args.url}` };
    }
    if (action.name === "go_back") {
      await chrome.tabs.goBack(this.currentTabId);
      await new Promise((r) => setTimeout(r, 300));
      await raceAbort(this.waitLoaded(), signal);
      return { ok: true, message: "went back" };
    }
    if (action.name === "switch_tab") {
      const nextId = Number(action.args.tabId);
      if (!Number.isInteger(nextId)) return { ok: false, message: "invalid tabId" };
      const tab = await chrome.tabs.get(nextId).catch(() => undefined);
      if (!tab?.id) return { ok: false, message: `tab ${nextId} not found` };
      if (tab.url && isRestrictedUrl(tab.url)) return { ok: false, message: `cannot switch to restricted tab ${nextId}` };
      if (this.currentTabId !== nextId) this.tabHistory.push(this.currentTabId);
      this.currentTabId = nextId;
      await chrome.tabs.update(nextId, { active: true }).catch(() => {});
      await raceAbort(this.waitLoaded(nextId), signal);
      await this.ensureInjected(nextId);
      return { ok: true, message: `switched to tab #${nextId} (${tab.url ?? ""})` };
    }
    if (action.name === "open_tab" && typeof action.args.url === "string") {
      const tab = await chrome.tabs.create({ url: action.args.url, active: true });
      if (!tab?.id) return { ok: false, message: "failed to create new tab" };
      this.tabHistory.push(this.currentTabId);
      this.currentTabId = tab.id;
      await new Promise((r) => setTimeout(r, 300));
      await raceAbort(this.waitLoaded(tab.id), signal);
      await this.ensureInjected(tab.id).catch(() => {});
      return { ok: true, message: `opened and switched to tab #${tab.id} (${action.args.url})` };
    }
    if (action.name === "close_tab") {
      const targetId = action.args.tabId != null ? Number(action.args.tabId) : this.currentTabId;
      if (!Number.isInteger(targetId)) return { ok: false, message: "invalid tabId" };
      await chrome.tabs.remove(targetId).catch(() => {});
      if (targetId === this.currentTabId) {
        const fallback = this.tabHistory.pop();
        if (fallback != null) {
          this.currentTabId = fallback;
          await chrome.tabs.update(fallback, { active: true }).catch(() => {});
        } else if (chrome.tabs.query) {
          const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (active?.id) this.currentTabId = active.id;
        }
      }
      return { ok: true, message: `closed tab #${targetId}, now on tab #${this.currentTabId}` };
    }

    const useCdp = (await this.opts.useCdp?.()) ?? false;
    if (typeof action.args.index === "string") {
      await this.call({ type: "agent:highlight", index: action.args.index, action: action.name }).catch(() => {});
    }
    // On stop, tell the page to halt in-flight work (per-character typing) instead of finishing in the background.
    const onAbort = () => void this.call({ type: "agent:abort" }).catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    // Track newly opened tabs triggered by click or Enter.
    const opened: chrome.tabs.Tab[] = [];
    const originTabId = this.currentTabId;
    const onCreated = (t: chrome.tabs.Tab) => void (t.openerTabId === originTabId && opened.push(t));
    const watch = action.name === "click" || action.name === "send_keys";
    if (watch && chrome.tabs.onCreated) chrome.tabs.onCreated.addListener(onCreated);
    try {
      let r: ActionResult | undefined;
      if (useCdp && typeof action.args.index === "string" && (action.name === "click" || action.name === "hover")) {
        const boxRes = await this.call<{ x: number; y: number; width: number; height: number; href?: string; target?: string } | null>({
          type: "agent:box",
          index: action.args.index,
          hover: action.name === "hover",
          action: action.name,
        }).catch(() => null);
        if (boxRes && boxRes.width > 0 && boxRes.height > 0) {
          if (action.name === "hover") {
            await cdpController.mouseHover(this.currentTabId, boxRes.x, boxRes.y);
            r = { ok: true, message: `hovered ${action.args.index} at (${boxRes.x}, ${boxRes.y}) [CDP]` };
          } else {
            await cdpController.mouseClick(this.currentTabId, boxRes.x, boxRes.y);
            r = { ok: true, message: `clicked ${action.args.index} at (${boxRes.x}, ${boxRes.y}) [CDP]` };
          }
        }
      }
      if (!r) {
        const execAction: ActionRequest =
          this.opts.autoFollowNewTab && action.name === "click"
            ? { name: action.name, args: { ...action.args, allowNewTab: true } }
            : action;
        r = await raceAbort(this.call<ActionResult>({ type: "agent:execute", action: execAction }), signal);
      }
      if (!watch) return r;
      // tabs.onCreated can arrive after the content script's reply
      await abortableSleep(POPUP_GRACE_MS, signal);
      if (opened.length > 0) {
        if (this.opts.autoFollowNewTab) {
          const newest = opened[opened.length - 1];
          const newUrl = newest.pendingUrl || newest.url || "";
          if (newest.id != null && (!newUrl || !isRestrictedUrl(newUrl))) {
            this.tabHistory.push(this.currentTabId);
            this.currentTabId = newest.id;
            await chrome.tabs.update?.(newest.id, { active: true })?.catch?.(() => {});
            await new Promise((res) => setTimeout(res, 250));
            await raceAbort(this.waitLoaded(newest.id), signal).catch(() => {});
            await this.ensureInjected(newest.id).catch(() => {});
            const finalTab = await chrome.tabs.get(newest.id).catch(() => newest);
            const finalUrl = (finalTab.url || finalTab.pendingUrl || newUrl).replace(/</g, "‹").replace(/>/g, "›");
            return { ...r, message: `${r.message}; automatically switched to newly opened tab #${newest.id}${finalUrl ? ` (${finalUrl})` : ""}` };
          }
        }
        return { ...r, message: `${r.message}\n${popupNote(opened)}` };
      }
      return r;
    } finally {
      if (watch && chrome.tabs.onCreated) chrome.tabs.onCreated.removeListener(onCreated);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async currentUrl(): Promise<string> {
    return (await chrome.tabs.get(this.currentTabId)).url ?? "";
  }
  domChanged(): Promise<boolean> {
    return this.call({ type: "agent:domChanged" });
  }
}
