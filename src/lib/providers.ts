import type { ModelRef, ProviderConfig, ProviderKind } from "./types";
import { tr } from "@/src/i18n";

export type OAuthProviderId = "chatgpt" | "antigravity" | "openrouter" | "github-copilot" | "kimi-coding" | "xai" | "anthropic" | "meta";

export const ANTIGRAVITY_MODELS = [
  "gemini-3.8-flash-high",
  "gemini-3.8-flash-medium",
  "gemini-3.8-flash-low",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "claude-sonnet-5-5-high",
  "claude-sonnet-5-5-medium",
  "claude-sonnet-5-5-low",
  "claude-opus-5-5-high",
  "claude-opus-5-5-medium",
  "claude-opus-5-5-low",
  "gpt-oss-120b-medium",
];

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];
  keyUrl?: string;
  keyOptional?: boolean;
  hint?: string;
  oauth?: OAuthProviderId;
}

export const PRESETS: ProviderPreset[] = [
  { id: "openai", name: tr("preset.openai"), kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-5.3-codex-spark", "gpt-5.5"], keyUrl: "https://platform.openai.com/api-keys", oauth: "chatgpt" },
  { id: "antigravity", name: tr("preset.antigravity"), kind: "gemini", baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com", models: [...ANTIGRAVITY_MODELS], oauth: "antigravity" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], keyUrl: "https://console.anthropic.com/settings/keys", oauth: "anthropic" },
  { id: "github-copilot", name: tr("preset.githubCopilot"), kind: "openai-compatible", baseUrl: "https://api.individual.githubcopilot.com", models: ["gpt-4.1", "claude-sonnet-4", "gpt-4o", "o3-mini"], oauth: "github-copilot" },
  { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o-mini", "deepseek/deepseek-chat"], keyUrl: "https://openrouter.ai/keys", oauth: "openrouter" },
  { id: "kimi-coding", name: tr("preset.kimiCoding"), kind: "openai-compatible", baseUrl: "https://api.kimi.com/coding/v1", models: ["kimi-k2-0711-preview", "kimi-for-coding"], keyUrl: "https://www.kimi.com/code", oauth: "kimi-coding" },
  { id: "xai", name: tr("preset.xai"), kind: "openai-compatible", baseUrl: "https://api.x.ai/v1", models: ["grok-3-mini", "grok-3"], keyUrl: "https://console.x.ai", oauth: "xai" },
  { id: "meta", name: tr("preset.meta"), kind: "openai-compatible", baseUrl: "https://api.llama.com/compat/v1", models: ["Llama-4-Maverick-17B-128E-Instruct-FP8", "Llama-3.3-70B-Instruct"], keyUrl: "https://llama.developer.meta.com", oauth: "meta" },
  { id: "deepseek", name: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "moonshot", name: tr("preset.moonshot"), kind: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", models: ["kimi-latest", "moonshot-v1-32k"], keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  { id: "qwen", name: tr("preset.qwen"), kind: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-turbo", "qwen-max"], keyUrl: "https://bailian.console.aliyun.com/" },
  { id: "zhipu", name: tr("preset.zhipu"), kind: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-plus"], keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { id: "siliconflow", name: tr("preset.siliconflow"), kind: "openai-compatible", baseUrl: "https://api.siliconflow.cn/v1", models: ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct"], keyUrl: "https://cloud.siliconflow.cn/account/ak" },
  { id: "volcengine", name: tr("preset.volcengine"), kind: "openai-compatible", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-1-5-pro-32k-250115", "deepseek-v3-250324"], keyUrl: "https://console.volcengine.com/ark" },
  { id: "gemini", name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash", "gemini-2.5-pro"], keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", name: tr("preset.groq"), kind: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], keyUrl: "https://console.groq.com/keys" },
  { id: "mistral", name: tr("preset.mistral"), kind: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", models: ["mistral-small-latest", "mistral-large-latest"], keyUrl: "https://console.mistral.ai/api-keys" },
  { id: "ollama", name: tr("preset.ollama"), kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", models: ["qwen2.5:7b"], keyOptional: true, hint: tr("preset.ollamaHint") },
  { id: "custom", name: tr("preset.custom"), kind: "openai-compatible", baseUrl: "", models: [], hint: tr("preset.customHint") },
  { id: "custom-anthropic", name: tr("preset.customAnthropic"), kind: "anthropic", baseUrl: "", models: [], hint: tr("preset.customAnthropicHint") },
];

export const PROVIDERS_KEY = "providers";
const SECRET_PREFIX = "secret:";
const OAUTH_PREFIX = "oauth:";
export const secretKey = (providerId: string) => `${SECRET_PREFIX}${providerId}`;
export const oauthKey = (providerId: string) => `${OAUTH_PREFIX}${providerId}`;

export function newProviderFromPreset(p: ProviderPreset, now = Date.now()): ProviderConfig {
  return {
    id: `${p.id}-${now.toString(36)}`,
    kind: p.kind,
    name: p.name,
    presetId: p.id,
    baseUrl: p.baseUrl,
    models: [...p.models],
    enabled: true,
    createdAt: now,
  };
}

/** Show only a short prefix and the last 4 chars: "sk-…a1b2". Never render a full key in the UI. */
export function maskKey(key: string | undefined | null): string {
  if (!key) return "";
  let k = key.trim();
  if (k.startsWith("{")) {
    try {
      const parsed = JSON.parse(k) as { token?: string };
      if (typeof parsed?.token === "string" && parsed.token.trim()) k = parsed.token.trim();
    } catch {
      /* ignore */
    }
  }
  if (k.length <= 8) return "•".repeat(k.length);
  const prefix = /^(?:[a-z]{2,4}-|ya29\.)/i.exec(k)?.[0] ?? "";
  return `${prefix}••••${k.slice(-4)}`;
}

/** Remove any occurrence of the given secrets (and common key shapes) from text such as provider error messages. */
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    out = out.split(s).join("[redacted]");
    if (s.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(s) as { token?: string };
        if (typeof parsed?.token === "string" && parsed.token.length >= 6) {
          out = out.split(parsed.token).join("[redacted]");
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out
    .replace(/\b(sk|ak|pk)-[A-Za-z0-9_\-]{12,}/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted]")
    .replace(/ya29\.[0-9A-Za-z_\-.]{16,}/g, "[redacted]")
    .replace(/([?&]key=)[^&\s"']+/g, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, "$1[redacted]");
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function modelRef(providerId: string, modelId: string): ModelRef {
  return `${providerId}::${modelId}`;
}

export function parseModelRef(ref: ModelRef): { providerId: string; modelId: string } | null {
  if (ref === "auto") return null;
  const i = ref.indexOf("::");
  if (i < 0) return null;
  return { providerId: ref.slice(0, i), modelId: ref.slice(i + 2) };
}

/**
 * Resolve a task's model reference. "auto" (the default) picks the first enabled provider that is usable
 * (has a key, or doesn't need one) and its first model. A stale explicit ref falls back to auto.
 */
export function resolveModelRef(
  ref: ModelRef,
  providers: ProviderConfig[],
  usable: (p: ProviderConfig) => boolean,
): { provider: ProviderConfig; modelId: string } | null {
  const parsed = parseModelRef(ref);
  if (parsed) {
    const p = providers.find((x) => x.id === parsed.providerId && x.enabled && usable(x));
    if (p && parsed.modelId) return { provider: p, modelId: parsed.modelId };
  }
  for (const p of providers) {
    if (p.enabled && usable(p) && p.models.length) return { provider: p, modelId: p.models[0] };
  }
  return null;
}

export const keyOptional = (p: ProviderConfig) => PRESETS.find((x) => x.id === p.presetId)?.keyOptional ?? false;

// ---- chrome.storage.local access (extension pages + service worker only; content scripts never import this) ----
export async function loadProviders(): Promise<ProviderConfig[]> {
  const r = await chrome.storage.local.get(PROVIDERS_KEY);
  return Array.isArray(r[PROVIDERS_KEY]) ? (r[PROVIDERS_KEY] as ProviderConfig[]) : [];
}
export async function saveProviders(list: ProviderConfig[]) {
  await chrome.storage.local.set({ [PROVIDERS_KEY]: list });
}
export async function getKey(providerId: string): Promise<string | undefined> {
  const k = secretKey(providerId);
  const r = await chrome.storage.local.get(k);
  const v = typeof r[k] === "string" && r[k] ? (r[k] as string).trim() : undefined;
  if (!v) return undefined;
  if (v.startsWith("{")) {
    try {
      const parsed = JSON.parse(v) as { token?: string };
      if (typeof parsed?.token === "string" && parsed.token.trim()) return parsed.token.trim();
    } catch {
      /* ignore */
    }
  }
  return v;
}
export async function setKey(providerId: string, key: string) {
  const k = secretKey(providerId);
  let v = key.trim();
  if (v.startsWith("{")) {
    try {
      const parsed = JSON.parse(v) as { token?: string };
      if (typeof parsed?.token === "string" && parsed.token.trim()) v = parsed.token.trim();
    } catch {
      /* ignore */
    }
  }
  if (v) await chrome.storage.local.set({ [k]: v });
  else await chrome.storage.local.remove(k);
}
export async function deleteProvider(providerId: string) {
  const list = (await loadProviders()).filter((p) => p.id !== providerId);
  await saveProviders(list);
  await chrome.storage.local.remove([secretKey(providerId), oauthKey(providerId)]);
}
export async function keyStatus(): Promise<Record<string, string>> {
  const all = await chrome.storage.local.get(null);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith(SECRET_PREFIX) && typeof v === "string") out[k.slice(SECRET_PREFIX.length)] = maskKey(v);
  return out;
}

/** Turn provider / network errors into a readable reason (spec 3.5: key wrong / no balance / network). */
export function friendlyError(raw: string): string {
  const m = raw || "";
  if (/Cloud Code Assist API error/i.test(m)) return m.slice(0, 240);
  if (/\b(401|403)\b|invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed|authentication/i.test(m)) return tr("err.401");
  if (/\b402\b|insufficient|balance|quota|billing|余额/i.test(m)) return tr("err.402");
  if (/\b429\b|rate limit|too many requests/i.test(m)) return tr("err.429");
  if (/\b404\b|model.*(not exist|not found)|no such model/i.test(m)) return tr("err.404");
  if (/failed to fetch|networkerror|network error|ECONNREFUSED|ENOTFOUND|timed? ?out|aborted|load failed/i.test(m)) return tr("err.network");
  if (/\b5\d\d\b/.test(m)) return tr("err.5xx");
  return m.slice(0, 200) || tr("err.unknown");
}
