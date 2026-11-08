/**
 * Optional Chrome DevTools Protocol (CDP) controller via `chrome.debugger`.
 * Disabled by default. When enabled by the user in Web Bridge settings, provides:
 * - Hardware-level trusted input (`isTrusted: true` mouse click, hover, and key events)
 * - Live Console & uncaught exception capture per tab
 * - Live Network request/response/failure telemetry per tab
 * - Background-tab & full-page screenshots (`Page.captureScreenshot`)
 * - Page-world JS evaluation with userGesture (`Runtime.evaluate`)
 */

export interface ConsoleEntry {
  level: string;
  text: string;
  url?: string;
  line?: number;
  ts: number;
}

export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  startedAt: number;
  durationMs?: number;
}

interface TabSession {
  attached: boolean;
  attaching?: Promise<void>;
  consoleLogs: ConsoleEntry[];
  networkMap: Map<string, NetworkEntry>;
  networkOrder: string[];
}

const MAX_BUFFER = 200;

const KEY_DEFS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
};

export async function hasDebuggerPermission(): Promise<boolean> {
  return Boolean(globalThis.chrome?.debugger?.attach);
}

export class CdpController {
  private sessions = new Map<number, TabSession>();
  private listenersBound = false;

  private bindListeners() {
    if (this.listenersBound || !globalThis.chrome?.debugger) return;
    this.listenersBound = true;
    try {
      chrome.debugger.onEvent.addListener((source, method, params: any) => {
      const tabId = source.tabId;
      if (tabId == null) return;
      const s = this.sessions.get(tabId);
      if (!s) return;

      if (method === "Runtime.consoleAPICalled") {
        const parts = (params?.args ?? []).map((a: any) => {
          if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
          return a.description ?? a.type ?? "";
        });
        const frame = params?.stackTrace?.callFrames?.[0];
        this.pushConsole(s, {
          level: String(params?.type ?? "log"),
          text: parts.join(" ").slice(0, 2000),
          url: frame?.url,
          line: frame?.lineNumber,
          ts: Date.now(),
        });
      } else if (method === "Runtime.exceptionThrown") {
        const d = params?.exceptionDetails;
        const desc = d?.exception?.description || d?.text || "Uncaught exception";
        this.pushConsole(s, {
          level: "exception",
          text: String(desc).slice(0, 2000),
          url: d?.url,
          line: d?.lineNumber,
          ts: Date.now(),
        });
      } else if (method === "Network.requestWillBeSent") {
        const reqId = String(params?.requestId ?? "");
        if (!reqId) return;
        const entry: NetworkEntry = {
          requestId: reqId,
          method: String(params?.request?.method ?? "GET"),
          url: String(params?.request?.url ?? ""),
          resourceType: params?.type ? String(params.type) : undefined,
          startedAt: Date.now(),
        };
        s.networkMap.set(reqId, entry);
        s.networkOrder.push(reqId);
        while (s.networkOrder.length > MAX_BUFFER) {
          const oldest = s.networkOrder.shift()!;
          s.networkMap.delete(oldest);
        }
      } else if (method === "Network.responseReceived") {
        const reqId = String(params?.requestId ?? "");
        const entry = s.networkMap.get(reqId);
        if (entry && params?.response) {
          entry.status = Number(params.response.status);
          entry.statusText = String(params.response.statusText ?? "");
          entry.mimeType = String(params.response.mimeType ?? "");
          entry.durationMs = Date.now() - entry.startedAt;
        }
      } else if (method === "Network.loadingFailed") {
        const reqId = String(params?.requestId ?? "");
        const entry = s.networkMap.get(reqId);
        if (entry) {
          entry.failed = true;
          entry.errorText = String(params?.errorText ?? "Failed");
          entry.durationMs = Date.now() - entry.startedAt;
        }
      }
    });

    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId != null) {
        const s = this.sessions.get(source.tabId);
        if (s) s.attached = false;
      }
    });

      chrome.tabs?.onRemoved?.addListener((tabId) => {
        this.sessions.delete(tabId);
      });
    } catch {
      // Ignore if debugger listeners are unavailable in test/restricted context
    }
  }

  private pushConsole(s: TabSession, item: ConsoleEntry) {
    s.consoleLogs.push(item);
    if (s.consoleLogs.length > MAX_BUFFER) s.consoleLogs.shift();
  }

  getAttachedTabs(): number[] {
    return [...this.sessions.entries()].filter(([, s]) => s.attached).map(([id]) => id);
  }

  async ensureAttached(tabId: number): Promise<TabSession> {
    this.bindListeners();
    if (!(await hasDebuggerPermission())) {
      throw new Error("CDP permission ('debugger') is not granted. Enable CDP Mode in Sidekick Settings -> Web Bridge.");
    }
    let s = this.sessions.get(tabId);
    if (!s) {
      s = { attached: false, consoleLogs: [], networkMap: new Map(), networkOrder: [] };
      this.sessions.set(tabId, s);
    }
    if (s.attached) return s;
    if (s.attaching) {
      await s.attaching;
      return s;
    }
    s.attaching = (async () => {
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        if (!/Already attached/i.test(msg)) throw e;
      }
      s!.attached = true;
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {}).catch(() => {});
      await chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxPostDataSize: 4096 }).catch(() => {});
      await chrome.debugger.sendCommand({ tabId }, "Page.enable", {}).catch(() => {});
      await chrome.debugger.sendCommand({ tabId }, "DOM.enable", {}).catch(() => {});
    })().finally(() => {
      if (s) s.attaching = undefined;
    });
    await s.attaching;
    return s;
  }

  async send<T = any>(tabId: number, method: string, commandParams: Record<string, unknown> = {}): Promise<T> {
    await this.ensureAttached(tabId);
    return (await chrome.debugger.sendCommand({ tabId }, method, commandParams)) as T;
  }

  async detachTab(tabId: number): Promise<void> {
    const s = this.sessions.get(tabId);
    if (!s) return;
    s.attached = false;
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }

  async detachAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    this.sessions.clear();
    await Promise.all(ids.map((tabId) => chrome.debugger?.detach({ tabId }).catch(() => {})));
  }

  async mouseHover(tabId: number, x: number, y: number): Promise<void> {
    await this.send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    });
  }

  async mouseClick(tabId: number, x: number, y: number, button: "left" | "right" | "middle" = "left", clickCount = 1): Promise<void> {
    await this.send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
    });
    await this.send(tabId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: button === "left" ? 1 : button === "right" ? 2 : 4,
      clickCount,
    });
    await this.send(tabId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount,
    });
  }

  async pressKey(tabId: number, keyName: string): Promise<void> {
    const def = KEY_DEFS[keyName] ?? { key: keyName, code: keyName, keyCode: keyName.charCodeAt(0) || 0 };
    await this.send(tabId, "Input.dispatchKeyEvent", {
      type: def.text ? "rawKeyDown" : "keyDown",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
    });
    if (def.text) {
      await this.send(tabId, "Input.dispatchKeyEvent", {
        type: "char",
        text: def.text,
        unmodifiedText: def.text,
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.keyCode,
      });
    }
    await this.send(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.keyCode,
      nativeVirtualKeyCode: def.keyCode,
    });
  }

  async captureScreenshot(tabId: number, fullPage = false): Promise<{ base64: string; mimeType: string }> {
    let clip: Record<string, unknown> | undefined;
    if (fullPage) {
      const metrics = await this.send<{ contentSize?: { width: number; height: number } }>(tabId, "Page.getLayoutMetrics");
      if (metrics?.contentSize?.width && metrics?.contentSize?.height) {
        clip = {
          x: 0,
          y: 0,
          width: Math.min(metrics.contentSize.width, 4096),
          height: Math.min(metrics.contentSize.height, 8192),
          scale: 1,
        };
      }
    }
    const res = await this.send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 80,
      captureBeyondViewport: fullPage,
      ...(clip ? { clip } : {}),
    });
    return { base64: res.data, mimeType: "image/jpeg" };
  }

  async getConsoleLogs(tabId: number, opts: { level?: string; clear?: boolean } = {}): Promise<ConsoleEntry[]> {
    const s = await this.ensureAttached(tabId);
    const logs = opts.level ? s.consoleLogs.filter((l) => l.level === opts.level) : [...s.consoleLogs];
    if (opts.clear) s.consoleLogs = [];
    return logs;
  }

  async getNetworkRequests(
    tabId: number,
    opts: { urlFilter?: string; onlyErrors?: boolean; clear?: boolean } = {},
  ): Promise<NetworkEntry[]> {
    const s = await this.ensureAttached(tabId);
    let list = s.networkOrder.map((id) => s.networkMap.get(id)!).filter(Boolean);
    if (opts.urlFilter) {
      const needle = opts.urlFilter.toLowerCase();
      list = list.filter((n) => n.url.toLowerCase().includes(needle));
    }
    if (opts.onlyErrors) {
      list = list.filter((n) => n.failed || (n.status !== undefined && n.status >= 400));
    }
    if (opts.clear) {
      s.networkMap.clear();
      s.networkOrder = [];
    }
    return list;
  }

  async evaluate(tabId: number, expression: string): Promise<{ value?: unknown; error?: string }> {
    const res = await this.send<{ result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      tabId,
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
    );
    if (res.exceptionDetails) {
      return { error: res.exceptionDetails.exception?.description || res.exceptionDetails.text || "Evaluation error" };
    }
    return { value: res.result?.value !== undefined ? res.result.value : res.result?.description };
  }
}

export const cdpController = new CdpController();
