import { COPILOT_HEADERS } from "./llm";
import { oauthKey, secretKey, setKey, type OAuthProviderId } from "./providers";
import { tr } from "@/src/i18n";

export interface StoredOAuthCreds {
  oauthId: OAuthProviderId;
  access: string;
  refresh?: string;
  expiresAt?: number;
  baseUrl?: string;
}

export type OAuthStartResult =
  | {
      flow: "device_code";
      sessionId: string;
      userCode: string;
      verificationUri: string;
      intervalMs: number;
      expiresAt: number;
    }
  | {
      flow: "pkce";
      sessionId: string;
      authorizeUrl: string;
    };

export type OAuthPollResult =
  | { status: "pending"; intervalMs?: number }
  | { status: "complete"; apiKey: string; baseUrl?: string };

interface ActiveOAuthSession {
  id: string;
  oauthId: OAuthProviderId;
  providerId: string;
  flow: "device_code" | "pkce";
  deviceCode?: string;
  userCode?: string;
  verifier?: string;
  redirectUri?: string;
  intervalMs?: number;
  expiresAt: number;
  completedKey?: string;
  completedBaseUrl?: string;
}

const sessions = new Map<string, ActiveOAuthSession>();

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_BASE = "https://auth.openai.com";
const OPENAI_PKCE_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const KIMI_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const META_CLIENT_ID = "742913181906401";
const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const OPENROUTER_CALLBACK_URL = "https://openrouter.ai/?sidekick_oauth=1";

/** Origins that should be requested in a user gesture before running OAuth for this provider. */
export function oauthOrigins(oauthId: OAuthProviderId): string[] {
  switch (oauthId) {
    case "chatgpt":
      return ["https://auth.openai.com/*", "https://chatgpt.com/*", "https://api.openai.com/*"];
    case "openrouter":
      return ["https://openrouter.ai/*"];
    case "github-copilot":
      return ["https://github.com/*", "https://api.github.com/*", "https://*.githubcopilot.com/*"];
    case "kimi-coding":
      return ["https://auth.kimi.com/*", "https://api.kimi.com/*"];
    case "xai":
      return ["https://auth.x.ai/*", "https://api.x.ai/*"];
    case "meta":
      return ["https://www.meta.ai/*", "https://api.llama.com/*"];
    case "anthropic":
      return ["https://platform.claude.com/*", "https://api.anthropic.com/*"];
  }
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

/** Extract an OAuth authorization code (and optional state) from a pasted URL, query string, or raw code. */
export function parseOAuthCodeInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) return { code: "" };
  try {
    const u = new URL(trimmed);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state") ?? (u.hash ? u.hash.slice(1) : undefined);
    if (code) return { code, state };
  } catch {
    /* not a full URL */
  }
  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed);
    const code = params.get("code");
    if (code) return { code, state: params.get("state") ?? undefined };
  }
  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#");
    return { code: code.trim(), state: state?.trim() };
  }
  return { code: trimmed };
}

function kimiHeaders(): Record<string, string> {
  return {
    "X-Msh-Platform": "kimi_cli",
    "X-Msh-Version": "0.1.0",
    "X-Msh-Device-Name": "sidekick-browser-extension",
    "X-Msh-Device-Model": "browser-extension",
    "X-Msh-Device-Id": "sidekick-oauth-client",
  };
}

function copilotBaseUrlFromToken(token: string): string {
  const match = token.match(/(?:^|;)\s*proxy-ep=([^;\s]+)/i);
  const proxyEp = match?.[1]?.trim();
  if (!proxyEp) return "https://api.individual.githubcopilot.com";
  const host = proxyEp.replace(/^https?:\/\//, "").replace(/^proxy\./i, "api.");
  return `https://${host}`;
}

async function exchangeCopilotApiToken(githubAccessToken: string): Promise<{ access: string; expiresAt: number; baseUrl: string }> {
  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Accept: "application/json",
      Authorization: `Token ${githubAccessToken}`,
      ...COPILOT_HEADERS,
    },
  });
  if (!res.ok) throw new Error(`GitHub Copilot token exchange failed: HTTP ${res.status}`);
  const data = (await res.json()) as { token?: string; expires_at?: number };
  if (!data.token || typeof data.expires_at !== "number") throw new Error("Invalid GitHub Copilot token response");
  return {
    access: data.token,
    expiresAt: data.expires_at * 1000 - 5 * 60 * 1000,
    baseUrl: copilotBaseUrlFromToken(data.token),
  };
}

