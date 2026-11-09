/** DOM helpers for immersive-style bilingual translation. Pure DOM, no chrome.* — unit-testable with jsdom. */

const INLINE = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "DATA", "DFN", "EM", "FONT", "I", "IMG", "INS", "DEL", "KBD", "LABEL",
  "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "CODE", "TT", "BIG", "NOBR",
]);

export const BASE_SKIP =
  "script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,math,iframe,canvas,video,audio," +
  "[contenteditable=''],[contenteditable='true'],[translate='no'],.notranslate,.pp-trans,[data-pp-ui]," +
  ".ytp-caption-window-container,.bpx-player-subtitle-wrap,.player-timedtext,.vjs-text-track-display,.jw-text-track-container";

export interface CollectOptions {
  skipSelectors?: string;
  isVisible?: (el: Element) => boolean;
  minLength?: number;
}

export interface Paragraph {
  el: Element;
  text: string;
}

function nearestBlock(node: Node, root: Element): Element | null {
  let el = node.parentElement;
  while (el && el !== root && INLINE.has(el.tagName)) el = el.parentElement;
  return el;
}

/**
 * Find leaf-ish blocks with translatable text. Text belongs to its nearest non-inline ancestor, so
 * `<li>Item <b>bold</b><ul>…</ul></li>` yields "Item bold" for the li and separate entries for nested items.
 */
export function collectParagraphs(root: Element, opts: CollectOptions = {}): Paragraph[] {
  const doc = root.ownerDocument;
  const skip = opts.skipSelectors?.trim() ? `${BASE_SKIP},${opts.skipSelectors}` : BASE_SKIP;
  const minLength = opts.minLength ?? 2;
  const texts = new Map<Element, string[]>();
  const order: Element[] = [];
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = n.nodeValue ?? "";
    if (!value.trim()) continue;
    const parent = n.parentElement;
    if (!parent) continue;
    let skipped = false;
    try {
      skipped = !!parent.closest(skip);
    } catch {
      skipped = !!parent.closest(BASE_SKIP); // invalid user selector
    }
    if (skipped) continue;
    const block = nearestBlock(n, root) ?? root;
    if (block.hasAttribute("data-pp-done")) continue;
    if (!texts.has(block)) {
      texts.set(block, []);
      order.push(block);
    }
    texts.get(block)!.push(value);
  }
  const out: Paragraph[] = [];
  for (const el of order) {
    const text = texts.get(el)!.join("").replace(/\s+/g, " ").trim();
    if (text.length < minLength) continue;
    if (opts.isVisible && !opts.isVisible(el)) continue;
    out.push({ el, text });
  }
  return out;
}

export interface HoverParagraphMatch {
  el: Element;
  text: string;
  alreadyTranslated: boolean;
}

/**
 * Resolve the single translatable paragraph block under the hovered DOM element (or cursor coordinates).
 * If the hovered element is already translated (`[data-pp-done]` or inside `.pp-trans`), returns `{ el, text: "", alreadyTranslated: true }`
 * so pressing the hover shortcut key again toggles/restores that paragraph.
 */
export function findHoverParagraph(
  target: Element | null,
  opts: { skipSelectors?: string; clientX?: number; clientY?: number } = {},
): HoverParagraphMatch | null {
  if (!target || target.nodeType !== 1) return null;
  const doc = target.ownerDocument;
  if (!doc) return null;

  // Hovering directly over an inserted `.pp-trans` span targets its parent paragraph for toggle/restore
  const transSpan = target.closest(".pp-trans");
  if (transSpan?.parentElement) {
    return { el: transSpan.parentElement, text: "", alreadyTranslated: true };
  }

  // Ignore extension's own floating UI controls (FAB, selection card, video subtitle menu/overlay)
  if (target.closest("[data-pp-ui]") || target.tagName === "SIDEKICK-UI") return null;

  const doneEl = target.closest("[data-pp-done]");
  if (doneEl) {
    return { el: doneEl, text: "", alreadyTranslated: true };
  }

  let block: Element | null = target;
  while (block && block !== doc.body && block !== doc.documentElement && INLINE.has(block.tagName)) {
    block = block.parentElement;
  }
  if (!block || block === doc.body || block === doc.documentElement) return null;

  const paras = collectParagraphs(block, { skipSelectors: opts.skipSelectors });
  if (paras.length === 1) {
    return { el: paras[0].el, text: paras[0].text, alreadyTranslated: false };
  }
  if (paras.length > 1) {
    const containing = paras.filter((p) => p.el.contains(target));
    if (containing.length > 0) {
      const deepest = containing[containing.length - 1];
      return { el: deepest.el, text: deepest.text, alreadyTranslated: false };
    }
    if (opts.clientX != null && opts.clientY != null) {
      const { clientX, clientY } = opts;
      let best: Paragraph | null = null;
      let bestDist = 28;
      for (const p of paras) {
        const r = (p.el as HTMLElement).getBoundingClientRect?.();
        if (!r || (r.width === 0 && r.height === 0)) continue;
        const dx = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        const dy = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = p;
        }
      }
      if (best) return { el: best.el, text: best.text, alreadyTranslated: false };
    }
  }
  return null;
}

