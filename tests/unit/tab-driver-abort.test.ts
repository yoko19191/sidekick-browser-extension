import { describe, expect, it, vi } from "vitest";
import { TabDriver, abortableSleep } from "../../src/agent/tab-driver";

describe("abortable wait", () => {
  it("abortableSleep rejects right after abort", async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const p = abortableSleep(10_000, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow("aborted");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("TabDriver wait(10s) stops within 500 ms and never touches the tab", async () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome = { tabs: { sendMessage, get: vi.fn(async () => ({ status: "complete" })) } };
    const d = new TabDriver(1, async () => {});
    const ac = new AbortController();
    const t0 = Date.now();
    const p = d.execute({ name: "wait", args: { seconds: 10 } }, ac.signal);
    setTimeout(() => ac.abort(), 30);
    await expect(p).rejects.toThrow("aborted");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("script popups", () => {
  function mockChrome(onExecute: (fire: (t: Partial<chrome.tabs.Tab>) => void) => void) {
    const listeners = new Set<(t: chrome.tabs.Tab) => void>();
    const fire = (t: Partial<chrome.tabs.Tab>) => listeners.forEach((l) => l(t as chrome.tabs.Tab));
    const sendMessage = vi.fn(async (_id: number, msg: any) => {
      if (msg.type === "agent:execute") onExecute(fire);
      return { ok: true, data: msg.type === "agent:execute" ? { ok: true, message: "clicked f0:1" } : undefined };
    });
    (globalThis as any).chrome = {
      tabs: {
        sendMessage,
        get: vi.fn(async () => ({ status: "complete" })),
        onCreated: { addListener: (l: any) => listeners.add(l), removeListener: (l: any) => listeners.delete(l) },
      },
    };
    return listeners;
  }

  it("a tab opened by this tab during a click is reported to the model, with its URL when readable", async () => {
    const listeners = mockChrome((fire) => {
      setTimeout(() => fire({ id: 9, openerTabId: 1, pendingUrl: "https://docs.example.com/<b>" }), 20); // arrives after the reply
      fire({ id: 10, openerTabId: 77, pendingUrl: "https://unrelated.example/" });
    });
    const r = await new TabDriver(1, async () => {}).execute({ name: "click", args: { index: "f0:1" } });
    expect(r.message).toContain("clicked f0:1");
    expect(r.message).toContain("opened a new tab (https://docs.example.com/‹b›)");
    expect(r.message).not.toContain("unrelated");
    expect(listeners.size).toBe(0);
  });

  it("no popup, no note", async () => {
    mockChrome(() => {});
    const r = await new TabDriver(1, async () => {}).execute({ name: "click", args: { index: "f0:1" } });
    expect(r.message).toBe("clicked f0:1");
  });
});
