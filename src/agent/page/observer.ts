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
}

function visible(el: Element): boolean {
  const he = el as HTMLElement;
  if (he.hidden) return false;
  const anyEl = el as any;
  if (typeof anyEl.checkVisibility === "function") return anyEl.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const win = el.ownerDocument.defaultView;
  const st = win?.getComputedStyle(el);
  if (st && (st.display === "none" || st.visibility === "hidden")) return false;
  return true;
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
export function isOccluded(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r || r.width === 0 || r.height === 0) return false;
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return false;
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = (root.elementFromPoint ?? doc.elementFromPoint).call(root, x, y);
  return !!hit && hit !== el && !el.contains(hit) && !hit.contains(el);
}

function clean(s: string | null | undefined, max = MAX_TEXT): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function labelOf(el: Element): string {
  const he = el as HTMLElement;
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const lb = el.getAttribute("aria-labelledby");
  if (lb) {
    const t = lb.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
    if (t.trim()) return clean(t);
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const i = el as HTMLInputElement;
    const lab = i.labels?.[0]?.textContent;
    if (lab) return clean(lab);
    if (i.type === "submit" || i.type === "button") return clean(i.value);
    return clean(i.placeholder || i.name || el.getAttribute("title"));
  }
  return clean(he.innerText ?? el.textContent) || clean(el.getAttribute("title")) || clean((el.querySelector("img") as HTMLImageElement | null)?.alt);
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
      isSubmit,
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
        if (isInteractive(el)) {
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
          push(`${pad}<${tag}>${clean((el as HTMLElement).innerText ?? el.textContent, 120)}`);
        } else if (el.children.length === 0) {
          const t = clean(el.textContent, 120);
          if (t.length > 1) push(`${pad}${t}`);
        }
        if (tag === "iframe") {
          try {
            const d = (el as HTMLIFrameElement).contentDocument;
            if (d?.body) walk(d.body, this.frameIndex(d), depth + 1);
          } catch {
            /* cross-origin */
          }
          if (!this.sameOrigin(el as HTMLIFrameElement)) push(`${pad}[unreachable: cross-origin iframe ${clean((el as HTMLIFrameElement).src, 60)}; content exists but cannot be read or operated]`);
          continue;
        }
        if (tag.includes("-") && !(el as HTMLElement).shadowRoot && el.childNodes.length === 0 && this.doc.defaultView?.customElements?.get(tag))
          push(`${pad}[unreachable: <${tag}> has a closed shadow root; content exists but cannot be read or operated]`);
        if ((el as HTMLElement).shadowRoot) walk((el as HTMLElement).shadowRoot!, frame, depth + 1);
        if (!isInteractive(el) || tag === "label" || el.querySelector("input,select,textarea,button,a[href]")) walk(el, frame, depth + 1);
      }
    };

    this.frameIndex(this.doc);
    if (this.doc.body) walk(this.doc.body, 0, 0);
    const newIds = [...seen].filter((id) => !this.lastIds.has(id));
    this.lastIds = seen;
    this.mutations = 0;
    return { url: this.doc.location?.href ?? "", title: this.doc.title, tree: lines.join("\n"), newIds };
  }

  private sameOrigin(f: HTMLIFrameElement): boolean {
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

  async execute(a: ActionRequest): Promise<ActionResult> {
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
          if (el!.isContentEditable) {
            if (args.clear !== false) el!.textContent = "";
            el!.textContent = (el!.textContent ?? "") + String(args.text);
          } else {
            const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            const next = args.clear === false ? (el as HTMLInputElement).value + String(args.text) : String(args.text);
            setter ? setter.call(el, next) : ((el as HTMLInputElement).value = next);
          }
          el!.dispatchEvent(new win.Event("input", { bubbles: true }));
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
