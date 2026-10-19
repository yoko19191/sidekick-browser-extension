import type { Settings } from "./types";

export const SETTINGS_KEY = "settings";

/** Best-effort default target language from the browser UI language. */
export function defaultTargetLang(uiLang?: string): string {
  const l = (uiLang ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "").toLowerCase();
  if (l.startsWith("zh")) return /tw|hk|hant|mo/.test(l) ? "zh-TW" : "zh-CN";
  if (!l || l.startsWith("en")) return "zh-CN";
  const known = ["ja", "ko", "fr", "de", "es", "ru", "pt", "it"];
  const base = l.split("-")[0];
  return known.includes(base) ? base : "zh-CN";
}

/** Every setting hidden in level-2/3 menus has a default here, so the extension works after only adding a key. */
export function defaultSettings(uiLang?: string): Settings {
  return {
    theme: "system",
    models: { chat: "auto", summary: "auto", translate: "auto" },
    translation: {
      targetLang: defaultTargetLang(uiLang),
      style: "dashed",
      batchMaxChars: 1800,
      batchMaxItems: 16,
      concurrency: 3,
      cacheEnabled: true,
      autoTranslateDynamic: true,
      extraPrompt: "",
      skipSelectors: "",
    },
    summary: { length: "medium", language: "target", maxContextChars: 48000 },
    chat: { temperature: 0.3, maxTokens: 4096 },
  };
}

type Plain = Record<string, unknown>;
const isObj = (v: unknown): v is Plain => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge stored (possibly partial / outdated) settings over defaults, dropping wrong-typed values. */
export function mergeSettings(defaults: Settings, stored: unknown): Settings {
  const walk = (d: Plain, s: unknown): Plain => {
    const out: Plain = {};
    for (const [k, dv] of Object.entries(d)) {
      const sv = isObj(s) ? s[k] : undefined;
      if (isObj(dv)) out[k] = walk(dv, sv);
      else out[k] = sv !== undefined && typeof sv === typeof dv ? sv : dv;
    }
    return out;
  };
  return walk(defaults as unknown as Plain, stored) as unknown as Settings;
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(defaultSettings(chrome.i18n?.getUILanguage?.()), r[SETTINGS_KEY]);
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

export const LANGUAGES: { code: string; label: string; english: string }[] = [
  { code: "zh-CN", label: "简体中文", english: "Simplified Chinese" },
  { code: "zh-TW", label: "繁體中文", english: "Traditional Chinese" },
  { code: "en", label: "English", english: "English" },
  { code: "ja", label: "日本語", english: "Japanese" },
  { code: "ko", label: "한국어", english: "Korean" },
  { code: "fr", label: "Français", english: "French" },
  { code: "de", label: "Deutsch", english: "German" },
  { code: "es", label: "Español", english: "Spanish" },
  { code: "ru", label: "Русский", english: "Russian" },
  { code: "pt", label: "Português", english: "Portuguese" },
  { code: "it", label: "Italiano", english: "Italian" },
];
export const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.english ?? code;
export const langLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;
