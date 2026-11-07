/**
 * Turn pdf.js text items into readable page text and assemble the per-page Markdown the chat pipeline uses.
 * Pure functions over a structural subset of pdf.js types, so they are unit-testable without pdf.js or a browser.
 */
import type { PageContent } from "../types";

/** The parts of a pdf.js TextItem this module reads (transform = [a, b, c, d, x, y]). */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  transform: number[];
  width: number;
  height: number;
}

/** The parts of a pdf.js PDFDocumentProxy this module reads. */
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup?(): void }>;
  getMetadata?(): Promise<{ info?: unknown }>;
}

/** Heading that starts every page section in the Markdown; retrieval labels and PDF citations rely on it. */
export const PAGE_HEADING = /^## Page (\d+)$/m;
export const pageHeading = (n: number) => `## Page ${n}`;

const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
/** Join two fragments of one line/paragraph: no space between CJK characters or when one side already has one. */
function joinable(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const l = a[a.length - 1];
  const r = b[0];
  if (/\s/.test(l) || /\s/.test(r) || (CJK.test(l) && CJK.test(r))) return a + b;
  return `${a} ${b}`;
}

/**
 * Lines from item positions: a new line on hasEOL or when the baseline moves by more than half a line; a space
 * where two items on one line are visibly apart. Paragraphs break where the gap between lines is clearly larger
 * than the page's usual line spacing. Hyphenated line ends ("exam-" + "ple") are re-joined.
 */
export function itemsToText(items: PdfTextItem[]): string {
  const lines: { text: string; y: number; h: number }[] = [];
  let cur: { text: string; y: number; h: number; endX: number } | null = null;
  let breakNext = false;
  for (const it of items) {
    if (typeof it?.str !== "string") continue; // marked-content items carry no text
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const h = Math.abs(it.height) || Math.abs(it.transform[3] ?? 0) || 10;
    if (cur && !breakNext && Math.abs(y - cur.y) <= h * 0.5) {
      const gap = x - cur.endX;
      cur.text = gap > h * 0.2 && !/\s$/.test(cur.text) && !/^\s/.test(it.str) ? joinable(cur.text, it.str) : cur.text + it.str;
      cur.endX = x + it.width;
    } else if (it.str.trim() || cur === null) {
      if (cur) lines.push(cur);
      cur = { text: it.str, y, h, endX: x + it.width };
    }
    breakNext = !!it.hasEOL;
  }
  if (cur) lines.push(cur);
  const kept = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text);
  if (!kept.length) return "";

  const gaps = kept.slice(1).map((l, i) => Math.abs(kept[i].y - l.y)).filter((g) => g > 0);
  // lower median: on a short page, one paragraph gap must not become the "usual" spacing
  const usual = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor((gaps.length - 1) / 2)] : 0;
  const paras: string[] = [];
  let para = kept[0].text;
  for (let i = 1; i < kept.length; i++) {
    const gap = Math.abs(kept[i - 1].y - kept[i].y);
    const newPara = usual > 0 && gap > usual * 1.5;
    if (newPara) {
      paras.push(para);
      para = kept[i].text;
    } else if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(kept[i].text)) {
      para = para.slice(0, -1) + kept[i].text;
    } else {
      para = joinable(para, kept[i].text);
    }
  }
  paras.push(para);
  return paras.join("\n\n");
}

function titleFrom(info: unknown, url: string): string {
  const t = (info as { Title?: unknown } | undefined)?.Title;
  if (typeof t === "string" && t.trim()) return t.trim();
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    if (name) return name;
  } catch {
    /* not a URL */
  }
  return url;
}

export class PdfNoTextError extends Error {
  constructor() {
    super("pdf-no-text");
    this.name = "PdfNoTextError";
  }
}

export interface PdfExtractOptions {
  url: string;
  /** Cap on the Markdown handed to the chat pipeline; `length` still reports the full size. */
  maxChars: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * One `## Page N` section per page that has text. Throws PdfNoTextError when the whole document has no text layer
 * (scanned images), so the UI can say so instead of sending an empty page to the model.
 */
export async function pdfToPage(doc: PdfDocLike, opts: PdfExtractOptions): Promise<PageContent> {
  const sections: string[] = [];
  let textChars = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const page = await doc.getPage(n);
    const { items } = await page.getTextContent();
    page.cleanup?.();
    const text = itemsToText(items as PdfTextItem[]);
    textChars += text.length;
    if (text) sections.push(`${pageHeading(n)}\n\n${text}`);
    opts.onProgress?.(n, doc.numPages);
  }
  if (textChars < 20) throw new PdfNoTextError();
  const info = (await doc.getMetadata?.().catch(() => undefined))?.info;
  let markdown = sections.join("\n\n");
  const length = markdown.length;
  if (markdown.length > opts.maxChars) markdown = markdown.slice(0, opts.maxChars) + "\n\n…";
  return { kind: "pdf", pages: doc.numPages, title: titleFrom(info, opts.url), url: opts.url, markdown, length };
}

/** Page number whose section contains `excerpt` (normalised, case-insensitive), for citation jumps. */
export function pageOfExcerpt(markdown: string, excerpt: string): number | undefined {
  const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
  const needle = norm(excerpt).replace(/^["\u201c'\u300c]+|["\u201d'\u300d.\u3002\u2026]+$/g, "").trim();
  if (needle.length < 4) return undefined;
  const parts = markdown.split(/^(?=## Page \d+$)/m);
  for (const probe of [needle, needle.slice(0, 48), needle.slice(0, 24)]) {
    const hit = parts.find((p) => norm(p).includes(probe));
    const n = hit?.match(PAGE_HEADING)?.[1];
    if (n) return Number(n);
  }
  return undefined;
}
