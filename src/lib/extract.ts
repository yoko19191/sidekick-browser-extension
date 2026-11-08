import { Readability, isProbablyReaderable } from "@mozilla/readability";
import TurndownService from "turndown";
import { MAX_DOC_CHARS } from "./retrieve";
import type { PageContent } from "./types";

const EXTENSION_UI_SELECTOR = ".pp-trans, [data-pp-ui], sidekick-ui, #__sidekick-agent-overlay__";
const NON_CONTENT_TAGS = ["script", "style", "noscript", "iframe", "svg", "img", "picture", "video", "audio", "canvas", "template", "object", "embed"];

/** Count actual content characters (ignoring Markdown syntax and whitespace) for completeness comparison. */
function contentCharCount(text: string): number {
  return text.replace(/[#*`_\-[\]()>~|\s]+/g, "").length;
}

/**
 * Clone a document while inlining open Shadow DOM roots and accessible same-origin iframes,
 * which native `doc.cloneNode(true)` would otherwise drop completely.
 */
function cloneDocumentWithShadowAndFrames(doc: Document): Document {
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll(EXTENSION_UI_SELECTOR).forEach((n) => n.remove());

  // 1. Inline open Shadow DOM content from live elements into matching cloned hosts
  try {
    const liveAll = doc.body ? Array.from(doc.body.querySelectorAll("*")) : [];
    const cloneAll = clone.body ? Array.from(clone.body.querySelectorAll("*")) : [];
    const len = Math.min(liveAll.length, cloneAll.length);
    for (let i = 0; i < len; i++) {
      const sr = liveAll[i]?.shadowRoot;
      if (sr && sr.innerHTML?.trim()) {
        const container = clone.createElement("div");
        container.setAttribute("data-shadow-inlined", "");
        container.innerHTML = sr.innerHTML;
        container.querySelectorAll(EXTENSION_UI_SELECTOR).forEach((n) => n.remove());
        cloneAll[i].appendChild(container);
      }
    }
  } catch {
    /* ignore shadow traversal errors */
  }

  // 2. Inline accessible same-origin iframe body content before iframes are stripped
  try {
    const liveFrames = Array.from(doc.querySelectorAll("iframe"));
    const cloneFrames = Array.from(clone.querySelectorAll("iframe"));
    const len = Math.min(liveFrames.length, cloneFrames.length);
    for (let i = 0; i < len; i++) {
      try {
        const frameDoc = liveFrames[i].contentDocument;
        const frameBody = frameDoc?.body;
        if (frameBody && (frameBody.textContent ?? "").trim().length > 40) {
          const section = clone.createElement("section");
          section.setAttribute("data-iframe-inlined", "");
          section.innerHTML = frameBody.innerHTML;
          section.querySelectorAll(EXTENSION_UI_SELECTOR).forEach((n) => n.remove());
          cloneFrames[i].replaceWith(section);
        }
      } catch {
        /* cross-origin iframe, ignore */
      }
    }
  } catch {
    /* ignore iframe traversal errors */
  }

  return clone;
}

function createTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(NON_CONTENT_TAGS as never);
  // Strip inline URLs from links: they often double the token count of articles without adding reading value.
  td.addRule("plainLink", {
    filter: "a",
    replacement: (content) => content,
  });
  // Convert HTML tables into clean GFM Markdown tables so tabular data is preserved.
  td.addRule("gfmTable", {
    filter: "table",
    replacement: (_content, node) => {
      const table = node as HTMLTableElement;
      const rows = Array.from(table.querySelectorAll("tr"));
      if (!rows.length) return "";
      const matrix = rows
        .map((tr) =>
          Array.from(tr.querySelectorAll(":scope > th, :scope > td")).map((cell) =>
            (cell.textContent ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim(),
          ),
        )
        .filter((r) => r.length > 0 && r.some((c) => c.length > 0));
      if (!matrix.length) return "";
      const colCount = Math.max(...matrix.map((r) => r.length));
      if (colCount === 0) return "";
      const padRow = (r: string[]) => `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? "").join(" | ")} |`;
      const header = padRow(matrix[0]);
      const sep = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
      const body = matrix.slice(1).map(padRow);
      return `\n\n${[header, sep, ...body].join("\n")}\n\n`;
    },
  });
  return td;
}

/**
 * Extract structured Markdown directly from the cleaned DOM when Readability over-prunes
 * (e.g. multi-card pages, GitHub issues/PRs, forums/Q&A with multiple <article> blocks, docs, dashboards).
 */
function extractStructuredDomMarkdown(preparedClone: Document, td: TurndownService): string {
  const dom = preparedClone.cloneNode(true) as Document;
  if (!dom.body) return "";
  dom.body
    .querySelectorAll(
      'script, style, noscript, template, svg, canvas, video, audio, picture, img, iframe, object, embed, nav, footer, [role="navigation"], [role="contentinfo"], [aria-hidden="true"]',
    )
    .forEach((n) => n.remove());

  const fullBodyTextLen = contentCharCount(dom.body.textContent ?? "");
  // Remove top-level banner/sidebar chrome only if doing so keeps the majority of the page text
  const chromeNodes = Array.from(dom.body.querySelectorAll(':scope > header, :scope > aside, [role="banner"], [role="complementary"]'));
  for (const node of chromeNodes) {
    const nodeLen = contentCharCount(node.textContent ?? "");
    if (fullBodyTextLen - nodeLen >= Math.min(200, fullBodyTextLen * 0.5)) {
      node.remove();
    }
  }

  // Prefer <main> or [role="main"] if it holds a substantial portion of the page's content
  const mainEl = dom.body.querySelector('main, [role="main"]');
  const bodyAfterTextLen = contentCharCount(dom.body.textContent ?? "");
  const mainTextLen = mainEl ? contentCharCount(mainEl.textContent ?? "") : 0;
  const targetRoot = mainEl && mainTextLen >= Math.max(160, bodyAfterTextLen * 0.45) ? mainEl : dom.body;

  try {
    return td.turndown(targetRoot.innerHTML).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  }
}

/** Extract the main content of the current document as Markdown (Readability + completeness check + structured DOM fallback). */
/** `length` is the FULL extracted length, before the `maxChars` cap, so callers can tell how much was cut. */
export function extractPage(doc: Document = document, maxChars = MAX_DOC_CHARS): PageContent {
  const url = doc.location?.href ?? "";
  const prepared = cloneDocumentWithShadowAndFrames(doc);
  const articleCount = prepared.querySelectorAll("article").length;

  let article: ReturnType<Readability<string>["parse"]> = null;
  try {
    article = new Readability(prepared.cloneNode(true) as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }

  const td = createTurndown();
  const readabilityMd = article?.content ? td.turndown(article.content).replace(/\n{3,}/g, "\n\n").trim() : "";
  const structuredMd = extractStructuredDomMarkdown(prepared, td);

  const readLen = contentCharCount(readabilityMd);
  const structLen = contentCharCount(structuredMd);

  // Use structured DOM Markdown when Readability failed, extracted < 200 chars, picked only one <article>
  // on a multi-article thread/forum/Q&A page, or discarded more than 55% of the cleaned main content.
  const readabilityUnderExtracted =
    readLen < 160 ||
    (articleCount > 1 && readLen < structLen * 0.65) ||
    (structLen > 300 && readLen < structLen * 0.45);

  let markdown = readabilityUnderExtracted && structLen > readLen ? structuredMd : readabilityMd || structuredMd;

  // Final fallback: visible body text (for canvas/custom-rendered apps or unusual DOM structures)
  const visibleBody = (doc.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  const mdLen = contentCharCount(markdown);
  const visLen = contentCharCount(visibleBody);
  if ((mdLen < 160 && visLen > mdLen) || (visLen > 400 && mdLen < visLen * 0.35)) {
    markdown = visibleBody;
  }

  const fullLength = markdown.length;
  if (markdown.length > maxChars) markdown = markdown.slice(0, maxChars) + "\n\n…（内容过长，已截断）";
  const iconHref = doc.querySelector<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')?.href;
  let favIconUrl = iconHref || undefined;
  if (!favIconUrl && /^https?:/.test(url)) {
    try {
      favIconUrl = new URL("/favicon.ico", url).href;
    } catch {
      /* ignore */
    }
  }
  const rawTitle = (article?.title || doc.title || "").trim();
  return {
    title: rawTitle || url,
    url,
    favIconUrl,
    markdown,
    excerpt: article?.excerpt ?? undefined,
    byline: article?.byline ?? undefined,
    lang: doc.documentElement.lang || article?.lang || undefined,
    length: fullLength,
  };
}

export { isProbablyReaderable };
