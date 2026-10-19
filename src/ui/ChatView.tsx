import {
  ArrowUp, Check, Info, ChevronDown, Copy, Crosshair, FileText, Globe, History, KeyRound, Languages, ListChecks, Loader2, Lock, Plus, RotateCcw, Settings2, Square, Trash2, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeMarkdown } from "./Markdown";
import { ConversationStore, type Conversation } from "@/src/lib/db";
import { DEFAULT_KEYPOINTS_TEMPLATE } from "@/src/lib/prompts";
import { keyOptional, modelRef, resolveModelRef } from "@/src/lib/providers";
import { LANGUAGES, langLabel } from "@/src/lib/settings";
import type { ChatTurn, DisplayMode, PageContent, ProviderConfig, Settings, TranslateState } from "@/src/lib/types";
import { Button, cn, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, IconButton, Popover, PopoverContent, PopoverTrigger, Segmented, Select, Switch, useToast } from "./components/ui";
import { Logo } from "./components/Logo";
import { useActiveTab, type TabInfo } from "./hooks";
import { bg, llm } from "./messaging";
import { tr } from "@/src/i18n";

interface Msg extends ChatTurn {
  id: string;
  kind?: "summary";
  status?: "streaming" | "thinking" | "done" | "error";
  model?: string;
  error?: string;
  progress?: { done: number; total: number };
  coverage?: number; // % of a very long page that the summary covers (only set when truncated)
}

