import {
  CheckCircle2, ChevronDown, Code2, Copy, Database, Download, Eye, EyeOff, Globe2, Keyboard, KeyRound, Languages, Loader2, MessageSquareText, Monitor, Moon, MousePointerClick, Palette, Plus, RefreshCw, RotateCcw, ShieldCheck, Star, Sun, Trash2, Upload, X, XCircle, Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { STYLE_LABELS } from "@/src/lib/batch";
import { ConversationStore } from "@/src/lib/db";
import { DEFAULT_KEYPOINTS_TEMPLATE, DEFAULT_SUMMARY_TEMPLATE } from "@/src/lib/prompts";
import { deleteProvider, getKey, keyOptional, modelRef, newProviderFromPreset, normalizeBaseUrl, PRESETS, resolveModelRef, setKey } from "@/src/lib/providers";
import { defaultSettings, LANGUAGES } from "@/src/lib/settings";
import type { DisplayMode, ModelRef, ProviderConfig, Settings, SummaryLength, ThemeMode, TranslationStyle, UiLocale } from "@/src/lib/types";
import { Advanced, Button, Card, cn, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownTrigger, Field, Group, inputCls, Row, SectionLabel, Segmented, Select, Switch, TextField, ToastProvider, useToast } from "../components/ui";
import { Logo } from "../components/Logo";
import { OAuthLoginBox } from "../components/OAuthLoginBox";
import { ProviderIcon } from "../components/ProviderIcon";
import { useProviders, useSettings, useTheme } from "../hooks";
import { bg } from "../messaging";
import { tr, type MessageKey } from "@/src/i18n";
import { DEFAULT_MCP_PORT, type McpBridgeStatus } from "@/src/agent/mcp-bridge";

type SectionId = "models" | "translation" | "chat" | "appearance" | "shortcuts" | "data" | "agent";
const SECTIONS: { id: SectionId; labelKey: MessageKey; icon: typeof KeyRound }[] = [
  { id: "models", labelKey: "nav.models", icon: KeyRound },
  { id: "translation", labelKey: "nav.translation", icon: Languages },
  { id: "chat", labelKey: "nav.chat", icon: MessageSquareText },
  { id: "appearance", labelKey: "nav.appearance", icon: Palette },
  { id: "shortcuts", labelKey: "nav.shortcuts", icon: Keyboard },
  { id: "data", labelKey: "nav.data", icon: ShieldCheck },
  { id: "agent", labelKey: "nav.agent", icon: MousePointerClick },
];

export type Ctx = { settings: Settings; update: (fn: (s: Settings) => Settings) => void; providers: ReturnType<typeof useProviders> };

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
                {tr(s.labelKey)}
              </button>
            ))}
          </div>
        </nav>
        <main className="min-w-0 max-w-[680px] flex-1" data-testid={`section-${section}`} key={section}>
          <h1 className="animate-in text-[22px] font-semibold tracking-tight">{tr(SECTIONS.find((s) => s.id === section)!.labelKey)}</h1>
          <div className="animate-in">
            {section === "models" && <ModelsSection {...ctx} />}
            {section === "translation" && <TranslationSection {...ctx} />}
            {section === "chat" && <ChatSection {...ctx} />}
            {section === "appearance" && <AppearanceSection {...ctx} />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "data" && <DataSection {...ctx} />}
            {section === "agent" && <AgentSection />}
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="px-1 pt-2 text-[12px] leading-5 text-muted-foreground">{children}</p>;

