/**
 * Optional live smoke test (NOT part of `npm test`). Runs the extension's own model layer
 * (pi-ai via src/lib/llm.ts) and prompts against the real DeepSeek API.
 *   DEEPSEEK_API_KEY=… npm run test:live
 * Never prints the key; skipped when the variable is unset.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTranslatePrompt, parseTranslationResponse } from "../../src/lib/batch";
import { streamText, testConnection } from "../../src/lib/llm";
import { pageSystemPrompt, summaryInstruction } from "../../src/lib/prompts";
import { newProviderFromPreset, PRESETS, redactSecrets } from "../../src/lib/providers";
import { defaultSettings } from "../../src/lib/settings";

const key = process.env.DEEPSEEK_API_KEY;
const provider = newProviderFromPreset(PRESETS.find((p) => p.id === "deepseek")!);
const model = "deepseek-chat";

describe.skipIf(!key)("live DeepSeek smoke (optional)", () => {
  it("test connection", async () => {
    const r = await testConnection(provider, model, key);
    expect(r).toBeTruthy();
  }, 60_000);

  it("summarize the fixture article (streams, Chinese, cites)", async () => {
    const html = readFileSync("tests/fixtures/article.html", "utf8");
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const s = defaultSettings("zh-CN");
    let deltas = 0;
    const r = await streamText(
      { provider, modelId: model, apiKey: key, system: pageSystemPrompt(s, "summary", { title: "How Rooftop Gardens Cool Our Cities", url: "http://example.test/", markdown: text }), messages: [{ role: "user", content: summaryInstruction(s) }], maxTokens: 800 },
      { onDelta: () => deltas++ },
    );
    console.log(`[live] summary: ${deltas} deltas, ${r.text.length} chars, footnotes=${/\[\^\d+\]/.test(r.text)}`);
    console.log(redactSecrets(r.text.slice(0, 400), [key]));
    expect(deltas).toBeGreaterThan(3);
    expect(r.text).toMatch(/[\u4e00-\u9fff]/);
  }, 90_000);

  it("translate a batch (JSON array round-trip)", async () => {
    const texts = ["Rooftop gardens replace heat-absorbing surfaces with soil and plants.", "Bees use them as stepping stones.", "The upfront cost is higher than a standard roof."];
    const { system, user } = buildTranslatePrompt(texts, "简体中文");
    const r = await streamText({ provider, modelId: model, apiKey: key, system, messages: [{ role: "user", content: user }], temperature: 0 } as never);
    const out = parseTranslationResponse(r.text, texts.length);
    console.log("[live] translation:", JSON.stringify(out));
    expect(out).not.toBeNull();
    expect(out!.every((t) => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  }, 90_000);
});