/** Remove the inserted translation from a single paragraph element and restore its original state. */
export function restoreParagraph(el: Element): void {
  el.querySelectorAll(":scope > .pp-trans").forEach((n) => n.remove());
  el.removeAttribute("data-pp-done");
  el.removeAttribute("data-pp-pending");
  (el as HTMLElement).style?.removeProperty("--pp-fs");
  if ((el as HTMLElement).getAttribute?.("style") === "") el.removeAttribute("style");
  let anc = el.parentElement;
  for (let depth = 0; anc && depth < 3; depth++, anc = anc.parentElement) {
    if (!anc.querySelector("[data-pp-done]")) {
      anc.removeAttribute("data-pp-unclip");
    }
  }
}

export interface HoverTranslateControllerDeps {
  doc?: Document;
  getKey: () => "Shift" | "Alt" | "Control" | "off";
  getTargetLang: () => string;
  getStyle: () => string;
  getSkipSelectors?: () => string;
  isDisabled?: () => boolean;
  translateOne: (text: string) => Promise<string>;
}

function isEditableElement(el: Element | null): boolean {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const ce = el.getAttribute("contenteditable");
  return ce === "" || ce === "true";
}

/**
 * Attach mouse-hover tracking and solo modifier-key listener (default `Shift`) so tapping the shortcut key
 * while hovering over any paragraph translates (or restores) that individual paragraph in place.
 */
export function setupHoverTranslate(deps: HoverTranslateControllerDeps): { trigger: () => Promise<boolean>; destroy: () => void } {
  const doc = deps.doc ?? document;
  let lastTarget: Element | null = null;
  let lastCoords: { x: number; y: number } | null = null;
  let pendingKeyDownAt = 0;
  let comboCancelled = false;

  const onMouseMove = (e: MouseEvent) => {
    if (e.target && (e.target as Node).nodeType === 1) {
      lastTarget = e.target as Element;
    }
    lastCoords = { x: e.clientX, y: e.clientY };
  };

  const onMouseOver = (e: MouseEvent) => {
    if (e.target && (e.target as Node).nodeType === 1) {
      lastTarget = e.target as Element;
    }
  };

  const onMouseDown = () => {
    if (pendingKeyDownAt > 0) {
      comboCancelled = true;
      pendingKeyDownAt = 0;
    }
  };

  const trigger = async (): Promise<boolean> => {
    if (deps.isDisabled?.()) return false;
    const fromPoint =
      lastCoords && typeof doc.elementFromPoint === "function"
        ? doc.elementFromPoint(lastCoords.x, lastCoords.y)
        : null;
    const target = lastTarget?.isConnected ? lastTarget : fromPoint;
    const match = findHoverParagraph(target, {
      skipSelectors: deps.getSkipSelectors?.(),
      clientX: lastCoords?.x,
      clientY: lastCoords?.y,
    });
    if (!match) return false;

    if (match.alreadyTranslated) {
      restoreParagraph(match.el);
      return true;
    }
    if (match.el.hasAttribute("data-pp-pending")) return false;

    const el = match.el as HTMLElement;
    el.querySelectorAll(":scope > .pp-failed").forEach((n) => n.remove());
    markPending(el, true);
    try {
      const trans = (await deps.translateOne(match.text))?.trim();
      markPending(el, false);
      if (trans && el.isConnected) {
        const view = doc.defaultView ?? window;
        el.style.setProperty("--pp-fs", view.getComputedStyle(el).fontSize);
        insertTranslation(el, trans, { lang: deps.getTargetLang(), style: deps.getStyle() });
        return true;
      }
    } catch {
      markPending(el, false);
    }
    return false;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const wanted = deps.getKey();
    if (wanted === "off" || deps.isDisabled?.()) return;
    if (isEditableElement(doc.activeElement) || isEditableElement(e.target as Element | null)) {
      pendingKeyDownAt = 0;
      return;
    }
    if (e.key === wanted) {
      if (e.repeat) return;
      const otherMod =
        (wanted !== "Shift" && e.shiftKey) ||
        (wanted !== "Alt" && e.altKey) ||
        (wanted !== "Control" && e.ctrlKey) ||
        e.metaKey;
      if (otherMod) {
        comboCancelled = true;
        pendingKeyDownAt = 0;
        return;
      }
      pendingKeyDownAt = Date.now();
      comboCancelled = false;
    } else if (pendingKeyDownAt > 0) {
      comboCancelled = true;
      pendingKeyDownAt = 0;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    const wanted = deps.getKey();
    if (wanted === "off" || deps.isDisabled?.()) return;
    if (e.key === wanted && !comboCancelled && pendingKeyDownAt > 0) {
      const elapsed = Date.now() - pendingKeyDownAt;
      pendingKeyDownAt = 0;
      if (elapsed <= 1000) {
        void trigger();
      }
    }
  };

  doc.addEventListener("mousemove", onMouseMove, { passive: true });
  doc.addEventListener("mouseover", onMouseOver, { passive: true });
  doc.addEventListener("mousedown", onMouseDown, { passive: true });
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("keyup", onKeyUp, true);

  return {
    trigger,
    destroy: () => {
      doc.removeEventListener("mousemove", onMouseMove);
      doc.removeEventListener("mouseover", onMouseOver);
      doc.removeEventListener("mousedown", onMouseDown);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("keyup", onKeyUp, true);
    },
  };
}

/**
 * "dark" when the original text is light-coloured (i.e. it sits on a dark background), so the translation can pick a
 * brighter accent there. Uses the element's own text colour rather than guessing the page background.
 */
export function textTone(el: Element): "light" | "dark" {
  const view = el.ownerDocument.defaultView;
  const c = view?.getComputedStyle(el).color ?? "";
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!m) return "light";
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const x = Number(v) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? "dark" : "light";
}

