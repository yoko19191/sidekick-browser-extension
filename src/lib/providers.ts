import type { ModelRef, ProviderConfig, ProviderKind } from "./types";
import { tr } from "@/src/i18n";

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];
  keyUrl?: string;
  keyOptional?: boolean;
  hint?: string;
}

export const PRESETS: ProviderPreset[] = [
  { id: "deepseek", name: "DeepSeek", kind: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "openai", name: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"], keyUrl: "https://platform.openai.com/api-keys" },
  { id: "moonshot", name: tr("preset.moonshot"), kind: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", models: ["kimi-latest", "moonshot-v1-32k"], keyUrl: "https://platform.moonshot.cn/console/api-keys" },
  { id: "qwen", name: tr("preset.qwen"), kind: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-turbo", "qwen-max"], keyUrl: "https://bailian.console.aliyun.com/" },
  { id: "zhipu", name: tr("preset.zhipu"), kind: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-plus"], keyUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o-mini", "deepseek/deepseek-chat"], keyUrl: "https://openrouter.ai/keys" },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-sonnet-4-5", "claude-haiku-4-5"], keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", name: "Google Gemini", kind: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", models: ["gemini-2.5-flash", "gemini-2.5-pro"], keyUrl: "https://aistudio.google.com/apikey" },
  { id: "ollama", name: tr("preset.ollama"), kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", models: ["qwen2.5:7b"], keyOptional: true, hint: tr("preset.ollamaHint") },
  { id: "custom", name: tr("preset.custom"), kind: "openai-compatible", baseUrl: "", models: [], hint: tr("preset.customHint") },
];

export const PROVIDERS_KEY = "providers";
const SECRET_PREFIX = "secret:";
export const secretKey = (providerId: string) => `${SECRET_PREFIX}${providerId}`;

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
  const k = key.trim();
  if (k.length <= 8) return "•".repeat(k.length);
  const prefix = /^[a-z]{2,4}-/i.exec(k)?.[0] ?? "";
  return `${prefix}••••${k.slice(-4)}`;
}

/** Remove any occurrence of the given secrets (and common key shapes) from text such as provider error messages. */
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out
    .replace(/\b(sk|ak|pk)-[A-Za-z0-9_\-]{12,}/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted]")
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
  return typeof r[k] === "string" && r[k] ? (r[k] as string) : undefined;
}
export async function setKey(providerId: string, key: string) {
  const k = secretKey(providerId);
  if (key.trim()) await chrome.storage.local.set({ [k]: key.trim() });
  else await chrome.storage.local.remove(k);
}
export async function deleteProvider(providerId: string) {
  const list = (await loadProviders()).filter((p) => p.id !== providerId);
  await saveProviders(list);
  await chrome.storage.local.remove(secretKey(providerId));
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
  if (/\b(401|403)\b|invalid[_ ]api[_ ]key|incorrect api key|unauthori[sz]ed|authentication/i.test(m)) return tr("err.401");
  if (/\b402\b|insufficient|balance|quota|billing|余额/i.test(m)) return tr("err.402");
  if (/\b429\b|rate limit|too many requests/i.test(m)) return tr("err.429");
  if (/\b404\b|model.*(not exist|not found)|no such model/i.test(m)) return tr("err.404");
  if (/failed to fetch|networkerror|network error|ECONNREFUSED|ENOTFOUND|timed? ?out|aborted|load failed/i.test(m)) return tr("err.network");
  if (/\b5\d\d\b/.test(m)) return tr("err.5xx");
  return m.slice(0, 200) || tr("err.unknown");
}
