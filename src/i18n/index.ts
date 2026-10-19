/**
 * UI copy. `zh_CN` is the complete source catalog; other locales are partial and fall back to it key by key, so a new
 * language is just a new catalog file (no code changes). Manifest-level strings (name, description, menu commands)
 * live in public/_locales.
 *
 *   tr("chat.translating", { done: 3, total: 9 })  →  "正在翻译 3/9"
 */
import { zh_CN } from "./zh_CN";
import { en } from "./en";

export type MessageKey = keyof typeof zh_CN;
export type Catalog = Partial<Record<MessageKey, string>>;

const CATALOGS: Record<string, Catalog> = { zh: zh_CN, en };

/** Browser UI language → catalog id. Unknown languages use zh_CN (the only complete catalog for now). */
export function detectLocale(uiLang?: string): string {
  let lang = uiLang;
  if (!lang) {
    try {
      lang = globalThis.chrome?.i18n?.getUILanguage?.();
    } catch {
      lang = undefined;
    }
  }
  const base = (lang ?? "zh").toLowerCase().split(/[-_]/)[0];
  return base in CATALOGS ? base : "zh";
}

let current: Catalog = CATALOGS[detectLocale()];

/** For tests / a future in-app language switch. */
export function setLocale(id: string) {
  current = CATALOGS[detectLocale(id)];
}

export function tr(key: MessageKey, params?: Record<string, string | number>): string {
  const s = current[key] ?? zh_CN[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}