export function insertTranslation(el: Element, translation: string, opts: { lang: string; style: string }): HTMLElement {
  const doc = el.ownerDocument;
  el.querySelectorAll(":scope > .pp-trans").forEach((n) => n.remove());
  const wrap = doc.createElement("span");
  wrap.className = `pp-trans pp-style-${opts.style}`;
  wrap.setAttribute("data-pp-ui", "");
  wrap.setAttribute("lang", opts.lang);
  wrap.setAttribute("translate", "no");
  wrap.setAttribute("data-pp-tone", textTone(el));
  const inner = doc.createElement("span");
  inner.className = "pp-trans-inner";
  inner.textContent = translation;
  wrap.appendChild(inner);
  if (el.tagName !== "A") {
    const anchors = Array.from(el.querySelectorAll("a[href]")).filter((a) => {
      if (a.closest(".pp-trans,[data-pp-ui]")) return false;
      const href = a.getAttribute("href")?.trim() ?? "";
      return href.length > 0 && !/^javascript:/i.test(href);
    });
    if (anchors.length > 0) {
      const links = doc.createElement("span");
      links.className = "pp-links";
      const seenHref = new Set<string>();
      for (const a of anchors) {
        const href = a.getAttribute("href")!.trim();
        if (seenHref.has(href)) continue;
        seenHref.add(href);
        const link = doc.createElement("a");
        link.className = "pp-link";
        link.setAttribute("href", href);
        const target = a.getAttribute("target");
        if (target) link.setAttribute("target", target);
        link.setAttribute("rel", "noopener noreferrer");
        const label = (a.textContent ?? "").replace(/\s+/g, " ").trim();
        link.textContent = label ? `↗ ${label}` : "↗";
        links.appendChild(link);
      }
      if (links.childNodes.length > 0) wrap.appendChild(links);
    }
  }
  el.appendChild(wrap);
  el.setAttribute("data-pp-done", "");

  // Unclip tight wrapper ancestors (e.g. YouTube `div#title > h1 > yt-formatted-string` or card title containers)
  // that set `max-height`, `-webkit-line-clamp`, or `overflow: hidden` for single-language text.
  const elLen = (el.textContent ?? "").trim().length;
  let anc = el.parentElement;
  for (let depth = 0; anc && depth < 3 && anc !== doc.body && anc !== doc.documentElement; depth++, anc = anc.parentElement) {
    const ancLen = (anc.textContent ?? "").trim().length;
    if (anc.children.length <= 2 && ancLen <= elLen + 40) {
      anc.setAttribute("data-pp-unclip", "");
    } else {
      break;
    }
  }
  return wrap;
}