const store = new ConversationStore();
const restricted = (url: string) => !/^https?:|^file:/.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ChatView({ settings, update, providers, masked, onSetup }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void; providers: ProviderConfig[]; masked: Record<string, string>; onSetup: () => void }) {
  const tab = useActiveTab();
  const toast = useToast();
  const [convs, setConvs] = useState<Record<string, { id: string; messages: Msg[] }>>({});
  const tabKey = tab ? `${tab.id}` : "none";
  const conv = convs[tabKey] ?? { id: "", messages: [] };
  const messages = conv.messages;
  const setMessages = useCallback(
    (fn: (m: Msg[]) => Msg[]) => setConvs((c) => ({ ...c, [tabKey]: { id: c[tabKey]?.id || newId(), messages: fn(c[tabKey]?.messages ?? []) } })),
    [tabKey],
  );
  const [input, setInput] = useState("");
  const [usePage, setUsePage] = useState(true);
  const [busy, setBusy] = useState<{ abort: () => void } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [tstate, setTstate] = useState<TranslateState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pageCache = useRef(new Map<string, PageContent>());
  const scroller = useRef<HTMLDivElement>(null);

  const usable = (p: ProviderConfig) => !!masked[p.id] || keyOptional(p);
  const chatModel = useMemo(() => resolveModelRef(settings.models.chat, providers, usable), [settings.models.chat, providers, masked]);
  const configured = !!chatModel;

  useEffect(() => {
    if (!tab) return;
    setTstate(null);
    setPageError(null);
    if (!tab.url || !restricted(tab.url)) bg<TranslateState>({ type: "translate:status", tabId: tab.id }).then(setTstate).catch(() => {});
    const onMsg = (msg: { type?: string; state?: TranslateState }, sender: chrome.runtime.MessageSender) => {
      if (msg?.type === "translate:state" && sender.tab?.id === tab.id) setTstate(msg.state!);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, [tab?.id, tab?.url]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // persist finished conversations (history)
  useEffect(() => {
    if (!tab || !conv.id || !messages.length || messages.some((m) => m.status === "streaming" || m.status === "thinking")) return;
    const now = Date.now();
    store.put({
      id: conv.id, url: tab.url, title: tab.title || tab.url, host: restricted(tab.url) ? "" : new URL(tab.url).host,
      messages: messages.filter((m) => m.status !== "error").map(({ role, content, kind, model }) => ({ role, content, kind, model })), createdAt: now, updatedAt: now,
    }).catch(() => {});
  }, [messages, conv.id]);

  async function getPage(): Promise<PageContent | undefined> {
    if (!tab || (tab.url && restricted(tab.url))) return undefined; // url "" = hidden (no access yet), still worth trying
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
    // Without host access Chrome hides tab.url, so an origin-specific request is only possible when we know it.
    if (!tab || !/^https?:|^file:/.test(tab.url)) return;
    const ok = await chrome.permissions.request({ origins: [`${new URL(tab.url).origin}/*`] }).catch(() => false);
    if (ok) setPageError(null);
  }

  async function send(text: string, kind?: "summary") {
    if (!text.trim() || busy) return;
    if (!configured) return onSetup();
    const user: Msg = { id: `u${Date.now()}`, role: "user", content: text.trim(), kind };
    const asst: Msg = { id: `a${Date.now()}`, role: "assistant", content: "", status: "streaming", kind };
    const history = [...messages.filter((m) => m.status !== "error"), user].map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, user, asst]);
    setInput("");
    const page = kind === "summary" || usePage ? await getPage() : undefined;
    const patch = (f: (x: Msg) => Msg) => setMessages((m) => m.map((x) => (x.id === asst.id ? f(x) : x)));
    if (kind === "summary" && !page) return patch((x) => ({ ...x, status: "error", error: tr("chat.cannotReadPage") }));
    const h = llm.chat({ task: kind ?? "chat", messages: history, page: page && { title: page.title, url: page.url, markdown: page.markdown, length: page.length } }, (e) => {
      if (e.type === "start") patch((x) => ({ ...x, model: e.model }));
      if (e.type === "progress") patch((x) => ({ ...x, progress: { done: e.done, total: e.total } }));
      if (e.type === "coverage") patch((x) => ({ ...x, coverage: e.percent }));
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
  const summarize = () => send(tr("chat.summarizePage"), "summary");

  // hand-offs from the page (context menu "summarize", selection card "ask in panel")
  useEffect(() => {
    if (!tab) return;
    const consume = async () => {
      const r = await chrome.storage.session.get("pendingAction");
      const a = r.pendingAction as { type: string; tabId: number; at: number; text?: string } | undefined;
      if (!a || a.tabId !== tab.id || Date.now() - a.at > 120_000) return; // 2 min: long enough to click the toolbar icon after the fallback toast
      await chrome.storage.session.remove("pendingAction");
      if (a.type === "summarize") summarize();
      if (a.type === "ask" && a.text) setInput(tr("chat.askAbout", { quote: a.text.replace(/\n/g, "\n> ") }));
    };
    consume();
    const onCh = (ch: Record<string, chrome.storage.StorageChange>, area: string) => area === "session" && ch.pendingAction?.newValue && consume();
    chrome.storage.onChanged.addListener(onCh);
    return () => chrome.storage.onChanged.removeListener(onCh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id]);

  async function toggleTranslate() {
    if (!tab) return;
    if (!configured) return onSetup();
    try {
      setTstate(await bg<TranslateState>({ type: "translate:toggle", tabId: tab.id }));
      setPageError(null);
    } catch (e) {
      setPageError((e as Error).message);
    }
  }

  async function locate(text: string) {
    if (!tab) return;
    try {
      const r = await bg<{ found: boolean }>({ type: "page:locate", tabId: tab.id, text });
      if (!r.found) toast({ text: tr("chat.citationNotFound"), tone: "info" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  }

  const host = tab && !restricted(tab.url) ? new URL(tab.url).host : "";
  // Without host access (or after an activeTab grant expired) Chrome hides tab.url: the page is still usable once
  // granted, so actions stay enabled and fail into the "grant" strip instead of looking like a browser-internal page.
  const urlHidden = !!tab && !tab.url;
  const pageOk = !!host || urlHidden;
  const needsGrant = !!pageError && /permission|Cannot access|must request/i.test(pageError);
  const translating = !!tstate?.active;
  const allModels = providers.filter((p) => p.enabled && usable(p)).map((p) => ({ p, models: p.models }));

  return (
    <div className="flex h-full flex-col">
      {/* top bar: logo · model switch · new · history · settings */}
      <header className="flex h-12 shrink-0 items-center gap-1 px-2.5">
        <Logo size={24} />
        <Dropdown>
          <DropdownTrigger asChild>
            <button data-testid="model-switch" className="ml-1 flex h-8 min-w-0 max-w-[48%] items-center gap-1 rounded-btn px-2 text-[13.5px] font-semibold outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              <span className="truncate">{chatModel ? chatModel.modelId : tr("chat.noModel")}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownTrigger>
          <DropdownContent testId="model-menu">
            {allModels.length === 0 && <DropdownItem icon={KeyRound} onSelect={onSetup}>{tr("chat.addKey")}</DropdownItem>}
            {allModels.map(({ p, models }) => (
              <div key={p.id}>
                <DropdownLabel>{p.name}</DropdownLabel>
                {models.map((m) => (
                  <DropdownItem key={m} testId={`model-option-${m}`} checked={chatModel?.provider.id === p.id && chatModel.modelId === m}
                    onSelect={() => update((s) => ({ ...s, models: { ...s.models, chat: modelRef(p.id, m), summary: modelRef(p.id, m) } }))}>
                    {m}
                  </DropdownItem>
                ))}
              </div>
            ))}
            <DropdownSeparator />
            <DropdownItem icon={Settings2} onSelect={() => chrome.runtime.openOptionsPage()}>{tr("chat.manageModels")}</DropdownItem>
          </DropdownContent>
        </Dropdown>
        <div className="flex-1" />
        <IconButton icon={Languages} label={translating ? tr("chat.showOriginal") : tr("chat.translatePage")} active={translating} onClick={toggleTranslate} testId="translate-toggle" disabled={!pageOk} />
        <IconButton icon={Plus} label={tr("chat.newChat")} onClick={() => setConvs((c) => ({ ...c, [tabKey]: { id: newId(), messages: [] } }))} testId="new-chat" />
        <IconButton icon={History} label={tr("chat.history")} onClick={() => setHistoryOpen(true)} testId="open-history" />
        <QuickSettings settings={settings} update={update} tab={tab} host={host} />
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {pageOk && (
          <div className="mt-1 flex items-center gap-2.5 rounded-card bg-card px-3 py-2.5" data-testid="page-chip">
            {tab?.favIconUrl ? <img src={tab.favIconUrl} className="size-4 rounded-[4px]" alt="" /> : <Globe className="size-4 text-muted-foreground" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{tab?.title || host || tr("chat.currentPage")}</div>
              <div className="truncate text-[12px] text-muted-foreground">{host || tr("chat.noAccessYet")}</div>
            </div>
          </div>
        )}
        {messages.length === 0 ? (
          <EmptyState host={host} pageOk={pageOk} translating={translating} targetLang={langLabel(settings.translation.targetLang)} onSummarize={summarize} onTranslate={toggleTranslate}
            onKeyPoints={() => send(settings.prompts.keyPoints.trim() || DEFAULT_KEYPOINTS_TEMPLATE)} />
        ) : (
          <div className="space-y-5 pt-4">
            {messages.map((m, i) => <MessageItem key={m.id} m={m} onRetry={() => send(messages[i - 1]?.content ?? "", m.kind)} onLocate={locate} />)}
          </div>
        )}
      </div>

      <div className="space-y-2 px-3">
        {!configured && (
          <div data-testid="nokey-banner" className="flex animate-in items-center gap-2 rounded-card bg-primary-soft px-3 py-2 text-[12.5px] text-primary-soft-foreground">
            <KeyRound className="size-4 shrink-0" />
            <span className="flex-1">{tr("chat.noKeyBanner")}</span>
            <Button size="sm" onClick={onSetup} testId="nokey-setup">{tr("chat.goSetup")}</Button>
          </div>
        )}
        {pageError && (
          <div data-testid="page-error" data-needs-grant={needsGrant ? "" : undefined} className="flex animate-in items-center gap-2 rounded-card bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-800 dark:text-amber-200">
            <Lock className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {!needsGrant ? pageError : host ? tr("chat.needHost", { host: host }) : tr("chat.needAccessClickIcon")}
            </span>
            {needsGrant && host && <Button size="sm" variant="outline" onClick={grantSite} testId="grant-site">{tr("chat.allow")}</Button>}
            <button onClick={() => setPageError(null)} className="opacity-60 hover:opacity-100" aria-label={tr("common.close")}><X className="size-4" /></button>
          </div>
        )}
        {translating && (
          <div data-testid="translate-status" className="flex animate-in items-center gap-2 rounded-card bg-card px-3 py-2 text-[12.5px]">
            {tstate!.done < tstate!.total ? <Loader2 className="size-4 animate-spin text-primary" /> : <Check className="size-4 text-primary" />}
            <span className="flex-1 text-muted-foreground">
              {tstate!.done < tstate!.total ? tr("chat.translating", { done: tstate!.done, total: tstate!.total }) : tr("chat.translatedTo", { lang: langLabel(settings.translation.targetLang), done: tstate!.done })}
              {tstate!.errors > 0 && <span className="text-destructive"> · {tstate!.errors} {tr("chat.failedSuffix")}</span>}
            </span>
            <button onClick={toggleTranslate} className="rounded-sm px-2 py-0.5 font-medium text-foreground hover:bg-muted">{tr("chat.showOriginal")}</button>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 p-3 pt-2">
        <div className="rounded-card bg-card transition focus-within:ring-2 focus-within:ring-ring">
          <textarea
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
            placeholder={tr("chat.placeholder")}
            className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 text-[14px] leading-6 outline-none placeholder:text-muted-foreground/70"
          />
          <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
            <button type="button" onClick={() => setUsePage((v) => !v)} disabled={!pageOk} data-testid="use-page" data-on={usePage && pageOk ? "" : undefined}
              className={cn("flex h-7 items-center gap-1.5 rounded-btn px-2.5 text-[12px] font-medium transition", usePage && pageOk ? "bg-background text-foreground" : "text-muted-foreground hover:bg-muted")}>
              <FileText className="size-3.5" />
              {tr("chat.usePage")}
              {usePage && pageOk && <Check className="size-3.5 text-primary" strokeWidth={2.6} />}
            </button>
            <div className="flex-1" />
            {busy ? (
              <button onClick={() => busy.abort()} className="grid size-8 place-items-center rounded-btn bg-foreground text-background transition hover:opacity-85" aria-label={tr("chat.stop")} data-testid="stop">
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button onClick={() => send(input)} disabled={!input.trim()} data-testid="send" aria-label={tr("chat.send")}
                className="grid size-8 place-items-center rounded-btn bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-input disabled:text-muted-foreground">
                <ArrowUp className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      {historyOpen && (
        <HistoryDrawer
          onClose={() => setHistoryOpen(false)}
          onOpen={(c) => {
            setConvs((x) => ({ ...x, [tabKey]: { id: c.id, messages: c.messages.map((m, i) => ({ ...m, kind: m.kind as Msg["kind"], id: `${c.id}-${i}`, status: m.role === "assistant" ? "done" : undefined })) } }));
            setHistoryOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Level-1 settings: a popover with only the most frequently changed switches. */
function QuickSettings({ settings, update, tab, host }: { settings: Settings; update: (fn: (s: Settings) => Settings) => void; tab: TabInfo | null; host: string }) {
  const t = settings.translation;
  const auto = !!host && t.autoSites.includes(host);
  const setT = (patch: Partial<Settings["translation"]>) => update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));
  async function toggleAuto(on: boolean) {
    if (!host || !tab) return;
    if (on) {
      const ok = await chrome.permissions.request({ origins: [`${new URL(tab.url).origin}/*`] }).catch(() => false);
      if (!ok) return;
    }
    setT({ autoSites: on ? [...new Set([...t.autoSites, host])] : t.autoSites.filter((h) => h !== host), neverSites: t.neverSites.filter((h) => h !== host) });
    if (on) bg({ type: "translate:toggle", tabId: tab.id, force: true }).catch(() => {});
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton icon={Settings2} label={tr("qs.title")} testId="open-quick-settings" />
      </PopoverTrigger>
      <PopoverContent testId="quick-settings">
        <div className="space-y-3.5">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{tr("qs.targetLang")}</div>
            <Select testId="qs-target-lang" value={t.targetLang} onChange={(v) => setT({ targetLang: v })} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">{tr("qs.displayMode")}</div>
            <Segmented<DisplayMode> testId="qs-display-mode" value={t.displayMode} onChange={(v) => setT({ displayMode: v })} options={[{ value: "bilingual", label: tr("mode.bilingual") }, { value: "translation-only", label: tr("mode.only") }]} />
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{tr("qs.autoSite")}</div>
              <div className="truncate text-[12px] text-muted-foreground">{host || tr("qs.unsupportedPage")}</div>
            </div>
            <Switch testId="qs-auto-site" checked={auto} onChange={toggleAuto} label={tr("qs.autoSite")} />
          </div>
          <div className="h-px bg-border/70" />
          <button data-testid="qs-more" onClick={() => chrome.runtime.openOptionsPage()} className="flex w-full items-center justify-between rounded-btn px-1 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            {tr("qs.more")} <span aria-hidden>→</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState(p: { host: string; pageOk: boolean; translating: boolean; targetLang: string; onSummarize: () => void; onTranslate: () => void; onKeyPoints: () => void }) {
  const chips = [
    { icon: FileText, label: tr("chat.summarizePage"), onClick: p.onSummarize, testId: "action-summarize" },
    { icon: Languages, label: p.translating ? tr("chat.showOriginal") : tr("chat.translatePage"), onClick: p.onTranslate, testId: "action-translate" },
    { icon: ListChecks, label: tr("chat.keyPoints"), onClick: p.onKeyPoints, testId: "action-keypoints" },
  ];
  return (
    <div className="animate-in pt-10">
      <div className="px-1">
        <div className="text-[22px] font-semibold tracking-tight">{tr("chat.emptyTitle")}</div>
        <div className="mt-1.5 text-[13.5px] leading-6 text-muted-foreground">{p.pageOk ? tr("chat.emptyDesc", { lang: p.targetLang }) : tr("chat.emptyRestricted")}</div>
      </div>
      {p.pageOk && (
        <div className="mt-5 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.label} data-testid={c.testId} onClick={c.onClick}
              className="flex h-9 items-center gap-1.5 rounded-btn bg-card px-3 text-[13px] font-medium transition hover:bg-card-strong active:scale-[0.98]">
              <c.icon className="size-4 text-primary" strokeWidth={1.9} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageItem({ m, onRetry, onLocate }: { m: Msg; onRetry: () => void; onLocate: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const footnotes = () => [...(ref.current?.querySelectorAll("section[data-footnotes] li") ?? [])].map((li) => li.textContent?.replace(/↩\s*$/, "").trim() ?? "");
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const refA = el.closest("a[data-footnote-ref]") as HTMLAnchorElement | null;
    const li = el.closest("section[data-footnotes] li") as HTMLLIElement | null;
    if (refA) {
      e.preventDefault();
      const id = decodeURIComponent(refA.getAttribute("href")?.slice(1) ?? "");
      const target = ref.current?.querySelector(`[id="${CSS.escape(id)}"]`);
      if (target?.textContent) onLocate(target.textContent.replace(/↩\s*$/, "").trim());
    } else if (li) {
      e.preventDefault();
      onLocate(li.textContent?.replace(/↩\s*$/, "").trim() ?? "");
    }
  };
  if (m.role === "user")
    return (
      <div className="flex animate-in justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-[6px] bg-primary-soft px-3.5 py-2 text-[14px] leading-6 text-foreground">
          {m.kind === "summary" ? <span className="flex items-center gap-1.5"><FileText className="size-3.5 text-primary" />{m.content}</span> : m.content}
        </div>
      </div>
    );
  return (
    <div className="animate-in" data-testid="assistant-message" data-status={m.status}>
      {m.status === "error" ? (
        <div className="rounded-card bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
          {m.content && <div className="md mb-2 opacity-80"><SafeMarkdown>{m.content}</SafeMarkdown></div>}
          <div className="flex items-center gap-2"><span className="flex-1" data-testid="assistant-error">{m.error}</span><Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry}>{tr("common.retry")}</Button></div>
        </div>
      ) : !m.content ? (
        <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
          <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
          {m.progress && m.progress.total > 1 ? tr("chat.readingSections", { done: m.progress.done, total: m.progress.total }) : m.status === "thinking" ? tr("chat.thinking") : m.kind === "summary" ? tr("chat.readingPage") : ""}
        </div>
      ) : (
        <div ref={ref} onClick={onClick} className={cn("md", m.status === "streaming" && "caret")} data-testid="assistant-content">
          <SafeMarkdown>{m.content}</SafeMarkdown>
        </div>
      )}
      {m.coverage != null && (
        <div data-testid="coverage-notice" className="mt-2 flex items-center gap-1.5 rounded-[10px] bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {m.kind === "summary" ? tr("chat.coverageSummary", { percent: m.coverage }) : tr("chat.coverageChat", { percent: m.coverage })}
        </div>
      )}
      {m.status === "done" && (
        <div className="mt-1.5 flex items-center gap-0.5 text-muted-foreground">
          <ActionBtn title={tr("common.copy")} onClick={() => { navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </ActionBtn>
          <ActionBtn title={tr("chat.regenerate")} onClick={onRetry}><RotateCcw className="size-3.5" /></ActionBtn>
          {/\[\^\d+\]/.test(m.content) && <ActionBtn title={tr("chat.locateCitation")} onClick={() => { const f = footnotes()[0]; if (f) onLocate(f); }} testId="locate-citation"><Crosshair className="size-3.5" /></ActionBtn>}
          {m.model && <span className="ml-1 truncate text-[11.5px]">{m.model}</span>}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ children, title, onClick, testId }: { children: React.ReactNode; title: string; onClick: () => void; testId?: string }) {
  return <button className="grid size-7 place-items-center rounded-sm transition hover:bg-muted hover:text-foreground" title={title} aria-label={title} onClick={onClick} data-testid={testId}>{children}</button>;
}

function HistoryDrawer({ onClose, onOpen }: { onClose: () => void; onOpen: (c: Conversation) => void }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const load = () => store.list(100).then(setList);
  useEffect(() => void load(), []);
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background" data-testid="history">
      <header className="flex h-12 items-center gap-2 px-3">
        <History className="size-[18px] text-muted-foreground" />
        <div className="flex-1 text-[14px] font-semibold">{tr("chat.history")}</div>
        <IconButton icon={X} label={tr("common.close")} onClick={onClose} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {list?.length === 0 && <div className="pt-16 text-center text-[13px] text-muted-foreground">{tr("chat.historyEmpty")}</div>}
        <div className="space-y-1.5">
          {list?.map((c) => (
            <div key={c.id} className="group flex items-center gap-2 rounded-card bg-card px-3 py-2.5 transition hover:bg-card-strong">
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(c)} data-testid="history-item">
                <div className="truncate text-[13px] font-medium">{c.messages.find((m) => m.role === "user")?.content || c.title}</div>
                <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{c.host || tr("chat.noPage")} · {new Date(c.updatedAt).toLocaleString()}</div>
              </button>
              <button className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100" aria-label={tr("common.delete")} onClick={async () => { await store.delete(c.id); load(); }}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
