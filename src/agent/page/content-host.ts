/** Content-script side of the agent: hosts one PageObserver per page and answers agent:* messages. */
import { PageObserver } from "./observer";
import { retargetToThisTab } from "./dom";
import type { ActionRequest } from "../types";
import { tr } from "@/src/i18n";

let obs: PageObserver | null = null;
const get = () => (obs ??= new PageObserver(document));

export type AgentPageMessage =
  | { type: "agent:snapshot" }
  | { type: "agent:describe"; index: string }
  | { type: "agent:box"; index: string; hover?: boolean; action?: string }
  | { type: "agent:execute"; action: ActionRequest }
  | { type: "agent:domChanged" }
  | { type: "agent:highlight"; index?: string; x?: number; y?: number; action?: string; label?: string; clear?: boolean }
  | { type: "agent:abort" };

interface VisualOptions {
  index?: string;
  x?: number;
  y?: number;
  action?: string;
  label?: string;
}

const OVERLAY_CSS = `
@keyframes sk-frame-pulse {
  0%, 100% {
    box-shadow: inset 0 0 24px rgba(99, 102, 241, 0.32), inset 0 0 4px rgba(16, 185, 129, 0.55);
    border-color: rgba(99, 102, 241, 0.85);
  }
  50% {
    box-shadow: inset 0 0 38px rgba(16, 185, 129, 0.36), inset 0 0 8px rgba(99, 102, 241, 0.75);
    border-color: rgba(16, 185, 129, 0.88);
  }
}
@keyframes sk-dot-ping {
  0% { transform: scale(0.95); opacity: 1; }
  70% { transform: scale(2.1); opacity: 0; }
  100% { transform: scale(2.1); opacity: 0; }
}
@keyframes sk-ripple-out {
  0% { transform: translate(-50%, -50%) scale(0.25); opacity: 0.95; }
  100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; }
}
@keyframes sk-box-pop {
  0% { transform: scale(0.96); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}
`;

let overlayRoot: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let lastActionVisualAt = 0;

function clearVisual() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  overlayRoot?.remove();
  overlayRoot = null;
  lastActionVisualAt = 0;
}