async function exchangeOpenAICodexCode(code: string, verifier: string, redirectUri: string): Promise<{ access: string; refresh: string; expiresAt: number }> {
  const res = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ChatGPT OAuth failed: HTTP ${res.status} ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    access: data.access_token,
    refresh: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
  };
}

export async function getOAuthCreds(providerId: string): Promise<StoredOAuthCreds | undefined> {
  const k = oauthKey(providerId);
  const r = await chrome.storage.local.get(k);
  const v = r[k];
  return v && typeof v === "object" && "access" in v ? (v as StoredOAuthCreds) : undefined;
}

export async function setOAuthCreds(providerId: string, creds: StoredOAuthCreds): Promise<void> {
  await chrome.storage.local.set({ [oauthKey(providerId)]: creds });
  await setKey(providerId, creds.access);
}

/** Refresh an expired OAuth token if refresh credentials exist; reads key + oauth creds in a single storage call. */
export async function ensureFreshKey(providerId: string): Promise<string | undefined> {
  const sk = secretKey(providerId);
  const ok = oauthKey(providerId);
  const r = await chrome.storage.local.get([sk, ok]);
  const currentKey = typeof r[sk] === "string" && r[sk] ? (r[sk] as string) : undefined;
  const creds = r[ok] && typeof r[ok] === "object" && "access" in (r[ok] as object) ? (r[ok] as StoredOAuthCreds) : undefined;
  if (!creds || !creds.expiresAt || Date.now() < creds.expiresAt || !creds.refresh) return currentKey;
  try {
    const refreshed = await refreshOAuthCreds(creds);
    await setOAuthCreds(providerId, refreshed);
    return refreshed.access;
  } catch {
    return currentKey;
  }
}

