/** Side panel <-> service worker messages for a web-action run (port name AGENT_PORT). */
import type { ConfirmDecision, ConfirmRequest, StepRecord } from "./types";
import type { RunOutcome } from "./loop";

export const AGENT_PORT = "sidekick-agent";

export type AgentRequest =
  | { type: "start"; tabId: number; task: string }
  | { type: "stop" }
  | { type: "confirm-reply"; id: string; decision: ConfirmDecision }
  | { type: "ask-reply"; id: string; answer: string };

export type AgentEvent =
  | { type: "started"; model: string }
  | { type: "step"; step: StepRecord }
  | { type: "confirm"; id: string; req: ConfirmRequest }
  | { type: "ask"; id: string; question: string; options?: string[] }
  | { type: "end"; outcome: RunOutcome };
