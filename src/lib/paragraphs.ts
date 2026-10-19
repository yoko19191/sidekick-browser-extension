/** DOM helpers for immersive-style bilingual translation. Pure DOM, no chrome.* — unit-testable with jsdom. */

const INLINE = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "BR", "CITE", "DATA", "DFN", "EM", "FONT", "I", "IMG", "INS", "DEL", "KBD", "LABEL",
  "MARK", "Q", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR", "WBR", "CODE", "TT", "BIG", "NOBR",
]);

export const BASE_SKIP =
  "script,style,noscript,template,textarea,input,select,option,button,pre,code,kbd,samp,svg,math,iframe,canvas,video,audio," +
  "[contenteditable=''],[contenteditable='true'],[translate='no'],.notranslate,.pp-trans,[data-pp-ui]";

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
  el.appendChild(wrap);
  el.setAttribute("data-pp-done", "");
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
  return nodes.length;
}

export const TRANSLATION_CSS = `
.pp-trans{display:block;margin:.35em 0 .1em;line-height:1.6;font-size:inherit;}
li>.pp-trans,td>.pp-trans,th>.pp-trans,dt>.pp-trans,dd>.pp-trans{margin-top:.2em}
h1>.pp-trans,h2>.pp-trans,h3>.pp-trans,h4>.pp-trans,h5>.pp-trans,h6>.pp-trans{font-weight:inherit;}
.pp-style-green{color:#16a34a;margin-top:.25em}
.pp-style-green[data-pp-tone=dark]{color:#34d399}
html.pp-only .pp-style-green{color:inherit}
.pp-style-plain .pp-trans-inner{}
.pp-style-dashed .pp-trans-inner{border-bottom:1.5px dashed rgba(99,102,241,.75);padding-bottom:1px}
.pp-style-faded .pp-trans-inner{opacity:.72}
.pp-style-highlight .pp-trans-inner{background:linear-gradient(transparent 55%,rgba(253,224,71,.55) 55%);}
.pp-style-card{background:rgba(99,102,241,.07);border-left:3px solid rgba(99,102,241,.6);border-radius:6px;padding:.35em .6em}
[data-pp-pending]::after{content:"";display:inline-block;width:.8em;height:.8em;margin-left:.4em;vertical-align:-.1em;border-radius:50%;
 border:2px solid rgba(99,102,241,.25);border-top-color:rgba(99,102,241,.9);animation:pp-spin .8s linear infinite}
@keyframes pp-spin{to{transform:rotate(360deg)}}
html.pp-only [data-pp-done]{font-size:0!important}
html.pp-only [data-pp-done]>.pp-trans{font-size:var(--pp-fs,16px)!important;margin:0}
html.pp-only [data-pp-done]>:is(a,span,b,strong,em,i,u,small,sup,sub,mark,abbr,cite,q,time,font,s,del,ins,label,br,img):not(.pp-trans){display:none!important}
.pp-failed .pp-retry{all:unset;cursor:pointer;font:500 12px/1.6 system-ui,sans-serif;color:#e11d48;border:1px solid rgba(225,29,72,.3);border-radius:8px;padding:0 8px}
.pp-flash{outline:2px solid rgba(79,70,229,.55)!important;outline-offset:3px;border-radius:4px;background:rgba(99,102,241,.10)!important;transition:background .3s}
`;