export function markPending(el: Element, on: boolean) {
  if (on) el.setAttribute("data-pp-pending", "");
  else el.removeAttribute("data-pp-pending");
}

/** Remove every inserted translation and marker, restoring the original page. Returns number removed. */
export function restoreOriginal(root: ParentNode): number {
  const nodes = root.querySelectorAll(".pp-trans");
  nodes.forEach((n) => n.remove());
  root.querySelectorAll("[data-pp-done],[data-pp-pending]").forEach((n) => {
    n.removeAttribute("data-pp-done");
    n.removeAttribute("data-pp-pending");
    (n as HTMLElement).style?.removeProperty("--pp-fs");
    if ((n as HTMLElement).getAttribute?.("style") === "") n.removeAttribute("style");
  });
  root.querySelectorAll("[data-pp-unclip]").forEach((n) => n.removeAttribute("data-pp-unclip"));
  return nodes.length;
}

export const TRANSLATION_CSS = `
[data-pp-done],[data-pp-unclip]{max-height:none!important;-webkit-line-clamp:unset!important;line-clamp:unset!important;overflow:visible!important}
:is(h1,h2,h3,h4,h5,h6,p,li,dt,dd,blockquote,yt-formatted-string)[data-pp-done],:is(h1,h2,h3,h4,h5,h6,p,a,yt-formatted-string)[data-pp-unclip]{height:auto!important}
.pp-trans{display:block;margin:.3em 0 .15em;padding-bottom:2px;line-height:1.58;font-size:inherit;overflow:visible;}
li>.pp-trans,td>.pp-trans,th>.pp-trans,dt>.pp-trans,dd>.pp-trans{margin-top:.2em}
h1>.pp-trans,h2>.pp-trans,h3>.pp-trans,h4>.pp-trans,h5>.pp-trans,h6>.pp-trans{font-weight:inherit;}
.pp-style-green{color:#16a34a;margin-top:.25em}
.pp-style-green[data-pp-tone=dark]{color:#34d399}
html.pp-only .pp-style-green{color:inherit}
.pp-style-plain .pp-trans-inner{}
.pp-style-dashed .pp-trans-inner{border-bottom:1.5px dashed rgba(99,102,241,.75);padding-bottom:1px}
.pp-style-faded .pp-trans-inner{opacity:.72}
.pp-style-highlight .pp-trans-inner{background:linear-gradient(transparent 55%,rgba(253,224,71,.55) 55%);padding-bottom:1px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.pp-style-card{background:rgba(99,102,241,.07);border-left:3px solid rgba(99,102,241,.6);border-radius:6px;padding:.35em .6em}
[data-pp-pending]::after{content:"";display:inline-block;width:.8em;height:.8em;margin-left:.4em;vertical-align:-.1em;border-radius:50%;
 border:2px solid rgba(99,102,241,.25);border-top-color:rgba(99,102,241,.9);animation:pp-spin .8s linear infinite}
@keyframes pp-spin{to{transform:rotate(360deg)}}
html.pp-only [data-pp-done]{font-size:0!important}
html.pp-only [data-pp-done]>.pp-trans{font-size:var(--pp-fs,16px)!important;margin:0}
html.pp-only [data-pp-done]>:is(a,span,b,strong,em,i,u,small,sup,sub,mark,abbr,cite,q,time,font,s,del,ins,label,br):not(.pp-trans){display:none!important}
.pp-links{display:none}
html.pp-only .pp-links{display:inline-flex;flex-wrap:wrap;gap:.35em;margin-left:.45em;font-size:.88em;vertical-align:baseline}
html.pp-only .pp-link{color:inherit;text-decoration:underline;opacity:.85}
html.pp-only .pp-link:hover{opacity:1}
.pp-failed .pp-retry{all:unset;cursor:pointer;font:500 12px/1.6 system-ui,sans-serif;color:#e11d48;border:1px solid rgba(225,29,72,.3);border-radius:8px;padding:0 8px}
.pp-flash{outline:2px solid rgba(79,70,229,.55)!important;outline-offset:3px;border-radius:4px;background:rgba(99,102,241,.10)!important;transition:background .3s}
`;
