import {
  ArrowLeft, Brain, CheckCircle2, Cpu, Database, Eye, EyeOff, Globe2, Info, KeyRound, Languages, Loader2, MessageSquareText, Monitor, Moon, Palette, Plus, RefreshCw, RotateCcw, ShieldCheck, SlidersHorizontal, Sun, Trash2, X, XCircle, Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { STYLE_LABELS } from "@/src/lib/batch";
import { deleteProvider, getKey, keyOptional, modelRef, newProviderFromPreset, normalizeBaseUrl, PRESETS, resolveModelRef, setKey } from "@/src/lib/providers";
import { defaultSettings, LANGUAGES, langLabel } from "@/src/lib/settings";
import type { ModelRef, ProviderConfig, Settings, SummaryLength, ThemeMode, TranslationStyle } from "@/src/lib/types";
import { Button, Card, cx, Group, IconButton, Row, SectionLabel, Segmented, Select, TextField, Toggle } from "../components/ui";
import { Logo } from "../components/Logo";
import type { useProviders } from "../hooks";
import { bg } from "../messaging";

export type Route = "settings" | "providers" | "provider-presets" | `provider:${string}` | "models" | "translation" | "translation-advanced" | "summary" | "advanced" | "about";

interface Ctx {
  push: (r: Route) => void;
  pop: () => void;
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  providers: ReturnType<typeof useProviders>;
}

const TITLES: Record<string, string> = {
  settings: "设置", providers: "模型服务", "provider-presets": "添加模型服务", models: "默认模型", translation: "翻译", "translation-advanced": "高级翻译选项", summary: "总结与对话", advanced: "高级", about: "关于",
};

export function SettingsStack(props: Ctx & { stack: Route[]; close: () => void }) {
  const route = props.stack[props.stack.length - 1];
  const providerId = route.startsWith("provider:") ? route.slice(9) : null;
  const title = providerId ? (props.providers.providers.find((p) => p.id === providerId)?.name ?? "服务") : TITLES[route];
  const depth = props.stack.length;
  return (
    <div className="flex h-full flex-col" data-testid={`page-${providerId ? "provider" : route}`} data-depth={depth}>
      <header className="flex h-12 shrink-0 items-center gap-1 px-2">
        <IconButton icon={ArrowLeft} label="返回" onClick={props.pop} testId="back" />
        <div className="flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</div>
        {depth > 1 && <IconButton icon={X} label="关闭设置" onClick={props.close} />}
      </header>
      <div className="min-h-0 flex-1 animate-slide overflow-y-auto px-3 pb-8">
        {route === "settings" && <SettingsHome {...props} />}
        {route === "providers" && <ProvidersPage {...props} />}
        {route === "provider-presets" && <PresetsPage {...props} />}
        {providerId && <ProviderDetail {...props} id={providerId} />}
        {route === "models" && <ModelsPage {...props} />}
        {route === "translation" && <TranslationPage {...props} />}
        {route === "translation-advanced" && <TranslationAdvanced {...props} />}
        {route === "summary" && <SummaryPage {...props} />}
        {route === "advanced" && <AdvancedPage {...props} />}
        {route === "about" && <AboutPage />}
      </div>
    </div>
  );
}

// ---------------- level 1 ----------------
function SettingsHome({ push, settings, update, providers }: Ctx) {
  const configured = providers.providers.filter((p) => providers.masked[p.id] || keyOptional(p));
  return (
    <>
      <SectionLabel>模型</SectionLabel>
      <Group>
        <Row icon={KeyRound} tone="indigo" title="模型服务" subtitle={configured.length ? `${configured.length} 个已接入 · ${configured.map((p) => p.name).join("、")}` : "添加 API Key 开始使用"} onClick={() => push("providers")} testId="nav-providers" />
        <Row icon={Cpu} tone="violet" title="默认模型" subtitle="对话、总结、翻译分别选择" onClick={() => push("models")} testId="nav-models" />
      </Group>
      <SectionLabel>功能</SectionLabel>
      <Group>
        <Row icon={Languages} tone="emerald" title="翻译" subtitle={`${langLabel(settings.translation.targetLang)} · ${STYLE_LABELS[settings.translation.style]}`} onClick={() => push("translation")} testId="nav-translation" />
        <Row icon={MessageSquareText} tone="sky" title="总结与对话" subtitle={{ short: "简短", medium: "适中", detailed: "详细" }[settings.summary.length] + "总结"} onClick={() => push("summary")} />
      </Group>
      <SectionLabel>外观</SectionLabel>
      <Card className="p-3">
        <div className="mb-2.5 flex items-center gap-3">
          <Palette className="size-4 text-zinc-400" />
          <span className="text-[13.5px] font-medium">主题</span>
        </div>
        <Segmented<ThemeMode>
          value={settings.theme}
          onChange={(v) => update((s) => ({ ...s, theme: v }))}
          options={[{ value: "system", label: "跟随系统", icon: Monitor }, { value: "light", label: "浅色", icon: Sun }, { value: "dark", label: "深色", icon: Moon }]}
        />
      </Card>
      <SectionLabel>其他</SectionLabel>
      <Group>
        <Row icon={SlidersHorizontal} title="高级" subtitle="网站权限、缓存、重置" onClick={() => push("advanced")} testId="nav-advanced" />
        <Row icon={Info} title="关于 PagePilot" subtitle={`版本 ${chrome.runtime.getManifest().version}`} onClick={() => push("about")} />
      </Group>
    </>
  );
}

// ---------------- providers ----------------
function ProvidersPage({ push, providers }: Ctx) {
  const list = providers.providers;
  return (
    <>
      {list.length === 0 ? (
        <Card className="mt-3 p-6 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-accent-soft dark:bg-accent/15"><KeyRound className="size-5 text-accent dark:text-indigo-300" /></div>
          <div className="mt-3 text-[14px] font-semibold">还没有接入模型</div>
          <div className="mt-1 text-[12.5px] leading-5 text-zinc-500">支持 OpenAI 兼容接口（DeepSeek、Kimi、通义、智谱、OpenRouter、Ollama…）以及 Anthropic、Gemini。</div>
        </Card>
      ) : (
        <>
          <SectionLabel>已添加</SectionLabel>
          <Group>
            {list.map((p) => {
              const ok = !!providers.masked[p.id] || keyOptional(p);
              return (
                <Row
                  key={p.id}
                  icon={ProviderGlyph(p.presetId)}
                  tone={ok ? "indigo" : "zinc"}
                  title={p.name}
                  subtitle={ok ? `${providers.masked[p.id] || "无需 Key"} · ${p.models.length} 个模型` : "未填写 API Key"}
                  right={<span className={cx("size-2 rounded-full", ok && p.enabled ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600")} />}
                  onClick={() => push(`provider:${p.id}`)}
                  testId={`provider-row-${p.presetId}`}
                />
              );
            })}
          </Group>
        </>
      )}
      <Button className="mt-4 w-full" icon={Plus} onClick={() => push("provider-presets")} testId="add-provider">添加模型服务</Button>
      <p className="mt-3 flex items-start gap-1.5 px-1 text-[11.5px] leading-5 text-zinc-400">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        API Key 只保存在本机（chrome.storage.local，不同步），只由扩展后台读取并直接发往你选择的服务商，网页脚本无法访问。
      </p>
    </>
  );
}

function ProviderGlyph(presetId: string) {
  return ({ anthropic: Brain, gemini: Zap, ollama: Database, custom: Globe2 } as Record<string, typeof KeyRound>)[presetId] ?? Cpu;
}

function PresetsPage({ push, pop, providers }: Ctx) {
  const add = async (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId)!;
    const p = newProviderFromPreset(preset);
    await providers.save([...providers.providers, p]);
    pop();
    push(`provider:${p.id}`);
  };
  const groups: [string, string[]][] = [
    ["常用", ["deepseek", "moonshot", "qwen", "zhipu", "openai"]],
    ["更多", ["anthropic", "gemini", "openrouter", "ollama", "custom"]],
  ];
  return (
    <>
      {groups.map(([label, ids]) => (
        <div key={label}>
          <SectionLabel>{label}</SectionLabel>
          <Group>
            {ids.map((id) => {
              const p = PRESETS.find((x) => x.id === id)!;
              return <Row key={id} icon={ProviderGlyph(id)} tone="indigo" title={p.name} subtitle={p.hint ?? (p.baseUrl.replace(/^https?:\/\//, "") || "")} right={<Plus className="size-4 text-zinc-400" />} chevron={false} onClick={() => add(id)} testId={`preset-${id}`} />;
            })}
          </Group>
        </div>
      ))}
    </>
  );
}

function ProviderDetail({ id, pop, providers }: Ctx & { id: string }) {
  const p = providers.providers.find((x) => x.id === id);
  const [draft, setDraft] = useState<ProviderConfig | null>(p ?? null);
  const [key, setKeyInput] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [fetching, setFetching] = useState(false);
  const [newModel, setNewModel] = useState("");
  const preset = PRESETS.find((x) => x.id === p?.presetId);

  useEffect(() => {
    getKey(id).then((k) => {
      setHasKey(!!k);
      setKeyInput(k ?? "");
    });
  }, [id]);
  if (!draft) return null;

  const persist = async (next: ProviderConfig) => {
    setDraft(next);
    await providers.save(providers.providers.map((x) => (x.id === id ? next : x)));
  };
  const saveKey = async () => {
    await setKey(id, key);
    setHasKey(!!key.trim());
    // Ask for the API origin up front so the worker can call it even if the provider has no CORS.
    try {
      const origin = new URL(normalizeBaseUrl(draft.baseUrl)).origin;
      await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      /* optional */
    }
  };
  const runTest = async () => {
    setTest({ state: "running" });
    await saveKey();
    try {
      const r = await bg<{ latencyMs: number; model: string; models: string[] }>({ type: "provider:test", provider: draft, modelId: draft.models[0] });
      setTest({ state: "ok", msg: `连接成功 · ${r.model} · ${r.latencyMs} ms` });
      if (r.models?.length && !draft.models.length) persist({ ...draft, models: r.models.slice(0, 50) });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    }
  };
  const fetchModels = async () => {
    setFetching(true);
    await saveKey();
    try {
      const models = await bg<string[]>({ type: "provider:models", provider: draft });
      if (models.length) {
        const keep = draft.models.filter((m) => models.includes(m));
        persist({ ...draft, models: [...new Set([...keep, ...models])].slice(0, 80) });
      }
      setTest({ state: "ok", msg: `获取到 ${models.length} 个模型` });
    } catch (e) {
      setTest({ state: "fail", msg: (e as Error).message });
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <SectionLabel>连接</SectionLabel>
      <Card>
        <TextField
          label="API Key"
          testId="api-key"
          type={show ? "text" : "password"}
          value={key}
          mono
          placeholder={preset?.keyOptional ? "可留空" : "sk-…"}
          onChange={setKeyInput}
          hint={preset?.keyUrl && <a className="text-accent hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">获取 Key</a>}
          right={<IconButton icon={show ? EyeOff : Eye} label={show ? "隐藏" : "显示"} onClick={() => setShow((v) => !v)} />}
        />
        <div className="h-px bg-zinc-100 dark:bg-white/[0.05]" />
        <TextField label="Base URL" testId="base-url" value={draft.baseUrl} mono placeholder="https://api.example.com/v1" onChange={(v) => setDraft({ ...draft, baseUrl: v })} />
        <div className="h-px bg-zinc-100 dark:bg-white/[0.05]" />
        <TextField label="显示名称" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
        <div className="flex gap-2 px-3.5 pb-3.5">
          <Button
            className="flex-1"
            testId="save-provider"
            icon={CheckCircle2}
            onClick={async () => {
              await persist({ ...draft, baseUrl: normalizeBaseUrl(draft.baseUrl) });
              await saveKey();
              setTest({ state: "ok", msg: "已保存" });
            }}
          >
            保存
          </Button>
          <Button variant="secondary" className="flex-1" testId="test-provider" icon={test.state === "running" ? Loader2 : Zap} onClick={runTest} disabled={test.state === "running" || (!key && !preset?.keyOptional)}>
            测试连接
          </Button>
        </div>
        {test.state !== "idle" && test.state !== "running" && (
          <div data-testid="test-result" className={cx("mx-3.5 mb-3.5 flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px]", test.state === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300")}>
            {test.state === "ok" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 break-words">{test.msg}</span>
          </div>
        )}
      </Card>
      {hasKey && <p className="px-1 pt-1.5 text-[11.5px] text-zinc-400">Key 已保存在本机。</p>}

      <div className="flex items-end justify-between">
        <SectionLabel>模型（{draft.models.length}）</SectionLabel>
        <button className="mb-1.5 flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-accent hover:bg-accent-soft dark:text-indigo-300 dark:hover:bg-accent/10" onClick={fetchModels} data-testid="fetch-models">
          <RefreshCw className={cx("size-3.5", fetching && "animate-spin")} /> 从服务商获取
        </button>
      </div>
      <Card>
        <div className="max-h-64 overflow-y-auto" data-testid="model-list">
          {draft.models.map((m, i) => (
            <div key={m} className={cx("group flex items-center gap-2 px-3.5 py-2.5", i > 0 && "border-t border-zinc-100 dark:border-white/[0.05]")}>
              <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{m}</span>
              {i === 0 && <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10.5px] text-zinc-500 dark:bg-white/10">默认</span>}
              <button className="text-zinc-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100" onClick={() => persist({ ...draft, models: draft.models.filter((x) => x !== m) })} aria-label="移除">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-zinc-100 p-2.5 dark:border-white/[0.05]">
          <input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="手动添加模型 ID" className="min-w-0 flex-1 rounded-lg bg-zinc-50 px-2.5 py-1.5 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-zinc-400 dark:bg-white/[0.04]" />
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => { if (newModel.trim()) { persist({ ...draft, models: [...new Set([...draft.models, newModel.trim()])] }); setNewModel(""); } }}>添加</Button>
        </div>
      </Card>

      <SectionLabel>状态</SectionLabel>
      <Group>
        <Row title="启用" subtitle="关闭后不会被自动选用" right={<Toggle checked={draft.enabled} onChange={(v) => persist({ ...draft, enabled: v })} />} />
        <Row title="删除此服务" danger chevron={false} right={<Trash2 className="size-4 text-rose-400" />} onClick={async () => { await deleteProvider(id); pop(); }} />
      </Group>
    </>
  );
}

// ---------------- models ----------------
function ModelsPage({ settings, update, providers, push }: Ctx) {
  const usable = (p: ProviderConfig) => !!providers.masked[p.id] || keyOptional(p);
  const opts = [
    { value: "auto", label: "自动（第一个可用模型）" },
    ...providers.providers.filter((p) => p.enabled && usable(p)).flatMap((p) => p.models.map((m) => ({ value: modelRef(p.id, m), label: m, group: p.name }))),
  ];
  const task = (k: keyof Settings["models"], title: string, desc: string, icon: typeof Cpu, tone: "indigo" | "sky" | "emerald") => {
    const r = resolveModelRef(settings.models[k], providers.providers, usable);
    return (
      <Row icon={icon} tone={tone} title={title} subtitle={r ? `当前：${r.modelId}` : desc} chevron={false}
        right={<Select testId={`model-${k}`} value={opts.some((o) => o.value === settings.models[k]) ? settings.models[k] : "auto"} options={opts} onChange={(v) => update((s) => ({ ...s, models: { ...s.models, [k]: v as ModelRef } }))} />} />
    );
  };
  return (
    <>
      <SectionLabel>按任务选择</SectionLabel>
      <Group>
        {task("chat", "对话", "未配置", MessageSquareText, "sky")}
        {task("summary", "总结", "未配置", Brain, "indigo")}
        {task("translate", "翻译", "建议选便宜快速的模型", Languages, "emerald")}
      </Group>
      <p className="px-1 pt-2 text-[11.5px] leading-5 text-zinc-400">默认都是“自动”：使用第一个已填 Key 的服务的默认模型。翻译量大，可单独选更便宜的模型。</p>
      {opts.length <= 1 && <Button className="mt-4 w-full" variant="secondary" icon={Plus} onClick={() => push("providers")}>先添加模型服务</Button>}
    </>
  );
}

// ---------------- translation ----------------
function TranslationPage({ settings, update, push }: Ctx) {
  const t = settings.translation;
  const set = (patch: Partial<Settings["translation"]>) => update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));
  return (
    <>
      <SectionLabel>目标语言</SectionLabel>
      <Group>
        <Row icon={Languages} tone="emerald" title="翻译为" chevron={false} right={<Select testId="target-lang" value={t.targetLang} onChange={(v) => set({ targetLang: v })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />} />
      </Group>
      <SectionLabel>译文样式</SectionLabel>
      <div className="grid grid-cols-2 gap-2" data-testid="style-grid">
        {(Object.keys(STYLE_LABELS) as TranslationStyle[]).map((st) => (
          <button key={st} onClick={() => set({ style: st })} data-testid={`style-${st}`}
            className={cx("rounded-2xl border bg-white p-3 text-left shadow-soft transition dark:bg-[#1a1a1f]", t.style === st ? "border-accent ring-2 ring-accent/15" : "border-zinc-200/70 hover:border-zinc-300 dark:border-white/[0.06]")}>
            <div className="text-[11.5px] leading-5 text-zinc-500">The quick brown fox.</div>
            <StylePreview style={st} />
            <div className="mt-2 text-[12px] font-medium">{STYLE_LABELS[st]}</div>
          </button>
        ))}
      </div>
      <SectionLabel>更多</SectionLabel>
      <Group>
        <Row icon={SlidersHorizontal} title="高级翻译选项" subtitle="批量大小、并发、缓存、提示词" onClick={() => push("translation-advanced")} testId="nav-translation-advanced" />
      </Group>
      <p className="px-1 pt-2 text-[11.5px] leading-5 text-zinc-400">快捷键 Alt+A 或右键菜单「翻译此页」也可切换双语对照。</p>
    </>
  );
}

function StylePreview({ style }: { style: TranslationStyle }) {
  const inner: Record<TranslationStyle, string> = {
    plain: "",
    dashed: "border-b-[1.5px] border-dashed border-indigo-400",
    faded: "opacity-60",
    highlight: "bg-[linear-gradient(transparent_55%,rgba(253,224,71,.6)_55%)]",
    card: "",
  };
  return (
    <div className={cx("mt-0.5 text-[12.5px] leading-5", style === "card" && "rounded-md border-l-2 border-indigo-400 bg-indigo-50 px-1.5 dark:bg-indigo-500/10")}>
      <span className={inner[style]}>敏捷的棕色狐狸。</span>
    </div>
  );
}

function NumberRow({ title, subtitle, value, min, max, step = 1, onChange }: { title: string; subtitle?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[14px] font-medium">{title}</div>
          {subtitle && <div className="mt-0.5 text-[12px] text-zinc-500">{subtitle}</div>}
        </div>
        <span className="rounded-lg bg-zinc-100 px-2 py-0.5 font-mono text-[12px] dark:bg-white/10">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2.5 w-full accent-[#5b5bf0]" />
    </div>
  );
}

function TranslationAdvanced({ settings, update }: Ctx) {
  const t = settings.translation;
  const d = defaultSettings().translation;
  const set = (patch: Partial<Settings["translation"]>) => update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => void bg<number>({ type: "cache:stats" }).then(setCount).catch(() => {}), []);
  return (
    <>
      <SectionLabel>请求</SectionLabel>
      <Group>
        <NumberRow title="每批最多字符" subtitle={`默认 ${d.batchMaxChars}`} value={t.batchMaxChars} min={400} max={6000} step={100} onChange={(v) => set({ batchMaxChars: v })} />
        <NumberRow title="每批最多段落" subtitle={`默认 ${d.batchMaxItems}`} value={t.batchMaxItems} min={1} max={50} onChange={(v) => set({ batchMaxItems: v })} />
        <NumberRow title="并发请求数" subtitle={`默认 ${d.concurrency}`} value={t.concurrency} min={1} max={8} onChange={(v) => set({ concurrency: v })} />
      </Group>
      <SectionLabel>行为</SectionLabel>
      <Group>
        <Row title="翻译动态加载的内容" subtitle="无限滚动、单页应用里新出现的段落" chevron={false} right={<Toggle checked={t.autoTranslateDynamic} onChange={(v) => set({ autoTranslateDynamic: v })} />} />
        <Row title="使用翻译缓存" subtitle={count == null ? "相同段落不再重复请求" : `已缓存 ${count} 段`} chevron={false} right={<Toggle checked={t.cacheEnabled} onChange={(v) => set({ cacheEnabled: v })} />} />
        <Row title="清空翻译缓存" chevron={false} right={<Trash2 className="size-4 text-zinc-400" />} onClick={async () => { await bg({ type: "cache:clear" }); setCount(0); }} />
      </Group>
      <SectionLabel>自定义</SectionLabel>
      <Card>
        <label className="block px-3.5 py-3">
          <div className="mb-1.5 text-[12px] font-medium text-zinc-500">额外提示词（术语、语气等）</div>
          <textarea value={t.extraPrompt} onChange={(e) => set({ extraPrompt: e.target.value })} rows={3} placeholder="例如：LLM 译为“大语言模型”，保持口语化" className="w-full resize-none rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-[13px] outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 dark:border-white/10 dark:bg-white/[0.03]" />
        </label>
        <div className="h-px bg-zinc-100 dark:bg-white/[0.05]" />
        <TextField label="跳过的元素（CSS 选择器）" mono value={t.skipSelectors} placeholder=".comments, footer" onChange={(v) => set({ skipSelectors: v })} />
      </Card>
      <Button variant="ghost" className="mt-3 w-full" icon={RotateCcw} onClick={() => update((s) => ({ ...s, translation: { ...d, targetLang: s.translation.targetLang, style: s.translation.style } }))}>恢复默认</Button>
    </>
  );
}

// ---------------- summary ----------------
function SummaryPage({ settings, update }: Ctx) {
  const sm = settings.summary;
  const set = (patch: Partial<Settings["summary"]>) => update((s) => ({ ...s, summary: { ...s.summary, ...patch } }));
  return (
    <>
      <SectionLabel>总结</SectionLabel>
      <Card className="p-3">
        <div className="mb-2.5 text-[13.5px] font-medium">篇幅</div>
        <Segmented<SummaryLength> value={sm.length} onChange={(v) => set({ length: v })} options={[{ value: "short", label: "简短" }, { value: "medium", label: "适中" }, { value: "detailed", label: "详细" }]} />
      </Card>
      <div className="h-2" />
      <Group>
        <Row title="总结语言" chevron={false} right={<Select value={sm.language} onChange={(v) => set({ language: v })} options={[{ value: "target", label: "同翻译目标语言" }, { value: "page", label: "与页面相同" }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]} />} />
        <NumberRow title="页面内容上限（字符）" subtitle="超出部分截断，越大越费 token" value={sm.maxContextChars} min={8000} max={200000} step={4000} onChange={(v) => set({ maxContextChars: v })} />
      </Group>
      <SectionLabel>对话</SectionLabel>
      <Group>
        <NumberRow title="温度" subtitle="越低越稳定" value={settings.chat.temperature} min={0} max={1.5} step={0.1} onChange={(v) => update((s) => ({ ...s, chat: { ...s.chat, temperature: Math.round(v * 10) / 10 } }))} />
        <NumberRow title="最大输出 tokens" value={settings.chat.maxTokens} min={512} max={16384} step={512} onChange={(v) => update((s) => ({ ...s, chat: { ...s.chat, maxTokens: v } }))} />
      </Group>
    </>
  );
}

// ---------------- advanced ----------------
function AdvancedPage({ update }: Ctx) {
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => void chrome.permissions.contains({ origins: ["<all_urls>"] }).then(setAll), []);
  return (
    <>
      <SectionLabel>网站访问</SectionLabel>
      <Group>
        <Row icon={Globe2} tone="sky" title="允许在所有网站上运行" subtitle={all ? "已授权：任意页面都可直接翻译和总结" : "默认只在你点击扩展时访问当前页"} chevron={false}
          right={<Toggle checked={all} onChange={async (v) => setAll(v ? await chrome.permissions.request({ origins: ["<all_urls>"] }) : !(await chrome.permissions.remove({ origins: ["<all_urls>"] })))} />} />
      </Group>
      <p className="px-1 pt-2 text-[11.5px] leading-5 text-zinc-400">不开启也能用：点击工具栏图标、右键菜单或快捷键时，Chrome 会临时授予当前标签页的访问权限。</p>
      <SectionLabel>数据</SectionLabel>
      <Group>
        <Row icon={RotateCcw} title="恢复默认设置" subtitle="不会删除模型服务和 Key" chevron={false} onClick={() => update(() => defaultSettings(chrome.i18n.getUILanguage()))} />
        {confirm ? (
          <div className="flex items-center gap-2 px-3.5 py-3">
            <span className="flex-1 text-[13px] text-rose-600">确认删除所有 Key、服务和缓存？</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
            <Button size="sm" variant="danger" onClick={async () => { await chrome.storage.local.clear(); await bg({ type: "cache:clear" }); setConfirm(false); }}>删除</Button>
          </div>
        ) : (
          <Row icon={Trash2} tone="rose" title="清除全部数据" danger chevron={false} onClick={() => setConfirm(true)} />
        )}
      </Group>
    </>
  );
}

function AboutPage() {
  return (
    <Card className="mt-3 p-5 text-center">
      <div className="flex justify-center"><Logo size={44} /></div>
      <div className="mt-3 text-[16px] font-semibold">PagePilot</div>
      <div className="text-[12px] text-zinc-400">v{chrome.runtime.getManifest().version}</div>
      <p className="mt-3 text-[12.5px] leading-5 text-zinc-500">网页双语翻译 + AI 总结。纯本地扩展，没有服务器；使用你自己的 API Key 直连模型服务商。</p>
    </Card>
  );
}

export type { ReactNode };
