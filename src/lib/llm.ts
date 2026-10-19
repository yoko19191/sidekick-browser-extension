/**
 * Model layer (service worker only). Uses pi-ai's per-protocol stream functions, imported statically
 * because MV3 service workers do not support dynamic import().
 */
import type { Api, AssistantMessageEvent, Context, Model, Tool, ToolCall } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { streamSimple as openaiStream } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as anthropicStream } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as geminiStream } from "@earendil-works/pi-ai/api/google-generative-ai";
import { normalizeBaseUrl, redactSecrets } from "./providers";
import type { ChatTurn, ProviderConfig, ProviderKind } from "./types";

const API_OF: Record<ProviderKind, Api> = {
  "openai-compatible": "openai-completions",
  anthropic: "anthropic-messages",
  gemini: "google-generative-ai",
};

export function toPiModel(p: ProviderConfig, modelId: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    api: API_OF[p.kind],
    provider: `sidekick-${p.presetId}`,
    baseUrl: normalizeBaseUrl(p.baseUrl),
    reasoning: /reason|thinking|r1\b|o\d/i.test(modelId),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
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

function streamFor(kind: ProviderKind) {
  return kind === "anthropic" ? anthropicStream : kind === "gemini" ? geminiStream : openaiStream;
}

/** Stream assistant text. Calls onDelta for each text chunk; resolves with the full text. */
export async function streamText(
  args: StreamArgs,
  cb: { onDelta?: (t: string) => void; onThinking?: () => void } = {},
): Promise<{ text: string; stopReason?: string; toolCalls: ToolCall[] }> {
  const model = toPiModel(args.provider, args.modelId);
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
  const stream = streamFor(args.provider.kind)(model as never, normalizeContext(ctx), {
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
      throw new Error(redactSecrets(ev.error.errorMessage || "模型请求失败", [args.apiKey]));
    } else if (ev.type === "done") {
      return { text, stopReason: ev.reason, toolCalls };
    }
  }
  return { text, toolCalls };
}

// ---- connection test / model listing (plain fetch, no SDK needed) ----
export async function listModels(p: ProviderConfig, apiKey?: string, signal?: AbortSignal): Promise<string[]> {
  const base = normalizeBaseUrl(p.baseUrl);
  let res: Response;
  if (p.kind === "anthropic") {
    res = await fetch(`${base}/v1/models?limit=100`, {
      headers: { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      signal,
    });
  } else if (p.kind === "gemini") {
    res = await fetch(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey ?? "" }, signal });
  } else {
    res = await fetch(`${base}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal });
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
  if (!target) throw new Error(listError ?? "没有可测试的模型");
  // A tiny completion verifies the key + model actually work.
  const r = await streamText({ provider: p, modelId: target, apiKey, messages: [{ role: "user", content: "Reply with: ok" }], maxTokens: 16, signal: AbortSignal.timeout(30000) });
  return { ok: true, latencyMs: Date.now() - t0, model: target, reply: r.text.slice(0, 40), models, listError };
}
