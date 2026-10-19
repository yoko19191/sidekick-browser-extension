import type { ChatTurn, PortEvent, PortRequest } from "@/src/lib/types";

export const LLM_PORT = "pagepilot-llm";

export async function bg<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error ?? "后台无响应");
  return res.data as T;
}

type Handler = (e: PortEvent) => void;

/**
 * Long-lived port to the service worker. Streaming over a port keeps the MV3 worker alive; while a
 * request is in flight we also ping every 15s so silent phases (e.g. model "thinking") can't let it idle out.
 */
class LlmClient {
  private port: chrome.runtime.Port | null = null;
  private handlers = new Map<string, Handler>();
  private pinger: number | undefined;
  lastBootId: string | undefined;

  private connect() {
    if (this.port) return this.port;
    const port = chrome.runtime.connect({ name: LLM_PORT });
    port.onMessage.addListener((e: PortEvent) => {
      if (e.type === "pong") {
        this.lastBootId = e.bootId;
        return;
      }
      this.handlers.get(e.id)?.(e);
      if (e.type === "done" || e.type === "error") this.finish(e.id);
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      // Any stream still open lost its worker — surface it instead of hanging.
      for (const [id, h] of this.handlers) h({ type: "error", id, message: "与后台的连接已断开，请重试" });
      this.handlers.clear();
      this.updatePinger();
    });
    this.port = port;
    return port;
  }

  private post(req: PortRequest) {
    this.connect().postMessage(req);
  }

  private finish(id: string) {
    this.handlers.delete(id);
    this.updatePinger();
  }

  private updatePinger() {
    if (this.handlers.size && !this.pinger) this.pinger = window.setInterval(() => this.port && this.post({ type: "ping" }), 15000);
    if (!this.handlers.size && this.pinger) {
      clearInterval(this.pinger);
      this.pinger = undefined;
    }
  }

  chat(req: { task: "chat" | "summary"; messages: ChatTurn[]; page?: { title: string; url: string; markdown: string } }, onEvent: Handler) {
    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.handlers.set(id, onEvent);
    this.post({ type: "chat", id, ...req });
    this.post({ type: "ping" });
    this.updatePinger();
    return { id, abort: () => this.port && this.post({ type: "abort", id }) };
  }
}

export const llm = new LlmClient();
