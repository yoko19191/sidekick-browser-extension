/**
 * Page observer + action executor. Runs inside the page (content script), DOM-only, no chrome.* calls,
 * so it can be unit-tested with jsdom. Walks open shadow roots and same-origin iframes.
 */
import type { ActionRequest, ActionResult, ElementInfo, PageSnapshot } from "../types";
import {
  box,
  clean,
  deepQueryAll,
  formOf,
  isInteractive,
  isOccluded,
  isSensitive,
  labelOf,
  labelProxy,
  nearViewport,
  visible,
} from "./dom";

const MAX_TREE = 40_000;

export interface ObserverOptions {
  maxTree?: number;
  /** Delay between typed characters (ms). 0 types instantly. */
  typeDelayMs?: number;
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

  /** Per-snapshot cache: one form is shared by all its controls, and searching it (shadow roots included) is not free. */
  private forms = new Map<HTMLFormElement, { submitText?: string; sensitive: boolean }>();

  private formFacts(form: HTMLFormElement) {
    let f = this.forms.get(form);
    if (!f) {
      // Deep queries: a web-component form (Shoelace etc.) keeps its real <button>/<input> inside shadow roots.
      const submitText = deepQueryAll(form, "button[type=submit],button:not([type]),input[type=submit],input[type=image]")
        .map((b) => clean((b as HTMLInputElement).value || b.textContent || b.getAttribute("aria-label"), 40))
        .filter(Boolean)
        .join(" / ");
      f = { submitText: submitText || undefined, sensitive: deepQueryAll(form, "input,textarea,select").some((x) => isSensitive(x)) };
      this.forms.set(form, f);
    }
    return f;
  }

  private describeEl(el: Element, id: string): ElementInfo {
    const tag = el.tagName.toLowerCase();
    const i = el as HTMLInputElement;
    const form = formOf(el);
    // HTMLButtonElement.type is "submit" when the attribute is missing or invalid.
    const isSubmit = !!form && ((tag === "button" && i.type === "submit") || (tag === "input" && (i.type === "submit" || i.type === "image")));
    const facts = form ? this.formFacts(form) : undefined;
    return {
      index: id,
      tag,
      text: labelOf(el),
      type: tag === "input" ? i.type : undefined,
      role: el.getAttribute("role") ?? undefined,
      inForm: !!form,
      formSubmitText: facts?.submitText,
      isSubmit,
      formSensitive: !!facts?.sensitive,
      sensitive: isSensitive(el),
      href: tag === "a" ? (el as HTMLAnchorElement).href : undefined,
      occluded: isOccluded(box(el)),
    };
  }

  snapshot(): PageSnapshot {
    this.byId.clear();
    this.forms.clear();
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
        // A hidden checkbox/radio still counts when its visible label stands in for it.
        if (!visible(el) && !labelProxy(el)) continue;
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
          if (!nearViewport(box(el), 1)) {
            outside++;
            const top = (box(el) as HTMLElement).getBoundingClientRect?.().top ?? 0;
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
          if (info.occluded) attrs.push("occluded");
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
    this.forms.clear(); // the page may have changed since the snapshot
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
          const seen = box(el!); // a hidden checkbox is scrolled to and hit-tested through its label
          seen.scrollIntoView?.({ block: "center" });
          if (isOccluded(seen)) return { ok: false, message: `element ${args.index} is covered by another element; close the overlay first` };
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
          // composed: real key events cross shadow roots (Shoelace closes dialogs from a document-level Escape listener)
          const opts = { key: args.keys, bubbles: true, cancelable: true, composed: true };
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
