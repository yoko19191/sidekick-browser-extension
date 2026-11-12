import { ArrowLeft, ArrowRight, Check, CheckCircle2, Globe2, KeyRound, Languages, Loader2, Lock, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { newProviderFromPreset, normalizeBaseUrl, PRESETS, setKey, type ProviderPreset } from "@/src/lib/providers";
import { LANGUAGES } from "@/src/lib/settings";
import type { ProviderConfig, Settings } from "@/src/lib/types";
import { Button, cn, inputCls, Select } from "./components/ui";
import { Logo } from "./components/Logo";
import { OAuthLoginBox } from "./components/OAuthLoginBox";
import { ProviderIcon } from "./components/ProviderIcon";
import type { useProviders } from "./hooks";
import { bg } from "./messaging";
import { tr } from "@/src/i18n";

const OAUTH_PRESETS = PRESETS.filter((p) => p.oauth);
const KEY_PRESETS = PRESETS.filter((p) => !p.oauth);

/** First-run: 1) pick provider (list, OAuth grouped) 2) OAuth or paste key + list/select model + test 3) language + site permission strategy. */
export function Onboarding({ settings, update, providers, onDone }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void; providers: ReturnType<typeof useProviders>; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState("openai");
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKeyInput] = useState("");
  const [models, setModels] = useState<string[]>(() => [...preset.models]);
  const [selectedModel, setSelectedModel] = useState<string>(() => preset.models[0] ?? "");
  const [fetchingModels, setFetchingModels] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [saved, setSaved] = useState<ProviderConfig | null>(null);
  const [allSitesPerm, setAllSitesPerm] = useState(false);

  useEffect(() => {
    chrome.permissions?.contains?.({ origins: ["<all_urls>"] }).then(setAllSitesPerm).catch(() => {});
  }, []);

  const selectPreset = (id: string) => {
    const next = PRESETS.find((x) => x.id === id)!;
    setPresetId(id);
    setBaseUrl("");
    setModels([...next.models]);
    setSelectedModel(next.models[0] ?? "");
    setTest({ state: "idle" });
    setSaved(null);
  };

  const isCustomPreset = presetId.startsWith("custom");

  const draft = (overrideBaseUrl?: string, overrideModels?: string[]): ProviderConfig => {
    const p = saved ?? newProviderFromPreset(preset);
    const list = overrideModels ?? models;
    const ordered = selectedModel && list.includes(selectedModel) ? [selectedModel, ...list.filter((m) => m !== selectedModel)] : list;
    return {
      ...p,
      kind: preset.kind,
      presetId: preset.id,
      name: preset.name,
      baseUrl: normalizeBaseUrl(overrideBaseUrl ?? (isCustomPreset ? baseUrl : baseUrl || preset.baseUrl)),
      models: ordered,
    };
  };

  async function fetchModelList(overrideKey?: string, overrideBaseUrl?: string) {
    const p = draft(overrideBaseUrl);
    const activeKey = (overrideKey ?? key).trim();
    setFetchingModels(true);
    try {
      await chrome.permissions.request({ origins: [`${new URL(p.baseUrl).origin}/*`] }).catch(() => false);
    } catch {
      setFetchingModels(false);
      return setTest({ state: "fail", msg: tr("ob.badBaseUrl") });
    }
    try {
      const fetched = await bg<string[]>({ type: "provider:models", provider: p, apiKey: activeKey || undefined });
      if (fetched.length) {
        const merged = [...new Set([...fetched, ...models])].slice(0, 80);
        const pick = selectedModel && merged.includes(selectedModel) ? selectedModel : merged[0];
        setModels(merged);
        setSelectedModel(pick);
        if (saved) {
          const ordered = [pick, ...merged.filter((m) => m !== pick)];
          const updated = { ...saved, models: ordered };
          await providers.save([...providers.providers.filter((x) => x.id !== updated.id), updated]);
          setSaved(updated);
        }
      }
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    } finally {
      setFetchingModels(false);
    }
  }

  async function runTest(overrideKey?: string, overrideBaseUrl?: string) {
    const activeKey = (overrideKey ?? key).trim();
    const p = draft(overrideBaseUrl);
    setTest({ state: "running" });
    try {
      await chrome.permissions.request({ origins: [`${new URL(p.baseUrl).origin}/*`] }).catch(() => false);
    } catch {
      return setTest({ state: "fail", msg: tr("ob.badBaseUrl") });
    }
    try {
      const targetModel = selectedModel || p.models[0];
      const r = await bg<{ latencyMs: number; model: string; models: string[] }>({
        type: "provider:test",
        provider: p,
        modelId: targetModel,
        apiKey: activeKey || undefined,
      });
      const merged = [...new Set([...(r.models ?? []), ...p.models])].slice(0, 80);
      const chosen = selectedModel && merged.includes(selectedModel) ? selectedModel : r.model || merged[0] || "";
      const ordered = chosen ? [chosen, ...merged.filter((m) => m !== chosen)] : merged;
      const final = { ...p, models: ordered };
      await providers.save([...providers.providers.filter((x) => x.id !== final.id), final]);
      await setKey(final.id, activeKey);
      setModels(ordered);
      setSelectedModel(chosen);
      setSaved(final);
      setTest({ state: "ok", msg: tr("ob.testOk", { model: chosen || r.model, secs: (r.latencyMs / 1000).toFixed(1) }) });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    }
  }

  async function pickModel(modelId: string) {
    setSelectedModel(modelId);
    const ordered = [modelId, ...models.filter((m) => m !== modelId)];
    setModels(ordered);
    if (saved) {
      const updated = { ...saved, models: ordered };
      await providers.save([...providers.providers.filter((x) => x.id !== updated.id), updated]);
      setSaved(updated);
    }
  }

  async function choosePermissionMode(wantAllSites: boolean) {
    if (wantAllSites) {
      const ok = await chrome.permissions?.request?.({ origins: ["<all_urls>"] }).catch(() => false);
      setAllSitesPerm(!!ok);
    } else {
      await chrome.permissions?.remove?.({ origins: ["<all_urls>"] }).catch(() => false);
      setAllSitesPerm(false);
    }
  }

  const currentProviderId = (saved ?? newProviderFromPreset(preset)).id;

  const renderPresetRow = (p: ProviderPreset) => {
    const on = presetId === p.id;
    return (
      <button
        key={p.id}
        data-testid={`ob-preset-${p.id}`}
        onClick={() => selectPreset(p.id)}
        className={cn(
          "flex w-full items-center gap-3 rounded-card px-3.5 py-2.5 text-left text-[13.5px] font-medium transition",
          on ? "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/40" : "bg-card hover:bg-card-strong",
        )}
      >
        <ProviderIcon presetId={p.id} size={20} />
        <span className="min-w-0 flex-1 truncate">{p.name}</span>
        {p.oauth && (
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
            {tr("oauth.badge")}
          </span>
        )}
        {on && <Check className="size-4 shrink-0" strokeWidth={2.4} />}
      </button>
    );
  };

  return (
    <div className="flex h-full flex-col px-5 pb-5" data-testid="onboarding" data-step={step}>
      <div className="flex h-12 items-center gap-2">
        {step > 0 ? (
          <button className="grid size-8 place-items-center rounded-btn text-muted-foreground hover:bg-muted" onClick={() => setStep(step - 1)} aria-label={tr("common.back")}><ArrowLeft className="size-[18px]" /></button>
        ) : (
          <Logo size={24} />
        )}
        <div className="flex flex-1 justify-center gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-input")} />)}
        </div>
        <button className="rounded-btn px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onDone} data-testid="onboarding-skip">{tr("ob.skip")}</button>
      </div>

      <div key={step} className="min-h-0 flex-1 animate-in overflow-y-auto pt-4">
        {step === 0 && (
          <>
            <StepTitle icon={Sparkles} title={tr("ob.step1Title")} desc={tr("ob.step1Desc")} />
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-1.5 px-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tr("ob.providerGroupOAuth")}
                </div>
                <div className="flex flex-col gap-1.5" data-testid="ob-oauth-list">
                  {OAUTH_PRESETS.map(renderPresetRow)}
                </div>
              </div>
              <div>
                <div className="mb-1.5 px-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {tr("ob.providerGroupKey")}
                </div>
                <div className="flex flex-col gap-1.5" data-testid="ob-key-list">
                  {KEY_PRESETS.map(renderPresetRow)}
                </div>
              </div>
            </div>
            {isCustomPreset && (
              <label className="mt-4 block">
                <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                  {presetId === "custom-anthropic" ? tr("ob.baseUrlLabelAnthropic") : tr("ob.baseUrlLabel")}
                </div>
                <input
                  data-testid="ob-base-url"
                  className={cn(inputCls, "font-mono text-[12.5px]")}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={presetId === "custom-anthropic" ? "https://api.example.com" : "https://api.example.com/v1"}
                />
              </label>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <StepTitle
              icon={KeyRound}
              badge={<ProviderIcon presetId={preset.id} size={22} />}
              title={tr("ob.pasteKey", { name: preset.name })}
              desc={preset.keyOptional ? tr("ob.localNoKey") : tr("ob.mustPass")}
            />
            <div className="mt-5 space-y-3">
              {preset.oauth && (
                <>
                  <OAuthLoginBox
                    oauthId={preset.oauth}
                    presetId={preset.id}
                    providerId={currentProviderId}
                    providerName={preset.name}
                    onSuccess={(apiKey, oauthBaseUrl) => {
                      setKeyInput(apiKey);
                      if (oauthBaseUrl) setBaseUrl(oauthBaseUrl);
                      void runTest(apiKey, oauthBaseUrl);
                    }}
                    onError={(msg) => setTest({ state: "fail", msg })}
                  />
                  <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    <div className="h-px flex-1 bg-border/70" />
                    <span>{tr("oauth.orApiKey")}</span>
                    <div className="h-px flex-1 bg-border/70" />
                  </div>
                </>
              )}
              <input data-testid="ob-key" type="password" autoFocus={!preset.oauth} className={cn(inputCls, "font-mono text-[12.5px]")} value={key} onChange={(e) => { setKeyInput(e.target.value); setTest({ state: "idle" }); }} placeholder={preset.keyOptional ? tr("common.optional") : "sk-…"} />
              <div className="flex flex-wrap items-center gap-2">
                <Button testId="ob-test" variant="secondary" onClick={() => runTest()} disabled={test.state === "running" || (!key.trim() && !preset.keyOptional)} icon={test.state === "running" ? Loader2 : undefined} className={test.state === "running" ? "[&_svg]:animate-spin" : ""}>
                  {tr("common.testConnection")}
                </Button>
                <Button
                  testId="ob-fetch-models"
                  variant="ghost"
                  onClick={() => fetchModelList()}
                  disabled={fetchingModels || (!key.trim() && !preset.keyOptional)}
                  icon={RefreshCw}
                  className={fetchingModels ? "[&_svg]:animate-spin" : ""}
                >
                  {tr("ob.fetchModels")}
                </Button>
                {preset.keyUrl && <a className="text-[12.5px] text-primary hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">{tr("ob.getKey")}</a>}
              </div>

              {models.length > 0 && (
                <div className="rounded-card bg-card p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-muted-foreground">
                    <span>{tr("ob.selectModel")}</span>
                    <span>{tr("ob.modelsFetched", { n: models.length })}</span>
                  </div>
                  <Select
                    testId="ob-model-select"
                    value={selectedModel || models[0]}
                    onChange={pickModel}
                    options={models.map((m) => ({ value: m, label: m }))}
                  />
                  <div className="mt-2 max-h-36 space-y-1 overflow-y-auto pr-0.5" data-testid="ob-model-list">
                    {models.map((m) => {
                      const active = (selectedModel || models[0]) === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => pickModel(m)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-btn px-2.5 py-1.5 text-left font-mono text-[12px] transition",
                            active ? "bg-primary-soft font-medium text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span className="truncate">{m}</span>
                          {active && <Check className="size-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(test.state === "ok" || test.state === "fail") && (
                <div data-testid="ob-test-result" data-state={test.state} className={cn("flex animate-in items-start gap-2 rounded-btn px-3 py-2.5 text-[12.5px]", test.state === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
                  {test.state === "ok" ? <CheckCircle2 className="mt-px size-4 shrink-0" /> : <XCircle className="mt-px size-4 shrink-0" />}
                  <span className="min-w-0 break-words">{test.msg}</span>
                </div>
              )}
              <p className="flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />{tr("ob.keyPrivacy")}
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepTitle icon={Languages} title={tr("ob.step3Title")} desc={tr("ob.step3Desc")} />
            <div className="mt-4 rounded-card bg-card p-3.5">
              <Select testId="ob-lang" value={settings.translation.targetLang} onChange={(v) => update((s) => ({ ...s, translation: { ...s.translation, targetLang: v } }))} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
            </div>

            <div className="mt-5">
              <div className="mb-2 px-1 text-[13px] font-semibold text-foreground">{tr("ob.permTitle")}</div>
              <div className="space-y-2">
                <button
                  type="button"
                  data-testid="ob-perm-all"
                  onClick={() => choosePermissionMode(true)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-card p-3 text-left transition",
                    allSitesPerm ? "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/40" : "bg-card hover:bg-card-strong",
                  )}
                >
                  <Globe2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{tr("ob.permAllTitle")}</div>
                    <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{tr("ob.permAllDesc")}</div>
                  </div>
                  {allSitesPerm && <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.4} />}
                </button>

                <button
                  type="button"
                  data-testid="ob-perm-click"
                  onClick={() => choosePermissionMode(false)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-card p-3 text-left transition",
                    !allSitesPerm ? "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/40" : "bg-card hover:bg-card-strong",
                  )}
                >
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{tr("ob.permClickTitle")}</div>
                    <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{tr("ob.permClickDesc")}</div>
                  </div>
                  {!allSitesPerm && <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.4} />}
                </button>
              </div>
              <p className="mt-2 flex items-start gap-1.5 px-1 text-[12px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {tr("ob.permSettingsHint")}
              </p>
            </div>

            <div className="mt-4 rounded-card bg-primary-soft p-3.5 text-[12.5px] leading-5 text-primary-soft-foreground">
              {tr("ob.tipBefore")} <b>{tr("ob.tipFab")}</b> {tr("ob.tipOr")} <kbd className="rounded-[6px] bg-background/70 px-1.5 font-mono text-[12px]">Alt+A</kbd>{tr("ob.tipAfter")}
            </div>
          </>
        )}
      </div>

      <div className="pt-4">
        {step === 0 && <Button size="lg" className="w-full" testId="ob-next" onClick={() => setStep(1)} disabled={isCustomPreset && !/^https?:\/\/.+/.test(baseUrl.trim())}>{tr("common.next")} <ArrowRight /></Button>}
        {step === 1 && <Button size="lg" className="w-full" testId="ob-next" onClick={() => setStep(2)} disabled={test.state !== "ok"}>{tr("common.next")} <ArrowRight /></Button>}
        {step === 2 && <Button size="lg" className="w-full" testId="ob-finish" onClick={onDone}>{tr("ob.finish")}</Button>}
      </div>
    </div>
  );
}

function StepTitle({ icon: Icon, badge, title, desc }: { icon: typeof Sparkles; badge?: ReactNode; title: string; desc: string }) {
  return (
    <div>
      <span className="grid size-10 place-items-center rounded-card bg-primary-soft text-primary-soft-foreground">
        {badge ?? <Icon className="size-5" />}
      </span>
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{desc}</p>
    </div>
  );
}
