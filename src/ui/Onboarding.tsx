import { ArrowLeft, ArrowRight, Check, CheckCircle2, KeyRound, Languages, Loader2, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";
import { newProviderFromPreset, normalizeBaseUrl, PRESETS, setKey } from "@/src/lib/providers";
import { LANGUAGES } from "@/src/lib/settings";
import type { ProviderConfig, Settings } from "@/src/lib/types";
import { Button, cn, inputCls, Select } from "./components/ui";
import { Logo } from "./components/Logo";
import type { useProviders } from "./hooks";
import { bg } from "./messaging";

const ONBOARD_PRESETS = ["deepseek", "moonshot", "qwen", "zhipu", "openai", "anthropic", "gemini", "openrouter", "ollama", "custom"];

/** First-run: 1) pick provider 2) paste key + test (must pass) 3) target language. Skippable. */
export function Onboarding({ settings, update, providers, onDone }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void; providers: ReturnType<typeof useProviders>; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [presetId, setPresetId] = useState("deepseek");
  const preset = PRESETS.find((p) => p.id === presetId)!;
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKeyInput] = useState("");
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [saved, setSaved] = useState<ProviderConfig | null>(null);

  const draft = (): ProviderConfig => {
    const p = saved ?? newProviderFromPreset(preset);
    return { ...p, kind: preset.kind, presetId: preset.id, name: preset.name, baseUrl: normalizeBaseUrl(presetId === "custom" ? baseUrl : baseUrl || preset.baseUrl) };
  };

  async function runTest() {
    const p = draft();
    setTest({ state: "running" });
    try {
      await chrome.permissions.request({ origins: [`${new URL(p.baseUrl).origin}/*`] }).catch(() => false);
    } catch {
      return setTest({ state: "fail", msg: "Base URL 格式不正确" });
    }
    try {
      const r = await bg<{ latencyMs: number; model: string; models: string[] }>({ type: "provider:test", provider: p, modelId: p.models[0], apiKey: key.trim() || undefined });
      const models = p.models.length ? p.models : r.models.slice(0, 50);
      const final = { ...p, models };
      await providers.save([...providers.providers.filter((x) => x.id !== final.id), final]);
      await setKey(final.id, key);
      setSaved(final);
      setTest({ state: "ok", msg: `连接成功 · ${r.model} · ${(r.latencyMs / 1000).toFixed(1)}s` });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    }
  }

  return (
    <div className="flex h-full flex-col px-5 pb-5" data-testid="onboarding" data-step={step}>
      <div className="flex h-12 items-center gap-2">
        {step > 0 ? (
          <button className="grid size-8 place-items-center rounded-btn text-muted-foreground hover:bg-muted" onClick={() => setStep(step - 1)} aria-label="上一步"><ArrowLeft className="size-[18px]" /></button>
        ) : (
          <Logo size={24} />
        )}
        <div className="flex flex-1 justify-center gap-1.5">
          {[0, 1, 2].map((i) => <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-input")} />)}
        </div>
        <button className="rounded-btn px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onDone} data-testid="onboarding-skip">跳过</button>
      </div>

      <div key={step} className="min-h-0 flex-1 animate-in overflow-y-auto pt-4">
        {step === 0 && (
          <>
            <StepTitle icon={Sparkles} title="选择模型服务" desc="用你自己的 API Key，直接连到服务商。之后可以再加更多。" />
            <div className="mt-5 grid grid-cols-2 gap-2">
              {ONBOARD_PRESETS.map((id) => {
                const p = PRESETS.find((x) => x.id === id)!;
                const on = presetId === id;
                return (
                  <button key={id} data-testid={`ob-preset-${id}`} onClick={() => { setPresetId(id); setBaseUrl(""); setTest({ state: "idle" }); setSaved(null); }}
                    className={cn("flex items-center gap-2 rounded-card px-3 py-3 text-left text-[13px] font-medium transition", on ? "bg-primary-soft text-primary-soft-foreground ring-1 ring-primary/40" : "bg-card hover:bg-card-strong")}>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {on && <Check className="size-4 shrink-0" strokeWidth={2.4} />}
                  </button>
                );
              })}
            </div>
            {presetId === "custom" && (
              <label className="mt-4 block">
                <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Base URL（OpenAI 兼容）</div>
                <input data-testid="ob-base-url" className={cn(inputCls, "font-mono text-[12.5px]")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
              </label>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <StepTitle icon={KeyRound} title={`粘贴 ${preset.name} 的 Key`} desc={preset.keyOptional ? "本地服务通常不需要 Key，可以直接测试。" : "测试通过后才能进入下一步。"} />
            <div className="mt-5 space-y-3">
              <input data-testid="ob-key" type="password" autoFocus className={cn(inputCls, "font-mono text-[12.5px]")} value={key} onChange={(e) => { setKeyInput(e.target.value); setTest({ state: "idle" }); }} placeholder={preset.keyOptional ? "可留空" : "sk-…"} />
              <div className="flex items-center gap-2">
                <Button testId="ob-test" variant="secondary" onClick={runTest} disabled={test.state === "running" || (!key.trim() && !preset.keyOptional)} icon={test.state === "running" ? Loader2 : undefined} className={test.state === "running" ? "[&_svg]:animate-spin" : ""}>
                  测试连接
                </Button>
                {preset.keyUrl && <a className="text-[12.5px] text-primary hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">去获取 Key</a>}
              </div>
              {(test.state === "ok" || test.state === "fail") && (
                <div data-testid="ob-test-result" data-state={test.state} className={cn("flex animate-in items-start gap-2 rounded-btn px-3 py-2.5 text-[12.5px]", test.state === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
                  {test.state === "ok" ? <CheckCircle2 className="mt-px size-4 shrink-0" /> : <XCircle className="mt-px size-4 shrink-0" />}
                  <span className="min-w-0 break-words">{test.msg}</span>
                </div>
              )}
              <p className="flex items-start gap-1.5 text-[12px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />Key 只保存在这台电脑的浏览器里（不同步），只由扩展后台读取，网页无法访问。
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <StepTitle icon={Languages} title="翻译成哪种语言？" desc="网页翻译和总结默认使用这个语言，随时可以在 ⚙ 里改。" />
            <div className="mt-5 rounded-card bg-card p-4">
              <Select testId="ob-lang" value={settings.translation.targetLang} onChange={(v) => update((s) => ({ ...s, translation: { ...s.translation, targetLang: v } }))} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
            </div>
            <div className="mt-4 rounded-card bg-primary-soft p-4 text-[13px] leading-6 text-primary-soft-foreground">
              在任意网页点右侧的 <b>译</b> 按钮（或按 <kbd className="rounded-[6px] bg-background/70 px-1.5 font-mono text-[12px]">Alt+A</kbd>）即可双语翻译；选中文字会出现划词翻译。
            </div>
          </>
        )}
      </div>

      <div className="pt-4">
        {step === 0 && <Button size="lg" className="w-full" testId="ob-next" onClick={() => setStep(1)} disabled={presetId === "custom" && !/^https?:\/\/.+/.test(baseUrl.trim())}>下一步 <ArrowRight /></Button>}
        {step === 1 && <Button size="lg" className="w-full" testId="ob-next" onClick={() => setStep(2)} disabled={test.state !== "ok"}>下一步 <ArrowRight /></Button>}
        {step === 2 && <Button size="lg" className="w-full" testId="ob-finish" onClick={onDone}>开始使用</Button>}
      </div>
    </div>
  );
}

function StepTitle({ icon: Icon, title, desc }: { icon: typeof Sparkles; title: string; desc: string }) {
  return (
    <div>
      <span className="grid size-10 place-items-center rounded-card bg-primary-soft text-primary-soft-foreground"><Icon className="size-5" /></span>
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{desc}</p>
    </div>
  );
}
