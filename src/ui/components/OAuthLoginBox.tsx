import { Check, Copy, ExternalLink, Loader2, LogIn, X } from "lucide-react";
import { useEffect, useState } from "react";
import { oauthOrigins, type OAuthPollResult, type OAuthStartResult } from "@/src/lib/oauth";
import type { OAuthProviderId } from "@/src/lib/providers";
import { Button, cn, inputCls } from "./ui";
import { ProviderIcon } from "./ProviderIcon";
import { bg } from "../messaging";
import { tr } from "@/src/i18n";

export function OAuthLoginBox({
  oauthId,
  presetId,
  providerId,
  providerName,
  onSuccess,
  onError,
}: {
  oauthId: OAuthProviderId;
  presetId: string;
  providerId: string;
  providerName: string;
  onSuccess: (apiKey: string, baseUrl?: string) => void;
  onError?: (msg: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "device_code" | "pkce" | "exchanging">("idle");
  const [session, setSession] = useState<OAuthStartResult | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPhase("idle");
    setSession(null);
    setCodeInput("");
  }, [oauthId, providerId]);

  useEffect(() => {
    if (!session || (phase !== "device_code" && phase !== "pkce")) return;
    let cancelled = false;
    let timer: number | undefined;
    const interval = session.flow === "device_code" ? session.intervalMs : 1500;

    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await bg<OAuthPollResult>({ type: "oauth:poll", sessionId: session.sessionId });
        if (cancelled) return;
        if (r.status === "complete") {
          setPhase("idle");
          setSession(null);
          onSuccess(r.apiKey, r.baseUrl);
          return;
        }
        timer = window.setTimeout(tick, r.intervalMs ?? interval);
      } catch (e) {
        if (cancelled) return;
        setPhase("idle");
        setSession(null);
        onError?.((e as Error).message);
      }
    };

    timer = window.setTimeout(tick, interval);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, phase]);

  async function start() {
    setPhase("starting");
    try {
      await chrome.permissions.request({ origins: oauthOrigins(oauthId) }).catch(() => false);
    } catch {
      /* ignore */
    }
    try {
      const r = await bg<OAuthStartResult>({ type: "oauth:start", oauthId, providerId });
      setSession(r);
      if (r.flow === "device_code") {
        setPhase("device_code");
        navigator.clipboard?.writeText(r.userCode).catch(() => {});
        chrome.tabs?.create?.({ url: r.verificationUri }).catch(() => window.open(r.verificationUri, "_blank"));
      } else {
        setPhase("pkce");
        chrome.tabs?.create?.({ url: r.authorizeUrl }).catch(() => window.open(r.authorizeUrl, "_blank"));
      }
    } catch (e) {
      setPhase("idle");
      onError?.((e as Error).message);
    }
  }

  async function submitCode() {
    if (!session || !codeInput.trim()) return;
    setPhase("exchanging");
    try {
      const r = await bg<{ apiKey: string; baseUrl?: string }>({
        type: "oauth:exchange",
        sessionId: session.sessionId,
        code: codeInput.trim(),
      });
      setPhase("idle");
      setSession(null);
      setCodeInput("");
      onSuccess(r.apiKey, r.baseUrl);
    } catch (e) {
      setPhase("pkce");
      onError?.((e as Error).message);
    }
  }

  if (phase === "idle" || phase === "starting") {
    return (
      <Button
        variant="outline"
        className="w-full justify-center gap-2 border-primary/30 bg-primary-soft/50 text-foreground hover:bg-primary-soft"
        testId="oauth-start"
        disabled={phase === "starting"}
        onClick={start}
      >
        {phase === "starting" ? <Loader2 className="size-4 animate-spin" /> : <ProviderIcon presetId={presetId} size={16} />}
        <span>{tr("oauth.signIn", { name: providerName })}</span>
        <LogIn className="ml-auto size-3.5 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <div className="animate-in space-y-2.5 rounded-card border border-primary/30 bg-primary-soft/35 p-3 text-[12.5px]" data-testid="oauth-flow">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          {tr("oauth.waiting")}
        </span>
        <button
          type="button"
          onClick={() => {
            setPhase("idle");
            setSession(null);
          }}
          className="text-muted-foreground hover:text-foreground"
          aria-label={tr("common.cancel")}
          data-testid="oauth-cancel"
        >
          <X className="size-4" />
        </button>
      </div>

      {session?.flow === "device_code" && (
        <>
          <p className="text-muted-foreground">{tr("oauth.deviceCodeHint")}</p>
          <div className="flex items-center gap-2">
            <code
              data-testid="oauth-user-code"
              className="flex-1 select-all rounded-btn border border-border bg-background px-3 py-1.5 text-center font-mono text-[15px] font-semibold tracking-wider text-foreground"
            >
              {session.userCode}
            </code>
            <Button
              size="sm"
              variant="secondary"
              icon={copied ? Check : Copy}
              onClick={() => {
                navigator.clipboard.writeText(session.userCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? tr("oauth.copied") : tr("common.copy")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={ExternalLink}
              onClick={() => chrome.tabs?.create?.({ url: session.verificationUri }).catch(() => window.open(session.verificationUri, "_blank"))}
            >
              {tr("oauth.openPage")}
            </Button>
          </div>
        </>
      )}

      {session?.flow === "pkce" && (
        <>
          <p className="text-muted-foreground">{tr("oauth.pkceHint")}</p>
          <div className="flex items-center gap-2">
            <input
              data-testid="oauth-code-input"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCode()}
              placeholder={tr("oauth.codePlaceholder")}
              className={cn(inputCls, "h-8 flex-1 font-mono text-[12px]")}
            />
            <Button
              size="sm"
              testId="oauth-submit-code"
              disabled={!codeInput.trim() || phase === "exchanging"}
              onClick={submitCode}
            >
              {tr("oauth.submitCode")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