export async function refreshOAuthCreds(creds: StoredOAuthCreds): Promise<StoredOAuthCreds> {
  if (!creds.refresh) return creds;
  if (creds.oauthId === "chatgpt") {
    const res = await fetch(`${OPENAI_AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refresh,
        client_id: OPENAI_CODEX_CLIENT_ID,
      }),
    });
    if (!res.ok) throw new Error(`ChatGPT token refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      ...creds,
      access: data.access_token,
      refresh: data.refresh_token || creds.refresh,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
    };
  }
  if (creds.oauthId === "github-copilot") {
    const next = await exchangeCopilotApiToken(creds.refresh);
    return { ...creds, access: next.access, expiresAt: next.expiresAt, baseUrl: next.baseUrl };
  }
  if (creds.oauthId === "kimi-coding") {
    const res = await fetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...kimiHeaders() },
      body: new URLSearchParams({ client_id: KIMI_CLIENT_ID, grant_type: "refresh_token", refresh_token: creds.refresh }),
    });
    if (!res.ok) throw new Error(`Kimi token refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      ...creds,
      access: data.access_token,
      refresh: data.refresh_token || creds.refresh,
      expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
  }
  if (creds.oauthId === "xai") {
    const res = await fetch("https://auth.x.ai/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: XAI_CLIENT_ID, refresh_token: creds.refresh }),
    });
    if (!res.ok) throw new Error(`xAI token refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      ...creds,
      access: data.access_token,
      refresh: data.refresh_token || creds.refresh,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
    };
  }
  if (creds.oauthId === "anthropic") {
    const res = await fetch("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", client_id: ANTHROPIC_CLIENT_ID, refresh_token: creds.refresh }),
    });
    if (!res.ok) throw new Error(`Anthropic token refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      ...creds,
      access: data.access_token,
      refresh: data.refresh_token || creds.refresh,
      expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    };
  }
  return creds;
}

/** Start an OAuth session (Device Code or PKCE). */
export async function startOAuthFlow(oauthId: OAuthProviderId, providerId: string): Promise<OAuthStartResult> {
  const sessionId = `oa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  if (oauthId === "chatgpt") {
    // Primary: OpenAI Codex Device Code flow (https://auth.openai.com/codex/device)
    try {
      const res = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/usercode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
      });
      if (res.ok) {
        const data = (await res.json()) as { device_auth_id?: string; user_code?: string; interval?: number | string };
        const intervalSec = typeof data.interval === "string" ? Number(data.interval.trim()) : (data.interval ?? 5);
        if (data.device_auth_id && data.user_code) {
          const intervalMs = Math.max(5, Number.isFinite(intervalSec) ? intervalSec : 5) * 1000;
          const expiresAt = Date.now() + 15 * 60 * 1000;
          sessions.set(sessionId, {
            id: sessionId,
            oauthId,
            providerId,
            flow: "device_code",
            deviceCode: data.device_auth_id,
            userCode: data.user_code,
            intervalMs,
            expiresAt,
          });
          return {
            flow: "device_code",
            sessionId,
            userCode: data.user_code,
            verificationUri: `${OPENAI_AUTH_BASE}/codex/device`,
            intervalMs,
            expiresAt,
          };
        }
      }
    } catch {
      /* fall back to PKCE flow below */
    }

    // Fallback: Browser PKCE flow
    const { verifier, challenge } = await generatePKCE();
    const stateBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    const state = base64urlEncode(stateBytes);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      redirect_uri: OPENAI_PKCE_REDIRECT_URI,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "pi",
    });
    const authorizeUrl = `${OPENAI_AUTH_BASE}/oauth/authorize?${params.toString()}`;
    sessions.set(sessionId, {
      id: sessionId,
      oauthId,
      providerId,
      flow: "pkce",
      verifier,
      redirectUri: OPENAI_PKCE_REDIRECT_URI,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
    return { flow: "pkce", sessionId, authorizeUrl };
  }

  if (oauthId === "openrouter") {
    const { verifier, challenge } = await generatePKCE();
    const params = new URLSearchParams({
      callback_url: OPENROUTER_CALLBACK_URL,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authorizeUrl = `https://openrouter.ai/auth?${params.toString()}`;
    sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "pkce", verifier, expiresAt: Date.now() + 15 * 60 * 1000 });
    return { flow: "pkce", sessionId, authorizeUrl };
  }

  if (oauthId === "anthropic") {
    const { verifier, challenge } = await generatePKCE();
    const params = new URLSearchParams({
      code: "true",
      client_id: ANTHROPIC_CLIENT_ID,
      response_type: "code",
      redirect_uri: ANTHROPIC_REDIRECT_URI,
      scope: "org:create_api_key user:profile user:inference",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
    });
    const authorizeUrl = `https://claude.ai/oauth/authorize?${params.toString()}`;
    sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "pkce", verifier, expiresAt: Date.now() + 15 * 60 * 1000 });
    return { flow: "pkce", sessionId, authorizeUrl };
  }

  if (oauthId === "github-copilot") {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: "read:user" }),
    });
    if (!res.ok) throw new Error(`GitHub device code failed: HTTP ${res.status}`);
    const data = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; interval?: number; expires_in: number };
    const intervalMs = Math.max(5, data.interval ?? 5) * 1000;
    const expiresAt = Date.now() + data.expires_in * 1000;
    sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "device_code", deviceCode: data.device_code, intervalMs, expiresAt });
    return { flow: "device_code", sessionId, userCode: data.user_code, verificationUri: data.verification_uri, intervalMs, expiresAt };
  }

  if (oauthId === "kimi-coding") {
    const res = await fetch("https://auth.kimi.com/api/oauth/device_authorization", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...kimiHeaders() },
      body: new URLSearchParams({ client_id: KIMI_CLIENT_ID }),
    });
    if (!res.ok) throw new Error(`Kimi device authorization failed: HTTP ${res.status}`);
    const data = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; interval?: number; expires_in?: number };
    const intervalMs = Math.max(5, data.interval ?? 5) * 1000;
    const expiresAt = Date.now() + (data.expires_in ?? 600) * 1000;
    sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "device_code", deviceCode: data.device_code, intervalMs, expiresAt });
    return {
      flow: "device_code",
      sessionId,
      userCode: data.user_code,
      verificationUri: data.verification_uri_complete || data.verification_uri,
      intervalMs,
      expiresAt,
    };
  }

  if (oauthId === "xai") {
    const res = await fetch("https://auth.x.ai/oauth2/device/code", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: XAI_CLIENT_ID,
        scope: "openid profile email offline_access grok-cli:access api:access",
      }),
    });
    if (!res.ok) throw new Error(`xAI device code failed: HTTP ${res.status}`);
    const data = (await res.json()) as { device_code: string; user_code: string; verification_uri?: string; verification_uri_complete?: string; interval?: number; expires_in: number };
    const intervalMs = Math.max(5, data.interval ?? 5) * 1000;
    const expiresAt = Date.now() + data.expires_in * 1000;
    const uri = data.verification_uri_complete || (data.verification_uri ? `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}` : "https://auth.x.ai/device");
    sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "device_code", deviceCode: data.device_code, intervalMs, expiresAt });
    return { flow: "device_code", sessionId, userCode: data.user_code, verificationUri: uri, intervalMs, expiresAt };
  }

  // meta
  const res = await fetch("https://www.meta.ai/api/oauth/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: META_CLIENT_ID }),
  });
  if (!res.ok) throw new Error(`Meta device code failed: HTTP ${res.status}`);
  const data = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; interval?: number; expires_in: number };
  const intervalMs = Math.max(5, data.interval ?? 5) * 1000;
  const expiresAt = Date.now() + data.expires_in * 1000;
  sessions.set(sessionId, { id: sessionId, oauthId, providerId, flow: "device_code", deviceCode: data.device_code, intervalMs, expiresAt });
  return {
    flow: "device_code",
    sessionId,
    userCode: data.user_code,
    verificationUri: data.verification_uri_complete || data.verification_uri,
    intervalMs,
    expiresAt,
  };
}

