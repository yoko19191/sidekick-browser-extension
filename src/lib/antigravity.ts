/**
 * Google Antigravity (Cloud Code Assist v1internal) stream adapter for pi-ai.
 * Works in browser / MV3 service worker environments using fetch + SSE.
 */
import type { Api, AssistantMessage, Model, StreamOptions, ThinkingContent, TextContent, ToolCall, TranscriptContext } from "@earendil-works/pi-ai";
import {
  convertMessages,
  convertTools,
  isThinkingPart,
  mapStopReasonString,
  retainThoughtSignature,
} from "@earendil-works/pi-ai/api/google-shared";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { sanitizeSurrogates } from "@earendil-works/pi-ai/utils/sanitize-unicode";
import { getSystemMessageText } from "@earendil-works/pi-ai/utils/text";
import { collapseSystemMessages, getCurrentTools, getInitialSystemMessage } from "@earendil-works/pi-ai/utils/transcript";
import { ANTIGRAVITY_BASE_URL, ANTIGRAVITY_DEFAULT_PROJECT_ID, discoverAntigravityProject } from "./oauth";

const DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const ANTIGRAVITY_AUTOPUSH_ENDPOINT = "https://autopush-cloudcode-pa.sandbox.googleapis.com";
const ANTIGRAVITY_ENDPOINT_FALLBACKS = [
  ANTIGRAVITY_BASE_URL,
  ANTIGRAVITY_AUTOPUSH_ENDPOINT,
  DEFAULT_ENDPOINT,
];

export const DEFAULT_ANTIGRAVITY_VERSION = "2.31.2";
export const ANTIGRAVITY_USER_AGENT = `antigravity/${DEFAULT_ANTIGRAVITY_VERSION} darwin/arm64`;
const CLAUDE_THINKING_BETA_HEADER = "interleaved-thinking-2025-05-14";

const ANTIGRAVITY_DNR_RULE_ID = 51121;
let dnrInstalled = false;

/**
 * Install a declarativeNetRequest session rule so that extension fetch() calls to
 * Cloud Code Assist endpoints carry `User-Agent: antigravity/<version> darwin/arm64`.
 * Chromium strips `User-Agent` from fetch() headers as a forbidden header, and
 * `daily-cloudcode-pa.sandbox.googleapis.com` rejects browser User-Agents with HTTP 403.
 */
export async function ensureAntigravityNetRules(): Promise<void> {
  if (dnrInstalled) return;
  const dnr = (globalThis as unknown as { chrome?: typeof chrome }).chrome?.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  try {
    await dnr.updateSessionRules({
      removeRuleIds: [ANTIGRAVITY_DNR_RULE_ID],
      addRules: [
        {
          id: ANTIGRAVITY_DNR_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: "User-Agent",
                operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
                value: ANTIGRAVITY_USER_AGENT,
              },
            ],
          },
          condition: {
            requestDomains: [
              "daily-cloudcode-pa.sandbox.googleapis.com",
              "autopush-cloudcode-pa.sandbox.googleapis.com",
              "cloudcode-pa.googleapis.com",
            ],
            resourceTypes: ["xmlhttprequest" as chrome.declarativeNetRequest.ResourceType],
          },
        },
      ],
    });
    dnrInstalled = true;
  } catch {
    /* ignore in unit tests or if permission not yet active */
  }
}

/**
 * Fetch the live list of available models from Cloud Code Assist (`v1internal:fetchAvailableModels`).
 */
export async function fetchAntigravityModels(
  baseUrl?: string,
  apiKey?: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const { token: accessToken } = parseAntigravityCredentials(apiKey);
  await ensureAntigravityNetRules();
  const customBase = baseUrl?.trim().replace(/\/+$/, "");
  const endpoints = [
    ...new Set([...(customBase ? [customBase] : []), ...ANTIGRAVITY_ENDPOINT_FALLBACKS]),
  ];
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
  };

  let lastError: Error | undefined;
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers,
        body: "{}",
        signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`Cloud Code Assist API error (${res.status}): ${extractErrorMessage(text)}`);
        continue;
      }
      const data = (await res.json()) as {
        models?: Record<
          string,
          {
            displayName?: string;
            recommended?: boolean;
            apiProvider?: string;
          }
        >;
      };
      const entries = Object.entries(data.models ?? {}).filter(([id, info]) => {
        if (info.apiProvider === "API_PROVIDER_INTERNAL") return false;
        if (id.startsWith("tab_") || id.startsWith("chat_")) return false;
        return true;
      });
      if (entries.length > 0) {
        entries.sort(([idA, a], [idB, b]) => {
          const recA = a.recommended ? 0 : 1;
          const recB = b.recommended ? 0 : 1;
          if (recA !== recB) return recA - recB;
          return idA.localeCompare(idB);
        });
        return entries.map(([id]) => id);
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (lastError) throw lastError;
  return [];
}

