/**
 * 翻翻 mascot — the designer's layered SVG (assets/mascot/fanfan-layered.svg, imported as text at build time) with
 * expressions driven by a single `state` prop. Pure SVG + CSS transforms + one rAF loop that sleeps once settled.
 *
 * ── Art contract (swap the SVG file, no code changes) ──────────────────────────────────────────────────────────
 *   <svg viewBox="0 0 128 128">
 *     <g id="ff-body">                      static: #ff-leaf (green page corner), body, #ff-sheen (highlight), #ff-rim
 *     <g id="ff-face">                      (or id="ff-eyes") the eyes layer. Pointer-follow translates this group,
 *                                           max 9 x / 7 y user units — leave that much room inside the body.
 *       <g data-state="idle">…</g>          one child per expression; the component shows the matching one and hides
 *       <g data-state="listening">…</g>     its siblings (`display`). Unknown/missing expression → the `idle` child,
 *       …                                   plus the in-code motion below. Blink = scaleY on the idle child's shapes.
 *     </g>
 *   </svg>
 *   The same rule applies to any other group whose children carry data-state (e.g. per-state shapes inside
 *   #ff-eye-left / #ff-eye-right). Ids are rewritten per instance (`id="x"` → `<uid>-x`, `url(#x)`, `href="#x"`),
 *   so gradients are safe with several mascots on one page. Don't animate these ids inside the SVG itself.
 *
 * ── States (prop) → drawing (first data-state found) + in-code motion ─────────────────────────────────────────
 *   idle          idle                 follows the pointer, random blink; after 60 s without input → sleeping
 *   typing        typing | listening   looks down toward the input
 *   waiting       waiting | thinking   flat eyes scanning left ↔ right (sent, no token yet)
 *   generating    generating | working gentle bounce (streaming)
 *   translating   translating | working  looks left toward the page
 *   done          done                 ^ ^ + small hop for ~1 s, then idle
 *   needs-action  needs-action | needs-you  head tilt (missing key / site permission)
 *   error         error                eyes droop + one small head shake
 *   sleeping      sleeping | sleep     closed; wakes (→ idle) when the pointer moves in the panel
 *   surprised     surprised | listening  eyes pop bigger for ~0.9 s (selection received), then idle
 * prefers-reduced-motion: the expression shapes still switch, but nothing moves (no follow, blink, bounce, hop…).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import raw from "@/assets/mascot/fanfan-layered.svg?raw";
import { tr } from "@/src/i18n";

export type MascotState = "idle" | "typing" | "waiting" | "generating" | "translating" | "done" | "needs-action" | "error" | "sleeping" | "surprised";
export const MASCOT_STATES: MascotState[] = ["idle", "typing", "waiting", "generating", "translating", "done", "needs-action", "error", "sleeping", "surprised"];

export const DRAWING: Record<MascotState, string[]> = {
  idle: ["idle"], typing: ["typing", "listening"], waiting: ["waiting", "thinking"], generating: ["generating", "working"],
  translating: ["translating", "working"], done: ["done"], "needs-action": ["needs-action", "needs-you"], error: ["error"],
  sleeping: ["sleeping", "sleep"], surprised: ["surprised", "listening"],
};
const TRANSIENT: Partial<Record<MascotState, number>> = { done: 1100, surprised: 900 };
const MAX_X = 9, MAX_Y = 7, REACH = 220, GLANCE_MS = 1400, SLEEP_MS = 60_000;

// ---- one shared pointer tracker for the panel document ----
const pointer = { x: 0, y: 0, inside: false, leftAt: 0, movedAt: 0 };
const wakers = new Set<() => void>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  const wake = () => wakers.forEach((w) => w());
  const leave = () => { if (pointer.inside) { pointer.inside = false; pointer.leftAt = performance.now(); wake(); } };
  window.addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true; pointer.movedAt = performance.now(); wake(); }, { passive: true });
  window.addEventListener("keydown", () => { pointer.movedAt = performance.now(); wake(); }, { passive: true });
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("blur", leave);
}
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Show, in every group whose children carry data-state, the first child matching `keys` (else the idle one). */
export function showDrawing(root: Element, keys: string[]): Element[] {
  const shown: Element[] = [];
  const groups = new Set([...root.querySelectorAll("[data-state]")].map((el) => el.parentElement!));
  for (const g of groups) {
    const kids = [...g.children].filter((c) => c.hasAttribute("data-state"));
    const pick = keys.map((k) => kids.find((c) => c.getAttribute("data-state") === k)).find(Boolean) ?? kids.find((c) => c.getAttribute("data-state") === "idle") ?? kids[0];
    for (const c of kids) c.setAttribute("display", c === pick ? "inline" : "none");
    if (pick) shown.push(pick);
  }
  return shown;
}

/**
 * still: render the expression without any motion (old message avatars, headers).
 * hold:  dev/gallery — keep the expression (no transient relax, no doze, no follow/blink) but keep its pose.
 */
