/** Side-panel UI for one web-action run: step list, confirm / ask cards, stop and take-over. */
import { useEffect, useRef, useState } from "react";
import { Check, Hand, Loader2, OctagonX, ShieldAlert, Square, X } from "lucide-react";
import { Button } from "./components/ui";
import { Mascot } from "./mascot/Mascot";
import { AGENT_PORT, type AgentEvent, type AgentRequest } from "@/src/agent/protocol";
import type { ConfirmDecision, ConfirmRequest, StepRecord } from "@/src/agent/types";
import type { RunOutcome } from "@/src/agent/loop";
import { tr } from "@/src/i18n";

type Pending = { kind: "confirm"; id: string; req: ConfirmRequest } | { kind: "ask"; id: string; question: string; options?: string[] };

export function AgentRun({ tabId, task, onClose }: { tabId: number; task: string; onClose: () => void }) {
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [started, setStarted] = useState(false);
  const [answer, setAnswer] = useState("");
  const port = useRef<chrome.runtime.Port | null>(null);
  const post = (m: AgentRequest) => port.current?.postMessage(m);

  useEffect(() => {
    const p = chrome.runtime.connect({ name: AGENT_PORT });
    port.current = p;
    p.onMessage.addListener((e: AgentEvent) => {
      if (e.type === "started") setStarted(true);
      if (e.type === "step") setSteps((s) => [...s, e.step]);
      if (e.type === "confirm") setPending({ kind: "confirm", id: e.id, req: e.req });
      if (e.type === "ask") setPending({ kind: "ask", id: e.id, question: e.question, options: e.options });
      if (e.type === "end") {
        setOutcome(e.outcome);
        setPending(null);
      }
    });
    p.postMessage({ type: "start", tabId, task } satisfies AgentRequest);
    return () => p.disconnect();
  }, [tabId, task]);

  const running = !outcome;
  const stop = () => {
    post({ type: "stop" });
    setPending(null);
  };
  const decide = (decision: ConfirmDecision) => {
    if (pending?.kind !== "confirm") return;
    post({ type: "confirm-reply", id: pending.id, decision });
    setPending(null);
  };
  const reply = (text: string) => {
    if (pending?.kind !== "ask") return;
    post({ type: "ask-reply", id: pending.id, answer: text });
    setPending(null);
    setAnswer("");
  };
  const mood = pending ? "needs-action" : running ? "generating" : outcome?.status === "done" && outcome.success ? "done" : outcome?.status === "error" ? "error" : "idle";
  const status = !outcome
    ? started ? tr("agent.running", { n: steps.length + 1 }) : tr("agent.starting")
    : outcome.status === "done" ? (outcome.success ? tr("agent.done") : tr("agent.failed"))
    : outcome.status === "stopped" ? tr("agent.stopped")
    : outcome.status === "budget" ? tr("agent.budget")
    : outcome.error === "restricted-page" ? tr("agent.restricted")
    : outcome.error === "never-site" ? tr("agent.neverSite")
    : outcome.error === "model-timeout" ? tr("agent.timeout")
    : outcome.error === "no-action" ? tr("agent.noAction")
    : tr("agent.error", { msg: outcome.error ?? "" });

  return (
    <div data-testid="agent-run" className="animate-in rounded-card border border-border bg-card p-3 text-[13px]">
      <div className="flex items-center gap-2">
        <Mascot state={mood} size={22} />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{tr("agent.title")}</div>
          <div className="truncate text-muted-foreground" title={task}>{task}</div>
        </div>
        {running ? (
          <>
            <Button size="sm" variant="outline" icon={Hand} onClick={stop} testId="agent-takeover">{tr("agent.takeOver")}</Button>
            <Button size="sm" variant="outline" icon={Square} onClick={stop} testId="agent-stop">{tr("agent.stop")}</Button>
          </>
        ) : (
          <button onClick={onClose} aria-label={tr("agent.close")} className="opacity-60 hover:opacity-100"><X className="size-4" /></button>
        )}
      </div>

      <ol className="mt-2 max-h-56 space-y-1 overflow-y-auto" data-testid="agent-steps">
        {steps.map((s) => (
          <li key={s.n} className="text-[12.5px]">
            <span className="text-muted-foreground">{s.n}.</span>{" "}
            {s.actions.map((a, i) => (
              <span key={i} className={a.blocked ? "text-amber-700 dark:text-amber-300" : a.ok ? "" : "text-destructive"}>
                {a.blocked ? <ShieldAlert className="mr-0.5 inline size-3" /> : a.ok ? <Check className="mr-0.5 inline size-3 text-primary" /> : <OctagonX className="mr-0.5 inline size-3" />}
                {a.name}{a.message ? ` · ${a.message.slice(0, 80)}` : ""}{i < s.actions.length - 1 ? "; " : ""}
              </span>
            ))}
          </li>
        ))}
      </ol>

      {pending?.kind === "confirm" && (
        <div data-testid="agent-confirm" className="mt-2 rounded-card bg-amber-500/10 p-2.5">
          <div className="flex items-center gap-1.5 font-medium"><ShieldAlert className="size-4" />{tr("agent.confirmTitle")}</div>
          <div className="mt-1 text-muted-foreground">{pending.req.reason}</div>
          {pending.req.target && <div className="mt-1 truncate font-mono text-[12px]">{pending.req.action.name} · {pending.req.target.text || pending.req.target.tag}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => decide("allow-once")} testId="agent-allow-once">{tr("agent.allowOnce")}</Button>
            {/* deletion / payment carry no kind: only "allow once" or "deny" */}
            {pending.req.kind && <Button size="sm" variant="outline" onClick={() => decide("allow-kind")} testId="agent-allow-kind">{tr("agent.allowKind")}</Button>}
            {pending.req.kind && <Button size="sm" variant="outline" onClick={() => decide("allow-site")} testId="agent-allow-site">{tr("agent.allowSite")}</Button>}
            <Button size="sm" variant="outline" onClick={() => decide("deny")} testId="agent-deny">{tr("agent.deny")}</Button>
          </div>
        </div>
      )}

      {pending?.kind === "ask" && (
        <div data-testid="agent-ask" className="mt-2 rounded-card bg-primary-soft p-2.5">
          <div className="font-medium">{tr("agent.askTitle")}</div>
          <div className="mt-1">{pending.question}</div>
          {pending.options?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pending.options.map((o) => <Button key={o} size="sm" variant="outline" onClick={() => reply(o)}>{o}</Button>)}
            </div>
          ) : (
            <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); reply(answer); }}>
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} className="min-w-0 flex-1 rounded-btn border border-border bg-background px-2 py-1" />
              <Button size="sm" type="submit">{tr("agent.answer")}</Button>
            </form>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="agent-status">
        {running && <Loader2 className="size-3.5 animate-spin" />}
        {status}
        {outcome?.status === "done" && outcome.text && <span className="text-foreground"> · {outcome.text}</span>}
      </div>
    </div>
  );
}
