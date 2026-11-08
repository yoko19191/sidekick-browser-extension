/** Content-script side of the agent: hosts one PageObserver per page and answers agent:* messages. */
import { PageObserver } from "./observer";
import type { ActionRequest } from "../types";

let obs: PageObserver | null = null;
const get = () => (obs ??= new PageObserver(document));

export type AgentPageMessage =
  | { type: "agent:snapshot" }
  | { type: "agent:describe"; index: string }
  | { type: "agent:box"; index: string; hover?: boolean }
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
    case "agent:box": {
      const el = get().element(msg.index);
      if (!el) return { ok: true, data: null };
      el.scrollIntoView?.({ block: "center", inline: "center" });
      highlight(msg.index);
      const r = el.getBoundingClientRect();
      let offsetX = 0;
      let offsetY = 0;
      if (el.ownerDocument !== document) {
        const frame = [...document.querySelectorAll("iframe, frame")].find(
          (f) => (f as HTMLIFrameElement).contentDocument === el.ownerDocument,
        );
        if (frame) {
          const fr = frame.getBoundingClientRect();
          offsetX = fr.left;
          offsetY = fr.top;
        }
      }
      const x = Math.round(offsetX + r.left + r.width / 2);
      const y = Math.round(offsetY + r.top + r.height / 2);
      if (msg.hover) {
        for (const type of [" pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
          el.dispatchEvent(new MouseEvent(type.trim(), { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        }
      }
      return {
        ok: true,
        data: {
          x,
          y,
          width: Math.round(r.width),
          height: Math.round(r.height),
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          href: (el as HTMLAnchorElement).href || undefined,
          target: (el as HTMLAnchorElement).target || undefined,
        },
      };
    }
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
