import {
  ArrowUp, Check, Copy, FileText, Globe, KeyRound, Languages, Lightbulb, ListChecks, Loader2, Lock, RotateCcw, Settings as SettingsIcon, Sparkles, Square, SquarePen, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { keyOptional, resolveModelRef } from "@/src/lib/providers";
import { langLabel } from "@/src/lib/settings";
import type { ChatTurn, PageContent, ProviderConfig, Settings, TranslateState } from "@/src/lib/types";
import { Button, cx, IconButton } from "./components/ui";
import { Logo } from "./components/Logo";
import { useActiveTab } from "./hooks";
import { bg, llm } from "./messaging";
import type { Route } from "./pages/Settings";

interface Msg extends ChatTurn {
  id: string;
  kind?: "summary";
  status?: "streaming" | "thinking" | "done" | "error";
  model?: string;
  error?: string;
}

const restricted = (url: string) => !/^https?:|^file:/.test(url) || /^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/.test(url);

export function ChatView({ settings, providers, masked, openSettings }: { settings: Settings; providers: ProviderConfig[]; masked: Record<string, string>; openSettings: (...r: Route[]) => void }) {
  const tab = useActiveTab();
  const [convos, setConvos] = useState<Record<string, Msg[]>>({});
  const convKey = tab ? `${tab.id}` : "none";
  const messages = convos[convKey] ?? [];
  const setMessages = useCallback((fn: (m: Msg[]) => Msg[]) => setConvos((c) => ({ ...c, [convKey]: fn(c[convKey] ?? []) })), [convKey]);
  const [input, setInput] = useState("");
  const [usePage, setUsePage] = useState(true);
  const [busy, setBusy] = useState<{ abort: () => void } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [tstate, setTstate] = useState<TranslateState | null>(null);
  const pageCache = useRef(new Map<string, PageContent>());
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const chatModel = useMemo(() => resolveModelRef(settings.models.chat, providers, (p) => !!masked[p.id] || keyOptional(p)), [settings.models.chat, providers, masked]);
  const configured = !!chatModel;

  // translation status for the current tab
  useEffect(() => {
    if (!tab) return;
    setTstate(null);
    setPageError(null);
    if (!restricted(tab.url)) bg<TranslateState>({ type: "translate:status", tabId: tab.id }).then(setTstate).catch(() => {});
    const onMsg = (msg: { type?: string; state?: TranslateState }, sender: chrome.runtime.MessageSender) => {
      if (msg?.type === "translate:state" && sender.tab?.id === tab.id) setTstate(msg.state!);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [tab?.id, tab?.url]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function getPage(): Promise<PageContent | undefined> {
    if (!tab || restricted(tab.url)) return undefined;
    const k = `${tab.id}|${tab.url}`;
    if (pageCache.current.has(k)) return pageCache.current.get(k);
    try {
      const p = await bg<PageContent>({ type: "page:extract", tabId: tab.id });
      pageCache.current.set(k, p);
      setPageError(null);
      return p;
    } catch (e) {
      setPageError((e as Error).message);
      return undefined;
    }
  }

  async function grantSite() {
    if (!tab) return;
    try {
      const origin = new URL(tab.url).origin;
      const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (ok) setPageError(null);
    } catch {
      /* ignore */
    }
  }

  async function send(text: string, kind?: "summary") {
    if (!text.trim() || busy) return;
    if (!configured) return openSettings("providers");
    const user: Msg = { id: `u${Date.now()}`, role: "user", content: text.trim(), kind };
    const asst: Msg = { id: `a${Date.now()}`, role: "assistant", content: "", status: "streaming", kind };
    const history = [...messages.filter((m) => m.status !== "error"), user].map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, user, asst]);
    setInput("");
    const page = kind === "summary" || usePage ? await getPage() : undefined;
    if (kind === "summary" && !page) {
      setMessages((m) => m.map((x) => (x.id === asst.id ? { ...x, status: "error", error: "无法读取当前页面内容" } : x)));
      return;
    }
    const patch = (f: (x: Msg) => Msg) => setMessages((m) => m.map((x) => (x.id === asst.id ? f(x) : x)));
    const h = llm.chat({ task: kind ?? "chat", messages: history, page: page && { title: page.title, url: page.url, markdown: page.markdown } }, (e) => {
      if (e.type === "start") patch((x) => ({ ...x, model: e.model }));
      if (e.type === "thinking") patch((x) => ({ ...x, status: x.content ? x.status : "thinking" }));
      if (e.type === "delta") patch((x) => ({ ...x, status: "streaming", content: x.content + e.text }));
      if (e.type === "done") {
        patch((x) => ({ ...x, status: "done" }));
        setBusy(null);
      }
      if (e.type === "error") {
        patch((x) => ({ ...x, status: "error", error: e.message }));
        setBusy(null);
      }
    });
    setBusy({ abort: h.abort });
  }

  const summarize = () => send("总结此页", "summary");

  // context-menu "summarize" handoff
  useEffect(() => {
    if (!tab) return;
    chrome.storage.session.get("pendingAction").then((r) => {
      const a = r.pendingAction as { type: string; tabId: number; at: number } | undefined;
      if (a?.type === "summarize" && a.tabId === tab.id && Date.now() - a.at < 30000) {
        chrome.storage.session.remove("pendingAction");
        summarize();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id]);

  async function toggleTranslate() {
    if (!tab) return;
    if (!configured) return openSettings("providers");
    try {
      setTstate(await bg<TranslateState>({ type: "translate:toggle", tabId: tab.id }));
      setPageError(null);
    } catch (e) {
      setPageError((e as Error).message);
    }
  }

  const host = tab && !restricted(tab.url) ? new URL(tab.url).host : "";
  const needsGrant = !!pageError && /permission|Cannot access|must request/i.test(pageError);
  const translating = !!tstate?.active;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <Logo />
        <div className="text-[15px] font-semibold tracking-tight">PagePilot</div>
        <div className="flex-1" />
        <IconButton icon={Languages} label={translating ? "显示原文" : "翻译此页"} active={translating} onClick={toggleTranslate} testId="translate-toggle" />
        <IconButton icon={SquarePen} label="新对话" onClick={() => setMessages(() => [])} />
        <IconButton icon={SettingsIcon} label="设置" onClick={() => openSettings()} testId="open-settings" />
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!configured && <Onboarding onAdd={() => openSettings("providers", "provider-presets")} />}

        {messages.length === 0 ? (
          <EmptyState
            tabTitle={tab?.title}
            host={host}
            favicon={tab?.favIconUrl}
            disabled={!tab || restricted(tab.url)}
            translating={translating}
            targetLang={langLabel(settings.translation.targetLang)}
            onSummarize={summarize}
            onTranslate={toggleTranslate}
            onPrompt={(p) => send(p)}
          />
        ) : (
          <div className="space-y-5 pt-2">
            {messages.map((m) => (
              <MessageItem key={m.id} m={m} onRetry={() => send(messages[messages.indexOf(m) - 1]?.content ?? "", m.kind)} />
            ))}
          </div>
        )}
      </div>

      {/* status strips */}
      <div className="space-y-2 px-3">
        {pageError && (
          <div className="flex animate-in items-center gap-2 rounded-2xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
            <Lock className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{needsGrant ? `需要访问 ${host} 的权限才能读取或翻译此页` : pageError}</span>
            {needsGrant && <Button size="sm" variant="secondary" onClick={grantSite}>允许</Button>}
            <button onClick={() => setPageError(null)} className="text-amber-700/60 hover:text-amber-800"><X className="size-4" /></button>
          </div>
        )}
        {translating && (
          <div data-testid="translate-status" className="flex animate-in items-center gap-2 rounded-2xl bg-accent-soft px-3 py-2 text-[12.5px] text-indigo-700 dark:bg-accent/15 dark:text-indigo-200">
            {tstate!.done < tstate!.total ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            <span className="flex-1">
              {tstate!.done < tstate!.total ? `正在翻译 ${tstate!.done}/${tstate!.total}` : `已翻译为${langLabel(settings.translation.targetLang)} · ${tstate!.done} 段`}
              {tstate!.errors > 0 && <span className="text-rose-500"> · {tstate!.errors} 段失败</span>}
            </span>
            <button onClick={toggleTranslate} className="rounded-lg px-2 py-0.5 font-medium hover:bg-white/60 dark:hover:bg-white/10">显示原文</button>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 p-3 pt-2">
        <div className="rounded-[22px] border border-zinc-200/80 bg-white shadow-float transition focus-within:border-zinc-300 dark:border-white/[0.08] dark:bg-[#1c1c21] dark:focus-within:border-white/15">
          <textarea
            ref={ta}
            data-testid="composer"
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={host ? `问问关于这个页面的任何问题…` : "有什么可以帮你？"}
            className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-4 pt-3 text-[14px] leading-6 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <button
              type="button"
              onClick={() => setUsePage((v) => !v)}
              disabled={!host}
              className={cx(
                "flex h-7 max-w-[55%] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition",
                usePage && host ? "bg-zinc-100 text-ink dark:bg-white/10 dark:text-zinc-100" : "text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5",
              )}
              title="对话时附带当前页面内容"
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{host ? (usePage ? "引用此页" : "不引用页面") : "无页面"}</span>
            </button>
            <button type="button" onClick={() => openSettings("models")} className="flex h-7 min-w-0 items-center gap-1 truncate rounded-full px-2 text-[12px] text-zinc-400 transition hover:bg-zinc-50 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-300" data-testid="model-chip">
              <Sparkles className="size-3.5 shrink-0" />
              <span className="truncate">{chatModel ? chatModel.modelId : "未配置模型"}</span>
            </button>
            <div className="flex-1" />
            {busy ? (
              <button onClick={() => busy.abort()} className="grid size-8 place-items-center rounded-full bg-ink text-white transition hover:bg-zinc-700 dark:bg-white dark:text-ink" aria-label="停止">
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                data-testid="send"
                className="grid size-8 place-items-center rounded-full bg-ink text-white transition hover:bg-zinc-700 disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-white dark:text-ink dark:disabled:bg-white/10 dark:disabled:text-zinc-500"
                aria-label="发送"
              >
                <ArrowUp className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-3 animate-in overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4 dark:border-indigo-400/15 dark:from-indigo-500/10 dark:via-transparent dark:to-violet-500/10" data-testid="onboarding">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white shadow-soft dark:bg-white/10"><KeyRound className="size-[18px] text-accent dark:text-indigo-300" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">接入你的模型</div>
          <div className="mt-0.5 text-[12.5px] leading-5 text-zinc-500 dark:text-zinc-400">填一个 API Key 即可开始翻译和总结。Key 只保存在本机浏览器里。</div>
        </div>
      </div>
      <Button className="mt-3 w-full" onClick={onAdd} testId="onboarding-add">添加 API Key</Button>
    </div>
  );
}

function EmptyState(p: { tabTitle?: string; host: string; favicon?: string; disabled: boolean; translating: boolean; targetLang: string; onSummarize: () => void; onTranslate: () => void; onPrompt: (s: string) => void }) {
  const actions = [
    { icon: FileText, title: "总结此页", desc: "一键提炼要点", onClick: p.onSummarize, tone: "text-indigo-500", testId: "action-summarize" },
    { icon: Languages, title: p.translating ? "显示原文" : "双语翻译", desc: p.translating ? "移除译文" : `译为${p.targetLang}`, onClick: p.onTranslate, tone: "text-emerald-500", testId: "action-translate" },
    { icon: ListChecks, title: "提取要点", desc: "列出关键信息", onClick: () => p.onPrompt("提取这个页面的关键信息和数据，用要点列出。"), tone: "text-amber-500" },
    { icon: Lightbulb, title: "解释概念", desc: "通俗讲明白", onClick: () => p.onPrompt("用通俗易懂的方式解释这个页面里最重要的几个概念。"), tone: "text-sky-500" },
  ];
  return (
    <div className="animate-in pt-8">
      <div className="px-1">
        <div className="text-[22px] font-semibold tracking-tight">你好 👋</div>
        <div className="mt-1 text-[14px] text-zinc-500 dark:text-zinc-400">我可以帮你读懂、翻译和总结这个页面。</div>
      </div>
      {p.host && (
        <div className="mt-5 flex items-center gap-2.5 rounded-2xl border border-zinc-200/70 bg-white px-3 py-2.5 shadow-soft dark:border-white/[0.06] dark:bg-[#1a1a1f]" data-testid="page-chip">
          {p.favicon ? <img src={p.favicon} className="size-4 rounded" alt="" /> : <Globe className="size-4 text-zinc-400" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{p.tabTitle || p.host}</div>
            <div className="truncate text-[11.5px] text-zinc-400">{p.host}</div>
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <button
            key={a.title}
            data-testid={a.testId}
            disabled={p.disabled}
            onClick={a.onClick}
            className="group rounded-2xl border border-zinc-200/70 bg-white p-3.5 text-left shadow-soft transition hover:-translate-y-px hover:border-zinc-300 hover:shadow-float disabled:pointer-events-none disabled:opacity-50 dark:border-white/[0.06] dark:bg-[#1a1a1f] dark:hover:border-white/15"
          >
            <a.icon className={cx("size-5", a.tone)} strokeWidth={1.9} />
            <div className="mt-2.5 text-[13.5px] font-medium">{a.title}</div>
            <div className="mt-0.5 text-[12px] text-zinc-400">{a.desc}</div>
          </button>
        ))}
      </div>
      {p.disabled && <div className="mt-4 text-center text-[12px] text-zinc-400">此页面（浏览器内部页面）无法读取，你仍可以直接提问。</div>}
    </div>
  );
}

function MessageItem({ m, onRetry }: { m: Msg; onRetry: () => void }) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user")
    return (
      <div className="flex animate-in justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-md bg-zinc-100 px-3.5 py-2 text-[14px] leading-6 dark:bg-white/[0.08]">
          {m.kind === "summary" ? (
            <span className="flex items-center gap-1.5"><FileText className="size-3.5 text-indigo-500" />{m.content}</span>
          ) : (
            m.content
          )}
        </div>
      </div>
    );
  return (
    <div className="animate-in" data-testid="assistant-message" data-status={m.status}>
      {m.status === "error" ? (
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300">
          {m.content && <div className="md mb-2 opacity-80"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>}
          <div className="flex items-center gap-2"><span className="flex-1">{m.error}</span><Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry}>重试</Button></div>
        </div>
      ) : !m.content ? (
        <div className="flex items-center gap-2 py-1 text-[13px] text-zinc-400">
          <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-zinc-300 dark:bg-zinc-600" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
          {m.status === "thinking" ? "思考中…" : m.kind === "summary" ? "正在阅读页面…" : ""}
        </div>
      ) : (
        <div className={cx("md", m.status === "streaming" && "caret")} data-testid="assistant-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>{m.content}</ReactMarkdown>
        </div>
      )}
      {m.status === "done" && (
        <div className="mt-1.5 flex items-center gap-1 text-zinc-400">
          <button
            className="grid size-7 place-items-center rounded-lg hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/8"
            title="复制"
            onClick={() => {
              navigator.clipboard.writeText(m.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
          <button className="grid size-7 place-items-center rounded-lg hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-white/8" title="重新生成" onClick={onRetry}>
            <RotateCcw className="size-3.5" />
          </button>
          {m.model && <span className="ml-1 truncate text-[11px]">{m.model}</span>}
        </div>
      )}
    </div>
  );
}
