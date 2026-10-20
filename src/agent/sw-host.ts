/** Service-worker side of a web-action run: owns the WebAgent, the model key and the tab driver. */
import { WebAgent } from "./loop";
import { TabDriver } from "./tab-driver";
import type { AgentEvent, AgentRequest } from "./protocol";
import type { ConfirmDecision } from "./types";
import { agentStreamFn, toPiModel } from "@/src/lib/llm";
import type { ProviderConfig } from "@/src/lib/types";

export interface SwDeps {
  resolveModel(): Promise<{ provider: ProviderConfig; modelId: string; apiKey?: string }>;
  ensureInjected(tabId: number): Promise<void>;
  neverSites(): Promise<string[]>;
}

export function attachAgentPort(port: chrome.runtime.Port, deps: SwDeps) {
  let agent: WebAgent | null = null;
  let seq = 0;
  const pending = new Map<string, (v: string) => void>();
  const send = (e: AgentEvent) => {
    try {
      port.postMessage(e);
    } catch {
      /* closed */
    }
  };
  /** Wait for a reply from the panel; a stop (abort) or a closed panel resolves to the fallback. */
  const waitReply = (id: string, fallback: string, signal?: AbortSignal) =>
    new Promise<string>((resolve) => {
      pending.set(id, resolve);
      signal?.addEventListener("abort", () => resolve(fallback), { once: true });
    }).finally(() => pending.delete(id));

  port.onDisconnect.addListener(() => {
    agent?.stop();
    pending.forEach((r) => r("deny"));
  });

  port.onMessage.addListener(async (req: AgentRequest) => {
    if (req.type === "stop") {
      agent?.stop();
      pending.forEach((r) => r("deny"));
      return;
    }
    if (req.type === "confirm-reply") return pending.get(req.id)?.(req.decision);
    if (req.type === "ask-reply") return pending.get(req.id)?.(req.answer);
    if (req.type !== "start" || agent) return;
    try {
      const r = await deps.resolveModel();
      await deps.ensureInjected(req.tabId);
      send({ type: "started", model: `${r.provider.name} · ${r.modelId}` });
      agent = new WebAgent({
        model: toPiModel(r.provider, r.modelId),
        streamFn: agentStreamFn(r.provider.kind),
        getApiKey: () => r.apiKey,
        driver: new TabDriver(req.tabId, deps.ensureInjected),
        never: await deps.neverSites(),
        hooks: {
          confirm: async (c, signal) => {
            const id = `c${++seq}`;
            send({ type: "confirm", id, req: c });
            return (await waitReply(id, "deny", signal)) as ConfirmDecision;
          },
          askUser: async (question, options, signal) => {
            const id = `a${++seq}`;
            send({ type: "ask", id, question, options });
            return waitReply(id, "", signal);
          },
          onStep: (step) => send({ type: "step", step }),
        },
      });
      const outcome = await agent.run(req.task);
      send({ type: "end", outcome });
    } catch (e) {
      send({ type: "end", outcome: { status: "error", steps: 0, error: String((e as Error)?.message ?? e) } });
    } finally {
      agent = null;
    }
  });
}