function scheduleHide(ms = 2600) {
  if (hideTimer) clearTimeout(hideTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  hideTimer = setTimeout(() => {
    if (overlayRoot) {
      overlayRoot.style.opacity = "0";
      fadeTimer = setTimeout(() => {
        overlayRoot?.remove();
        overlayRoot = null;
      }, 240);
    }
  }, ms);
}

function resolveElementRect(el: Element): { left: number; top: number; width: number; height: number; cx: number; cy: number } {
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
  const left = offsetX + r.left;
  const top = offsetY + r.top;
  return {
    left,
    top,
    width: r.width,
    height: r.height,
    cx: Math.round(left + r.width / 2),
    cy: Math.round(top + r.height / 2),
  };
}

function describeElementShort(el: Element, index?: string): string {
  const tag = el.tagName.toLowerCase();
  const raw = (
    (el as HTMLInputElement).value ||
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.textContent ||
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 26);
  const idPart = index ? `[${index}] ` : "";
  return `${idPart}<${tag}>${raw ? ` "${raw}"` : ""}`;
}

function showAgentVisual(opts: VisualOptions = {}) {
  if (!document.documentElement) return;
  const el = opts.index ? get().element(opts.index) : undefined;
  const rect = el ? resolveElementRect(el) : undefined;
  const cx = opts.x ?? rect?.cx;
  const cy = opts.y ?? rect?.cy;
  const action = (opts.action ?? (el || cx != null ? "click" : "inspect")).toLowerCase();
  if (action !== "inspect") {
    lastActionVisualAt = Date.now();
  }

  const targetDesc =
    opts.label ||
    (el ? describeElementShort(el, opts.index) : opts.index ? `[${opts.index}]` : cx != null && cy != null ? `(${cx}, ${cy})` : "");

  let badgeText = "AGENT";
  let badgeColor = "#6366f1";
  let statusText = tr("hud.agentActive");

  switch (action) {
    case "click":
      badgeText = "CLICK";
      badgeColor = "#6366f1";
      statusText = tr("hud.clicking", { target: targetDesc });
      break;
    case "hover":
      badgeText = "HOVER";
      badgeColor = "#0ea5e9";
      statusText = tr("hud.hovering", { target: targetDesc });
      break;
    case "input":
      badgeText = "INPUT";
      badgeColor = "#10b981";
      statusText = tr("hud.typing", { target: targetDesc });
      break;
    case "scroll":
      badgeText = "SCROLL";
      badgeColor = "#8b5cf6";
      statusText = tr("hud.scrolling", { dir: opts.label || "↓" });
      break;
    case "send_keys":
      badgeText = "KEYS";
      badgeColor = "#f59e0b";
      statusText = tr("hud.pressing", { key: opts.label || "Key" });
      break;
    case "select_option":
      badgeText = "SELECT";
      badgeColor = "#ec4899";
      statusText = tr("hud.selecting", { target: targetDesc });
      break;
    case "extract":
    case "search_page":
      badgeText = "READ";
      badgeColor = "#14b8a6";
      statusText = tr("hud.extracting");
      break;
    default:
      badgeText = "SCAN";
      badgeColor = "#6366f1";
      statusText = tr("hud.inspecting");
      break;
  }

  if (!overlayRoot || !overlayRoot.isConnected) {
    overlayRoot = document.createElement("div");
    overlayRoot.setAttribute("data-sidekick-highlight", "");
    Object.assign(overlayRoot.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646",
      transition: "opacity 0.22s ease",
      opacity: "1",
    });
    document.documentElement.appendChild(overlayRoot);
  } else {
    overlayRoot.style.opacity = "1";
  }

  const boxHtml =
    rect && rect.width > 0 && rect.height > 0
      ? `<div style="
          position: fixed;
          left: ${Math.max(0, rect.left - 4)}px;
          top: ${Math.max(0, rect.top - 4)}px;
          width: ${rect.width + 8}px;
          height: ${rect.height + 8}px;
          border: 2px solid ${badgeColor};
          background: rgba(99, 102, 241, 0.10);
          border-radius: 8px;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.20), 0 8px 24px rgba(15, 23, 42, 0.25);
          animation: sk-box-pop 0.18s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          pointer-events: none;
        ">
          <div style="
            position: absolute;
            top: ${rect.top < 28 ? "calc(100% + 4px)" : "-24px"};
            left: -2px;
            background: ${badgeColor};
            color: #ffffff;
            font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            padding: 3px 7px;
            border-radius: 5px;
            white-space: nowrap;
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.25);
            letter-spacing: 0.04em;
          ">${badgeText}${opts.index ? ` · ${opts.index}` : ""}</div>
        </div>`
      : "";

  const rippleHtml =
    cx != null && cy != null && (action === "click" || action === "hover" || action === "input")
      ? `<div style="position: fixed; left: ${cx}px; top: ${cy}px; width: 0; height: 0; pointer-events: none;">
          <div style="
            position: absolute;
            width: 28px;
            height: 28px;
            border-radius: 9999px;
            border: 2.5px solid ${badgeColor};
            background: rgba(99, 102, 241, 0.18);
            animation: sk-ripple-out 0.75s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          "></div>
          <div style="
            position: absolute;
            width: 12px;
            height: 12px;
            transform: translate(-50%, -50%);
            border-radius: 9999px;
            background: ${badgeColor};
            border: 2px solid #ffffff;
            box-shadow: 0 2px 8px rgba(15, 23, 42, 0.45);
          "></div>
        </div>`
      : "";

  overlayRoot.innerHTML = `
    <style>${OVERLAY_CSS}</style>
    <div style="
      position: fixed;
      inset: 0;
      border: 3px solid rgba(99, 102, 241, 0.85);
      pointer-events: none;
      animation: sk-frame-pulse 2.2s ease-in-out infinite;
    "></div>
    <div style="
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: min(92vw, 540px);
      padding: 6px 14px;
      border-radius: 9999px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(99, 102, 241, 0.55);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.35), 0 0 16px rgba(99, 102, 241, 0.32);
      color: #f8fafc;
      font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    ">
      <span style="position: relative; display: inline-flex; width: 8px; height: 8px; flex-shrink: 0;">
        <span style="position: absolute; inset: 0; border-radius: 9999px; background: #10b981; animation: sk-dot-ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <span style="position: relative; display: inline-block; width: 8px; height: 8px; border-radius: 9999px; background: #10b981;"></span>
      </span>
      <span style="
        background: ${badgeColor};
        color: #ffffff;
        font: 700 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        padding: 2px 6px;
        border-radius: 4px;
        letter-spacing: 0.04em;
        flex-shrink: 0;
      ">${badgeText}</span>
      <span style="overflow: hidden; text-overflow: ellipsis;">${statusText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
    </div>
    ${boxHtml}
    ${rippleHtml}
  `;

  scheduleHide(2600);
}

