import { ensureAntigravityNetRules } from "./antigravity";
import { COPILOT_HEADERS } from "./llm";
import { oauthKey, secretKey, setKey, type OAuthProviderId } from "./providers";
import { tr } from "@/src/i18n";

export interface StoredOAuthCreds {
  oauthId: OAuthProviderId;
  access: string;
  refresh?: string;
  expiresAt?: number;
  baseUrl?: string;
  projectId?: string;
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

const ANTIGRAVITY_CLIENT_ID = atob(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlcC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
);
const ANTIGRAVITY_CLIENT_SECRET = atob("R09DU1BYLUs1OEZXUjQ4NkxkTEoxbUxCOHNYQzR6NnFEQWY=");
const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
const ANTIGRAVITY_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_BASE_URL = "https://daily-cloudcode-pa.sandbox.googleapis.com";
export const ANTIGRAVITY_DEFAULT_PROJECT_ID = "rising-fact-p41fc";
const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/** Origins that should be requested in a user gesture before running OAuth for this provider. */
export function oauthOrigins(oauthId: OAuthProviderId): string[] {
  switch (oauthId) {
    case "chatgpt":
      return ["https://auth.openai.com/*", "https://chatgpt.com/*", "https://api.openai.com/*", "http://localhost/*", "http://127.0.0.1/*"];
    case "antigravity":
      return [
        "https://accounts.google.com/*",
        "https://oauth2.googleapis.com/*",
        "https://www.googleapis.com/*",
        "https://cloudcode-pa.googleapis.com/*",
        "https://daily-cloudcode-pa.sandbox.googleapis.com/*",
        "https://autopush-cloudcode-pa.sandbox.googleapis.com/*",
        "http://localhost/*",
        "http://127.0.0.1/*",
      ];
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
    const qIdx = trimmed.indexOf("?");
    const queryPart = qIdx >= 0 ? trimmed.slice(qIdx + 1) : trimmed;
    const params = new URLSearchParams(queryPart.split("#")[0]);
    const code = params.get("code");
    if (code) return { code, state: params.get("state") ?? undefined };
  }
  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#");
    let decoded = code.trim();
    if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* ignore */
      }
    }
    return { code: decoded, state: state?.trim() };
  }
  let decoded = trimmed;
  if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* ignore */
    }
  }
  return { code: decoded };
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

const projectCache = new Map<string, string>();

