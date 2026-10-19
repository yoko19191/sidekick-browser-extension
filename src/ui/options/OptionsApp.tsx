import {
  Brain, CheckCircle2, ChevronDown, Cpu, Database, Download, Eye, EyeOff, Globe2, Keyboard, KeyRound, Languages, Loader2, MessageSquareText, Monitor, Moon, Palette, Plus, RefreshCw, RotateCcw, ShieldCheck, Sun, Trash2, Upload, X, XCircle, Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STYLE_LABELS } from "@/src/lib/batch";
import { ConversationStore } from "@/src/lib/db";
import { DEFAULT_KEYPOINTS_TEMPLATE, DEFAULT_SUMMARY_TEMPLATE } from "@/src/lib/prompts";
import { deleteProvider, getKey, keyOptional, modelRef, newProviderFromPreset, normalizeBaseUrl, PRESETS, resolveModelRef, setKey } from "@/src/lib/providers";
import { defaultSettings, LANGUAGES } from "@/src/lib/settings";
import type { DisplayMode, ModelRef, ProviderConfig, Settings, SummaryLength, ThemeMode, TranslationStyle } from "@/src/lib/types";
import { Advanced, Button, Card, cn, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownTrigger, Field, Group, inputCls, Row, SectionLabel, Segmented, Select, Switch, TextField, ToastProvider, useToast } from "../components/ui";
import { Logo } from "../components/Logo";
import { useProviders, useSettings, useTheme } from "../hooks";
import { bg } from "../messaging";
import { tr } from "@/src/i18n";

type SectionId = "models" | "translation" | "chat" | "appearance" | "shortcuts" | "data";
const SECTIONS: { id: SectionId; label: string; icon: typeof KeyRound }[] = [
  { id: "models", label: tr("nav.models"), icon: KeyRound },
  { id: "translation", label: tr("nav.translation"), icon: Languages },
  { id: "chat", label: tr("nav.chat"), icon: MessageSquareText },
  { id: "appearance", label: tr("nav.appearance"), icon: Palette },
  { id: "shortcuts", label: tr("nav.shortcuts"), icon: Keyboard },
  { id: "data", label: tr("nav.data"), icon: ShieldCheck },
];

type Ctx = { settings: Settings; update: (fn: (s: Settings) => Settings) => void; providers: ReturnType<typeof useProviders> };

