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
