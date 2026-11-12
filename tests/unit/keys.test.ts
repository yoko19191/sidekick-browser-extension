import { describe, expect, it } from "vitest";
import { maskKey, modelRef, newProviderFromPreset, parseModelRef, PRESETS, redactSecrets, resolveModelRef } from "@/src/lib/providers";
import { defaultSettings, defaultTargetLang, mergeSettings } from "@/src/lib/settings";
import type { ProviderConfig } from "@/src/lib/types";

describe("key handling", () => {
  it("masks keys, never revealing more than the last 4 chars", () => {
    const k = "sk-1234567890abcdefXYZW";
    const m = maskKey(k);
    expect(m).toBe("sk-••••XYZW");
    expect(m).not.toContain("1234567890");
    expect(maskKey("short")).toBe("•••••");
    expect(maskKey(undefined)).toBe("");
  });
  it("redacts keys from error messages (explicit and pattern-based)", () => {
    const key = "sk-live-ABCDEFGHIJKLMNOP";
    const msg = `401 Incorrect API key provided: ${key}. Authorization: Bearer ${key} url=https://x/models?key=AIzaSyA1234567890123456789012`;
    const out = redactSecrets(msg, [key]);
    expect(out).not.toContain(key);
    expect(out).not.toContain("AIzaSy");
    expect(out).toContain("[redacted]");
    expect(redactSecrets("token sk-abcdefghijklmnopqrstu leaked")).toBe("token [redacted] leaked");
  });
});