export async function handleAgentMessage(msg: AgentPageMessage): Promise<{ ok: true; data?: unknown }> {
  switch (msg.type) {
    case "agent:snapshot": {
      const snap = get().snapshot();
      if (Date.now() - lastActionVisualAt < 1800 && overlayRoot?.isConnected) {
        scheduleHide(2600);
      } else {
        showAgentVisual({ action: "inspect" });
      }
      return { ok: true, data: snap };
    }
    case "agent:describe":
      return { ok: true, data: get().describe(msg.index) ?? null };
    case "agent:box": {
      const el = get().element(msg.index);
      if (!el) return { ok: true, data: null };
      el.scrollIntoView?.({ block: "center", inline: "center" });
      const rect = resolveElementRect(el);
      const x = rect.cx;
      const y = rect.cy;
      showAgentVisual({
        index: msg.index,
        x,
        y,
        action: msg.hover ? "hover" : (msg.action ?? "click"),
      });
      if (msg.hover) {
        for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        }
      } else {
        // Ensure CDP clicks on <a target="_blank"> also navigate in the current tab instead of spawning a new tab.
        const restore = retargetToThisTab(el, true);
        if (restore) setTimeout(restore, 250);
      }
      return {
        ok: true,
        data: {
          x,
          y,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          href: (el as HTMLAnchorElement).href || undefined,
          target: (el as HTMLAnchorElement).target || undefined,
        },
      };
    }
    case "agent:execute": {
      const a = msg.action;
      const args = (a.args ?? {}) as Record<string, unknown>;
      const index = typeof args.index === "string" ? args.index : undefined;
      if (a.name === "scroll") {
        showAgentVisual({ index, action: "scroll", label: args.down === false ? "↑ Up" : "↓ Down" });
      } else if (a.name === "send_keys") {
        showAgentVisual({ index, action: "send_keys", label: String(args.keys ?? "") });
      } else if (a.name === "input") {
        showAgentVisual({ index, action: "input" });
      } else if (a.name === "select_option") {
        showAgentVisual({ index, action: "select_option" });
      } else if (a.name === "click" || a.name === "hover") {
        showAgentVisual({ index, action: a.name });
      } else if (a.name === "extract" || a.name === "search_page") {
        showAgentVisual({ action: a.name });
      }
      const res = await get().execute(a);
      if (index && (a.name === "click" || a.name === "hover" || a.name === "input" || a.name === "select_option")) {
        // Refresh bounding box position after scrollIntoView / DOM focus inside execute()
        showAgentVisual({ index, action: a.name });
      }
      return { ok: true, data: res };
    }
    case "agent:domChanged":
      return { ok: true, data: get().domChanged() };
    case "agent:abort":
      obs?.abort();
      clearVisual();
      return { ok: true };
    case "agent:highlight":
      if (msg.clear) {
        clearVisual();
      } else if (msg.index || (typeof msg.x === "number" && typeof msg.y === "number") || msg.action) {
        showAgentVisual({
          index: msg.index,
          x: msg.x,
          y: msg.y,
          action: msg.action ?? "click",
          label: msg.label,
        });
      } else {
        clearVisual();
      }
      return { ok: true };
  }
}