const ANTIGRAVITY_SYSTEM_INSTRUCTION =
  "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding." +
  "You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question." +
  "**Absolute paths only**" +
  "**Proactiveness**";

let toolCallCounter = 0;

/** Detect whether an API key string is an Antigravity JSON credential ({ token, projectId }) or a Google OAuth token (ya29.*). */
export function isAntigravityOAuthToken(apiKey?: string): boolean {
  if (!apiKey) return false;
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("ya29.")) return true;
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { token?: unknown; projectId?: unknown };
    return typeof parsed?.token === "string" && parsed.token.length > 0 && typeof parsed?.projectId === "string" && parsed.projectId.length > 0;
  } catch {
    return false;
  }
}

/** Parse Antigravity credentials from either JSON `{ token, projectId }` or a raw Google OAuth access token. */
export function parseAntigravityCredentials(apiKey?: string): { token: string; projectId: string; explicitProject: boolean } {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Antigravity requires OAuth authentication.");
  }
  const trimmed = apiKey.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { token?: string; projectId?: string };
      if (typeof parsed?.token === "string" && parsed.token.trim()) {
        const proj = typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
        return {
          token: parsed.token.trim(),
          projectId: proj || ANTIGRAVITY_DEFAULT_PROJECT_ID,
          explicitProject: Boolean(proj && proj !== ANTIGRAVITY_DEFAULT_PROJECT_ID),
        };
      }
    } catch {
      throw new Error("Invalid Antigravity OAuth credentials.");
    }
  }
  return { token: trimmed, projectId: ANTIGRAVITY_DEFAULT_PROJECT_ID, explicitProject: false };
}

function isGemini3ProModel(modelId: string): boolean {
  return /gemini-3(?:\.\d+)?-pro/i.test(modelId);
}

function isGemini3FlashModel(modelId: string): boolean {
  return /gemini-3(?:\.\d+)?-flash/i.test(modelId);
}

function extractErrorMessage(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* ignore */
  }
  return errorText;
}

export function buildAntigravityRequest(
  model: Model<Api>,
  context: TranscriptContext,
  projectId: string,
  options: StreamOptions & { temperature?: number; maxTokens?: number } = {},
) {
  const normalizedContext = collapseSystemMessages(context);
  const contents = convertMessages(model as never, normalizedContext);
  const initialSystemMessage = getInitialSystemMessage(normalizedContext.messages);
  const systemText = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";
  const currentTools = getCurrentTools(normalizedContext.messages);

  const generationConfig: Record<string, unknown> = {};
  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }

  const isClaudeThinking = model.id.startsWith("claude-") && model.id.includes("thinking");
  if (isClaudeThinking) {
    const budgetTokens = 4096;
    const requestedMax = options.maxTokens ?? 8192;
    generationConfig.maxOutputTokens = Math.max(requestedMax + budgetTokens, budgetTokens + 1024);
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: budgetTokens,
    };
  } else if (isGemini3ProModel(model.id)) {
    const level = model.id.toLowerCase().endsWith("-low") ? "LOW" : "HIGH";
    if (options.maxTokens !== undefined) {
      // Ensure headroom for internal thoughts when a tiny maxTokens (e.g. connection test) is passed
      generationConfig.maxOutputTokens = Math.max(options.maxTokens, 512);
    }
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingLevel: level,
    };
  } else if (isGemini3FlashModel(model.id)) {
    if (options.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = Math.max(options.maxTokens, 512);
    }
    if (!/-(?:low|medium|high|tiered)$/i.test(model.id)) {
      generationConfig.thinkingConfig = {
        thinkingLevel: "MINIMAL",
      };
    }
  } else if (model.reasoning && options.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = Math.max(options.maxTokens, 512);
  } else if (options.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = options.maxTokens;
  }

  const request: Record<string, unknown> = {
    contents,
  };

  if (options.sessionId) {
    request.sessionId = options.sessionId;
  }

  const existingParts = systemText ? [{ text: sanitizeSurrogates(systemText) }] : [];
  request.systemInstruction = {
    role: "user",
    parts: [
      { text: ANTIGRAVITY_SYSTEM_INSTRUCTION },
      { text: `Please ignore following [ignore]${ANTIGRAVITY_SYSTEM_INSTRUCTION}[/ignore]` },
      ...existingParts,
    ],
  };

  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig;
  }

  if (currentTools.length > 0) {
    const useParameters = model.id.startsWith("claude-");
    request.tools = convertTools(currentTools, useParameters, false);
  }

  return {
    project: projectId,
    model: model.id,
    request,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
  };
}