export function Mascot({ state = "idle", size = 48, still = false, hold = false, className, label }: { state?: MascotState; size?: number; still?: boolean; hold?: boolean; className?: string; label?: string }) {
  const uid = useId().replace(/[^\w-]/g, "");
  const html = useMemo(
    () => raw.replace(/<svg\b[^>]*>/, (t) => t.replace(/\s(width|height)=(['"])[^'"]*\2/g, "").replace("<svg", '<svg aria-hidden="true" focusable="false"'))
      .replace(/\bid=(['"])([\w-]+)\1/g, `id="${uid}-$2"`).replace(/url\(#([\w-]+)\)/g, `url(#${uid}-$1)`).replace(/href=(['"])#([\w-]+)\1/g, `href="#${uid}-$2"`),
    [uid],
  );
  const host = useRef<HTMLSpanElement>(null);
  // effective expression: transient states relax to idle; idle dozes off to sleeping
  const [shown, setShown] = useState<MascotState>(state);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const wakeRef = useRef<() => void>(() => {});
  const propRef = useRef(state);
  propRef.current = state;
  const sinceRef = useRef(0); // when the current expression started (idle → sleeping timer)
  const motion = !still && !reducedMotion();

  useEffect(() => {
    setShown(state);
    const ms = TRANSIENT[state];
    if (!ms || !motion || hold) return;
    const t = setTimeout(() => setShown("idle"), ms);
    return () => clearTimeout(t);
  }, [state, motion, hold]);

  // swap drawings whenever the expression changes (also with reduced motion / still)
  useEffect(() => {
    if (host.current) showDrawing(host.current, DRAWING[shown]);
    sinceRef.current = performance.now();
    wakeRef.current();
  }, [shown, html]);

  useEffect(() => {
    const root = host.current;
    if (!root || !motion) return;
    const face = root.querySelector<SVGGElement>(`[id="${uid}-ff-face"], [id="${uid}-ff-eyes"]`);
    if (face) { face.style.transformBox = "fill-box"; face.style.transformOrigin = "center"; }
    const cur = { x: 0, y: 0, s: 1, blink: 1 };
    let raf = 0, last = 0, blinkAt = -1, blinkTimer = 0;

    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const s = shownRef.current;
      let tx = 0, ty = 0, ts = 1, active = false;
      if (s === "idle" && hold) {
        /* gallery: centred, no follow / doze */
      } else if (s === "idle") {
        if (pointer.inside) {
          const r = root.getBoundingClientRect();
          const dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / REACH);
          tx = (dx / d) * k * MAX_X; ty = (dy / d) * k * MAX_Y;
        } else if (now - pointer.leftAt < GLANCE_MS) {
          tx = -MAX_X; ty = 1; active = true; // glance toward the page (left of the panel), then ease back
        }
        if (now - Math.max(pointer.movedAt, sinceRef.current) > SLEEP_MS) setShown("sleeping");
      } else if (s === "sleeping") {
        if (propRef.current === "idle" && pointer.movedAt > sinceRef.current && now - pointer.movedAt < 250) setShown("idle"); // wake up
        ty = 2;
      } else if (s === "typing") { ty = MAX_Y; ts = 1.04; }
      else if (s === "waiting") { tx = Math.sin(now / 330) * MAX_X * 0.8; ty = -1; active = true; }
      else if (s === "generating") { ty = Math.sin(now / 240) * 1.6; active = true; }
      else if (s === "translating") { tx = -MAX_X; ty = 1; }
      else if (s === "error") { ty = 2.5; }
      else if (s === "surprised") { ts = 1.14; ty = -1; }
      // blink: only while idle
      let blink = 1;
      if (blinkAt >= 0) {
        const p = (now - blinkAt) / 160;
        if (p >= 1) blinkAt = -1;
        else { blink = Math.max(0.1, 1 - Math.sin(Math.PI * p)); active = true; }
      }
      const a = 1 - Math.exp(-dt / 90); // frame-rate independent ease
      cur.x += (tx - cur.x) * a; cur.y += (ty - cur.y) * a; cur.s += (ts - cur.s) * a;
      if (face) face.style.transform = `translate(${cur.x.toFixed(2)}px,${cur.y.toFixed(2)}px) scale(${cur.s.toFixed(3)})`;
      if (blink !== cur.blink) {
        cur.blink = blink;
        const idleKids = root.querySelectorAll<SVGElement>('[data-state="idle"] > *');
        idleKids.forEach((el) => { el.style.transformBox = "fill-box"; el.style.transformOrigin = "center"; el.style.transform = blink === 1 ? "" : `scaleY(${blink.toFixed(3)})`; });
      }
      const moving = Math.abs(tx - cur.x) + Math.abs(ty - cur.y) + Math.abs(ts - cur.s) * 20 > 0.05;
      if (moving || active) raf = requestAnimationFrame(frame);
      else { last = 0; if (s === "idle") idleCheck = window.setTimeout(wake, 5000); } // settled: sleep, re-check the 60 s doze later
    };
    let idleCheck = 0;
    const wake = () => { clearTimeout(idleCheck); if (!raf) raf = requestAnimationFrame(frame); };
    wakeRef.current = wake;
    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        if (shownRef.current === "idle" && !hold) {
          blinkAt = performance.now();
          if (Math.random() < 0.2) setTimeout(() => { blinkAt = performance.now(); wake(); }, 280); // sometimes twice
          wake();
        }
        scheduleBlink();
      }, 2400 + Math.random() * 3800);
    };
    scheduleBlink();
    listen();
    wakers.add(wake);
    wake();
    return () => { wakers.delete(wake); cancelAnimationFrame(raf); clearTimeout(blinkTimer); clearTimeout(idleCheck); wakeRef.current = () => {}; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, motion, html, hold]);

  return (
    <span ref={host} role="img" aria-label={label ?? tr("brand.header")} data-testid="mascot" data-state={shown}
      className={["mascot", `mascot-${shown}`, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
