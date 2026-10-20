import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { detectLocale, setLocale, tr } from "../../src/i18n";
import { zh_CN } from "../../src/i18n/zh_CN";
import { en } from "../../src/i18n/en";

const CJK = /[\u4e00-\u9fff]/;
/** Model-facing text and language endonyms are not UI copy. */
const ALLOWED: Record<string, RegExp> = {
  "src/lib/prompts.ts": /DEFAULT_KEYPOINTS_TEMPLATE/,
  "src/lib/extract.ts": /内容过长，已截断/,
  "src/lib/settings.ts": /label: "(简体中文|繁體中文|日本語)"/,
  "src/agent/risk.ts": /const (CONSEQUENTIAL|DESTRUCTIVE|PAYMENT)|^\s*\/提交/, // matches page button text, not UI copy
  "src/lib/providers.ts": /billing\|余额/, // matches Chinese provider error text, not UI copy
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("i18n", () => {
  it("has no hard-coded Chinese UI copy outside src/i18n", () => {
    const offenders: string[] = [];
    for (const f of [...walk("src"), ...walk("entrypoints")]) {
      if (f.startsWith("src/i18n/")) continue;
      stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
        if (CJK.test(line) && !ALLOWED[f]?.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("interpolates params and falls back to zh_CN for missing English keys", () => {
    setLocale("zh-CN");
    expect(tr("chat.translating", { done: 3, total: 9 })).toBe("正在翻译 3/9");
    setLocale("en-US");
    expect(tr("brand.name")).toBe("Sidekick");
    expect(tr("chat.summarizePage")).toBe(zh_CN["chat.summarizePage"]);
    setLocale("zh-CN");
    expect(tr("brand.name")).toBe("翻翻");
  });

  it("locale detection: en → en, everything else → zh (only complete catalog)", () => {
    expect(detectLocale("en-GB")).toBe("en");
    expect(detectLocale("zh-TW")).toBe("zh");
    expect(detectLocale("fr")).toBe("zh");
  });

  it("en only contains known keys", () => {
    for (const k of Object.keys(en)) expect(k in zh_CN).toBe(true);
  });
});
