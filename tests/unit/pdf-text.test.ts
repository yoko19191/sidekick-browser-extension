import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { itemsToText, pageOfExcerpt, pdfToPage, PdfNoTextError, type PdfDocLike, type PdfTextItem } from "../../src/lib/pdf/text";
import { makePdf } from "../fixtures/make-pdf.mjs";

const item = (str: string, x: number, y: number, o: Partial<PdfTextItem> = {}): PdfTextItem => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12, ...o });

describe("itemsToText", () => {
  it("joins items on one baseline, spacing only where there is a visible gap", () => {
    expect(itemsToText([item("Hello", 72, 700), item("world", 72 + 30 + 6, 700), item("!", 72 + 30 + 6 + 30, 700)])).toBe("Hello world!");
  });
  it("breaks lines on hasEOL or baseline change, and paragraphs on larger gaps", () => {
    const text = itemsToText([
      item("First line of a", 72, 700, { hasEOL: true }),
      item("paragraph.", 72, 686),
      item("Second paragraph.", 72, 650),
    ]);
    expect(text).toBe("First line of a paragraph.\n\nSecond paragraph.");
  });
  it("re-joins words hyphenated across lines, and CJK lines without spaces", () => {
    expect(itemsToText([item("an exam-", 72, 700), item("ple here", 72, 686)])).toBe("an example here");
    expect(itemsToText([item("屋顶花园可以", 72, 700), item("降低室温。", 72, 686)])).toBe("屋顶花园可以降低室温。");
  });
  it("ignores marked-content items without text", () => {
    expect(itemsToText([{ type: "beginMarkedContent" } as unknown as PdfTextItem, item("Text", 72, 700)])).toBe("Text");
  });
});

describe("pdfToPage (real pdf.js on a generated PDF)", () => {
  const load = (pages: string[][], title?: string) =>
    getDocument({ data: new Uint8Array(makePdf(pages, { title })), verbosity: 0, useWorkerFetch: false }).promise as unknown as Promise<PdfDocLike>;

  it("produces one '## Page N' section per page with its text, and the document title", async () => {
    const progress: number[] = [];
    const page = await pdfToPage(await load([["Alpha first page"], [], ["Gamma on page three"]], "My Report"), { url: "https://x.test/files/r.pdf", maxChars: 1e6, onProgress: (d) => progress.push(d) });
    expect(page).toMatchObject({ kind: "pdf", pages: 3, title: "My Report", url: "https://x.test/files/r.pdf" });
    expect(page.markdown).toBe("## Page 1\n\nAlpha first page\n\n## Page 3\n\nGamma on page three");
    expect(progress).toEqual([1, 2, 3]);
  });
  it("falls back to the file name for untitled PDFs and caps the text, keeping the full length", async () => {
    const page = await pdfToPage(await load([["x".repeat(80)], ["y".repeat(80)]]), { url: "file:///tmp/My%20Notes.pdf", maxChars: 50 });
    expect(page.title).toBe("My Notes.pdf");
    expect(page.markdown.length).toBeLessThan(60);
    expect(page.length).toBeGreaterThan(160);
  });
  it("rejects a PDF without a text layer", async () => {
    await expect(pdfToPage(await load([[], []]), { url: "https://x/s.pdf", maxChars: 1e6 })).rejects.toBeInstanceOf(PdfNoTextError);
  });
  it("stops when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(pdfToPage(await load([["a page with text"]]), { url: "u", maxChars: 1e6, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("pageOfExcerpt", () => {
  const md = "## Page 1\n\nIntro text here.\n\n## Page 2\n\nThe pilot project in Tallinn\nsaved 4127 kWh.\n\n## Page 10\n\nEnd of the report.";
  it("finds the page of a verbatim citation, tolerating quotes and line breaks", () => {
    expect(pageOfExcerpt(md, "“The pilot project in Tallinn saved 4127 kWh.”")).toBe(2);
    expect(pageOfExcerpt(md, "end of the report")).toBe(10);
  });
  it("returns undefined for unknown or too-short excerpts", () => {
    expect(pageOfExcerpt(md, "not in the document at all")).toBeUndefined();
    expect(pageOfExcerpt(md, "ab")).toBeUndefined();
  });
});
