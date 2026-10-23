/** Service-worker side of a web-action run: owns the WebAgent, the model key and the tab driver. */
import { WebAgent } from "./loop";
import { TabDriver } from "./tab-driver";
import type { AgentEvent, AgentRequest } from "./protocol";
import type { ConfirmDecision } from "./types";
import { agentStreamFn, toPiModel } from "@/src/lib/llm";
import type { ProviderConfig } from "@/src/lib/types";
import { agentStore } from "./store";
import { isRestrictedUrl, siteOf } from "./risk";

/** `outcome.error` codes for runs refused before they start; the panel shows a localized reason. */
export const RESTRICTED_PAGE = "restricted-page";
export const NEVER_SITE = "never-site";
import type { StepRecord } from "./types";

export interface SwDeps {
  resolveModel(): Promise<{ provider: ProviderConfig; modelId: string; apiKey?: string }>;
  ensureInjected(tabId: number): Promise<void>;
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
    const startedAt = Date.now();
    const runId = `r${startedAt}`;
    const recorded: StepRecord[] = [];
    let pageUrl = "";
    try {
      // Refuse browser-internal pages before doing anything (tab.url may be hidden without host access;
      // then a failed injection is the signal: chrome://, the Web Store, the New Tab page…).
      pageUrl = (await chrome.tabs.get(req.tabId).catch(() => undefined))?.url ?? "";
      // No readable URL means the never-act list cannot be checked: refuse instead of skipping it.
      if (!pageUrl || isRestrictedUrl(pageUrl)) return send({ type: "end", outcome: { status: "error", steps: 0, error: RESTRICTED_PAGE } });
      try {
        await deps.ensureInjected(req.tabId);
      } catch {
        return send({ type: "end", outcome: { status: "error", steps: 0, error: RESTRICTED_PAGE } });
      }
      const r = await deps.resolveModel();
      const site = siteOf(pageUrl);
      const policy = site ? await agentStore.getPolicy(site) : undefined;
      if (policy?.neverAct) {
        send({ type: "end", outcome: { status: "error", steps: 0, error: NEVER_SITE } });
        return;
      }
      const never = (await agentStore.listPolicies()).filter((p) => p.neverAct).map((p) => p.site);
      send({ type: "started", model: `${r.provider.name} · ${r.modelId}` });
      agent = new WebAgent({
        model: toPiModel(r.provider, r.modelId),
        streamFn: agentStreamFn(r.provider.kind),
        getApiKey: () => r.apiKey,
        driver: new TabDriver(req.tabId, deps.ensureInjected),
        never,
        allowedKinds: policy?.allowKinds,
        hooks: {
          confirm: async (c, signal) => {
            const id = `c${++seq}`;
            send({ type: "confirm", id, req: c });
            const decision = (await waitReply(id, "deny", signal)) as ConfirmDecision;
            if (decision === "allow-site" && c.kind && site) {
              const prev = (await agentStore.getPolicy(site)) ?? { site, updatedAt: Date.now() };
              const kinds = new Set(prev.allowKinds ?? []);
              kinds.add(c.kind);
              await agentStore.setPolicy({ ...prev, allowKinds: [...kinds], updatedAt: Date.now() }).catch(() => {});
            }
            return decision;
          },
          askUser: async (question, options, signal) => {
            const id = `a${++seq}`;
            send({ type: "ask", id, question, options });
            return waitReply(id, "", signal);
          },
          onStep: (step) => {
            recorded.push(step);
            send({ type: "step", step });
          },
        },
      });
      const outcome = await agent.run(req.task);
      send({ type: "end", outcome });
      await agentStore.saveRun(
        {
          id: runId,
          task: req.task,
          url: pageUrl,
          status: outcome.status,
          success: outcome.status === "done" ? outcome.success : undefined,
          text: outcome.status === "done" ? outcome.text : undefined,
          error: outcome.status === "error" ? outcome.error : undefined,
          steps: outcome.steps,
          startedAt,
          endedAt: Date.now(),
        },
        recorded,
      ).catch(() => {});
    } catch (e) {
      send({ type: "end", outcome: { status: "error", steps: 0, error: String((e as Error)?.message ?? e) } });
    } finally {
      agent = null;
    }
  });
}
