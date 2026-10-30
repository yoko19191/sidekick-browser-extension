/**
 * DOM facts the observer builds on: what a user can see, what is interactive or sensitive, composed-tree (shadow DOM)
 * navigation, form ownership, and accessible names. Pure DOM, no chrome.* calls, so it runs in jsdom tests.
 */
const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton", "treeitem"]);
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-|cc$)/i;
const SENSITIVE_NAME = /pass(word|wd)?|pwd|otp|one.?time|verif(y|ication).?code|验证码|密码|card.?(number|no)|cc.?(num|number|cvc|csc|exp)|cvv|cvc|security.?code/i;
const MAX_TEXT = 80;

/** True when a user could see the element. Hides display:none, opacity 0, near-zero font, and off-screen text (spec: do not feed invisible page text to the model). */
export function visible(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.hidden) return false;
  const win = el.ownerDocument.defaultView;
  const st = win?.getComputedStyle?.(el);
  // display:contents boxes nothing itself (checkVisibility() is false for it), but its children render normally —
  // e.g. Shoelace's <sl-dialog> host. Let each child decide.
  if (st?.display === "contents") return true;
  const anyEl = el as any;
  if (typeof anyEl.checkVisibility === "function") {
    if (!anyEl.checkVisibility({ checkVisibilityCSS: true })) return false;
    // Chrome's checkOpacity also counts opacity:0 on display:contents ancestors, which renders nothing (Shoelace's docs
    // fade custom elements in, and on a display:contents host that fade stays at 0). Only on that slow path, re-check
    // the ancestors ourselves and skip the display:contents ones.
    if (!anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && transparentAncestor(el)) return false;
  }
  if (st) {
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    const fs = parseFloat(st.fontSize);
    if (Number.isFinite(fs) && fs > 0 && fs < 1) return false;
  }
  // Positioned off the document entirely (e.g. left:-9999px tricks). Content merely below the fold is NOT hidden:
  // the walker keeps descending and nearViewport() decides whether it is listed or only counted.
  try {
    const r = he.getBoundingClientRect?.();
    if (r && win && r.width + r.height > 0) {
      const docW = Math.max(el.ownerDocument.documentElement?.scrollWidth ?? 0, win.innerWidth);
      const absRight = r.right + win.scrollX, absBottom = r.bottom + win.scrollY, absLeft = r.left + win.scrollX;
      if (absRight < 0 || absBottom < 0 || absLeft >= docW) return false; // sr-only (1px, margin:-1px) ends exactly at 0 and stays visible
    }
  } catch { /* jsdom */ }
  return true;
}

/** `el` or a flat-tree ancestor that actually renders (not display:contents) has opacity 0. */
function transparentAncestor(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  for (let n: Node | null = el; n; n = composedParent(n)) {
    if (n.nodeType !== 1) continue;
    const st = win?.getComputedStyle?.(n as Element);
    if (st && st.display !== "contents" && st.opacity === "0") return true;
  }
  return false;
}

/** Element centre is inside (or within one screen of) the viewport. */
export function nearViewport(el: Element, screens = 1): boolean {
  const he = el as HTMLElement;
  const win = el.ownerDocument.defaultView;
  const r = he.getBoundingClientRect?.();
  if (!r || !win || r.width + r.height === 0) return true; // unknown → keep
  const m = Math.max(win.innerHeight, 1) * screens;
  return r.bottom >= -m && r.top <= win.innerHeight + m && r.right >= -m && r.left <= win.innerWidth + m;
}

export function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return (el as HTMLAnchorElement).hasAttribute("href");
  if (["button", "select", "textarea", "summary"].includes(tag)) return !(el as HTMLButtonElement).disabled;
  if (tag === "input") return (el as HTMLInputElement).type !== "hidden" && !(el as HTMLInputElement).disabled;
  const role = el.getAttribute("role");
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if ((el as HTMLElement).isContentEditable || el.getAttribute("contenteditable") === "true") return true;
  if (el.hasAttribute("onclick")) return true;
  const ti = el.getAttribute("tabindex");
  return ti !== null && Number(ti) >= 0;
}

export function isSensitive(el: Element): boolean {
  if (el.tagName.toLowerCase() !== "input" && el.tagName.toLowerCase() !== "textarea") return false;
  const i = el as HTMLInputElement;
  if (i.type === "password" || i.type === "file") return true;
  const ac = i.getAttribute("autocomplete") ?? "";
  if (SENSITIVE_AUTOCOMPLETE.test(ac)) return true;
  const hint = `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute("aria-label") ?? ""}`;
  return SENSITIVE_NAME.test(hint);
}

/** Covered by another element at its centre (cookie bars, overlays). Needs layout; false when unknown. */
/** Parent in the composed (flattened) tree: slot assignment first, then DOM parent, then shadow host. */
function composedParent(n: Node): Node | null {
  const slot = (n as Element).assignedSlot;
  if (slot) return slot;
  if (n.parentNode) return n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
  return null;
}

