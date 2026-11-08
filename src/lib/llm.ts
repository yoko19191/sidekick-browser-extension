/**
 * Model layer (service worker only). Uses pi-ai's per-protocol stream functions, imported statically
 * because MV3 service workers do not support dynamic import().
 */
import type { Api, AssistantMessageEvent, Context, Model, Tool, ToolCall } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { streamSimple as openaiStream } from "@earendil-works/pi-ai/api/openai-completions";
import { stream as codexRawStream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { streamSimple as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as geminiStream } from "@earendil-works/pi-ai/api/google-generative-ai";
import { normalizeBaseUrl, redactSecrets } from "./providers";
import type { ChatTurn, ProviderConfig, ProviderKind } from "./types";
import { tr } from "@/src/i18n";
import type { StreamFn } from "@earendil-works/pi-agent-core";

const API_OF: Record<ProviderKind, Api> = {
  "openai-compatible": "openai-completions",
  anthropic: "anthropic-messages",
  gemini: "google-generative-ai",
};

export const COPILOT_HEADERS: Record<string, string> = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
};

export const CHATGPT_CODEX_MODELS = ["gpt-5.3-codex-spark", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"];

/** Detect whether an API key is a ChatGPT Plus/Pro OAuth JWT token (contains chatgpt_account_id claim). */
export function isChatGPTOAuthToken(apiKey?: string): boolean {
  if (!apiKey || !apiKey.startsWith("eyJ")) return false;
  const parts = apiKey.split(".");
  if (parts.length !== 3) return false;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return Boolean(payload?.["https://api.openai.com/auth"]?.chatgpt_account_id);
  } catch {
    return false;
  }
}

export function inferModelMeta(modelId: string, kind: ProviderKind): { reasoning: boolean; contextWindow: number; maxTokens: number } {
  const m = modelId.toLowerCase();
  const reasoning = /reason|thinking|\br[12]\b|\bo[134](?:-|\b)|\bqwq\b|zero-preview|\bgemini-2\.5|\bcodex/i.test(m);
  let contextWindow = 128000;
  const kMatch = m.match(/(?:^|[-_:])(\d+)k(?:\b|$)/);
  if (kMatch) {
    contextWindow = Number(kMatch[1]) * 1024;
  } else if (kind === "gemini" || /\bgemini-(?:1\.5|2\.)|\bgpt-4\.1/i.test(m)) {
    contextWindow = 1_000_000;
  } else if (kind === "anthropic" || /\bclaude-(?:3|4|sonnet|opus|haiku)/i.test(m)) {
    contextWindow = 200_000;
  }
  const maxTokens = reasoning ? 16384 : contextWindow <= 8192 ? 2048 : 8192;
  return { reasoning, contextWindow, maxTokens };
}

export function toPiModel(p: ProviderConfig, modelId: string, apiKey?: string): Model<Api> {
  const meta = inferModelMeta(modelId, p.kind);
  const isCopilot = p.presetId === "github-copilot";
  const isCodex = isChatGPTOAuthToken(apiKey) || p.baseUrl.includes("chatgpt.com/backend-api");
  return {
    id: modelId,
    name: modelId,
    api: isCodex ? "openai-codex-responses" : API_OF[p.kind],
    provider: isCodex ? "openai-codex" : isCopilot ? "github-copilot" : `sidekick-${p.presetId}`,
    baseUrl: isCodex ? "https://chatgpt.com/backend-api" : normalizeBaseUrl(p.baseUrl),
    reasoning: meta.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: meta.contextWindow,
    maxTokens: meta.maxTokens,
    ...(isCopilot ? { headers: COPILOT_HEADERS } : {}),
  } as Model<Api>;
}

export interface StreamArgs {
  provider: ProviderConfig;
  modelId: string;
  apiKey?: string;
  system?: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
}

const codexStream: typeof openaiStream = (model, context, options) =>
  codexRawStream(model as never, context, { ...(options as object), transport: "sse" } as never);

function streamFor(kind: ProviderKind, api?: Api) {
  if (api === "openai-codex-responses") return codexStream;
  return kind === "anthropic" ? anthropicStream : kind === "gemini" ? geminiStream : openaiStream;
}