export function streamAntigravity(
  model: Model<Api>,
  context: TranscriptContext,
  options?: StreamOptions & { temperature?: number; maxTokens?: number },
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const { token: accessToken, projectId: parsedProject, explicitProject } = parseAntigravityCredentials(options?.apiKey);
      await ensureAntigravityNetRules();
      const projectId = explicitProject ? parsedProject : await discoverAntigravityProject(accessToken);
      const customBase = model.baseUrl?.trim().replace(/\/+$/, "");
      const endpoints = [...new Set([
        ...(customBase ? [customBase] : []),
        ...ANTIGRAVITY_ENDPOINT_FALLBACKS,
      ])];

      const requestBody = buildAntigravityRequest(model, context, projectId, options);
      const requestBodyJson = JSON.stringify(requestBody);

      const needsClaudeThinkingBeta = model.id.startsWith("claude-") && model.id.includes("thinking");
      const requestHeaders: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": ANTIGRAVITY_USER_AGENT,
        ...(needsClaudeThinkingBeta ? { "anthropic-beta": CLAUDE_THINKING_BETA_HEADER } : {}),
      };

      let response: Response | undefined;
      let lastError: Error | undefined;
      for (let i = 0; i < endpoints.length; i++) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        const endpoint = endpoints[i];
        const requestUrl = `${endpoint}/v1internal:streamGenerateContent?alt=sse`;
        try {
          const res = await fetch(requestUrl, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyJson,
            signal: options?.signal,
          });
          if (res.ok) {
            response = res;
            break;
          }
          const errorText = await res.text().catch(() => "");
          if ((res.status === 403 || res.status === 404) && i < endpoints.length - 1) {
            lastError = new Error(`Cloud Code Assist API error (${res.status}): ${extractErrorMessage(errorText)}`);
            continue;
          }
          throw new Error(`Cloud Code Assist API error (${res.status}): ${extractErrorMessage(errorText)}`);
        } catch (err) {
          if (err instanceof Error && (err.name === "AbortError" || err.message === "Request was aborted")) {
            throw new Error("Request was aborted");
          }
          lastError = err instanceof Error ? err : new Error(String(err));
          if (i === endpoints.length - 1) throw lastError;
        }
      }

      if (!response || !response.ok || !response.body) {
        throw lastError ?? new Error("Failed to get response from Antigravity endpoint");
      }

      let started = false;
      const ensureStarted = () => {
        if (!started) {
          stream.push({ type: "start", partial: output });
          started = true;
        }
      };

      let currentBlock: TextContent | ThinkingContent | null = null;
      const blocks = output.content;
      const blockIndex = () => blocks.length - 1;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const abortHandler = () => {
        void reader.cancel().catch(() => {});
      };
      options?.signal?.addEventListener("abort", abortHandler);

      try {
        while (true) {
          if (options?.signal?.aborted) {
            throw new Error("Request was aborted");
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const jsonStr = line.slice(5).trim();
            if (!jsonStr) continue;
            let chunk: {
              response?: {
                responseId?: string;
                candidates?: Array<{
                  finishReason?: string;
                  content?: {
                    parts?: Array<{
                      text?: string;
                      thought?: boolean;
                      thoughtSignature?: string;
                      functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
                    }>;
                  };
                }>;
                usageMetadata?: {
                  promptTokenCount?: number;
                  cachedContentTokenCount?: number;
                  candidatesTokenCount?: number;
                  thoughtsTokenCount?: number;
                  totalTokenCount?: number;
                };
              };
            };
            try {
              chunk = JSON.parse(jsonStr);
            } catch {
              continue;
            }

            const responseData = chunk.response;
            if (!responseData) continue;

            const candidate = responseData.candidates?.[0];
            if (candidate?.content?.parts) {
              for (const part of candidate.content.parts) {
                if (part.text !== undefined) {
                  const isThinking = isThinkingPart(part);
                  if (
                    !currentBlock ||
                    (isThinking && currentBlock.type !== "thinking") ||
                    (!isThinking && currentBlock.type !== "text")
                  ) {
                    if (currentBlock) {
                      if (currentBlock.type === "text") {
                        stream.push({
                          type: "text_end",
                          contentIndex: blocks.length - 1,
                          content: currentBlock.text,
                          partial: output,
                        });
                      } else {
                        stream.push({
                          type: "thinking_end",
                          contentIndex: blockIndex(),
                          content: currentBlock.thinking,
                          partial: output,
                        });
                      }
                    }
                    if (isThinking) {
                      currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
                      output.content.push(currentBlock);
                      ensureStarted();
                      stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
                    } else {
                      currentBlock = { type: "text", text: "" };
                      output.content.push(currentBlock);
                      ensureStarted();
                      stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                    }
                  }
                  if (currentBlock.type === "thinking") {
                    currentBlock.thinking += part.text;
                    currentBlock.thinkingSignature = retainThoughtSignature(
                      currentBlock.thinkingSignature,
                      part.thoughtSignature,
                    );
                    stream.push({
                      type: "thinking_delta",
                      contentIndex: blockIndex(),
                      delta: part.text,
                      partial: output,
                    });
                  } else {
                    currentBlock.text += part.text;
                    currentBlock.textSignature = retainThoughtSignature(
                      currentBlock.textSignature,
                      part.thoughtSignature,
                    );
                    stream.push({
                      type: "text_delta",
                      contentIndex: blockIndex(),
                      delta: part.text,
                      partial: output,
                    });
                  }
                }

                if (part.functionCall) {
                  if (currentBlock) {
                    if (currentBlock.type === "text") {
                      stream.push({
                        type: "text_end",
                        contentIndex: blockIndex(),
                        content: currentBlock.text,
                        partial: output,
                      });
                    } else {
                      stream.push({
                        type: "thinking_end",
                        contentIndex: blockIndex(),
                        content: currentBlock.thinking,
                        partial: output,
                      });
                    }
                    currentBlock = null;
                  }
                  const providedId = part.functionCall.id;
                  const needsNewId =
                    !providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
                  const toolCallId = needsNewId
                    ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
                    : providedId;
                  const toolCall: ToolCall = {
                    type: "toolCall",
                    id: toolCallId,
                    name: part.functionCall.name || "",
                    arguments: (part.functionCall.args ?? {}) as ToolCall["arguments"],
                    ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                  };
                  output.content.push(toolCall);
                  ensureStarted();
                  stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
                  stream.push({
                    type: "toolcall_delta",
                    contentIndex: blockIndex(),
                    delta: JSON.stringify(toolCall.arguments),
                    partial: output,
                  });
                  stream.push({
                    type: "toolcall_end",
                    contentIndex: blockIndex(),
                    toolCall,
                    partial: output,
                  });
                }
              }
            }

            if (candidate?.finishReason) {
              output.stopReason = mapStopReasonString(candidate.finishReason);
              if (output.content.some((b) => b.type === "toolCall")) {
                output.stopReason = "toolUse";
              }
            }

            if (responseData.usageMetadata) {
              const promptTokens = responseData.usageMetadata.promptTokenCount || 0;
              const cacheReadTokens = responseData.usageMetadata.cachedContentTokenCount || 0;
              output.usage = {
                input: promptTokens - cacheReadTokens,
                output:
                  (responseData.usageMetadata.candidatesTokenCount || 0) +
                  (responseData.usageMetadata.thoughtsTokenCount || 0),
                cacheRead: cacheReadTokens,
                cacheWrite: 0,
                totalTokens: responseData.usageMetadata.totalTokenCount || 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              };
            }
          }
        }
      } finally {
        options?.signal?.removeEventListener("abort", abortHandler);
      }

      if (currentBlock) {
        if (currentBlock.type === "text") {
          stream.push({
            type: "text_end",
            contentIndex: blockIndex(),
            content: currentBlock.text,
            partial: output,
          });
        } else {
          stream.push({
            type: "thinking_end",
            contentIndex: blockIndex(),
            content: currentBlock.thinking,
            partial: output,
          });
        }
      }

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      ensureStarted();
      stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
      stream.end(output);
    } catch (error) {
      const isAborted =
        options?.signal?.aborted ||
        (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted"));
      output.stopReason = isAborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end(output);
    }
  })();

  return stream;
}