/** True when `inner` is `outer` or sits inside it in the composed tree (crosses shadow roots and slots). */
export function composedContains(outer: Node, inner: Node): boolean {
  for (let n: Node | null = inner; n; n = composedParent(n)) if (n === outer) return true;
  return false;
}

/** Element.closest() that also climbs out of shadow roots (a web component's inner button sits in its host's form). */
function composedClosest(el: Element, selector: string): Element | null {
  for (let n: Node | null = el; n; n = composedParent(n)) if (n.nodeType === 1 && (n as Element).matches(selector)) return n as Element;
  return null;
}

/** The form an element submits: its own form owner, else the nearest <form> in the composed tree. */
export function formOf(el: Element): HTMLFormElement | null {
  return (el as HTMLInputElement).form ?? (composedClosest(el, "form") as HTMLFormElement | null);
}

/** querySelectorAll that also searches open shadow roots below `root`. */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const out = Array.from(root.querySelectorAll(selector));
  for (const el of Array.from(root.querySelectorAll("*"))) if (el.shadowRoot) out.push(...deepQueryAll(el.shadowRoot, selector));
  return out;
}

/**
 * A checkbox/radio that is visually hidden (opacity 0, 0×0, display:none…) and operated through its visible <label>,
 * the usual custom-styled toggle (IKEA filters). The label is what the user sees and clicks.
 */
export function labelProxy(el: Element): HTMLLabelElement | undefined {
  if (el.tagName.toLowerCase() !== "input") return undefined;
  const i = el as HTMLInputElement;
  if ((i.type !== "checkbox" && i.type !== "radio") || i.disabled) return undefined;
  return Array.from(i.labels ?? []).find((l) => visible(l));
}

/** What the user sees for `el`: itself, or the label standing in for a hidden checkbox/radio. */
export function box(el: Element): Element {
  return (!visible(el) && labelProxy(el)) || el;
}

/** Deepest element at a point, descending through open shadow roots. */
function deepHit(doc: Document, x: number, y: number): Element | null {
  let hit = doc.elementFromPoint?.(x, y) ?? null;
  for (let i = 0; hit?.shadowRoot && i < 32; i++) {
    const inner = hit.shadowRoot.elementFromPoint?.(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

export function isOccluded(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r || r.width === 0 || r.height === 0) return false;
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return false;
  if (typeof doc.elementFromPoint !== "function") return false;
  const hit = deepHit(doc, x, y);
  return !!hit && !composedContains(el, hit) && !composedContains(hit, el);
}

export function clean(s: string | null | undefined, max = MAX_TEXT): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** Tiny font or positioned off the document: hidden even under ARIA naming rules (which do count display:none refs). */
function tinyOrOffDoc(el: Element): boolean {
  const win = el.ownerDocument.defaultView;
  const fs = parseFloat(win?.getComputedStyle?.(el).fontSize ?? "");
  if (Number.isFinite(fs) && fs > 0 && fs < 1) return true;
  try {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    if (r && win && r.width + r.height > 0 && (r.right + win.scrollX < 0 || r.bottom + win.scrollY < 0)) return true;
  } catch { /* jsdom */ }
  return false;
}

/**
 * Text of `root` built only from text nodes whose element chain (up to and including root) passes `isShown`.
 * innerText/textContent would leak opacity:0, tiny-font or display:none text into names (prompt-injection vector).
 * Walks the flat tree like an accessible-name computation: a shadow host shows its shadow content, and a <slot>
 * shows what is assigned to it — <sl-button>'s inner <button> gets its label "No, thanks" only through a slot.
 */
function shownText(root: Element, isShown: (el: Element) => boolean = visible): string {
  const out: string[] = [];
  const visit = (n: Node) => {
    if (n.nodeType === 3) return void out.push(n.nodeValue ?? "");
    if (n.nodeType !== 1 || !isShown(n as Element)) return;
    const el = n as Element;
    const assigned = el.tagName === "SLOT" ? (el as HTMLSlotElement).assignedNodes({ flatten: true }) : [];
    // a slot with nothing assigned renders its fallback children
    const kids = assigned.length ? assigned : Array.from((el.shadowRoot ?? el).childNodes);
    for (const k of kids) visit(k);
  };
  visit(root);
  return out.join(" ");
}

export function labelOf(el: Element): string {
  const he = el as HTMLElement;
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const lb = el.getAttribute("aria-labelledby");
  if (lb) {
    const t = lb.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)).map((r) => (r ? shownText(r, (e) => !tinyOrOffDoc(e)) : "")).join(" ");
    if (t.trim()) return clean(t);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const i = el as HTMLInputElement;
    const lab = i.labels?.[0] ? shownText(i.labels[0]) : "";
    if (lab) return clean(lab);
    if (i.type === "submit" || i.type === "button") return clean(i.value);
    return clean(i.placeholder || i.name || el.getAttribute("title"));
  }
  return clean(shownText(he)) || clean(el.getAttribute("title")) || clean((el.querySelector("img") as HTMLImageElement | null)?.alt);
}