describe("model resolution", () => {
  const mk = (presetId: string, models: string[], t: number): ProviderConfig => ({ ...newProviderFromPreset(PRESETS.find((p) => p.id === presetId)!, t), models });
  const a = mk("deepseek", ["deepseek-chat"], 1);
  const b = mk("openai", ["gpt-4.1-mini"], 2);
  it("auto picks the first usable provider", () => {
    expect(resolveModelRef("auto", [a, b], (p) => p.id === b.id)?.modelId).toBe("gpt-4.1-mini");
    expect(resolveModelRef("auto", [a, b], () => true)?.modelId).toBe("deepseek-chat");
    expect(resolveModelRef("auto", [a, b], () => false)).toBeNull();
  });
  it("honours explicit refs and falls back when stale", () => {
    expect(resolveModelRef(modelRef(b.id, "gpt-4.1"), [a, b], () => true)).toMatchObject({ modelId: "gpt-4.1" });
    expect(resolveModelRef(modelRef("gone", "x"), [a, b], () => true)?.provider.id).toBe(a.id);
    expect(parseModelRef(modelRef("p::x", "m"))).toEqual({ providerId: "p", modelId: "x::m" });
  });
  it("every preset (except custom) ships default models so adding a key is enough", () => {
    for (const p of PRESETS.filter((x) => !x.id.startsWith("custom"))) {
      expect(p.models.length).toBeGreaterThan(0);
      expect(p.baseUrl).toMatch(/^https?:\/\//);
    }
  });
});

describe("settings defaults", () => {
  it("empty storage yields complete defaults", () => {
    expect(mergeSettings(defaultSettings("zh-CN"), undefined)).toEqual(defaultSettings("zh-CN"));
  });
  it("partial / wrongly-typed stored values are merged safely", () => {
    const s = mergeSettings(defaultSettings("en-US"), { theme: "dark", translation: { style: "card", concurrency: "9" }, junk: 1 });
    expect(s.theme).toBe("dark");
    expect(s.translation.style).toBe("card");
    expect(s.translation.concurrency).toBe(3); // wrong type → default
    expect(s.translation.batchMaxChars).toBe(1800);
    expect((s as unknown as Record<string, unknown>).junk).toBeUndefined();
  });
  it("derives the target language from the UI language", () => {
    expect(defaultTargetLang("zh-TW")).toBe("zh-TW");
    expect(defaultTargetLang("ja-JP")).toBe("ja");
    expect(defaultTargetLang("en-US")).toBe("zh-CN");
  });
});

import { friendlyError } from "@/src/lib/providers";
import { inferModelMeta, isAntigravityOAuthToken, isChatGPTOAuthToken, listModels, toPiModel } from "@/src/lib/llm";
import { buildAntigravityRequest, parseAntigravityCredentials } from "@/src/lib/antigravity";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { generatePKCE, oauthOrigins, parseOAuthCodeInput, startOAuthFlow } from "@/src/lib/oauth";
import { cleanGeneratedTitle, deriveChatTitle, displayPageTitle } from "@/src/lib/prompts";
import { hasProviderIcon } from "@/src/ui/components/ProviderIcon";

describe("friendlyError", () => {
  it("maps common failures to readable reasons", () => {
    expect(friendlyError("HTTP 401 {\"error\":\"Incorrect API key\"}")).toMatch(/Key 无效/);
    expect(friendlyError("402 Insufficient Balance")).toMatch(/余额不足/);
    expect(friendlyError("TypeError: Failed to fetch")).toMatch(/网络不通/);
    expect(friendlyError("HTTP 404 model not found")).toMatch(/不存在/);
    expect(friendlyError("weird")).toBe("weird");
  });
});

describe("inferModelMeta", () => {
  it("infers reasoning flags, context windows, and maxTokens per model/provider", () => {
    expect(inferModelMeta("deepseek-reasoner", "openai-compatible")).toEqual({ reasoning: true, contextWindow: 128000, maxTokens: 16384 });
    expect(inferModelMeta("qwq-32b", "openai-compatible").reasoning).toBe(true);
    expect(inferModelMeta("moonshot-v1-32k", "openai-compatible").contextWindow).toBe(32768);
    expect(inferModelMeta("claude-sonnet-4-5", "anthropic").contextWindow).toBe(200000);
    expect(inferModelMeta("gemini-2.5-flash", "gemini")).toEqual({ reasoning: true, contextWindow: 1000000, maxTokens: 16384 });
  });
});

describe("provider icons and OAuth helpers", () => {
  it("ships LobeHub SVG icons for all named presets (except custom)", () => {
    for (const p of PRESETS.filter((x) => !x.id.startsWith("custom"))) {
      expect(hasProviderIcon(p.id), `icon for ${p.id}`).toBe(true);
    }
    expect(hasProviderIcon("custom")).toBe(false);
    expect(hasProviderIcon("custom-anthropic")).toBe(false);
  });

  it("includes OAuth-capable presets (including ChatGPT and Antigravity) and origin lists", () => {
    const oauthPresets = PRESETS.filter((p) => p.oauth);
    expect(oauthPresets.map((p) => p.id)).toEqual(
      expect.arrayContaining(["openai", "antigravity", "openrouter", "github-copilot", "kimi-coding", "xai", "anthropic", "meta"]),
    );
    for (const p of oauthPresets) {
      expect(oauthOrigins(p.oauth!).length).toBeGreaterThan(0);
    }
  });

  it("supports Antigravity OAuth PKCE flow, credential parsing, and Cloud Code Assist model routing", async () => {
    const rawToken = "ya29.a0AfH6SMB_test_token_1234567890";
    const agCreds = JSON.stringify({ token: rawToken, projectId: "custom-proj-123" });
    expect(isAntigravityOAuthToken(agCreds)).toBe(true);
    expect(isAntigravityOAuthToken(rawToken)).toBe(true);
    expect(isAntigravityOAuthToken("sk-proj-123")).toBe(false);
    expect(parseAntigravityCredentials(agCreds)).toEqual({
      token: rawToken,
      projectId: "custom-proj-123",
      explicitProject: true,
    });
    expect(parseAntigravityCredentials(rawToken)).toEqual({
      token: rawToken,
      projectId: "rising-fact-p41fc",
      explicitProject: false,
    });
    expect(maskKey(agCreds)).toBe("ya29.••••7890");
    expect(maskKey(rawToken)).toBe("ya29.••••7890");
    expect(redactSecrets(`Failed with token ${rawToken}`, [agCreds])).toBe("Failed with token [redacted]");

    const agPreset = newProviderFromPreset(PRESETS.find((p) => p.id === "antigravity")!);
    const agModel = toPiModel(agPreset, "gemini-3.8-flash-high", agCreds);
    expect(agModel.api).toBe("google-gemini-cli");
    expect(agModel.provider).toBe("google-antigravity");
    expect(agModel.baseUrl).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com");

    const models = await listModels(agPreset, agCreds);
    expect(models).toContain("gemini-3.8-flash-high");
    expect(models).toContain("claude-sonnet-5-5-medium");

    const req = buildAntigravityRequest(
      agModel,
      normalizeContext({
        systemPrompt: "Be concise.",
        messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
      }),
      "rising-fact-p41fc",
      { maxTokens: 16 },
    );
    expect(req.project).toBe("rising-fact-p41fc");
    expect(req.model).toBe("gemini-3.8-flash-high");
    expect(req.requestType).toBe("agent");
    expect(req.userAgent).toBe("antigravity");

    const flow = await startOAuthFlow("antigravity", agPreset.id);
    expect(flow.flow).toBe("pkce");
    if (flow.flow === "pkce") {
      expect(flow.authorizeUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
      expect(flow.authorizeUrl).toContain(encodeURIComponent("http://localhost:51121/oauth-callback"));
    }
  });

  it("detects ChatGPT OAuth JWT tokens and routes toPiModel to openai-codex-responses", () => {
    const payload = btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } }));
    const fakeJwt = `eyJhbGciOiJSUzI1NiJ9.${payload}.sig`;
    expect(isChatGPTOAuthToken(fakeJwt)).toBe(true);
    expect(isChatGPTOAuthToken("sk-proj-123456")).toBe(false);

    const openaiPreset = newProviderFromPreset(PRESETS.find((p) => p.id === "openai")!);
    const codexModel = toPiModel(openaiPreset, "gpt-5.3-codex-spark", fakeJwt);
    expect(codexModel.api).toBe("openai-codex-responses");
    expect(codexModel.provider).toBe("openai-codex");
    expect(codexModel.baseUrl).toBe("https://chatgpt.com/backend-api");
  });

  it("generates valid PKCE verifier/challenge pairs and parses OAuth callback inputs", async () => {
    const pkce = await generatePKCE();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(40);
    expect(pkce.challenge.length).toBeGreaterThanOrEqual(40);
    expect(pkce.verifier).not.toBe(pkce.challenge);

    expect(parseOAuthCodeInput("https://openrouter.ai/?sidekick_oauth=1&code=abc123&state=xyz")).toEqual({
      code: "abc123",
      state: "xyz",
    });
    expect(
      parseOAuthCodeInput(
        "http://localhost:51121/oauth-callback?state=st_123&code=4%2F0AeanS0a_test_code&scope=email+profile",
      ),
    ).toEqual({
      code: "4/0AeanS0a_test_code",
      state: "st_123",
    });
    expect(parseOAuthCodeInput("4%2F0AeanS0a_test_code")).toEqual({ code: "4/0AeanS0a_test_code" });
    expect(parseOAuthCodeInput("my-code#my-state")).toEqual({ code: "my-code", state: "my-state" });
    expect(parseOAuthCodeInput("  raw-code-99  ")).toEqual({ code: "raw-code-99" });
  });

  it("configures GitHub Copilot headers in toPiModel", () => {
    const copilot = newProviderFromPreset(PRESETS.find((p) => p.id === "github-copilot")!);
    const model = toPiModel(copilot, "gpt-4.1");
    expect(model.provider).toBe("github-copilot");
    expect(model.headers?.["Copilot-Integration-Id"]).toBe("vscode-chat");
  });

  it("derives meaningful conversation titles and page titles with domain fallback", () => {
    expect(displayPageTitle("Building Effective Agents", "https://www.anthropic.com/research/agents", "www.anthropic.com")).toBe("Building Effective Agents");
    expect(displayPageTitle("https://www.anthropic.com/research/agents", "https://www.anthropic.com/research/agents", "www.anthropic.com")).toBe("www.anthropic.com");
    expect(displayPageTitle("", "https://www.youtube.com/watch?v=123", "www.youtube.com")).toBe("www.youtube.com");

    // Summary conversation should NOT stay as "总结本页" when assistant response or page title is available
    expect(
      deriveChatTitle(
        [
          { role: "user", content: "总结本页", kind: "summary" },
          { role: "assistant", content: "### 关键要点\n- **Anthropic 智能体架构设计指南**：提出简洁可组合模式[^1]", kind: "summary" },
        ],
        "Building Effective Agents",
        "www.anthropic.com",
      ),
    ).toBe("Anthropic 智能体架构设计指南");

    expect(
      deriveChatTitle(
        [
          { role: "user", content: "总结本页", kind: "summary" },
          { role: "assistant", content: "", kind: "summary" },
        ],
        "Building Effective Agents",
        "www.anthropic.com",
      ),
    ).toBe("Building Effective Agents");

    expect(
      deriveChatTitle(
        [
          { role: "user", content: "总结本页", kind: "summary" },
          { role: "assistant", content: "### 关键要点\n- **屋顶花园降温与雨水留存研究**：夏季降温可达三度[^1]", kind: "summary" },
        ],
        "",
        "www.youtube.com",
      ),
    ).toBe("屋顶花园降温与雨水留存研究");

    expect(cleanGeneratedTitle('"**Anthropic 智能体构建指南**。"')).toBe("Anthropic 智能体构建指南");
  });
});