// ───────────────────────── 模型与密钥 ─────────────────────────
export function ModelsSection({ settings, update, providers }: Ctx) {
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
        right={<Select className="w-40 shrink-0 sm:w-56" testId={`task-model-${k}`} value={opts.some((o) => o.value === settings.models[k]) ? settings.models[k] : "auto"} options={opts} onChange={(v) => update((s) => ({ ...s, models: { ...s.models, [k]: v as ModelRef } }))} />} />
    );
  };
  return (
    <>
      <div className="flex items-end justify-between">
        <SectionLabel>{tr("opt.providers")}</SectionLabel>
        <Dropdown>
          <DropdownTrigger asChild><Button size="sm" icon={Plus} testId="add-provider" className="mb-2">{tr("opt.addProvider")}</Button></DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>{tr("ob.providerGroupOAuth")}</DropdownLabel>
            {PRESETS.filter((p) => p.oauth).map((p) => (
              <DropdownItem key={p.id} testId={`preset-${p.id}`} onSelect={() => add(p.id)}>
                <ProviderIcon presetId={p.id} size={15} />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{tr("oauth.badge")}</span>
              </DropdownItem>
            ))}
            <DropdownLabel>{tr("ob.providerGroupKey")}</DropdownLabel>
            {PRESETS.filter((p) => !p.oauth && !p.id.startsWith("custom")).map((p) => (
              <DropdownItem key={p.id} testId={`preset-${p.id}`} onSelect={() => add(p.id)}>
                <ProviderIcon presetId={p.id} size={15} />
                <span className="truncate">{p.name}</span>
              </DropdownItem>
            ))}
            <DropdownLabel>{tr("opt.customProviders")}</DropdownLabel>
            {PRESETS.filter((p) => p.id.startsWith("custom")).map((p) => (
              <DropdownItem key={p.id} testId={`preset-${p.id}`} onSelect={() => add(p.id)}>
                <ProviderIcon presetId={p.id} size={15} />
                <span className="truncate">{p.name}</span>
              </DropdownItem>
            ))}
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
      if (r.models?.length && (!p.models.length || p.presetId === "antigravity")) {
        persist({ ...p, models: [...new Set([r.model, ...r.models])].filter(Boolean).slice(0, 80) });
      }
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
  return (
    <Card className="overflow-hidden" data-testid={`provider-${p.presetId}`}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={onToggle} aria-expanded={open} data-testid={`provider-toggle-${p.presetId}`}>
        <span className="grid size-8 place-items-center rounded-btn bg-background text-muted-foreground"><ProviderIcon presetId={p.presetId} size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{p.name}</div>
          <div className="truncate text-[12px] text-muted-foreground" data-testid="provider-summary">{ok ? tr("opt.providerSummary", { key: masked || tr("opt.noKeyNeeded"), n: p.models.length }) : tr("opt.noKey")}</div>
        </div>
        <span className={cn("size-2 rounded-full", ok && p.enabled ? "bg-emerald-500" : "bg-input")} />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="animate-in space-y-4 border-t border-border/70 px-4 pb-4 pt-4">
          {preset?.oauth && (
            <OAuthLoginBox
              oauthId={preset.oauth}
              presetId={p.presetId}
              providerId={p.id}
              providerName={p.name}
              onSuccess={(apiKey, oauthBaseUrl) => {
                setKeyInput(apiKey);
                if (oauthBaseUrl && oauthBaseUrl !== p.baseUrl) persist({ ...p, baseUrl: oauthBaseUrl });
                toast({ text: tr("oauth.connected"), tone: "info" });
              }}
              onError={(msg) => toast({ text: msg, tone: "error", sticky: true })}
            />
          )}
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
                  {i === 0 ? (
                    <span title={tr("opt.setDefault")} aria-label={tr("opt.setDefault")} className="grid size-6 place-items-center text-primary">
                      <Star className="size-3.5 fill-current" aria-hidden="true" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={tr("opt.setDefault")}
                      aria-label={tr("opt.setDefault")}
                      className="grid size-6 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-muted hover:text-primary group-hover:opacity-100"
                      onClick={() => persist({ ...p, models: [m, ...p.models.filter((x) => x !== m)] })}
                    >
                      <Star className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    title={tr("common.remove")}
                    aria-label={tr("common.remove")}
                    className="grid size-6 place-items-center rounded-sm text-muted-foreground opacity-0 transition hover:bg-muted hover:text-destructive group-hover:opacity-100"
                    onClick={() => persist({ ...p, models: p.models.filter((x) => x !== m) })}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
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

export function TranslationSection({ settings, update }: Ctx) {
  const t = settings.translation;
  const d = defaultSettings().translation;
  const set = (patch: Partial<Settings["translation"]>) => update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));
  return (
    <>
      <SectionLabel>{tr("opt.basics")}</SectionLabel>
      <Group>
        <Row title={tr("qs.targetLang")} chevron={false} right={<Select className="w-36 shrink-0 sm:w-44" testId="target-lang" value={t.targetLang} onChange={(v) => set({ targetLang: v })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />} />
        <Row title={tr("opt.displayMode")} chevron={false} right={<Segmented<DisplayMode> className="shrink-0" value={t.displayMode} onChange={(v) => set({ displayMode: v })} options={[{ value: "bilingual", label: tr("mode.bilingual") }, { value: "translation-only", label: tr("mode.only") }]} />} />
        <Row title={tr("opt.fab")} subtitle={tr("opt.fabHint")} chevron={false} right={<Switch testId="fab-switch" checked={t.floatingButton} onChange={(v) => set({ floatingButton: v })} />} />
        <Row title={tr("opt.selection")} subtitle={tr("opt.selectionHint")} chevron={false} right={<Switch checked={t.selectionTranslate} onChange={(v) => set({ selectionTranslate: v })} />} />
        <Row
          title={tr("sb.hoverTranslateKey")}
          subtitle={tr("sb.hoverTranslateKeyHint")}
          chevron={false}
          right={
            <Select
              className="w-32 shrink-0"
              testId="hover-translate-key"
              value={t.hoverTranslateKey ?? "Shift"}
              onChange={(v) => set({ hoverTranslateKey: v as Settings["translation"]["hoverTranslateKey"] })}
              options={[
                { value: "Shift", label: "Shift" },
                { value: "Alt", label: "Alt / Option" },
                { value: "Control", label: "Ctrl" },
                { value: "off", label: tr("sb.hoverKeyOff") },
              ]}
            />
          }
        />
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
export function ChatSection({ settings, update }: Ctx) {
  const sm = settings.summary;
  const setS = (patch: Partial<Settings["summary"]>) => update((s) => ({ ...s, summary: { ...s.summary, ...patch } }));
  const setP = (patch: Partial<Settings["prompts"]>) => update((s) => ({ ...s, prompts: { ...s.prompts, ...patch } }));
  return (
    <>
      <SectionLabel>{tr("opt.summaryTitle")}</SectionLabel>
      <Group>
        <Row title={tr("opt.summaryLength")} chevron={false} right={<Segmented<SummaryLength> className="shrink-0" value={sm.length} onChange={(v) => setS({ length: v })} options={[{ value: "short", label: tr("len.short") }, { value: "medium", label: tr("len.medium") }, { value: "detailed", label: tr("len.long") }]} />} />
        <Row title={tr("opt.summaryLang")} chevron={false} right={<Select className="w-36 shrink-0 sm:w-44" value={sm.language} onChange={(v) => setS({ language: v })} options={[{ value: "target", label: tr("opt.summaryLangTarget") }, { value: "page", label: tr("opt.summaryLangPage") }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]} />} />
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
export function AppearanceSection({ settings, update }: Ctx) {
  return (
    <>
      <SectionLabel>{tr("opt.theme")}</SectionLabel>
      <Card className="p-4">
        <Segmented<ThemeMode> testId="theme" iconOnly value={settings.theme} onChange={(v) => update((s) => ({ ...s, theme: v }))}
          options={[{ value: "system", label: tr("theme.system"), icon: Monitor }, { value: "light", label: tr("theme.light"), icon: Sun }, { value: "dark", label: tr("theme.dark"), icon: Moon }]} />
      </Card>
      <Hint>{tr("opt.themeHint")}</Hint>
      <SectionLabel>{tr("opt.uiLocale")}</SectionLabel>
      <Card className="p-4">
        <Segmented<UiLocale> testId="ui-locale" value={settings.uiLocale ?? "auto"} onChange={(v) => update((s) => ({ ...s, uiLocale: v }))}
          options={[{ value: "auto", label: tr("opt.uiLocaleAuto") }, { value: "zh", label: tr("opt.uiLocaleZh") }, { value: "en", label: tr("opt.uiLocaleEn") }]} />
      </Card>
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
export function DataSection({ update }: Ctx) {
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

const MCP_TOOL_GROUPS = [
  {
    labelKey: "mcp.catInspect" as const,
    tools: [
      { name: "browser_snapshot", sig: "{ tabId? }", descKey: "mcp.tool.browser_snapshot" as const },
      { name: "browser_screenshot", sig: "{ tabId?, fullPage? }", descKey: "mcp.tool.browser_screenshot" as const },
      { name: "browser_extract", sig: "{ tabId? }", descKey: "mcp.tool.browser_extract" as const },
      { name: "browser_search_page", sig: "{ pattern, tabId? }", descKey: "mcp.tool.browser_search_page" as const },
    ],
  },
  {
    labelKey: "mcp.catInteract" as const,
    tools: [
      { name: "browser_click", sig: "{ index | x,y }", descKey: "mcp.tool.browser_click" as const },
      { name: "browser_hover", sig: "{ index | x,y }", descKey: "mcp.tool.browser_hover" as const },
      { name: "browser_input", sig: "{ index, text, clear? }", descKey: "mcp.tool.browser_input" as const },
      { name: "browser_select_option", sig: "{ index, text }", descKey: "mcp.tool.browser_select_option" as const },
      { name: "browser_scroll", sig: "{ down, pages?, index? }", descKey: "mcp.tool.browser_scroll" as const },
      { name: "browser_send_keys", sig: "{ keys, index? }", descKey: "mcp.tool.browser_send_keys" as const },
    ],
  },
  {
    labelKey: "mcp.catTabs" as const,
    tools: [
      { name: "browser_tabs_list", sig: "{}", descKey: "mcp.tool.browser_tabs_list" as const },
      { name: "browser_tab_activate", sig: "{ tabId }", descKey: "mcp.tool.browser_tab_activate" as const },
      { name: "browser_tab_open", sig: "{ url, active? }", descKey: "mcp.tool.browser_tab_open" as const },
      { name: "browser_tab_close", sig: "{ tabId }", descKey: "mcp.tool.browser_tab_close" as const },
      { name: "browser_navigate", sig: "{ url, tabId? }", descKey: "mcp.tool.browser_navigate" as const },
      { name: "browser_go_back", sig: "{ tabId? }", descKey: "mcp.tool.browser_go_back" as const },
      { name: "browser_wait", sig: "{ seconds, tabId? }", descKey: "mcp.tool.browser_wait" as const },
    ],
  },
  {
    labelKey: "mcp.catCdp" as const,
    tools: [
      { name: "browser_console_logs", sig: "{ level?, clear? }", descKey: "mcp.tool.browser_console_logs" as const },
      { name: "browser_network_requests", sig: "{ urlFilter?, onlyErrors? }", descKey: "mcp.tool.browser_network_requests" as const },
      { name: "browser_evaluate", sig: "{ expression, tabId? }", descKey: "mcp.tool.browser_evaluate" as const },
    ],
  },
  {
    labelKey: "mcp.catAgent" as const,
    tools: [
      { name: "browser_run_task", sig: "{ task, tabId? }", descKey: "mcp.tool.browser_run_task" as const },
    ],
  },
];

function McpBridgeCard() {
  const toast = useToast();
  const [status, setStatus] = useState<McpBridgeStatus>({
    enabled: false,
    connected: false,
    port: DEFAULT_MCP_PORT,
    token: "",
  });
  const [portInput, setPortInput] = useState(String(DEFAULT_MCP_PORT));
  const [tokenInput, setTokenInput] = useState("");
  const [showJson, setShowJson] = useState(false);

  const refresh = async () => {
    try {
      const s = await bg<McpBridgeStatus>({ type: "mcp:status" });
      if (s) setStatus(s);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    bg<McpBridgeStatus>({ type: "mcp:status" })
      .then((s) => {
        if (s) {
          setStatus(s);
          setPortInput(String(s.port));
          setTokenInput(s.token);
        }
      })
      .catch(() => {});
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, []);

  const toggle = async (enabled: boolean) => {
    if (enabled) {
      await chrome.permissions.request({ origins: ["<all_urls>"] }).catch(() => false);
    }
    const s = await bg<McpBridgeStatus>({
      type: "mcp:config",
      config: { enabled, port: Number(portInput) || DEFAULT_MCP_PORT, token: tokenInput.trim() },
    });
    if (s) setStatus(s);
  };

  const toggleCdp = async (cdpEnabled: boolean) => {
    const s = await bg<McpBridgeStatus>({
      type: "mcp:config",
      config: { cdpEnabled },
    });
    if (s) setStatus(s);
  };

  const applyConfig = async () => {
    const s = await bg<McpBridgeStatus>({
      type: "mcp:config",
      config: { port: Number(portInput) || DEFAULT_MCP_PORT, token: tokenInput.trim() },
    });
    if (s) setStatus(s);
    await bg<McpBridgeStatus>({ type: "mcp:reconnect" }).then((r) => r && setStatus(r));
  };

  const mcpSnippet = () => {
    const entry: Record<string, unknown> = {
      type: "streamable-http",
      url: `http://127.0.0.1:${status.port}/mcp`,
    };
    if (status.token) {
      entry.headers = { Authorization: `Bearer ${status.token}` };
    }
    return JSON.stringify(
      {
        mcpServers: {
          "sidekick-browser": entry,
        },
      },
      null,
      2,
    );
  };

  const copyMcpJson = () => {
    navigator.clipboard.writeText(mcpSnippet());
    toast({ text: tr("mcp.copied"), tone: "info" });
  };

  return (
    <Card className="p-5" data-testid="mcp-bridge-card">
      {/* Header row: icon + title + status badge | switch */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary/10 text-primary">
            <Zap className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-foreground">{tr("mcp.title")}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
                  !status.enabled
                    ? "bg-muted text-muted-foreground"
                    : status.indicator === "active"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : status.indicator === "error" || !status.connected
                        ? "bg-red-500/15 text-red-700 dark:text-red-300"
                        : "bg-blue-500/15 text-blue-700 dark:text-blue-300",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    !status.enabled
                      ? "bg-muted-foreground/50"
                      : status.indicator === "active"
                        ? "bg-emerald-500 animate-pulse"
                        : status.indicator === "error" || !status.connected
                          ? "bg-red-500"
                          : "bg-blue-500",
                  )}
                />
                {!status.enabled
                  ? tr("mcp.badgeDisabled")
                  : status.indicator === "active"
                    ? tr("mcp.badgeActive")
                    : status.indicator === "error" || !status.connected
                      ? tr("mcp.badgeWaiting")
                      : tr("mcp.badgeConnected")}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{tr("mcp.subtitle")}</p>
          </div>
        </div>
        <Switch testId="mcp-enable" checked={status.enabled} onChange={toggle} label={tr("mcp.enable")} />
      </div>

      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">{tr("mcp.desc")}</p>

      {/* Live status & actions bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border/60 bg-background/70 px-3.5 py-2.5 text-[12.5px]">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              !status.enabled
                ? "bg-muted-foreground/40"
                : status.indicator === "active"
                  ? "bg-emerald-500 animate-pulse"
                  : status.indicator === "error" || !status.connected
                    ? "bg-red-500"
                    : "bg-blue-500",
            )}
          />
          <span className="truncate font-mono text-[12px] font-medium text-foreground/90" data-testid="mcp-status-text">
            {!status.enabled
              ? tr("mcp.statusDisabled")
              : status.connected
                ? tr("mcp.statusConnected", { port: status.port })
                : tr("mcp.statusWaiting", { port: status.port })}
          </span>
          {status.lastTool && (
            <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
              {tr("mcp.lastTool", { tool: status.lastTool })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={applyConfig}
            title={tr("mcp.reconnect")}
            aria-label={tr("mcp.reconnect")}
            data-testid="mcp-reconnect"
            className="grid size-7 place-items-center rounded-btn border border-border/70 bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
          </button>
          <Button size="sm" variant="outline" icon={Copy} onClick={copyMcpJson} testId="mcp-copy-config">
            {tr("mcp.copyConfig")}
          </Button>
          <button
            type="button"
            onClick={() => setShowJson((v) => !v)}
            title={showJson ? tr("mcp.hideConfig") : tr("mcp.showConfig")}
            aria-label={showJson ? tr("mcp.hideConfig") : tr("mcp.showConfig")}
            aria-expanded={showJson}
            className={cn(
              "grid size-7 place-items-center rounded-btn border transition",
              showJson
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/70 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Code2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {showJson && (
        <pre className="mt-2.5 overflow-x-auto rounded-[12px] border border-border/60 bg-background/90 p-3 font-mono text-[11.5px] leading-5 text-foreground/85">
          {mcpSnippet()}
        </pre>
      )}

      {/* Port & Token inputs */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <TextField label={tr("mcp.port")} value={portInput} onChange={setPortInput} mono testId="mcp-port" />
        <TextField label={tr("mcp.token")} value={tokenInput} onChange={setTokenInput} placeholder={tr("mcp.tokenPlaceholder")} mono testId="mcp-token" />
      </div>

      {/* Optional CDP Enhanced Mode toggle (default off) */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-[12px] border border-border/60 bg-background/60 px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-foreground">{tr("mcp.cdpTitle")}</span>
            {status.cdpEnabled && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {tr("mcp.cdpBadge")}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{tr("mcp.cdpDesc")}</p>
        </div>
        <Switch testId="mcp-cdp-enable" checked={Boolean(status.cdpEnabled)} onChange={toggleCdp} label={tr("mcp.cdpTitle")} />
      </div>

      {/* Categorized MCP Tool pills with aligned 2-column grid & hover tooltips */}
      <div className="mt-4 rounded-[14px] border border-border/60 bg-background/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold text-foreground/85">{tr("mcp.toolsTitle")}</span>
        </div>
        <div className="divide-y divide-border/45">
          {MCP_TOOL_GROUPS.map((g) => (
            <div key={g.labelKey} className="grid grid-cols-[100px_1fr] items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="pt-1 text-[12px] font-medium text-muted-foreground">{tr(g.labelKey)}</span>
              <div className="flex flex-wrap gap-1.5">
                {g.tools.map((t) => {
                  const desc = tr(t.descKey);
                  return (
                    <span
                      key={t.name}
                      title={`${t.name}(${t.sig}) — ${desc}`}
                      data-testid={`mcp-tool-${t.name}`}
                      className="group relative inline-flex cursor-help items-center rounded-[8px] border border-border/75 bg-card px-2.5 py-1 font-mono text-[11.5px] text-foreground/90 shadow-[0_1px_2px_rgb(0_0_0/0.02)] transition hover:border-primary/45 hover:bg-primary/5 hover:text-primary"
                    >
                      {t.name}
                      <span
                        role="tooltip"
                        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-60 -translate-x-1/2 translate-y-1 rounded-[10px] border border-border/60 bg-popover p-2.5 font-sans text-left opacity-0 shadow-float transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100"
                      >
                        <span className="block font-mono text-[11px] font-semibold text-primary">
                          {t.name} <span className="font-normal text-muted-foreground">{t.sig}</span>
                        </span>
                        <span className="mt-1 block text-[11.5px] leading-4 text-foreground/90">{desc}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function AgentSection() {
  const [neverSites, setNever] = useState<{ site: string }[]>([]);
  const [allows, setAllows] = useState<{ site: string; kinds: string[] }[]>([]);
  const [runs, setRuns] = useState<{ id: string; task: string; url: string; status: string; startedAt: number; steps: number }[]>([]);
  const [siteIn, setSiteIn] = useState("");
  const toast = useToast();
  const reload = async () => {
    const { agentStore } = await import("@/src/agent/store");
    const policies = await agentStore.listPolicies();
    setNever(policies.filter((p) => p.neverAct).map((p) => ({ site: p.site })));
    setAllows(policies.filter((p) => (p.allowKinds?.length ?? 0) > 0).map((p) => ({ site: p.site, kinds: p.allowKinds! })));
    setRuns(await agentStore.listRuns(30));
  };
  useEffect(() => { void reload(); }, []);
  const addNever = async () => {
    const site = siteIn.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
    if (!site) return;
    const { agentStore } = await import("@/src/agent/store");
    const prev = (await agentStore.getPolicy(site)) ?? { site, updatedAt: Date.now() };
    await agentStore.setPolicy({ ...prev, neverAct: true, updatedAt: Date.now() });
    setSiteIn("");
    toast({ text: tr("agent.addSite"), tone: "info" });
    await reload();
  };
  const remove = async (site: string, field: "never" | "allow") => {
    const { agentStore } = await import("@/src/agent/store");
    const prev = await agentStore.getPolicy(site);
    if (!prev) return;
    if (field === "never") {
      if (!(prev.allowKinds?.length)) await agentStore.deletePolicy(site);
      else await agentStore.setPolicy({ ...prev, neverAct: false, updatedAt: Date.now() });
    } else {
      if (!prev.neverAct) await agentStore.deletePolicy(site);
      else await agentStore.setPolicy({ ...prev, allowKinds: [], updatedAt: Date.now() });
    }
    await reload();
  };
  return (
    <div>
      <SectionLabel>{tr("mcp.sectionBridge")}</SectionLabel>
      <McpBridgeCard />

      <SectionLabel>{tr("mcp.sectionPolicy")}</SectionLabel>
      <div className="space-y-3">
        <Card className="p-4">
          <div className="text-[14px] font-semibold text-foreground">{tr("agent.neverSites")}</div>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted-foreground">{tr("agent.neverSitesHelp")}</p>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder={tr("agent.sitePlaceholder")}
              value={siteIn}
              onChange={(e) => setSiteIn(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNever()}
              data-testid="agent-never-input"
            />
            <Button onClick={addNever} testId="agent-never-add">{tr("agent.addSite")}</Button>
          </div>
          <ul className="mt-3 space-y-1.5" data-testid="agent-never-list">
            {neverSites.length === 0 && (
              <li className="rounded-btn border border-dashed border-border/70 px-3 py-2 text-center text-[12.5px] text-muted-foreground">
                {tr("mcp.neverEmpty")}
              </li>
            )}
            {neverSites.map((s) => (
              <li key={s.site} className="flex items-center justify-between rounded-btn bg-background/70 px-3 py-2 text-[13px]">
                <span className="font-mono text-[12.5px]">{s.site}</span>
                <button
                  type="button"
                  title={tr("agent.remove")}
                  aria-label={tr("agent.remove")}
                  className="grid size-6 place-items-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-destructive"
                  onClick={() => remove(s.site, "never")}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <div className="text-[14px] font-semibold text-foreground">{tr("agent.noConfirmSites")}</div>
          <p className="mt-0.5 mb-3 text-[12.5px] text-muted-foreground">{tr("agent.noConfirmHelp")}</p>
          <ul className="space-y-1.5" data-testid="agent-allow-list">
            {allows.length === 0 && (
              <li className="rounded-btn border border-dashed border-border/70 px-3 py-2 text-center text-[12.5px] text-muted-foreground">
                {tr("mcp.allowEmpty")}
              </li>
            )}
            {allows.map((s) => (
              <li key={s.site} className="flex items-center justify-between rounded-btn bg-background/70 px-3 py-2 text-[13px]">
                <span>
                  <span className="font-mono text-[12.5px]">{s.site}</span>{" "}
                  <span className="text-[12px] text-muted-foreground">({s.kinds.join(", ")})</span>
                </span>
                <button
                  type="button"
                  title={tr("agent.remove")}
                  aria-label={tr("agent.remove")}
                  className="grid size-6 place-items-center rounded-sm text-muted-foreground transition hover:bg-muted hover:text-destructive"
                  onClick={() => remove(s.site, "allow")}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <SectionLabel>{tr("mcp.sectionHistory")}</SectionLabel>
      <Card className="p-4">
        <div className="mb-2.5 text-[14px] font-semibold text-foreground">{tr("agent.history")}</div>
        <ul className="max-h-80 space-y-2 overflow-y-auto" data-testid="agent-history">
          {runs.length === 0 && (
            <li className="rounded-btn border border-dashed border-border/70 px-3 py-4 text-center text-[12.5px] text-muted-foreground">
              {tr("agent.historyEmpty")}
            </li>
          )}
          {runs.map((r) => (
            <li key={r.id} className="rounded-[12px] border border-border/60 bg-background/70 px-3.5 py-2.5 text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{r.task}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    r.status === "done" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {r.status} · {r.steps} steps
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">{r.url}</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