export function OptionsApp() {
  const { settings, update } = useSettings();
  const providers = useProviders();
  useTheme(settings.theme);
  const [section, setSection] = useState<SectionId>(() => (location.hash.slice(1) as SectionId) || "models");
  useEffect(() => {
    history.replaceState(null, "", `#${section}`);
  }, [section]);
  const ctx = { settings, update, providers };
  return (
    <ToastProvider>
      <div className="mx-auto flex min-h-full max-w-[1040px] gap-8 px-6 py-8 max-md:flex-col max-md:gap-4">
        <nav className="w-52 shrink-0 max-md:w-full" data-testid="options-nav">
          <div className="mb-6 flex items-center gap-2.5 px-2">
            <Logo size={28} />
            <div>
              <div className="text-[15px] font-semibold tracking-tight">{tr("brand.header")}</div>
              <div className="text-[11.5px] text-muted-foreground">{tr("opt.settingsVersion")}{chrome.runtime.getManifest().version}</div>
            </div>
          </div>
          <div className="space-y-0.5 max-md:flex max-md:gap-1 max-md:space-y-0 max-md:overflow-x-auto">
            {SECTIONS.map((s) => (
              <button key={s.id} data-testid={`nav-${s.id}`} onClick={() => setSection(s.id)}
                className={cn("flex w-full items-center gap-2.5 whitespace-nowrap rounded-btn px-3 py-2 text-[13.5px] font-medium transition", section === s.id ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <s.icon className="size-4" strokeWidth={1.9} />
                {s.label}
              </button>
            ))}
          </div>
        </nav>
        <main className="min-w-0 max-w-[680px] flex-1" data-testid={`section-${section}`} key={section}>
          <h1 className="animate-in text-[22px] font-semibold tracking-tight">{SECTIONS.find((s) => s.id === section)!.label}</h1>
          <div className="animate-in">
            {section === "models" && <ModelsSection {...ctx} />}
            {section === "translation" && <TranslationSection {...ctx} />}
            {section === "chat" && <ChatSection {...ctx} />}
            {section === "appearance" && <AppearanceSection {...ctx} />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "data" && <DataSection {...ctx} />}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="px-1 pt-2 text-[12px] leading-5 text-muted-foreground">{children}</p>;
const glyph = (id: string) => ({ anthropic: Brain, gemini: Zap, ollama: Database, custom: Globe2 } as Record<string, typeof Cpu>)[id] ?? Cpu;

// ───────────────────────── 模型与密钥 ─────────────────────────
function ModelsSection({ settings, update, providers }: Ctx) {
  const usable = (p: ProviderConfig) => !!providers.masked[p.id] || keyOptional(p);
  const [openId, setOpenId] = useState<string | null>(null);
  const add = async (presetId: string) => {
    const p = newProviderFromPreset(PRESETS.find((x) => x.id === presetId)!);
    await providers.save([...providers.providers, p]);
    setOpenId(p.id);
  };
  const opts = [{ value: "auto", label: tr("opt.autoModel") }, ...providers.providers.filter((p) => p.enabled && usable(p)).flatMap((p) => p.models.map((m) => ({ value: modelRef(p.id, m), label: m, group: p.name })))];
  const task = (k: keyof Settings["models"], title: string, desc: string) => {
    const r = resolveModelRef(settings.models[k], providers.providers, usable);
    return (
      <Row title={title} subtitle={r ? tr("opt.currentModel", { provider: r.provider.name, model: r.modelId }) : desc} chevron={false}
        right={<Select className="w-56" testId={`task-model-${k}`} value={opts.some((o) => o.value === settings.models[k]) ? settings.models[k] : "auto"} options={opts} onChange={(v) => update((s) => ({ ...s, models: { ...s.models, [k]: v as ModelRef } }))} />} />
    );
  };
  return (
    <>
      <div className="flex items-end justify-between">
        <SectionLabel>{tr("opt.providers")}</SectionLabel>
        <Dropdown>
          <DropdownTrigger asChild><Button size="sm" icon={Plus} testId="add-provider" className="mb-2">{tr("opt.addProvider")}</Button></DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{tr("opt.openaiCompatible")}</DropdownLabel>
            {PRESETS.filter((p) => p.kind === "openai-compatible").map((p) => <DropdownItem key={p.id} testId={`preset-${p.id}`} onSelect={() => add(p.id)}>{p.name}</DropdownItem>)}
            <DropdownLabel>{tr("opt.otherProtocols")}</DropdownLabel>
            {PRESETS.filter((p) => p.kind !== "openai-compatible").map((p) => <DropdownItem key={p.id} testId={`preset-${p.id}`} onSelect={() => add(p.id)}>{p.name}</DropdownItem>)}
          </DropdownContent>
        </Dropdown>
      </div>
      {providers.providers.length === 0 && <Card className="p-6 text-center text-[13px] text-muted-foreground">{tr("opt.noProviders")}</Card>}
      <div className="space-y-2">
        {providers.providers.map((p) => (
          <ProviderCard key={p.id} p={p} masked={providers.masked[p.id]} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} providers={providers} />
        ))}
      </div>
      <SectionLabel>{tr("opt.defaultModels")}</SectionLabel>
      <Group>
        {task("chat", tr("opt.taskChat"), tr("opt.notConfigured"))}
        {task("summary", tr("opt.taskSummary"), tr("opt.notConfigured"))}
        {task("translate", tr("opt.taskTranslate"), tr("opt.translateHint"))}
      </Group>
      <Hint>{tr("opt.defaultModelsHint")}</Hint>
    </>
  );
}

/** Level-3: provider detail lives in an expandable card. Every change saves immediately. */
function ProviderCard({ p, masked, open, onToggle, providers }: { p: ProviderConfig; masked?: string; open: boolean; onToggle: () => void; providers: Ctx["providers"] }) {
  const toast = useToast();
  const ok = !!masked || keyOptional(p);
  const preset = PRESETS.find((x) => x.id === p.presetId);
  const [key, setKeyInput] = useState("");
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [fetching, setFetching] = useState(false);
  const [newModel, setNewModel] = useState("");
  const keyTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (open) getKey(p.id).then((k) => setKeyInput(k ?? ""));
  }, [open, p.id]);
  const persist = (next: ProviderConfig) => providers.save(providers.providers.map((x) => (x.id === p.id ? next : x)));
  const requestOrigin = async () => {
    try {
      await chrome.permissions.request({ origins: [`${new URL(normalizeBaseUrl(p.baseUrl)).origin}/*`] });
    } catch {
      /* optional: CORS-enabled APIs work without it */
    }
  };
  const runTest = async () => {
    setTest({ state: "running" });
    await requestOrigin();
    await setKey(p.id, key);
    try {
      const r = await bg<{ latencyMs: number; model: string; models: string[] }>({ type: "provider:test", provider: p, modelId: p.models[0] });
      setTest({ state: "ok", msg: tr("ob.testOk", { model: r.model, secs: (r.latencyMs / 1000).toFixed(1) }) });
      if (r.models?.length && !p.models.length) persist({ ...p, models: r.models.slice(0, 50) });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    }
  };
  const fetchModels = async () => {
    setFetching(true);
    await requestOrigin();
    await setKey(p.id, key);
    try {
      const models = await bg<string[]>({ type: "provider:models", provider: p });
      if (models.length) persist({ ...p, models: [...new Set([...p.models.filter((m) => models.includes(m)), ...models])].slice(0, 80) });
      toast({ text: tr("opt.fetchedModels", { n: models.length }), tone: "info" });
    } catch (e) {
      toast({ text: tr("opt.fetchModelsFailed"), tone: "error", detail: (e as Error).message, sticky: true });
    } finally {
      setFetching(false);
    }
  };
  const Icon = glyph(p.presetId);
  return (
    <Card className="overflow-hidden" data-testid={`provider-${p.presetId}`}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onToggle} aria-expanded={open} data-testid={`provider-toggle-${p.presetId}`}>
        <span className="grid size-8 place-items-center rounded-btn bg-background text-muted-foreground"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{p.name}</div>
          <div className="truncate text-[12px] text-muted-foreground" data-testid="provider-summary">{ok ? tr("opt.providerSummary", { key: masked || tr("opt.noKeyNeeded"), n: p.models.length }) : tr("opt.noKey")}</div>
        </div>
        <span className={cn("size-2 rounded-full", ok && p.enabled ? "bg-emerald-500" : "bg-input")} />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-in space-y-4 border-t border-border/70 px-4 pb-4 pt-4">
          <TextField label="API Key" testId="api-key" type={show ? "text" : "password"} mono value={key} placeholder={preset?.keyOptional ? tr("common.optional") : "sk-…"}
            onChange={(v) => { setKeyInput(v); clearTimeout(keyTimer.current); keyTimer.current = window.setTimeout(() => setKey(p.id, v), 400); }}
            hint={preset?.keyUrl && <a className="text-primary hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">{tr("opt.getKey")}</a>}
            right={<Button variant="ghost" size="icon" onClick={() => setShow((v) => !v)} aria-label={show ? tr("common.hide") : tr("common.show")}>{show ? <EyeOff /> : <Eye />}</Button>} />
          <TextField label="Base URL" testId="base-url" mono value={p.baseUrl} placeholder="https://api.example.com/v1" onChange={(v) => persist({ ...p, baseUrl: v })} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" testId="test-provider" onClick={runTest} disabled={test.state === "running" || (!key && !preset?.keyOptional)} icon={test.state === "running" ? Loader2 : Zap} className={test.state === "running" ? "[&_svg]:animate-spin" : ""}>{tr("common.testConnection")}</Button>
            <Button variant="ghost" testId="fetch-models" onClick={fetchModels} icon={RefreshCw} className={fetching ? "[&_svg]:animate-spin" : ""}>{tr("opt.fetchModels")}</Button>
          </div>
          {(test.state === "ok" || test.state === "fail") && (
            <div data-testid="test-result" className={cn("flex items-start gap-2 rounded-btn px-3 py-2 text-[12.5px]", test.state === "ok" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
              {test.state === "ok" ? <CheckCircle2 className="mt-px size-4 shrink-0" /> : <XCircle className="mt-px size-4 shrink-0" />}
              <span className="min-w-0 break-words">{test.msg}</span>
            </div>
          )}
          <Field label={tr("opt.modelsTitle", { n: p.models.length })}>
            <div className="max-h-56 overflow-y-auto rounded-card bg-background" data-testid="model-list">
              {p.models.map((m, i) => (
                <div key={m} className={cn("group flex items-center gap-2 px-3 py-2", i > 0 && "border-t border-border/60")}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{m}</span>
                  {i > 0 && <button className="text-[11.5px] text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100" onClick={() => persist({ ...p, models: [m, ...p.models.filter((x) => x !== m)] })}>{tr("opt.setDefault")}</button>}
                  <button className="text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100" aria-label={tr("common.remove")} onClick={() => persist({ ...p, models: p.models.filter((x) => x !== m) })}><X className="size-3.5" /></button>
                </div>
              ))}
              <div className="flex gap-2 border-t border-border/60 p-2">
                <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder={tr("opt.addModelPlaceholder")} className="min-w-0 flex-1 bg-transparent px-1 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-muted-foreground/70" />
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => { if (newModel.trim()) { persist({ ...p, models: [...new Set([...p.models, newModel.trim()])] }); setNewModel(""); } }}>{tr("common.add")}</Button>
              </div>
            </div>
          </Field>
          <Advanced title={tr("opt.moreOptions")}>
            <div className="space-y-3">
              <TextField label={tr("opt.displayName")} value={p.name} onChange={(v) => persist({ ...p, name: v })} />
              <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{tr("opt.enabledHint")}</span><Switch checked={p.enabled} onChange={(v) => persist({ ...p, enabled: v })} /></div>
              <Button variant="destructive" icon={Trash2} onClick={() => deleteProvider(p.id)}>{tr("opt.deleteProvider")}</Button>
            </div>
          </Advanced>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── 翻译 ─────────────────────────
function NumberField({ label, value, min, max, step = 1, onChange, def }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; def?: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted-foreground">
        <span>{label}{def != null && <span className="ml-1 font-normal opacity-70">{tr("opt.defaultPrefix")} {def}{tr("opt.defaultSuffix")}</span>}</span>
        <span className="rounded-sm bg-background px-1.5 py-0.5 font-mono text-foreground">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--primary)]" />
    </div>
  );
}

