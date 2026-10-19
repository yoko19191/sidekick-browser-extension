import { Readability, isProbablyReaderable } from "@mozilla/readability";
import TurndownService from "turndown";
import type { PageContent } from "./types";

/** Extract the main content of the current document as Markdown (Readability on a clone, then Turndown). */
export function extractPage(doc: Document = document, maxChars = 120000): PageContent {
  const url = doc.location?.href ?? "";
  const clone = doc.cloneNode(true) as Document;
  clone.querySelectorAll(".pp-trans, [data-pp-ui]").forEach((n) => n.remove());
  let article: ReturnType<Readability<string>["parse"]> = null;
  try {
    article = new Readability(clone, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["script", "style", "noscript", "iframe", "svg"] as never);
  let markdown = "";
  if (article?.content) markdown = td.turndown(article.content);
  if (!markdown || markdown.length < 200) {
    // Fallback: visible body text (non-article pages, apps, search results…)
    const body = (doc.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
    if (body.length > markdown.length) markdown = body;
  }
  if (markdown.length > maxChars) markdown = markdown.slice(0, maxChars) + "\n\n…（内容过长，已截断）";
  return {
    title: article?.title || doc.title || url,
    url,
    markdown,
    excerpt: article?.excerpt ?? undefined,
    byline: article?.byline ?? undefined,
    lang: doc.documentElement.lang || article?.lang || undefined,
    length: markdown.length,
  };
}

export { isProbablyReaderable };
