export type ProviderKind = "openai-compatible" | "anthropic" | "gemini";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  presetId: string;
  baseUrl: string;
  /** Model ids the user can pick from (prefilled from the preset, refreshable via "list models"). */
  models: string[];
  enabled: boolean;
  createdAt: number;
}

/** "auto" = first enabled provider that has a key, using its first model. */
export type ModelRef = "auto" | `${string}::${string}`;

export type TranslationStyle = "plain" | "dashed" | "faded" | "highlight" | "card";
export type SummaryLength = "short" | "medium" | "detailed";
export type ThemeMode = "system" | "light" | "dark";
export type DisplayMode = "bilingual" | "translation-only";

export interface Settings {
  theme: ThemeMode;
  models: { chat: ModelRef; summary: ModelRef; translate: ModelRef };
  translation: {
    targetLang: string; // BCP-47, e.g. zh-CN
    style: TranslationStyle;
    batchMaxChars: number;
    batchMaxItems: number;
    concurrency: number;
    cacheEnabled: boolean;
    autoTranslateDynamic: boolean;
    extraPrompt: string;
    skipSelectors: string;
    displayMode: DisplayMode;
    /** Hosts translated automatically on load (needs a per-site host grant). */
    autoSites: string[];
    /** Hosts never translated / no floating button. */
    neverSites: string[];
    floatingButton: boolean;
    selectionTranslate: boolean;
  };
  summary: {
    length: SummaryLength;
    /** "target" follows translation.targetLang */
    language: "target" | "page" | string;
    maxContextChars: number;
  };
  chat: { temperature: number; maxTokens: number };
  prompts: {
    /** Empty = built-in template. */
    summary: string;
    chatSystem: string;
    keyPoints: string;
  };
  cache: { maxEntries: number };
}

// ---- messaging ----
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type PortRequest =
  | {
      type: "chat";
      id: string;
      task: "chat" | "summary";
      messages: ChatTurn[];
      page?: { title: string; url: string; markdown: string; lang?: string };
    }
  | { type: "abort"; id: string }
  | { type: "ping" };

export type PortEvent =
  | { type: "start"; id: string; model: string }
  | { type: "delta"; id: string; text: string }
  | { type: "thinking"; id: string }
  | { type: "progress"; id: string; done: number; total: number }
  | { type: "done"; id: string; stopReason?: string }
  | { type: "error"; id: string; message: string }
  | { type: "pong"; bootId: string };

export interface PageContent {
  title: string;
  url: string;
  markdown: string;
  excerpt?: string;
  lang?: string;
  byline?: string;
  length: number;
}

export interface TranslateState {
  active: boolean;
  total: number;
  done: number;
  errors: number;
  lastError?: string;
}
