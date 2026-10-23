/**
 * Page observer + action executor. Runs inside the page (content script), DOM-only, no chrome.* calls,
 * so it can be unit-tested with jsdom. Walks open shadow roots and same-origin iframes.
 */
import type { ActionRequest, ActionResult, ElementInfo, PageSnapshot } from "../types";

const INTERACTIVE_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "combobox", "textbox", "searchbox", "slider", "spinbutton", "treeitem"]);
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-|cc$)/i;
const SENSITIVE_NAME = /pass(word|wd)?|pwd|otp|one.?time|verif(y|ication).?code|验证码|密码|card.?(number|no)|cc.?(num|number|cvc|csc|exp)|cvv|cvc|security.?code/i;
const MAX_TEXT = 80;
const MAX_TREE = 40_000;

export interface ObserverOptions {
  maxTree?: number;
  /** Delay between typed characters (ms). 0 types instantly. */
  typeDelayMs?: number;
}

/** True when a user could see the element. Hides display:none, opacity 0, near-zero font, and off-screen text (spec: do not feed invisible page text to the model). */
export function visible(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.hidden) return false;
  const anyEl = el as any;
  if (typeof anyEl.checkVisibility === "function" && !anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const win = el.ownerDocument.defaultView;
  const st = win?.getComputedStyle?.(el);
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

/** Element centre is inside (or within one screen of) the viewport. */
export function nearViewport(el: Element, screens = 1): boolean {
  const he = el as HTMLElement;
  const win = el.ownerDocument.defaultView;
  const r = he.getBoundingClientRect?.();
  if (!r || !win || r.width + r.height === 0) return true; // unknown → keep
  const m = Math.max(win.innerHeight, 1) * screens;
  return r.bottom >= -m && r.top <= win.innerHeight + m && r.right >= -m && r.left <= win.innerWidth + m;
}

function isInteractive(el: Element): boolean {
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

function clean(s: string | null | undefined, max = MAX_TEXT): string {
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
 */
function shownText(root: Element, isShown: (el: Element) => boolean = visible): string {
  const ok = new Map<Element, boolean>();
  const shown = (el: Element): boolean => {
    const c = ok.get(el);
    if (c !== undefined) return c;
    const v = isShown(el) && (el === root || !el.parentElement || shown(el.parentElement));
    ok.set(el, v);
    return v;
  };
  const out: string[] = [];
  const doc = root.ownerDocument;
  const tw = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement;
    if (p && shown(p)) out.push(n.nodeValue ?? "");
  }
  return out.join(" ");
}

function labelOf(el: Element): string {
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

interface Entry {
  el: Element;
  frame: number;
}

export class PageObserver {
  private ids = new WeakMap<Element, string>();
  private byId = new Map<string, Entry>();
  private counter = 0;
  private frames: Document[] = [];
  private mutations = 0;
  private mo?: MutationObserver;
  private lastIds = new Set<string>();

  constructor(private readonly doc: Document, private readonly opts: ObserverOptions = {}) {
    const MO = doc.defaultView?.MutationObserver;
    if (MO) {
      this.mo = new MO((recs) => {
        for (const r of recs) this.mutations += r.addedNodes.length + r.removedNodes.length;
      });
      this.mo.observe(doc.documentElement, { childList: true, subtree: true });
    }
  }

  disconnect() {
    this.mo?.disconnect();
  }

  private frameIndex(d: Document): number {
    let i = this.frames.indexOf(d);
    if (i < 0) {
      this.frames.push(d);
      i = this.frames.length - 1;
    }
    return i;
  }

  private idFor(el: Element, frame: number): string {
    let id = this.ids.get(el);
    if (!id) {
      id = `f${frame}:${this.counter++}`;
      this.ids.set(el, id);
    }
    this.byId.set(id, { el, frame });
    return id;
  }

  private describeEl(el: Element, id: string): ElementInfo {
    const tag = el.tagName.toLowerCase();
    const i = el as HTMLInputElement;
    const form = (el as HTMLInputElement).form ?? el.closest("form");
    const isSubmit =
      !!form && ((tag === "button" && (i.type === "submit" || !el.getAttribute("type"))) || (tag === "input" && (i.type === "submit" || i.type === "image")));
    return {
      index: id,
      tag,
      text: labelOf(el),
      type: tag === "input" ? i.type : undefined,
      role: el.getAttribute("role") ?? undefined,
      inForm: !!form,
      formSubmitText: form
        ? Array.from(form.querySelectorAll('button[type=submit],button:not([type]),input[type=submit],input[type=image]'))
            .map((b) => clean((b as HTMLInputElement).value || b.textContent || b.getAttribute("aria-label"), 40))
            .filter(Boolean)
            .join(" / ") || undefined
        : undefined,
      isSubmit,
      formSensitive: !!form && Array.from(form.querySelectorAll("input,textarea,select")).some((f) => isSensitive(f)),
      sensitive: isSensitive(el),
      href: tag === "a" ? (el as HTMLAnchorElement).href : undefined,
      occluded: isOccluded(el),
    };
  }

  snapshot(): PageSnapshot {
    this.byId.clear();
    const lines: string[] = [];
    const max = this.opts.maxTree ?? MAX_TREE;
    let size = 0;
    let outside = 0;
    // Off-viewport interactive elements, grouped by the nearest preceding heading (with a few sample labels).
    let heading = "";
    const groups = new Map<string, { where: "above" | "below"; heading: string; count: number; labels: string[] }>();
    const push = (s: string) => {
      if (size > max) return;
      size += s.length + 1;
      lines.push(size > max ? "… (page truncated)" : s);
    };
    const seen = new Set<string>();

    const walk = (root: Document | ShadowRoot | Element, frame: number, depth: number) => {
      const kids = (root as ParentNode).children;
      for (const el of Array.from(kids)) {
        const tag = el.tagName.toLowerCase();
        if (["script", "style", "noscript", "template", "svg", "head"].includes(tag)) continue;
        if (!visible(el)) continue;
        const pad = "  ".repeat(Math.min(depth, 6));
        if (tag === "iframe") {
          try {
            const d = (el as HTMLIFrameElement).contentDocument;
            if (d?.body) walk(d.body, this.frameIndex(d), depth + 1);
          } catch {
            /* cross-origin */
          }
          // Report every cross-origin frame, in or out of the viewport, before any leaf/viewport filtering.
          if (!this.sameOrigin(el as HTMLIFrameElement) && !nearViewport(el, 1)) {
            // Far cross-origin frames go into the per-heading counts (and the shared label budget), not the tree.
            outside++;
            const top = (el as HTMLElement).getBoundingClientRect?.().top ?? 0;
            const where = top < 0 ? "above" : "below";
            const key = `${where}|${heading}`;
            const g = groups.get(key) ?? { where, heading, count: 0, labels: [] };
            g.count++;
            if (g.labels.length < 3 && !g.labels.includes("cross-origin iframe")) g.labels.push("cross-origin iframe");
            groups.set(key, g);
          } else if (!this.sameOrigin(el as HTMLIFrameElement)) push(`${pad}[unreachable: cross-origin iframe ${clean((el as HTMLIFrameElement).src, 60)}; content exists but cannot be read or operated]`);
          continue;
        }
        if (isInteractive(el)) {
          // Prefer elements near the viewport; far ones are counted, not fully listed (saves tokens on huge pages).
          if (!nearViewport(el, 1)) {
            outside++;
            const top = (el as HTMLElement).getBoundingClientRect?.().top ?? 0;
            const where = top < 0 ? "above" : "below";
            const key = `${where}|${heading}`;
            const g = groups.get(key) ?? { where, heading, count: 0, labels: [] };
            g.count++;
            const label = clean(labelOf(el), 16);
            if (label.length > 1 && g.labels.length < 3 && !g.labels.includes(label)) g.labels.push(label);
            groups.set(key, g);
            this.idFor(el, frame); // still register so describe/execute work if the model knows the id from a prior step
            continue;
          }
          const id = this.idFor(el, frame);
          seen.add(id);
          const info = this.describeEl(el, id);
          const attrs: string[] = [];
          if (info.type) attrs.push(`type=${info.type}`);
          if (info.role) attrs.push(`role=${info.role}`);
          if (info.sensitive) attrs.push("sensitive");
          if (isOccluded(el)) attrs.push("occluded");
          if (tag === "select") {
            const opts = Array.from((el as HTMLSelectElement).options).slice(0, 12).map((o) => clean(o.text, 30));
            attrs.push(`options="${opts.join("|")}"`);
          }
          if ((tag === "input" || tag === "textarea") && !info.sensitive) {
            const v = (el as HTMLInputElement).value;
            if (v) attrs.push(`value="${clean(v, 40)}"`);
          }
          if ((el as HTMLInputElement).checked) attrs.push("checked");
          const isNew = !this.lastIds.has(id) && this.lastIds.size > 0 ? "*" : "";
          push(`${pad}${isNew}[${id}]<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${info.text}</${tag}>`);
        } else if (/^h[1-6]$/.test(tag) || el.getAttribute("role") === "dialog" || tag === "dialog") {
          const ht = clean((el as HTMLElement).innerText ?? el.textContent, 120);
          if (/^h[1-6]$/.test(tag)) heading = clean(ht, 30);
          push(`${pad}<${tag}>${ht}`);
        } else if (el.children.length === 0) {
          if (!nearViewport(el, 2)) continue; // far plain text: skip (tokens); interactive ones are still counted
          const t = clean(el.textContent, 120);
          if (t.length > 1) push(`${pad}${t}`);
        }
        if (tag.includes("-") && !(el as HTMLElement).shadowRoot && el.childNodes.length === 0 && this.doc.defaultView?.customElements?.get(tag))
          push(`${pad}[unreachable: <${tag}> has a closed shadow root; content exists but cannot be read or operated]`);
        if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!, frame, depth + 1);
        if (!isInteractive(el) || tag === "label" || el.querySelector("input,select,textarea,button,a[href]")) walk(el, frame, depth + 1);
      }
    };

    this.frameIndex(this.doc);
    if (this.doc.body) walk(this.doc.body, 0, 0);
    if (outside > 0) {
      push(`[+${outside} interactive elements outside the viewport; scroll to see them]`);
      let budget = 20; // sample labels across all groups
      for (const g of [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 8)) {
        const labels = g.labels.slice(0, Math.max(0, Math.min(3, budget)));
        budget -= labels.length;
        const sec = g.heading ? ` section "${g.heading}"` : "";
        push(`  [${g.where}${sec}: ~${g.count}${labels.length ? `: ${labels.join(", ")}${g.count > labels.length ? "…" : ""}` : ""}]`);
      }
    }
    const newIds = [...seen].filter((id) => !this.lastIds.has(id));
    this.lastIds = seen;
    this.mutations = 0;
    return { url: this.doc.location?.href ?? "", title: this.doc.title, tree: lines.join("\n"), newIds };
  }

  private sameOrigin(f: HTMLIFrameElement): boolean {
    const src = f.getAttribute("src");
    if (src && /^https?:/i.test(src)) {
      try {
        if (new URL(src, this.doc.baseURI).origin !== new URL(this.doc.baseURI).origin) return false;
      } catch {
        /* fall through to contentDocument check */
      }
    }
    try {
      return !!f.contentDocument;
    } catch {
      return false;
    }
  }

  describe(id: string): ElementInfo | undefined {
    const e = this.byId.get(id);
    if (!e || !e.el.isConnected) return undefined;
    return this.describeEl(e.el, id);
  }

  /** Substantial DOM change since the last snapshot. */
  /** The live element behind an id (for the on-page highlight). */
  element(id: string): Element | undefined {
    const e = this.byId.get(id)?.el;
    return e?.isConnected ? e : undefined;
  }

  domChanged(threshold = 40): boolean {
    this.mo?.takeRecords().forEach((r) => (this.mutations += r.addedNodes.length + r.removedNodes.length));
    return this.mutations >= threshold;
  }

  private aborted = false;
  /** Stop in-flight work (per-character typing) as soon as possible. */
  abort() {
    this.aborted = true;
  }

  async execute(a: ActionRequest): Promise<ActionResult> {
    this.aborted = false;
    const args = a.args as Record<string, any>;
    const target = typeof args.index === "string" ? this.byId.get(args.index)?.el : undefined;
    if (typeof args.index === "string" && (!target || !target.isConnected)) return { ok: false, message: `element ${args.index} not found` };
    const el = target as HTMLElement | undefined;
    const win = (el?.ownerDocument ?? this.doc).defaultView!;
    try {
      switch (a.name) {
        case "click": {
          el!.scrollIntoView?.({ block: "center" });
          if (isOccluded(el!)) return { ok: false, message: `element ${args.index} is covered by another element; close the overlay first` };
          el!.focus?.();
          el!.click();
          return { ok: true, message: `clicked ${args.index}` };
        }
        case "input": {
          if (isSensitive(el!)) return { ok: false, message: "refused: sensitive field" };
          el!.focus?.();
          const text = String(args.text);
          const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          const setVal = (v: string) => (el!.isContentEditable ? (el!.textContent = v) : setter ? setter.call(el, v) : ((el as HTMLInputElement).value = v));
          const getVal = () => (el!.isContentEditable ? (el!.textContent ?? "") : (el as HTMLInputElement).value);
          if (args.clear !== false) setVal("");
          // Type per character so key-driven pages behave, and so stop interrupts mid-way.
          const delay = this.opts.typeDelayMs ?? 12;
          for (const ch of text) {
            if (this.aborted) {
              el!.dispatchEvent(new win.Event("change", { bubbles: true }));
              return { ok: false, message: "aborted by user" };
            }
            setVal(getVal() + ch);
            el!.dispatchEvent(new win.Event("input", { bubbles: true }));
            if (delay > 0) await new Promise((r) => setTimeout(r, delay));
          }
          el!.dispatchEvent(new win.Event("change", { bubbles: true }));
          return { ok: true, message: `typed into ${args.index}` };
        }
        case "select_option": {
          const sel = el as HTMLSelectElement;
          const want = String(args.text).trim().toLowerCase();
          const opt = Array.from(sel.options ?? []).find((o) => o.text.trim().toLowerCase() === want) ?? Array.from(sel.options ?? []).find((o) => o.text.toLowerCase().includes(want));
          if (!opt) return { ok: false, message: `option "${args.text}" not found` };
          sel.value = opt.value;
          sel.dispatchEvent(new win.Event("input", { bubbles: true }));
          sel.dispatchEvent(new win.Event("change", { bubbles: true }));
          return { ok: true, message: `selected "${opt.text.trim()}"` };
        }
        case "scroll": {
          const pages = Number(args.pages ?? 1) * (args.down ? 1 : -1);
          const box = el ?? (this.doc.scrollingElement as HTMLElement | null);
          const h = el ? el.clientHeight : win.innerHeight;
          if (box?.scrollBy) box.scrollBy({ top: pages * h * 0.9 });
          else win.scrollBy?.(0, pages * h * 0.9);
          return { ok: true, message: `scrolled ${args.down ? "down" : "up"}` };
        }
        case "send_keys": {
          const t = (el ?? (this.doc.activeElement as HTMLElement) ?? this.doc.body) as HTMLElement;
          const opts = { key: args.keys, bubbles: true, cancelable: true };
          const ok = t.dispatchEvent(new win.KeyboardEvent("keydown", opts));
          t.dispatchEvent(new win.KeyboardEvent("keyup", opts));
          if (ok && args.keys === "Enter") {
            const form = (t as HTMLInputElement).form;
            if (form && t.tagName.toLowerCase() === "input") form.requestSubmit?.();
          }
          return { ok: true, message: `pressed ${args.keys}` };
        }
        case "navigate":
          win.location.assign(String(args.url));
          return { ok: true, message: `navigating to ${args.url}` };
        case "go_back":
          win.history.back();
          return { ok: true, message: "went back" };
        case "wait":
          await new Promise((r) => setTimeout(r, Math.min(10, Number(args.seconds)) * 1000));
          return { ok: true, message: `waited ${args.seconds}s` };
        case "extract": {
          const main = this.doc.querySelector("main, article, [role=main]") ?? this.doc.body;
          const text = clean((main as HTMLElement).innerText ?? main.textContent, 8000);
          return { ok: true, message: `<untrusted_page_content>${text.replace(/</g, "‹").replace(/>/g, "›")}</untrusted_page_content>` };
        }
        case "search_page": {
          const re = new RegExp(String(args.pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          const body = (this.doc.body as HTMLElement).innerText ?? this.doc.body.textContent ?? "";
          const hits: string[] = [];
          for (const line of body.split(/\n+/)) if (re.test(line) && hits.length < 10) hits.push(clean(line, 160));
          return { ok: true, message: hits.length ? hits.map((h) => `- ${h}`).join("\n").replace(/</g, "‹").replace(/>/g, "›") : "no match" };
        }
      }
      return { ok: false, message: `unknown action ${a.name}` };
    } catch (e) {
      return { ok: false, message: `failed: ${(e as Error).message}` };
    }
  }
}
