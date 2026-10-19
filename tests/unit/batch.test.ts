import { describe, expect, it } from "vitest";
import { buildTranslatePrompt, makeBatches, parseTranslationResponse, shouldTranslate } from "@/src/lib/batch";

const items = (lens: number[]) => lens.map((n, id) => ({ id, text: "x".repeat(n) }));

describe("makeBatches", () => {
  it("keeps order and respects maxChars", () => {
    const b = makeBatches(items([400, 400, 400, 900, 100]), { maxChars: 1000, maxItems: 10 });
    expect(b.map((x) => x.map((i) => i.id))).toEqual([[0, 1], [2], [3, 4]]);
  });
  it("respects maxItems", () => {
    const b = makeBatches(items(Array(7).fill(5)), { maxChars: 10_000, maxItems: 3 });
    expect(b.map((x) => x.length)).toEqual([3, 3, 1]);
  });
  it("puts an oversized paragraph in its own batch instead of splitting it", () => {
    const b = makeBatches(items([50, 5000, 50]), { maxChars: 1000, maxItems: 10 });
    expect(b.map((x) => x.map((i) => i.id))).toEqual([[0], [1], [2]]);
  });
  it("handles empty input and degenerate limits", () => {
    expect(makeBatches([], { maxChars: 10, maxItems: 1 })).toEqual([]);
    expect(makeBatches(items([1, 1]), { maxChars: 0, maxItems: 0 }).length).toBe(2);
  });
  it("never loses or duplicates items", () => {
    const src = items(Array.from({ length: 200 }, (_, i) => (i * 37) % 300));
    const flat = makeBatches(src, { maxChars: 700, maxItems: 9 }).flat();
    expect(flat.map((i) => i.id)).toEqual(src.map((i) => i.id));
  });
});

describe("parseTranslationResponse", () => {
  it("parses a plain JSON array", () => expect(parseTranslationResponse('["你好","世界"]', 2)).toEqual(["你好", "世界"]));
  it("strips code fences and leading prose", () => expect(parseTranslationResponse('Sure:\n```json\n["a","b"]\n```', 2)).toEqual(["a", "b"]));
  it("rejects a length mismatch so the caller can split the batch", () => expect(parseTranslationResponse('["a"]', 2)).toBeNull());
  it("accepts raw text for a single item", () => expect(parseTranslationResponse("只有一段", 1)).toEqual(["只有一段"]));
  it("returns null for garbage with multiple items", () => expect(parseTranslationResponse("nope", 3)).toBeNull());
});

describe("shouldTranslate / prompt", () => {
  it("skips numbers, urls, and text already in Chinese", () => {
    expect(shouldTranslate("12,345.6 %", "zh-CN")).toBe(false);
    expect(shouldTranslate("https://example.com/a", "zh-CN")).toBe(false);
    expect(shouldTranslate("这是一段中文内容", "zh-CN")).toBe(false);
    expect(shouldTranslate("Hello world", "zh-CN")).toBe(true);
  });
  it("marks page text as untrusted and asks for a same-length array", () => {
    const p = buildTranslatePrompt(["a", "b"], "Simplified Chinese");
    expect(p.system).toMatch(/untrusted/);
    expect(p.system).toMatch(/same length/);
    expect(JSON.parse(p.user)).toEqual(["a", "b"]);
  });
});