function SiteList({ label, items, onChange, placeholder, testId }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string; testId?: string }) {
  const [v, setV] = useState("");
  const addOne = () => {
    const h = v.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (h) onChange([...new Set([...items, h])]);
    setV("");
  };
  return (
    <Field label={label}>
      <div className="flex flex-wrap gap-1.5" data-testid={testId}>
        {items.map((h) => (
          <span key={h} className="flex items-center gap-1 rounded-sm bg-background px-2 py-1 font-mono text-[12px]">
            {h}
            <button onClick={() => onChange(items.filter((x) => x !== h))} className="text-muted-foreground hover:text-destructive" aria-label={tr("common.remove")}><X className="size-3" /></button>
          </span>
        ))}
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addOne()} onBlur={addOne} placeholder={placeholder} className="min-w-32 flex-1 rounded-sm bg-background px-2 py-1 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-muted-foreground/70" />
      </div>
    </Field>
  );
}

function TranslationSection({ settings, update }: Ctx) {
  const t = settings.translation;
  const d = defaultSettings().translation;
  const set = (patch: Partial<Settings["translation"]>) => update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));
  return (
    <>
      <SectionLabel>{tr("opt.basics")}</SectionLabel>
      <Group>
        <Row title={tr("qs.targetLang")} chevron={false} right={<Select className="w-44" testId="target-lang" value={t.targetLang} onChange={(v) => set({ targetLang: v })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />} />
        <Row title={tr("opt.displayMode")} chevron={false} right={<Segmented<DisplayMode> className="w-52" value={t.displayMode} onChange={(v) => set({ displayMode: v })} options={[{ value: "bilingual", label: tr("mode.bilingual") }, { value: "translation-only", label: tr("mode.only") }]} />} />
        <Row title={tr("opt.fab")} subtitle={tr("opt.fabHint")} chevron={false} right={<Switch testId="fab-switch" checked={t.floatingButton} onChange={(v) => set({ floatingButton: v })} />} />
        <Row title={tr("opt.selection")} subtitle={tr("opt.selectionHint")} chevron={false} right={<Switch checked={t.selectionTranslate} onChange={(v) => set({ selectionTranslate: v })} />} />
      </Group>
      <SectionLabel>{tr("opt.styleTitle")}</SectionLabel>
      <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2" data-testid="style-grid">
        {(Object.keys(STYLE_LABELS) as TranslationStyle[]).map((st) => (
          <button key={st} onClick={() => set({ style: st })} data-testid={`style-${st}`}
            className={cn("rounded-card bg-card p-3 text-left transition", t.style === st ? "ring-2 ring-primary" : "hover:bg-card-strong")}>
            <div className="text-[12px] leading-5 text-muted-foreground">The quick brown fox.</div>
            <StylePreview style={st} />
            <div className="mt-2 text-[12px] font-medium">{STYLE_LABELS[st]}</div>
          </button>
        ))}
      </div>
      <Advanced title={tr("opt.translationAdvanced")} testId="translation-advanced">
        <div className="space-y-4">
          <NumberField label={tr("opt.batchChars")} def={d.batchMaxChars} value={t.batchMaxChars} min={400} max={6000} step={100} onChange={(v) => set({ batchMaxChars: v })} />
          <NumberField label={tr("opt.batchItems")} def={d.batchMaxItems} value={t.batchMaxItems} min={1} max={50} onChange={(v) => set({ batchMaxItems: v })} />
          <NumberField label={tr("opt.concurrency")} def={d.concurrency} value={t.concurrency} min={1} max={8} onChange={(v) => set({ concurrency: v })} />
          <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{tr("opt.dynamic")}</span><Switch checked={t.autoTranslateDynamic} onChange={(v) => set({ autoTranslateDynamic: v })} /></div>
          <div className="flex items-center justify-between"><span className="text-[13px] font-medium">{tr("opt.useCache")}</span><Switch checked={t.cacheEnabled} onChange={(v) => set({ cacheEnabled: v })} /></div>
          <SiteList label={tr("opt.autoSites")} testId="auto-sites" items={t.autoSites} onChange={(v) => set({ autoSites: v })} placeholder={tr("opt.sitePlaceholder")} />
          <SiteList label={tr("opt.neverSites")} items={t.neverSites} onChange={(v) => set({ neverSites: v })} placeholder={tr("opt.sitePlaceholder")} />
          <TextField label={tr("opt.skipSelectors")} mono value={t.skipSelectors} placeholder=".comments, footer" onChange={(v) => set({ skipSelectors: v })} />
          <Field label={tr("opt.extraPrompt")}>
            <textarea value={t.extraPrompt} onChange={(e) => set({ extraPrompt: e.target.value })} rows={3} placeholder={tr("opt.extraPromptPlaceholder")} className={cn(inputCls, "resize-y")} />
          </Field>
          <Button variant="ghost" icon={RotateCcw} onClick={() => update((s) => ({ ...s, translation: { ...d, targetLang: s.translation.targetLang, style: s.translation.style, autoSites: s.translation.autoSites, neverSites: s.translation.neverSites } }))}>{tr("opt.resetTranslation")}</Button>
        </div>
      </Advanced>
    </>
  );
}