/** Poll an active OAuth session once (Device Code polling or auto-captured PKCE callback). */
export async function pollOAuthSession(sessionId: string): Promise<OAuthPollResult> {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(tr("oauth.expired"));
  if (s.completedKey) {
    sessions.delete(sessionId);
    return { status: "complete", apiKey: s.completedKey, baseUrl: s.completedBaseUrl };
  }
  if (Date.now() > s.expiresAt) {
    sessions.delete(sessionId);
    throw new Error(tr("oauth.expired"));
  }
  if (s.flow === "pkce") {
    return { status: "pending", intervalMs: 1500 };
  }

  const deviceCode = s.deviceCode!;
  if (s.oauthId === "chatgpt") {
    const res = await fetch(`${OPENAI_AUTH_BASE}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        device_auth_id: deviceCode,
        user_code: s.userCode,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { authorization_code?: string; code_verifier?: string };
      if (!data.authorization_code || !data.code_verifier) throw new Error("Invalid ChatGPT device auth response");
      const token = await exchangeOpenAICodexCode(data.authorization_code, data.code_verifier, OPENAI_DEVICE_REDIRECT_URI);
      await setOAuthCreds(s.providerId, {
        oauthId: "chatgpt",
        access: token.access,
        refresh: token.refresh,
        expiresAt: token.expiresAt,
        baseUrl: CHATGPT_CODEX_BASE_URL,
      });
      sessions.delete(sessionId);
      return { status: "complete", apiKey: token.access, baseUrl: CHATGPT_CODEX_BASE_URL };
    }
    if (res.status === 403 || res.status === 404) {
      return { status: "pending", intervalMs: s.intervalMs };
    }
    const bodyText = await res.text().catch(() => "");
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(bodyText);
      errorCode = typeof parsed?.error === "object" ? parsed.error?.code : parsed?.error;
    } catch {
      /* ignore */
    }
    if (errorCode === "deviceauth_authorization_pending") return { status: "pending", intervalMs: s.intervalMs };
    if (errorCode === "slow_down") {
      s.intervalMs = (s.intervalMs ?? 5000) + 5000;
      return { status: "pending", intervalMs: s.intervalMs };
    }
    sessions.delete(sessionId);
    throw new Error(errorCode || bodyText.slice(0, 120) || tr("err.401"));
  }

  if (s.oauthId === "github-copilot") {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string; interval?: number };
    if (data.access_token) {
      const copilot = await exchangeCopilotApiToken(data.access_token);
      await setOAuthCreds(s.providerId, {
        oauthId: "github-copilot",
        access: copilot.access,
        refresh: data.access_token,
        expiresAt: copilot.expiresAt,
        baseUrl: copilot.baseUrl,
      });
      sessions.delete(sessionId);
      return { status: "complete", apiKey: copilot.access, baseUrl: copilot.baseUrl };
    }
    if (data.error === "authorization_pending") return { status: "pending", intervalMs: s.intervalMs };
    if (data.error === "slow_down") {
      s.intervalMs = (data.interval ? data.interval * 1000 : (s.intervalMs ?? 5000) + 5000);
      return { status: "pending", intervalMs: s.intervalMs };
    }
    sessions.delete(sessionId);
    throw new Error(data.error || tr("err.401"));
  }

  if (s.oauthId === "kimi-coding") {
    const res = await fetch("https://auth.kimi.com/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...kimiHeaders() },
      body: new URLSearchParams({
        client_id: KIMI_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (res.ok && data.access_token) {
      await setOAuthCreds(s.providerId, {
        oauthId: "kimi-coding",
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
      });
      sessions.delete(sessionId);
      return { status: "complete", apiKey: data.access_token };
    }
    if (data.error === "authorization_pending") return { status: "pending", intervalMs: s.intervalMs };
    if (data.error === "slow_down") {
      s.intervalMs = (s.intervalMs ?? 5000) + 5000;
      return { status: "pending", intervalMs: s.intervalMs };
    }
    sessions.delete(sessionId);
    throw new Error(data.error_description || data.error || tr("err.401"));
  }

  if (s.oauthId === "xai") {
    const res = await fetch("https://auth.x.ai/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_CLIENT_ID,
        device_code: deviceCode,
      }),
    });
    const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (res.ok && data.access_token) {
      await setOAuthCreds(s.providerId, {
        oauthId: "xai",
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
      });
      sessions.delete(sessionId);
      return { status: "complete", apiKey: data.access_token };
    }
    if (data.error === "authorization_pending") return { status: "pending", intervalMs: s.intervalMs };
    if (data.error === "slow_down") {
      s.intervalMs = (s.intervalMs ?? 5000) + 5000;
      return { status: "pending", intervalMs: s.intervalMs };
    }
    sessions.delete(sessionId);
    throw new Error(data.error_description || data.error || tr("err.401"));
  }

  // meta
  const res = await fetch("https://www.meta.ai/api/oauth/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: META_CLIENT_ID, device_code: deviceCode }),
  });
  const data = (await res.json()) as { access_token?: string; api_key?: string; expires_in?: number; error?: string; error_description?: string };
  const token = data.access_token || data.api_key;
  if (res.ok && token) {
    await setOAuthCreds(s.providerId, {
      oauthId: "meta",
      access: token,
      expiresAt: Date.now() + (data.expires_in ?? 86400 * 30) * 1000,
    });
    sessions.delete(sessionId);
    return { status: "complete", apiKey: token };
  }
  if (data.error === "authorization_pending") return { status: "pending", intervalMs: s.intervalMs };
  if (data.error === "slow_down") {
    s.intervalMs = (s.intervalMs ?? 5000) + 5000;
    return { status: "pending", intervalMs: s.intervalMs };
  }
  sessions.delete(sessionId);
  throw new Error(data.error_description || data.error || tr("err.401"));
}

/** Exchange a PKCE authorization code (or redirect URL) for an API key / OAuth token. */
export async function exchangeOAuthCode(sessionId: string, rawInput: string): Promise<{ apiKey: string; baseUrl?: string }> {
  const s = sessions.get(sessionId);
  if (!s || !s.verifier) throw new Error(tr("oauth.expired"));
  const { code, state } = parseOAuthCodeInput(rawInput);
  if (!code) throw new Error(tr("err.401"));

  if (s.oauthId === "chatgpt") {
    const token = await exchangeOpenAICodexCode(code, s.verifier, s.redirectUri || OPENAI_PKCE_REDIRECT_URI);
    await setOAuthCreds(s.providerId, {
      oauthId: "chatgpt",
      access: token.access,
      refresh: token.refresh,
      expiresAt: token.expiresAt,
      baseUrl: CHATGPT_CODEX_BASE_URL,
    });
    s.completedKey = token.access;
    s.completedBaseUrl = CHATGPT_CODEX_BASE_URL;
    return { apiKey: token.access, baseUrl: CHATGPT_CODEX_BASE_URL };
  }

  if (s.oauthId === "openrouter") {
    const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code,
        code_verifier: s.verifier,
        code_challenge_method: "S256",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter OAuth failed: HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const data = (await res.json()) as { key?: string };
    if (!data.key) throw new Error("OpenRouter response missing key");
    await setOAuthCreds(s.providerId, { oauthId: "openrouter", access: data.key });
    s.completedKey = data.key;
    return { apiKey: data.key };
  }

  if (s.oauthId === "anthropic") {
    const res = await fetch("https://platform.claude.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: ANTHROPIC_CLIENT_ID,
        code,
        state: state || s.verifier,
        redirect_uri: ANTHROPIC_REDIRECT_URI,
        code_verifier: s.verifier,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic OAuth failed: HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    await setOAuthCreds(s.providerId, {
      oauthId: "anthropic",
      access: data.access_token,
      refresh: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    });
    s.completedKey = data.access_token;
    return { apiKey: data.access_token };
  }

  throw new Error(tr("err.unknown"));
}

/** Auto-capture PKCE callback URLs when a browser tab redirects back with code=... */
export async function tryCaptureOAuthTabUrl(url: string): Promise<boolean> {
  if (!url.includes("code=")) return false;
  const isOpenRouter = url.startsWith("https://openrouter.ai/") && url.includes("sidekick_oauth=1");
  const isChatGPTLocal = /^http:\/\/(localhost|127\.0\.0\.1):1455\/auth\/callback/.test(url);
  if (!isOpenRouter && !isChatGPTLocal) return false;
  for (const s of sessions.values()) {
    if (s.flow === "pkce" && !s.completedKey && ((isOpenRouter && s.oauthId === "openrouter") || (isChatGPTLocal && s.oauthId === "chatgpt"))) {
      try {
        await exchangeOAuthCode(s.id, url);
        return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}
