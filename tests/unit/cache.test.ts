import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { TranslationCache } from "@/src/lib/cache";
import { normalizeText, sha256Hex, translationCacheKey } from "@/src/lib/hash";

describe("translationCacheKey", () => {
  it("is stable, whitespace-insensitive and includes lang + model", async () => {
    const a = await translationCacheKey("Hello   world\n", "zh-CN", "deepseek:deepseek-chat");
    const b = await translationCacheKey(" Hello world", "zh-CN", "deepseek:deepseek-chat");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}\|zh-CN\|deepseek:deepseek-chat$/);
    expect(await translationCacheKey("Hello world", "ja", "deepseek:deepseek-chat")).not.toBe(a);
    expect(await translationCacheKey("Hello world", "zh-CN", "openai:gpt-4.1-mini")).not.toBe(a);
  });
  it("sha256 matches a known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(normalizeText("  a \n\t b ")).toBe("a b");
  });
});

describe("TranslationCache (IndexedDB)", () => {
  it("stores and retrieves entries, misses are undefined", async () => {
    const c = new TranslationCache(100, `t-${Math.random()}`);
    await c.putMany([{ key: "k1", translation: "一" }, { key: "k2", translation: "二" }]);
    expect(await c.getMany(["k1", "nope", "k2"])).toEqual(["一", undefined, "二"]);
    expect(await c.count()).toBe(2);
    await c.clear();
    expect(await c.count()).toBe(0);
  });
  it("trims least-recently-used entries beyond the limit", async () => {
    const c = new TranslationCache(3, `t-${Math.random()}`);
    for (let i = 0; i < 3; i++) {
      await c.putMany([{ key: `k${i}`, translation: `${i}` }]);
      await new Promise((r) => setTimeout(r, 3));
    }
    await new Promise((r) => setTimeout(r, 3));
    await c.getMany(["k0"]); // touch k0 so k1 becomes the LRU
    await new Promise((r) => setTimeout(r, 3));
    await c.putMany([{ key: "k3", translation: "3" }]);
    expect(await c.count()).toBe(3);
    expect(await c.getMany(["k0", "k1", "k2", "k3"])).toEqual(["0", undefined, "2", "3"]);
  });
});