function StylePreview({ style }: { style: TranslationStyle }) {
  const inner: Record<TranslationStyle, string> = { green: "text-[#16a34a] dark:text-[#34d399]", plain: "", dashed: "border-b-[1.5px] border-dashed border-primary", faded: "opacity-60", highlight: "bg-[linear-gradient(transparent_55%,rgba(253,224,71,.6)_55%)]", card: "" };
  return (
    <div className={cn("mt-0.5 text-[12.5px] leading-5", style === "card" && "rounded-[6px] border-l-2 border-primary bg-primary-soft px-1.5")}>
      <span className={inner[style]}>{tr("opt.stylePreview")}</span>
    </div>
  );
}

// ───────────────────────── 对话与提示词 ─────────────────────────
function ChatSection({ settings, update }: Ctx) {
  const sm = settings.summary;
  const setS = (patch: Partial<Settings["summary"]>) => update((s) => ({ ...s, summary: { ...s.summary, ...patch } }));
  const setP = (patch: Partial<Settings["prompts"]>) => update((s) => ({ ...s, prompts: { ...s.prompts, ...patch } }));
  return (
    <>
      <SectionLabel>{tr("opt.summaryTitle")}</SectionLabel>
      <Group>
        <Row title={tr("opt.summaryLength")} chevron={false} right={<Segmented<SummaryLength> className="w-52" value={sm.length} onChange={(v) => setS({ length: v })} options={[{ value: "short", label: tr("len.short") }, { value: "medium", label: tr("len.medium") }, { value: "detailed", label: tr("len.long") }]} />} />
        <Row title={tr("opt.summaryLang")} chevron={false} right={<Select className="w-44" value={sm.language} onChange={(v) => setS({ language: v })} options={[{ value: "target", label: tr("opt.summaryLangTarget") }, { value: "page", label: tr("opt.summaryLangPage") }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]} />} />
      </Group>
      <Hint>{tr("opt.summaryHint")}</Hint>
      <Advanced title={tr("opt.promptTemplates")} testId="prompt-templates">
        <div className="space-y-4">
          <Field label={tr("chat.summarizePage")} hint={<button className="text-primary" onClick={() => setP({ summary: "" })}>{tr("common.resetDefault")}</button>}>
            <textarea rows={3} value={settings.prompts.summary} placeholder={DEFAULT_SUMMARY_TEMPLATE[sm.length]} onChange={(e) => setP({ summary: e.target.value })} className={cn(inputCls, "resize-y")} />
          </Field>
          <Field label={tr("chat.keyPoints")} hint={<button className="text-primary" onClick={() => setP({ keyPoints: "" })}>{tr("common.resetDefault")}</button>}>
            <textarea rows={2} value={settings.prompts.keyPoints} placeholder={DEFAULT_KEYPOINTS_TEMPLATE} onChange={(e) => setP({ keyPoints: e.target.value })} className={cn(inputCls, "resize-y")} />
          </Field>
          <Field label={tr("opt.chatSystem")}>
            <textarea rows={2} value={settings.prompts.chatSystem} placeholder={tr("opt.chatSystemPlaceholder")} onChange={(e) => setP({ chatSystem: e.target.value })} className={cn(inputCls, "resize-y")} />
          </Field>
        </div>
      </Advanced>
      <Advanced title={tr("opt.genParams")}>
        <div className="space-y-4">
          <NumberField label={tr("opt.maxContext")} def={48000} value={sm.maxContextChars} min={8000} max={200000} step={4000} onChange={(v) => setS({ maxContextChars: v })} />
          <NumberField label={tr("opt.temperature")} def={0.3} value={settings.chat.temperature} min={0} max={1.5} step={0.1} onChange={(v) => update((s) => ({ ...s, chat: { ...s.chat, temperature: Math.round(v * 10) / 10 } }))} />
          <NumberField label={tr("opt.maxTokens")} def={4096} value={settings.chat.maxTokens} min={512} max={16384} step={512} onChange={(v) => update((s) => ({ ...s, chat: { ...s.chat, maxTokens: v } }))} />
        </div>
      </Advanced>
    </>
  );
}

