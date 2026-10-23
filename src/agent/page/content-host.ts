/** Content-script side of the agent: hosts one PageObserver per page and answers agent:* messages. */
import { PageObserver } from "./observer";
import type { ActionRequest } from "../types";

let obs: PageObserver | null = null;
const get = () => (obs ??= new PageObserver(document));

export type AgentPageMessage =
  | { type: "agent:snapshot" }
  | { type: "agent:describe"; index: string }
  | { type: "agent:execute"; action: ActionRequest }
  | { type: "agent:domChanged" }
  | { type: "agent:highlight"; index?: string }
  | { type: "agent:abort" };

let hl: HTMLElement | null = null;
function highlight(index?: string) {
  hl?.remove();
  hl = null;
  const el = index ? get().element(index) : undefined;
  if (!el) return;
  const r = el.getBoundingClientRect();
  hl = document.createElement("div");
  hl.setAttribute("data-sidekick-highlight", "");
  Object.assign(hl.style, {
    position: "fixed", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`,
    border: "2px solid #00bc7c", borderRadius: "6px", pointerEvents: "none", zIndex: "2147483647", transition: "all .15s",
  });
  document.documentElement.appendChild(hl);
}

export async function handleAgentMessage(msg: AgentPageMessage): Promise<{ ok: true; data?: unknown }> {
  switch (msg.type) {
    case "agent:snapshot":
      highlight();
      return { ok: true, data: get().snapshot() };
    case "agent:describe":
      return { ok: true, data: get().describe(msg.index) ?? null };
    case "agent:execute":
      return { ok: true, data: await get().execute(msg.action) };
    case "agent:domChanged":
      return { ok: true, data: get().domChanged() };
    case "agent:abort":
      obs?.abort();
      highlight();
      return { ok: true };
    case "agent:highlight":
      highlight(msg.index);
      return { ok: true };
  }
}
