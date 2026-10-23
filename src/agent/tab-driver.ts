/** PageDriver backed by a browser tab: talks to the content-script host via chrome.tabs.sendMessage. */
import type { ActionRequest, ActionResult, ElementInfo, PageDriver, PageSnapshot } from "./types";

/** Sleep that rejects as soon as `signal` aborts, so stop never waits out a timer. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolve `p`, or reject immediately when `signal` aborts. */
function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export class TabDriver implements PageDriver {
  constructor(
    private readonly tabId: number,
    private readonly ensureInjected: (tabId: number) => Promise<void>,
  ) {}

  private async call<T>(msg: Record<string, unknown>): Promise<T> {
    await this.waitLoaded();
    let r: { ok: boolean; data?: T; error?: string } | undefined;
    try {
      r = await chrome.tabs.sendMessage(this.tabId, msg);
    } catch {
      // page navigated: the old content script is gone, inject again
      await this.ensureInjected(this.tabId);
      r = await chrome.tabs.sendMessage(this.tabId, msg);
    }
    if (!r?.ok) throw new Error(r?.error ?? "content script did not answer");
    return r.data as T;
  }

  /** Wait (max 10 s) for the tab to finish loading after a navigation. */
  private async waitLoaded() {
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const tab = await chrome.tabs.get(this.tabId);
      if (tab.status === "complete") return;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  snapshot(): Promise<PageSnapshot> {
    return this.call({ type: "agent:snapshot" });
  }
  async describe(index: string): Promise<ElementInfo | undefined> {
    return (await this.call<ElementInfo | null>({ type: "agent:describe", index })) ?? undefined;
  }
  async execute(action: ActionRequest, signal?: AbortSignal): Promise<ActionResult> {
    if (action.name === "wait") {
      const sec = Math.max(0, Math.min(10, Number(action.args.seconds) || 0));
      await abortableSleep(sec * 1000, signal);
      return { ok: true, message: `waited ${sec}s` };
    }
    if (action.name === "navigate" && typeof action.args.url === "string") {
      await chrome.tabs.update(this.tabId, { url: action.args.url });
      await new Promise((r) => setTimeout(r, 300));
      await raceAbort(this.waitLoaded(), signal);
      return { ok: true, message: `navigated to ${action.args.url}` };
    }
    if (action.name === "go_back") {
      await chrome.tabs.goBack(this.tabId);
      await new Promise((r) => setTimeout(r, 300));
      await raceAbort(this.waitLoaded(), signal);
      return { ok: true, message: "went back" };
    }
    if (typeof action.args.index === "string") await this.call({ type: "agent:highlight", index: action.args.index }).catch(() => {});
    // On stop, tell the page to halt in-flight work (per-character typing) instead of finishing in the background.
    const onAbort = () => void this.call({ type: "agent:abort" }).catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await raceAbort(this.call({ type: "agent:execute", action }), signal);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  async currentUrl(): Promise<string> {
    return (await chrome.tabs.get(this.tabId)).url ?? "";
  }
  domChanged(): Promise<boolean> {
    return this.call({ type: "agent:domChanged" });
  }
}