// ───────────────────────── 外观 / 快捷键 ─────────────────────────
function AppearanceSection({ settings, update }: Ctx) {
  return (
    <>
      <SectionLabel>{tr("opt.theme")}</SectionLabel>
      <Card className="p-4">
        <Segmented<ThemeMode> testId="theme" value={settings.theme} onChange={(v) => update((s) => ({ ...s, theme: v }))}
          options={[{ value: "system", label: tr("theme.system"), icon: Monitor }, { value: "light", label: tr("theme.light"), icon: Sun }, { value: "dark", label: tr("theme.dark"), icon: Moon }]} />
      </Card>
      <Hint>{tr("opt.themeHint")}</Hint>
    </>
  );
}

function ShortcutsSection() {
  const [cmds, setCmds] = useState<chrome.commands.Command[]>([]);
  useEffect(() => void chrome.commands.getAll().then(setCmds), []);
  return (
    <>
      <SectionLabel>{tr("nav.shortcuts")}</SectionLabel>
      <Group>
        <Row title={tr("opt.openPanel")} subtitle={tr("opt.clickToolbar")} chevron={false} />
        {cmds.filter((c) => c.name !== "_execute_action").map((c) => (
          <Row key={c.name} title={c.description || c.name} chevron={false} right={<kbd className="rounded-sm bg-background px-2 py-1 font-mono text-[12px]">{c.shortcut || tr("opt.notSet")}</kbd>} />
        ))}
        <Row title={tr("opt.contextMenu")} subtitle={tr("opt.contextMenuItems")} chevron={false} />
      </Group>
      <Button variant="secondary" className="mt-3" icon={Keyboard} onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>{tr("opt.editShortcuts")}</Button>
    </>
  );
}