export async function discoverAntigravityProject(accessToken: string): Promise<string> {
  const cached = projectCache.get(accessToken);
  if (cached) return cached;
  await ensureAntigravityNetRules();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "antigravity/2.31.2 darwin/arm64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "IDE_UNSPECIFIED",
      platform: "PLATFORM_UNSPECIFIED",
      pluginType: "GEMINI",
    }),
  };
  const endpoints = [ANTIGRAVITY_BASE_URL, "https://cloudcode-pa.googleapis.com"];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          cloudaicompanionProject?: string | { id?: string };
          allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
        };
        if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
          projectCache.set(accessToken, data.cloudaicompanionProject);
          return data.cloudaicompanionProject;
        }
        if (
          data.cloudaicompanionProject &&
          typeof data.cloudaicompanionProject === "object" &&
          data.cloudaicompanionProject.id
        ) {
          projectCache.set(accessToken, data.cloudaicompanionProject.id);
          return data.cloudaicompanionProject.id;
        }
        if (Array.isArray(data.allowedTiers) && data.allowedTiers.length > 0) {
          const defaultTier = data.allowedTiers.find((t) => t.isDefault) ?? data.allowedTiers[0];
          const tierId = defaultTier?.id || "free-tier";
          const onboardRes = await fetch(`${endpoint}/v1internal:onboardUser`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              tierId,
              metadata: {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
              },
            }),
          });
          if (onboardRes.ok) {
            const lro = (await onboardRes.json()) as {
              done?: boolean;
              response?: { cloudaicompanionProject?: { id?: string } | string };
            };
            const proj = lro.response?.cloudaicompanionProject;
            const projId = typeof proj === "string" ? proj : proj?.id;
            if (projId) {
              projectCache.set(accessToken, projId);
              return projId;
            }
          }
        }
      }
    } catch {
      /* try next endpoint */
    }
  }
  return ANTIGRAVITY_DEFAULT_PROJECT_ID;
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
  let currentKey = typeof r[sk] === "string" && r[sk] ? (r[sk] as string).trim() : undefined;
  const creds = r[ok] && typeof r[ok] === "object" && "access" in (r[ok] as object) ? (r[ok] as StoredOAuthCreds) : undefined;
  if (currentKey?.startsWith("{")) {
    try {
      const parsed = JSON.parse(currentKey) as { token?: string; projectId?: string };
      if (typeof parsed?.token === "string" && parsed.token.trim()) {
        currentKey = parsed.token.trim();
        await setKey(providerId, currentKey);
        if (creds) {
          creds.access = currentKey;
          if (parsed.projectId && !creds.projectId) creds.projectId = parsed.projectId;
          await chrome.storage.local.set({ [ok]: creds });
        }
      }
    } catch {
      /* ignore */
    }
  }
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
  if (creds.oauthId === "antigravity") {
    const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        refresh_token: creds.refresh,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`Antigravity token refresh failed: HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    let projectId = creds.projectId;
    if (!projectId && creds.access.startsWith("{")) {
      try {
        const parsed = JSON.parse(creds.access) as { projectId?: string };
        if (parsed?.projectId) projectId = parsed.projectId;
      } catch {
        /* ignore */
      }
    }
    if (!projectId || projectId === ANTIGRAVITY_DEFAULT_PROJECT_ID) {
      projectId = await discoverAntigravityProject(data.access_token);
    }
    return {
      ...creds,
      access: data.access_token,
      refresh: data.refresh_token || creds.refresh,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000,
      projectId,
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

  if (oauthId === "antigravity") {
    const { verifier, challenge } = await generatePKCE();
    const params = new URLSearchParams({
      client_id: ANTIGRAVITY_CLIENT_ID,
      response_type: "code",
      redirect_uri: ANTIGRAVITY_REDIRECT_URI,
      scope: ANTIGRAVITY_SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: verifier,
      access_type: "offline",
      prompt: "consent",
    });
    const authorizeUrl = `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`;
    sessions.set(sessionId, {
      id: sessionId,
      oauthId,
      providerId,
      flow: "pkce",
      verifier,
      redirectUri: ANTIGRAVITY_REDIRECT_URI,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
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
    try {
      const tabs = (await chrome.tabs?.query?.({})) ?? [];
      for (const t of tabs) {
        const u = t.pendingUrl || t.url;
        if (u && u.includes("code=")) {
          const captured = await tryCaptureOAuthTabUrl(u);
          if (captured && t.id && /^http:\/\/(localhost|127\.0\.0\.1):/.test(u)) {
            chrome.tabs.remove(t.id).catch(() => {});
          }
        }
      }
    } catch {
      /* ignore */
    }
    if (s.completedKey) {
      sessions.delete(sessionId);
      return { status: "complete", apiKey: s.completedKey, baseUrl: s.completedBaseUrl };
    }
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

  if (s.oauthId === "antigravity") {
    if (state && state !== s.verifier) {
      throw new Error("OAuth state mismatch");
    }
    const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: s.redirectUri || ANTIGRAVITY_REDIRECT_URI,
        code_verifier: s.verifier,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Antigravity OAuth failed: HTTP ${res.status} ${text.slice(0, 120)}`);
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    const projectId = await discoverAntigravityProject(data.access_token);
    const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 5 * 60 * 1000;
    await setOAuthCreds(s.providerId, {
      oauthId: "antigravity",
      access: data.access_token,
      refresh: data.refresh_token,
      expiresAt,
      baseUrl: ANTIGRAVITY_BASE_URL,
      projectId,
    });
    s.completedKey = data.access_token;
    s.completedBaseUrl = ANTIGRAVITY_BASE_URL;
    return { apiKey: data.access_token, baseUrl: ANTIGRAVITY_BASE_URL };
  }

  throw new Error(tr("err.unknown"));
}

/** Auto-capture PKCE callback URLs when a browser tab redirects back with code=... */
export async function tryCaptureOAuthTabUrl(url: string): Promise<boolean> {
  if (!url.includes("code=")) return false;
  const isOpenRouter = url.startsWith("https://openrouter.ai/") && url.includes("sidekick_oauth=1");
  const isChatGPTLocal = /^http:\/\/(localhost|127\.0\.0\.1):1455\/auth\/callback/.test(url);
  const isAntigravityLocal = /^http:\/\/(localhost|127\.0\.0\.1):51121\/oauth-callback/.test(url);
  if (!isOpenRouter && !isChatGPTLocal && !isAntigravityLocal) return false;
  for (const s of sessions.values()) {
    if (
      s.flow === "pkce" &&
      !s.completedKey &&
      ((isOpenRouter && s.oauthId === "openrouter") ||
        (isChatGPTLocal && s.oauthId === "chatgpt") ||
        (isAntigravityLocal && s.oauthId === "antigravity"))
    ) {
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