/** Stream assistant text. Calls onDelta for each text chunk; resolves with the full text. */
export async function streamText(
  args: StreamArgs,
  cb: { onDelta?: (t: string) => void; onThinking?: () => void } = {},
): Promise<{ text: string; stopReason?: string; toolCalls: ToolCall[] }> {
  const model = toPiModel(args.provider, args.modelId, args.apiKey);
  const now = Date.now();
  const ctx: Context = {
    systemPrompt: args.system,
    tools: args.tools,
    messages: args.messages.map((m) =>
      m.role === "user"
        ? { role: "user", content: m.content, timestamp: now }
        : ({
            role: "assistant",
            content: [{ type: "text", text: m.content }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: now,
          } as never),
    ),
  };
  const stream = streamFor(args.provider.kind, model.api)(model as never, normalizeContext(ctx), {
    apiKey: args.apiKey || "not-needed",
    signal: args.signal,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
  } as never);
  let text = "";
  const toolCalls: ToolCall[] = [];
  for await (const ev of stream as AsyncIterable<AssistantMessageEvent>) {
    if (ev.type === "text_delta") {
      text += ev.delta;
      cb.onDelta?.(ev.delta);
    } else if (ev.type === "thinking_delta" || ev.type === "thinking_start") {
      cb.onThinking?.();
    } else if (ev.type === "toolcall_end") {
      toolCalls.push(ev.toolCall);
    } else if (ev.type === "error") {
      if (ev.reason === "aborted") throw new DOMException("aborted", "AbortError");
      throw new Error(redactSecrets(ev.error.errorMessage || tr("err.requestFailed"), [args.apiKey]));
    } else if (ev.type === "done") {
      return { text, stopReason: ev.reason, toolCalls };
    }
  }
  return { text, toolCalls };
}

// ---- connection test / model listing (plain fetch, no SDK needed) ----
export async function listModels(p: ProviderConfig, apiKey?: string, signal?: AbortSignal): Promise<string[]> {
  if (isChatGPTOAuthToken(apiKey) || p.baseUrl.includes("chatgpt.com/backend-api")) {
    return [...CHATGPT_CODEX_MODELS];
  }
  const base = normalizeBaseUrl(p.baseUrl);
  let res: Response;
  if (p.kind === "anthropic") {
    const isOAuth = !!apiKey?.includes("sk-ant-oat");
    res = await fetch(`${base}/v1/models?limit=100`, {
      headers: isOAuth
        ? { Authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20", "anthropic-dangerous-direct-browser-access": "true" }
        : { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      signal,
    });
  } else if (p.kind === "gemini") {
    res = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey ?? "" }, signal });
  } else {
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    if (p.presetId === "github-copilot") Object.assign(headers, COPILOT_HEADERS);
    res = await fetch(`${base}/models`, { headers, signal });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(redactSecrets(`HTTP ${res.status} ${body.slice(0, 200)}`, [apiKey]));
  }
  const json = (await res.json()) as { data?: { id: string }[]; models?: { name: string; supportedGenerationMethods?: string[] }[] };
  if (p.kind === "gemini")
    return (json.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  return (json.data ?? []).map((m) => m.id).sort();
}

export async function testConnection(p: ProviderConfig, modelId: string | undefined, apiKey?: string) {
  const t0 = Date.now();
  let models: string[] = [];
  let listError: string | undefined;
  try {
    models = await listModels(p, apiKey, AbortSignal.timeout(15000));
  } catch (e) {
    listError = (e as Error).message;
  }
  const target = modelId ?? models[0] ?? p.models[0];
  if (!target) throw new Error(listError ?? tr("err.noTestModel"));
  // A tiny completion verifies the key + model actually work.
  const r = await streamText({ provider: p, modelId: target, apiKey, messages: [{ role: "user", content: "Reply with: ok" }], maxTokens: 16, signal: AbortSignal.timeout(30000) });
  return { ok: true, latencyMs: Date.now() - t0, model: target, reply: r.text.slice(0, 40), models, listError };
}

/** pi-agent-core StreamFn for a provider (used by the web-action agent in the service worker). */
export function agentStreamFn(kind: ProviderKind): StreamFn {
  return ((model: Model<Api>, context: Context, options?: unknown) =>
    streamFor(kind, model?.api)(model as never, normalizeContext(context), options as never)) as unknown as StreamFn;
}