// ───────────────────────── 数据与隐私 ─────────────────────────
function DataSection({ update }: Ctx) {
  const toast = useToast();
  const [all, setAll] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    chrome.permissions.contains({ origins: ["<all_urls>"] }).then(setAll);
    bg<number>({ type: "cache:stats" }).then(setCount).catch(() => {});
  }, []);
  const exportSettings = async () => {
    const { settings, providers } = await chrome.storage.local.get(["settings", "providers"]);
    const blob = new Blob([JSON.stringify({ app: "sidekick", version: 1, settings, providers }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "sidekick-settings.json";
    a.click();
    toast({ text: tr("opt.exported"), tone: "info" });
  };
  const importSettings = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (j.app !== "sidekick") throw new Error(tr("opt.notSettingsFile"));
      await chrome.storage.local.set({ ...(j.settings ? { settings: j.settings } : {}), ...(Array.isArray(j.providers) ? { providers: j.providers } : {}) });
      toast({ text: tr("opt.imported"), tone: "info" });
    } catch (e) {
      toast({ text: tr("opt.importFailed", { error: (e as Error).message }), tone: "error" });
    }
  };
  return (
    <>
      <SectionLabel>{tr("opt.privacy")}</SectionLabel>
      <Card className="space-y-2 p-4 text-[13px] leading-6 text-muted-foreground">
        <p className="flex gap-2"><ShieldCheck className="mt-1 size-4 shrink-0 text-primary" />{tr("opt.privacyNoServer")}</p>
        <p className="flex gap-2"><KeyRound className="mt-1 size-4 shrink-0 text-primary" />{tr("opt.privacyKeys")}</p>
      </Card>
      <SectionLabel>{tr("opt.siteAccess")}</SectionLabel>
      <Group>
        <Row icon={Globe2} title={tr("opt.allSites")} subtitle={all ? tr("opt.allSitesOn") : tr("opt.allSitesOff")} chevron={false}
          right={<Switch testId="all-sites" checked={all} onChange={async (v) => setAll(v ? await chrome.permissions.request({ origins: ["<all_urls>"] }) : !(await chrome.permissions.remove({ origins: ["<all_urls>"] })))} />} />
      </Group>
      <Advanced title={tr("opt.dataAdvanced")} testId="data-advanced">
        <div className="space-y-2">
          <Row className="px-0" icon={Database} title={tr("opt.translationCache")} subtitle={count == null ? "…" : tr("opt.cacheCount", { count: count })} chevron={false}
            right={<Button size="sm" variant="secondary" onClick={async () => { await bg({ type: "cache:clear" }); setCount(0); toast({ text: tr("opt.cacheCleared"), tone: "info" }); }}>{tr("common.clear")}</Button>} />
          <Row className="px-0" icon={MessageSquareText} title={tr("chat.history")} chevron={false} right={<Button size="sm" variant="secondary" onClick={async () => { await new ConversationStore().clear(); toast({ text: tr("opt.historyCleared"), tone: "info" }); }}>{tr("common.clear")}</Button>} />
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="secondary" icon={Download} onClick={exportSettings}>{tr("opt.export")}</Button>
            <Button variant="secondary" icon={Upload} onClick={() => file.current?.click()}>{tr("opt.import")}</Button>
            <input ref={file} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importSettings(e.target.files[0])} />
            <Button variant="ghost" icon={RotateCcw} onClick={() => { update(() => defaultSettings(chrome.i18n.getUILanguage())); toast({ text: tr("opt.resetDone"), tone: "info" }); }}>{tr("opt.resetAll")}</Button>
          </div>
          <div className="pt-2">
            {confirm ? (
              <div className="flex items-center gap-2 rounded-btn bg-destructive/10 px-3 py-2">
                <span className="flex-1 text-[13px] text-destructive">{tr("opt.wipeConfirm")}</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{tr("common.cancel")}</Button>
                <Button size="sm" variant="destructive" onClick={async () => { await chrome.storage.local.clear(); await bg({ type: "cache:clear" }); await new ConversationStore().clear(); setConfirm(false); }}>{tr("common.delete")}</Button>
              </div>
            ) : (
              <Button variant="destructive" icon={Trash2} onClick={() => setConfirm(true)}>{tr("opt.wipeAll")}</Button>
            )}
          </div>
        </div>
      </Advanced>
    </>
  );
}
