import { describe, expect, it } from "vitest";
import { maskKey, modelRef, newProviderFromPreset, parseModelRef, PRESETS, redactSecrets, resolveModelRef } from "@/src/lib/providers";
import { defaultSettings, defaultTargetLang, mergeSettings } from "@/src/lib/settings";
import type { ProviderConfig } from "@/src/lib/types";

describe("key handling", () => {
  it("masks keys, never revealing more than the last 4 chars", () => {
    const k = "sk-1234567890abcdefXYZW";
    const m = maskKey(k);
    expect(m).toBe("sk-••••XYZW");
    expect(m).not.toContain("1234567890");
    expect(maskKey("short")).toBe("•••••");
    expect(maskKey(undefined)).toBe("");
  });
  it("redacts keys from error messages (explicit and pattern-based)", () => {
    const key = "sk-live-ABCDEFGHIJKLMNOP";
    const msg = `401 Incorrect API key provided: ${key}. Authorization: Bearer ${key} url=https://x/models?key=AIzaSyA1234567890123456789012`;
    const out = redactSecrets(msg, [key]);
    expect(out).not.toContain(key);
    expect(out).not.toContain("AIzaSy");
    expect(out).toContain("[redacted]");
    expect(redactSecrets("token sk-abcdefghijklmnopqrstu leaked")).toBe("token [redacted] leaked");
  });
});

describe("model resolution", () => {
  const mk = (presetId: string, models: string[], t: number): ProviderConfig => ({ ...newProviderFromPreset(PRESETS.find((p) => p.id === presetId)!, t), models });
  const a = mk("deepseek", ["deepseek-chat"], 1);
  const b = mk("openai", ["gpt-4.1-mini"], 2);
  it("auto picks the first usable provider", () => {
    expect(resolveModelRef("auto", [a, b], (p) => p.id === b.id)?.modelId).toBe("gpt-4.1-mini");
    expect(resolveModelRef("auto", [a, b], () => true)?.modelId).toBe("deepseek-chat");
    expect(resolveModelRef("auto", [a, b], () => false)).toBeNull();
  });
  it("honours explicit refs and falls back when stale", () => {
    expect(resolveModelRef(modelRef(b.id, "gpt-4.1"), [a, b], () => true)).toMatchObject({ modelId: "gpt-4.1" });
    expect(resolveModelRef(modelRef("gone", "x"), [a, b], () => true)?.provider.id).toBe(a.id);
    expect(parseModelRef(modelRef("p::x", "m"))).toEqual({ providerId: "p", modelId: "x::m" });
  });
  it("every preset (except custom) ships default models so adding a key is enough", () => {
    for (const p of PRESETS.filter((x) => x.id !== "custom")) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.baseUrl).toMatch(/^https?:\/\//);
    }
  });
});

describe("settings defaults", () => {
  it("empty storage yields complete defaults", () => {
    expect(mergeSettings(defaultSettings("zh-CN"), undefined)).toEqual(defaultSettings("zh-CN"));
  });
  it("partial / wrongly-typed stored values are merged safely", () => {
    const s = mergeSettings(defaultSettings("en-US"), { theme: "dark", translation: { style: "card", concurrency: "9" }, junk: 1 });
    expect(s.theme).toBe("dark");
    expect(s.translation.style).toBe("card");
    expect(s.translation.concurrency).toBe(3); // wrong type → default
    expect(s.translation.batchMaxChars).toBe(1800);
    expect((s as unknown as Record<string, unknown>).junk).toBeUndefined();
  });
  it("derives the target language from the UI language", () => {
    expect(defaultTargetLang("zh-TW")).toBe("zh-TW");
    expect(defaultTargetLang("ja-JP")).toBe("ja");
    expect(defaultTargetLang("en-US")).toBe("zh-CN");
  });
});

import { friendlyError } from "@/src/lib/providers";
describe("friendlyError", () => {
  it("maps common failures to readable reasons", () => {
    expect(friendlyError("HTTP 401 {\"error\":\"Incorrect API key\"}")).toMatch(/Key 无效/);
    expect(friendlyError("402 Insufficient Balance")).toMatch(/余额不足/);
    expect(friendlyError("TypeError: Failed to fetch")).toMatch(/网络不通/);
    expect(friendlyError("HTTP 404 model not found")).toMatch(/不存在/);
    expect(friendlyError("weird")).toBe("weird");
  });
});
