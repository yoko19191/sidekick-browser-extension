import {
  ArrowRight, ArrowUp, Check, Info, ChevronDown, Copy, Crosshair, FileText, Globe, History, KeyRound, Languages, ListChecks, Loader2, Lock, MessageSquarePlus, Moon, Plus, RotateCcw, ScanText, Settings2, Sparkles, Square, Sun, TextQuote, Trash2, Video, X,
} from "lucide-react";
import { AgentRun } from "./AgentRun";
import type { RunOutcome } from "@/src/agent/loop";
import type { StepRecord } from "@/src/agent/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SafeMarkdown } from "./Markdown";
import { ConversationStore, type Conversation } from "@/src/lib/db";
import { DEFAULT_KEYPOINTS_TEMPLATE, deriveChatTitle, displayPageTitle } from "@/src/lib/prompts";
import { keyOptional, modelRef, resolveModelRef } from "@/src/lib/providers";
import { langLabel } from "@/src/lib/settings";
import { LONG_TEXT_PASTE_THRESHOLD, type ChatAttachment, type ChatTurn, type ProviderConfig, type Settings, type TranslateState } from "@/src/lib/types";
import { Button, cn, Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger, IconButton, useToast } from "./components/ui";
import { ProviderIcon } from "./components/ProviderIcon";
import { Mascot, type MascotState } from "./mascot/Mascot";
import { useActiveTab, type TabInfo, type useProviders } from "./hooks";
import { SidebarSettings, type SidebarSettingsPage } from "./SidebarSettings";
import { pageErrorOf, restrictedUrl as restricted, usePageContent } from "./usePageContent";
import { isFileUrl } from "@/src/lib/pdf/bytes";
import { isVideoWatchUrl } from "@/src/lib/video-subtitles";
import { bg, llm } from "./messaging";
import { tr } from "@/src/i18n";

interface Msg extends ChatTurn {
  id: string;
  kind?: "summary" | "agent";
  status?: "streaming" | "thinking" | "done" | "error";
  model?: string;
  error?: string;
  progress?: { done: number; total: number };
  /** PDF pages read so far, while the PDF is being parsed for this answer. */
  pdfProgress?: { done: number; total: number };
  coverage?: number; // % of a very long page that the summary covers (only set when truncated)
  /** true: chat on a long page answered from retrieved excerpts (coverage = their share); false: from the head. */
  retrieved?: boolean;
  /** Inline Browser-Use Agent run state embedded in the conversation stream. */
  agentRun?: {
    tabId: number;
    task: string;
    key: number;
    steps?: StepRecord[];
    outcome?: RunOutcome;
  };
}

const store = new ConversationStore();
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatPastedFileName(ext: string, prefix = "pasted", d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hms = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}-${ymd}-${hms}.${ext.replace(/^\./, "")}`;
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface ConvEntry {
  id: string;
  messages: Msg[];
  chatTitle?: string;
  pageTitle?: string;
  pageUrl?: string;
  favIconUrl?: string;
}

export function ChatView({
  settings,
  update,
  providers,
  masked,
  providersObj,
  onSetup,
}: {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  providers: ProviderConfig[];
  masked: Record<string, string>;
  providersObj: ReturnType<typeof useProviders>;
  onSetup: () => void;
}) {
  const tab = useActiveTab();
  const toast = useToast();
  const [convs, setConvs] = useState<Record<string, ConvEntry>>({});
  // Keep the sidebar conversation pinned across tab switches so Agent runs and multi-page browsing never reset the panel UI.
  const tabKey = "active";
  const conv = convs[tabKey] ?? { id: "", messages: [] };
  const messages = conv.messages;
  const setMessages = useCallback(
    (fn: (m: Msg[]) => Msg[]) => setConvs((c) => ({ ...c, [tabKey]: { ...c[tabKey], id: c[tabKey]?.id || newId(), messages: fn(c[tabKey]?.messages ?? []) } })),
    [tabKey],
  );
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previewAtt, setPreviewAtt] = useState<ChatAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [usePage, setUsePage] = useState(true);
  const [busy, setBusy] = useState<{ abort: () => void } | null>(null);
  const page = usePageContent(tab);
  const pageError = page.error;
  const setPageError = (text: string | null) => page.setError(text === null ? null : { text });
  /** A failed page call: permission-shaped errors get the matching fix button. */
  const failPage = (e: unknown) => page.setError(pageErrorOf(e, tab?.url ?? ""));
  const [tstate, setTstate] = useState<TranslateState | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SidebarSettingsPage | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [agentTask, setAgentTask] = useState<{ tabId: number; task: string; key: number } | null>(null);
  const [flash, setFlash] = useState<"done" | "surprised" | null>(null); // brief mascot reactions
  const flashTimer = useRef(0);
  const react = useCallback((f: "done" | "surprised") => {
    clearTimeout(flashTimer.current);
    setFlash(f);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1200);
  }, []);
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

  const effectiveUrl = tab?.url || page.lastPage?.url || conv.pageUrl || "";
  const host = effectiveUrl && !restricted(effectiveUrl) ? new URL(effectiveUrl).host : "";
  const effectivePageTitle = displayPageTitle(tab?.title || page.lastPage?.title || conv.pageTitle, effectiveUrl, host);
  const effectiveFavIcon = tab?.favIconUrl || page.lastPage?.favIconUrl || conv.favIconUrl;

  // persist finished conversations (history)
  useEffect(() => {
    if (!tab || !conv.id || !messages.length || messages.some((m) => m.status === "streaming" || m.status === "thinking")) return;
    const now = Date.now();
    const cleanMsgs = messages
      .filter((m) => m.status !== "error")
      .map(({ role, content, kind, model, attachments: atts }) => ({
        role,
        content,
        kind,
        model,
        ...(atts?.length ? { attachments: atts } : {}),
      }));
    const pageTitleToSave = effectivePageTitle || host || effectiveUrl;
    const autoTitle = conv.chatTitle || deriveChatTitle(cleanMsgs, pageTitleToSave, host);
    store.put({
      id: conv.id,
      url: effectiveUrl,
      title: pageTitleToSave,
      chatTitle: autoTitle,
      favIconUrl: effectiveFavIcon,
      host,
      messages: cleanMsgs,
      createdAt: now,
      updatedAt: now,
    }).catch(() => {});
  }, [messages, conv.id, conv.chatTitle, effectivePageTitle, effectiveFavIcon, effectiveUrl, host, tab]);

  async function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const added: ChatAttachment[] = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await fileToDataUrl(file);
        const ext = (file.type.split("/")[1] || "png").replace(/jpeg/, "jpg").split("+")[0];
        const isGeneric = !file.name || /^image\.\w+$/i.test(file.name);
        added.push({
          id: newId(),
          kind: "image",
          name: isGeneric ? formatPastedFileName(ext, "pasted") : file.name,
          size: file.size,
          mimeType: file.type || "image/png",
          dataUrl,
        });
      } else {
        const textContent = await file.text();
        added.push({
          id: newId(),
          kind: "text",
          name: file.name || formatPastedFileName("txt", "pasted"),
          size: file.size || new Blob([textContent]).size,
          mimeType: file.type || "text/plain",
          textContent,
        });
      }
    }
    if (added.length) {
      setAttachments((prev) => [...prev, ...added]);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const cd = e.clipboardData;
    if (!cd) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(cd.items ?? [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      void addFiles(imageFiles);
      return;
    }
    const pastedText = cd.getData("text/plain") ?? "";
    if (pastedText.length >= LONG_TEXT_PASTE_THRESHOLD) {
      e.preventDefault();
      const bytes = new Blob([pastedText]).size;
      const att: ChatAttachment = {
        id: newId(),
        kind: "text",
        name: formatPastedFileName("txt", "pasted"),
        size: bytes,
        mimeType: "text/plain",
        textContent: pastedText,
      };
      setAttachments((prev) => [...prev, att]);
      toast({ text: tr("chat.pastedLongText", { count: pastedText.length }), tone: "info" });
    }
  }

  async function send(text: string, kind?: "summary" | "agent", overrideAttachments?: ChatAttachment[]) {
    const activeAttachments = overrideAttachments ?? (kind === "summary" ? [] : attachments);
    if ((!text.trim() && activeAttachments.length === 0) || busy) return;
    if (!configured) return onSetup();
    const cmd = tr("agent.command");
    const isExplicitCmd = !kind && (text.trim().startsWith(cmd) || text.trim().startsWith("/act"));
    if (kind === "agent" || isExplicitCmd || (!kind && agentMode)) {
      const task = text.trim().replace(cmd, "").replace(/^\/act/, "").trim();
      if (!task || !tab?.id) return setPageError(tr("agent.usage"));
      const nowKey = Date.now();
      const user: Msg = { id: `u${nowKey}`, role: "user", content: task, kind: "agent" };
      const asst: Msg = {
        id: `a${nowKey}`,
        role: "assistant",
        content: "",
        status: "streaming",
        kind: "agent",
        agentRun: { tabId: tab.id, task, key: nowKey },
      };
      setMessages((m) => [...m, user, asst]);
      setInput("");
      return;
    }
    const user: Msg = {
      id: `u${Date.now()}`,
      role: "user",
      content: text.trim(),
      kind,
      ...(activeAttachments.length ? { attachments: activeAttachments } : {}),
    };
    const asst: Msg = { id: `a${Date.now()}`, role: "assistant", content: "", status: "streaming", kind };
    const history = [...messages.filter((m) => m.status !== "error"), user].map(({ role, content, attachments: atts }) => ({
      role,
      content,
      ...(atts?.length ? { attachments: atts } : {}),
    }));
    setMessages((m) => [...m, user, asst]);
    setInput("");
    if (!overrideAttachments && kind !== "summary") {
      setAttachments([]);
    }
    const patch = (f: (x: Msg) => Msg) => setMessages((m) => m.map((x) => (x.id === asst.id ? f(x) : x)));
    // Busy from the start: reading a long PDF takes a while, and Stop must cancel it too.
    const reading = new AbortController();
    setBusy({ abort: () => reading.abort() });
    const content = kind === "summary" || usePage
      ? await page.getPage({ signal: reading.signal, onProgress: (done, total) => patch((x) => ({ ...x, pdfProgress: { done, total } })) })
      : undefined;
    if (content) {
      setConvs((c) => ({
        ...c,
        [tabKey]: {
          ...c[tabKey],
          id: c[tabKey]?.id || newId(),
          messages: c[tabKey]?.messages ?? [],
          pageTitle: content.title || c[tabKey]?.pageTitle,
          pageUrl: content.url || c[tabKey]?.pageUrl,
          favIconUrl: content.favIconUrl || tab?.favIconUrl || c[tabKey]?.favIconUrl,
        },
      }));
    }
    patch((x) => ({ ...x, pdfProgress: undefined }));
    if (reading.signal.aborted) {
      setBusy(null);
      return patch((x) => ({ ...x, status: "done" }));
    }
    if (kind === "summary" && !content) {
      setBusy(null);
      return patch((x) => ({ ...x, status: "error", error: tr("chat.cannotReadPage") }));
    }
    let streamedText = "";
    const needAutoTitle = !conv.chatTitle;
    const h = llm.chat({ task: kind ?? "chat", messages: history, page: content && { title: content.title, url: content.url, markdown: content.markdown, length: content.length, kind: content.kind } }, (e) => {
      if (e.type === "start") patch((x) => ({ ...x, model: e.model }));
      if (e.type === "progress") patch((x) => ({ ...x, progress: { done: e.done, total: e.total } }));
      if (e.type === "coverage") patch((x) => ({ ...x, coverage: e.percent, retrieved: e.retrieved }));
      if (e.type === "thinking") patch((x) => ({ ...x, status: x.content ? x.status : "thinking" }));
      if (e.type === "delta") {
        streamedText += e.text;
        patch((x) => ({ ...x, status: "streaming", content: x.content + e.text }));
      }
      if (e.type === "done") {
        patch((x) => ({ ...x, status: "done" }));
        setBusy(null);
        if (needAutoTitle && streamedText.trim()) {
          const titlePage = displayPageTitle(content?.title || effectivePageTitle, content?.url || effectiveUrl, host);
          const turnList = [...history.map((m) => ({ ...m, kind })), { role: "assistant", content: streamedText, kind }];
          const immediateTitle = deriveChatTitle(turnList, titlePage, host);
          setConvs((c) => (c[tabKey] ? { ...c, [tabKey]: { ...c[tabKey], chatTitle: c[tabKey].chatTitle || immediateTitle } } : c));
          void bg<{ title: string }>({
            type: "chat:title",
            messages: turnList,
            pageTitle: titlePage,
            host,
          })
            .then((r) => {
              if (r?.title) {
                setConvs((c) => (c[tabKey] ? { ...c, [tabKey]: { ...c[tabKey], chatTitle: r.title } } : c));
              }
            })
            .catch(() => {});
        }
      }
      if (e.type === "error") {
        patch((x) => ({ ...x, status: "error", error: e.message }));
        setBusy(null);
      }
    });
    setBusy({ abort: h.abort });
  }
  const summarize = () => send(tr("chat.summarizePage"), "summary");
  const summarizeVideo = () => send(tr("chat.summarizeVideo"), "summary");

  // hand-offs from the page (context menu "summarize", selection card "ask in panel")
  useEffect(() => {
    if (!tab) return;
    const consume = async () => {
      const r = await chrome.storage.session.get("pendingAction");
      const a = r.pendingAction as { type: string; tabId: number; at: number; text?: string } | undefined;
      if (!a || a.tabId !== tab.id || Date.now() - a.at > 120_000) return; // 2 min: long enough to click the toolbar icon after the fallback toast
      await chrome.storage.session.remove("pendingAction");
      if (a.type === "summarize") summarize();
      if (a.type === "ask" && a.text) {
        setInput(tr("chat.askAbout", { quote: a.text.replace(/\n/g, "\n> ") }));
        react("surprised");
      }
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
      failPage(e);
    }
  }

  /** Current selection on the page (empty string when nothing is selected). */
  async function pageSelection(): Promise<string | undefined> {
    if (!tab || (tab.url && restricted(tab.url))) return undefined;
    try {
      const r = await bg<{ text: string }>({ type: "page:selection", tabId: tab.id });
      setPageError(null);
      return r.text;
    } catch (e) {
      failPage(e);
      return undefined;
    }
  }
  async function explainSelection() {
    if (!configured) return onSetup();
    const text = await pageSelection();
    if (text === undefined) return;
    if (!text) return toast({ text: tr("chat.noSelection"), tone: "info" });
    react("surprised");
    send(tr("chat.explainPrompt", { quote: text.replace(/\n/g, "\n> ") }));
  }
  async function quoteSelection() {
    const text = await pageSelection();
    if (text === undefined) return;
    if (!text) return toast({ text: tr("chat.noSelection"), tone: "info" });
    react("surprised");
    setInput((v) => (v.trim() ? `${v.trimEnd()}\n\n` : "") + tr("chat.askAbout", { quote: text.replace(/\n/g, "\n> ") }));
  }

  async function locate(text: string) {
    if (!tab) return;
    try {
      if (!(await page.locate(text))) toast({ text: tr("chat.citationNotFound"), tone: "info" });
    } catch (e) {
      toast({ text: (e as Error).message, tone: "error" });
    }
  }

  // Without host access (or after an activeTab grant expired) Chrome hides tab.url: the page is still usable once
  // granted, so actions stay enabled and fail into the "grant" strip instead of looking like a browser-internal page.
  const urlHidden = !!tab && !tab.url;
  const local = !!tab && isFileUrl(tab.url);
  const pageOk = !!host || urlHidden || local;
  const pageLabel = host || (local ? tr("chat.localFile") : "");
  const needsGrant = !!pageError?.fix;
  const translating = !!tstate?.active;
  const videoAvailable = Boolean(tstate?.videoSubtitlesAvailable || isVideoWatchUrl(effectiveUrl));
  const allModels = providers.filter((p) => p.enabled && usable(p)).map((p) => ({ p, models: p.models }));

  // ---- mascot expression, driven by real app events ----
  const last = messages[messages.length - 1];
  const lastStatus = last?.role === "assistant" ? last.status : undefined;
  const translatingNow = translating && tstate!.done < tstate!.total;
  useEffect(() => {
    if (lastStatus === "done") react("done");
  }, [lastStatus, react]);
  const prevTranslating = useRef(false);
  useEffect(() => {
    if (prevTranslating.current && !translatingNow && translating) react("done");
    prevTranslating.current = translatingNow;
  }, [translatingNow, translating, react]);
  const chatMood: MascotState =
    lastStatus === "error" ? "error"
    : lastStatus === "thinking" || (lastStatus === "streaming" && !last!.content) ? "waiting"
    : lastStatus === "streaming" ? "generating"
    : flash === "done" ? "done" : "idle";
  const mood: MascotState =
    !configured || needsGrant ? "needs-action"
    : chatMood !== "idle" && chatMood !== "done" ? chatMood
    : translatingNow ? "translating"
    : flash ?? (composerFocused ? "typing" : "idle");

  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  const toggleTheme = () => update((s) => ({ ...s, theme: isDark ? "light" : "dark" }));

  const round = "size-9 rounded-full border border-border bg-background text-foreground/75 hover:bg-muted hover:text-foreground";
  return (
    <div className="flex h-full flex-col">
      {/* top row: round outlined buttons — new chat · history | translate · theme · settings */}
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        <IconButton icon={MessageSquarePlus} label={tr("chat.newChat")} className={round} onClick={() => setConvs((c) => ({ ...c, [tabKey]: { id: newId(), messages: [] } }))} testId="new-chat" />
        <IconButton icon={History} label={tr("chat.history")} className={round} onClick={() => setHistoryOpen(true)} testId="open-history" />
        <div className="flex-1" />
        <IconButton icon={Languages} label={translating ? tr("chat.showOriginal") : tr("chat.translatePage")} active={translating} onClick={toggleTranslate} testId="translate-toggle" disabled={!pageOk}
          className={cn(round, translating && "border-primary/40 bg-primary-soft text-primary-soft-foreground", "disabled:opacity-40")} />
        <IconButton icon={isDark ? Sun : Moon} label={tr("chat.toggleTheme")} className={round} onClick={toggleTheme} testId="theme-toggle" />
        <IconButton icon={Settings2} label={tr("qs.title")} className={round} onClick={() => setSettingsPage("root")} testId="open-quick-settings" />
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {messages.length === 0 ? (
          <Home mood={mood} tab={tab} pageTitle={effectivePageTitle} favIconUrl={effectiveFavIcon} host={pageLabel} pageOk={pageOk} translating={translating} videoAvailable={videoAvailable} targetLang={langLabel(settings.translation.targetLang)} onSummarize={summarize} onSummarizeVideo={summarizeVideo} onTranslate={toggleTranslate}
            onExplain={explainSelection} onKeyPoints={() => send(settings.prompts.keyPoints.trim() || DEFAULT_KEYPOINTS_TEMPLATE, "summary")} />
        ) : (
          <>
            {pageOk && <PageChip tab={tab} pageTitle={effectivePageTitle} favIconUrl={effectiveFavIcon} host={pageLabel} className="mt-1 bg-card" />}
            <div className="space-y-5 pt-4">
              {messages.map((m, i) => (
                <MessageItem
                  key={m.id}
                  m={m}
                  mood={i === messages.length - 1 ? chatMood : undefined}
                  onRetry={() => send(messages[i - 1]?.content ?? "", m.kind, messages[i - 1]?.attachments)}
                  onLocate={locate}
                  onPreviewAttachment={setPreviewAtt}
                  onAgentFinish={(outcome, steps) => {
                    setMessages((list) =>
                      list.map((x) =>
                        x.id === m.id
                          ? {
                              ...x,
                              status: "done",
                              content: outcome.status === "done" && outcome.text ? outcome.text : x.content,
                              agentRun: x.agentRun ? { ...x.agentRun, steps, outcome } : undefined,
                            }
                          : x,
                      ),
                    );
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 px-3">
        {agentTask && <AgentRun key={agentTask.key} tabId={agentTask.tabId} task={agentTask.task} onClose={() => setAgentTask(null)} />}
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
              {pageError.fix !== "grant-site" ? pageError.text : host ? tr("chat.needHost", { host: host }) : tr("chat.needAccessClickIcon")}
            </span>
            {pageError.fix === "file-access" && <Button size="sm" variant="outline" onClick={page.fix} testId="open-file-access">{tr("chat.openExtSettings")}</Button>}
            {pageError.fix === "grant-file" && <Button size="sm" variant="outline" onClick={page.fix} testId="grant-file">{tr("chat.allow")}</Button>}
            {pageError.fix === "grant-site" && host && <Button size="sm" variant="outline" onClick={page.fix} testId="grant-site">{tr("chat.allow")}</Button>}
            {pageError.fix === "grant-site" && !host && <Button size="sm" variant="outline" onClick={page.fix} testId="grant-all">{tr("chat.allow")}</Button>}
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

      {/* composer: big rounded box · attachment chips · toolbar icons · model selector + round send (bottom-right) */}
      <div className="shrink-0 p-3 pt-2">
        <div
          onDragOver={(e) => {
            if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
          }}
          onDrop={(e) => {
            if (e.dataTransfer?.files?.length) {
              e.preventDefault();
              void addFiles(e.dataTransfer.files);
            }
          }}
          className={cn(
            "rounded-[22px] border bg-background shadow-[0_1px_3px_rgb(16_24_40/0.05)] transition focus-within:ring-2 dark:bg-card",
            agentMode
              ? "border-primary/50 focus-within:border-primary focus-within:ring-primary/30"
              : "border-border focus-within:border-primary/45 focus-within:ring-ring/40",
          )}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3 pb-0.5" data-testid="composer-attachments">
              {attachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  att={att}
                  onPreview={() => setPreviewAtt(att)}
                  onRemove={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                />
              ))}
            </div>
          )}
          <textarea
            data-testid="composer"
            rows={2}
            value={input}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            onPaste={handlePaste}
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
            placeholder={agentMode ? tr("agent.placeholder") : tr("chat.placeholder")}
            className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] leading-6 outline-none placeholder:text-muted-foreground/70"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.json,.csv,.log,.xml,.yaml,.yml"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-1 px-2.5 pb-2.5">
            <ToolBtn icon={Plus} label={tr("chat.addAttachment")} onClick={() => fileInputRef.current?.click()} testId="attach-file" />
            <ToolBtn icon={FileText} label={tr("chat.usePage")} on={usePage && pageOk} disabled={!pageOk} onClick={() => setUsePage((v) => !v)} testId="use-page" />
            <ToolBtn icon={TextQuote} label={tr("chat.quoteSelection")} disabled={!pageOk} onClick={quoteSelection} testId="quote-selection" />
            <button
              type="button"
              onClick={() => setAgentMode((v) => !v)}
              title={tr("agent.modeTip")}
              aria-pressed={agentMode}
              data-testid="agent-mode-toggle"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition",
                agentMode
                  ? "bg-primary text-primary-foreground shadow-2xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Sparkles className="size-3.5 shrink-0" />
              <span>{tr("agent.modeLabel")}</span>
            </button>
            <div className="flex-1" />
            <Dropdown>
              <DropdownTrigger asChild>
                <button data-testid="model-switch" className="flex h-8 min-w-0 max-w-[55%] items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  {chatModel && <ProviderIcon presetId={chatModel.provider.presetId} size={14} />}
                  <span className="truncate">{chatModel ? chatModel.modelId : tr("chat.noModel")}</span>
                  <ChevronDown className="size-3.5 shrink-0" />
                </button>
              </DropdownTrigger>
              <DropdownContent testId="model-menu">
                {allModels.length === 0 && <DropdownItem icon={KeyRound} onSelect={onSetup}>{tr("chat.addKey")}</DropdownItem>}
                {allModels.map(({ p, models }) => (
                  <div key={p.id}>
                    <DropdownLabel><span className="inline-flex items-center gap-1.5"><ProviderIcon presetId={p.presetId} size={13} />{p.name}</span></DropdownLabel>
                    {models.map((m) => (
                      <DropdownItem key={m} testId={`model-option-${m}`} checked={chatModel?.provider.id === p.id && chatModel.modelId === m}
                        onSelect={() => update((s) => {
                          const nextRef = modelRef(p.id, m);
                          const syncSummary = s.models.summary === "auto" || s.models.summary === s.models.chat;
                          return { ...s, models: { ...s.models, chat: nextRef, summary: syncSummary ? nextRef : s.models.summary } };
                        })}>
                        {m}
                      </DropdownItem>
                    ))}
                  </div>
                ))}
                <DropdownSeparator />
                <DropdownItem icon={Settings2} onSelect={() => setSettingsPage("models")}>{tr("chat.manageModels")}</DropdownItem>
              </DropdownContent>
            </Dropdown>
            {busy ? (
              <button onClick={() => busy.abort()} className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:opacity-85" aria-label={tr("chat.stop")} data-testid="stop">
                <Square className="size-3 fill-current" />
              </button>
            ) : (
              <button onClick={() => send(input)} disabled={!input.trim() && attachments.length === 0} data-testid="send" aria-label={tr("chat.send")}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-input disabled:text-muted-foreground">
                <ArrowUp className="size-4" strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      {previewAtt && <AttachmentPreviewModal att={previewAtt} onClose={() => setPreviewAtt(null)} />}

      {settingsPage && (
        <SidebarSettings
          settings={settings}
          update={update}
          providers={providersObj}
          tab={tab}
          host={host}
          initialPage={settingsPage}
          onClose={() => setSettingsPage(null)}
        />
      )}

      {historyOpen && (
        <HistoryDrawer
          onClose={() => setHistoryOpen(false)}
          onOpen={(c) => {
            setConvs((x) => ({
              ...x,
              [tabKey]: {
                id: c.id,
                chatTitle: c.chatTitle,
                pageTitle: c.title,
                pageUrl: c.url,
                favIconUrl: c.favIconUrl,
                messages: c.messages.map((m, i) => ({ ...m, kind: m.kind as Msg["kind"], id: `${c.id}-${i}`, status: m.role === "assistant" ? "done" : undefined })),
              },
            }));
            setHistoryOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ToolBtn({ icon: Icon, label, on, disabled, onClick, testId }: { icon: typeof FileText; label: string; on?: boolean; disabled?: boolean; onClick: () => void; testId: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={on ?? undefined} data-testid={testId} data-on={on ? "" : undefined}
      className={cn("grid size-8 place-items-center rounded-full transition disabled:opacity-40", on ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <Icon className="size-[17px]" strokeWidth={1.9} />
    </button>
  );
}

function PageFavicon({ favIconUrl, url, host, size = 16, className }: { favIconUrl?: string; url?: string; host?: string; size?: number; className?: string }) {
  const src = useMemo(() => {
    if (favIconUrl) return favIconUrl;
    if (url && /^https?:/.test(url)) {
      try {
        const u = new URL(url);
        if (!/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return new URL("/favicon.ico", u.origin).href;
      } catch {
        /* ignore */
      }
    }
    if (host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return `https://${host}/favicon.ico`;
    return "";
  }, [favIconUrl, url, host]);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return <Globe className={cn("shrink-0 text-muted-foreground", className)} style={{ width: size, height: size }} />;
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-[4px] object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

function PageChip({ tab, pageTitle, favIconUrl, host, className }: { tab: TabInfo | null; pageTitle?: string; favIconUrl?: string; host: string; className?: string }) {
  const titleText = pageTitle || displayPageTitle(tab?.title, tab?.url, host) || host || tr("chat.currentPage");
  return (
    <div className={cn("flex items-center gap-2.5 rounded-card px-3 py-2.5", className)} data-testid="page-chip">
      <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-background/80 dark:bg-white/10">
        <PageFavicon favIconUrl={favIconUrl || tab?.favIconUrl} url={tab?.url} host={host} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{titleText}</div>
        <div className="truncate text-[12px] text-muted-foreground">{host || tr("chat.noAccessYet")}</div>
      </div>
    </div>
  );
}

/** Home / empty state (Kimi-style): mascot + headline, a soft card with the current page, then quick actions. */
function Home(p: { mood: MascotState; tab: TabInfo | null; pageTitle?: string; favIconUrl?: string; host: string; pageOk: boolean; translating: boolean; videoAvailable?: boolean; targetLang: string; onSummarize: () => void; onSummarizeVideo: () => void; onTranslate: () => void; onExplain: () => void; onKeyPoints: () => void }) {
  const actions = [
    ...(p.videoAvailable ? [{ icon: Video, label: tr("chat.summarizeVideo"), onClick: p.onSummarizeVideo, testId: "action-summarize-video" }] : []),
    { icon: FileText, label: tr("chat.summarizePage"), onClick: p.onSummarize, testId: "action-summarize" },
    { icon: Languages, label: p.translating ? tr("chat.showOriginal") : tr("chat.translatePage"), onClick: p.onTranslate, testId: "action-translate" },
    { icon: ScanText, label: tr("chat.explainSelection"), onClick: p.onExplain, testId: "action-explain" },
    { icon: ListChecks, label: tr("chat.keyPoints"), onClick: p.onKeyPoints, testId: "action-keypoints" },
  ];
  return (
    <div className="animate-in px-1 pt-5" data-testid="home">
      <Mascot state={p.mood} size={60} />
      <h1 className="mt-3 text-[25px] font-semibold leading-[1.3] tracking-tight">{tr("chat.homeTitle")}</h1>
      <div className="mt-5 overflow-hidden rounded-[20px] border border-primary/10 p-1.5 dark:border-white/5" style={{ background: "var(--home-card)" }} data-testid="home-card">
        {p.pageOk && <PageChip tab={p.tab} pageTitle={p.pageTitle} favIconUrl={p.favIconUrl} host={p.host} className="bg-background/70 dark:bg-black/20" />}
        <div className="px-3 pb-2.5 pt-2.5 text-[13px] leading-6 text-foreground/70">{p.pageOk ? tr("chat.emptyDesc", { lang: p.targetLang }) : tr("chat.emptyRestricted")}</div>
      </div>
      {p.pageOk && (
        <div className="mt-3 space-y-0.5">
          {actions.map((c) => (
            <button key={c.testId} data-testid={c.testId} onClick={c.onClick}
              className="group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left text-[14.5px] transition hover:bg-card active:scale-[0.99]">
              <c.icon className="size-[18px] shrink-0 text-foreground/70" strokeWidth={1.8} />
              <span className="flex-1 truncate">{c.label}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentChip({
  att,
  onRemove,
  onPreview,
}: {
  att: ChatAttachment;
  onRemove?: () => void;
  onPreview?: () => void;
}) {
  const isImage = att.kind === "image";
  const extLabel = isImage
    ? ((att.mimeType?.split("/")[1] || att.name.split(".").pop() || "IMG").replace(/jpeg/i, "JPG").split("+")[0] || "IMG").toUpperCase()
    : (att.name.split(".").pop() || "TXT").toUpperCase().slice(0, 5);
  const subLabel = isImage
    ? `${extLabel} · ${formatBytes(att.size)}`
    : `${extLabel} · ${(att.textContent?.length ?? 0).toLocaleString()} ${tr("chat.chars")} · ${formatBytes(att.size)}`;

  return (
    <div
      data-testid={`attachment-chip-${att.kind}`}
      onClick={onPreview}
      className={cn(
        "group relative flex w-[212px] max-w-full items-center gap-2.5 rounded-[14px] border border-border/80 bg-muted/45 p-2 text-left transition hover:bg-muted/75 dark:bg-white/[0.04]",
        onRemove && "pr-7",
        onPreview && "cursor-pointer",
      )}
    >
      <div className="size-10 shrink-0 overflow-hidden rounded-[9px] border border-border/60 bg-background shadow-2xs">
        {isImage && att.dataUrl ? (
          <img src={att.dataUrl} alt={att.name} className="size-full object-cover" />
        ) : (
          <div className="size-full overflow-hidden p-1 font-mono text-[4.5px] leading-[6px] text-foreground/65 select-none whitespace-pre-wrap break-all">
            {(att.textContent ?? "").slice(0, 260)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-snug text-foreground" title={att.name}>
          {att.name}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] leading-snug text-muted-foreground">
          {subLabel}
        </div>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={tr("chat.removeAttachment")}
          data-testid="remove-attachment"
          className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full text-muted-foreground transition hover:bg-background/90 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function AttachmentPreviewModal({ att, onClose }: { att: ChatAttachment; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 backdrop-blur-xs animate-in"
      onClick={onClose}
      data-testid="attachment-preview-modal"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[18px] border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{att.name}</div>
            <div className="text-[11.5px] text-muted-foreground">
              {att.kind === "image"
                ? formatBytes(att.size)
                : `${(att.textContent?.length ?? 0).toLocaleString()} ${tr("chat.chars")} · ${formatBytes(att.size)}`}
            </div>
          </div>
          <IconButton icon={X} label={tr("common.close")} onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-3.5">
          {att.kind === "image" && att.dataUrl ? (
            <img src={att.dataUrl} alt={att.name} className="mx-auto max-h-[70vh] rounded-lg object-contain" />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-foreground/90">
              {att.textContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageItem({
  m,
  mood,
  onRetry,
  onLocate,
  onPreviewAttachment,
  onAgentFinish,
}: {
  m: Msg;
  mood?: MascotState;
  onRetry: () => void;
  onLocate: (text: string) => void;
  onPreviewAttachment: (att: ChatAttachment) => void;
  onAgentFinish?: (outcome: RunOutcome, steps: StepRecord[]) => void;
}) {
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
      <div className="flex animate-in flex-col items-end gap-1.5">
        {m.attachments && m.attachments.length > 0 && (
          <div className="flex max-w-[90%] flex-wrap justify-end gap-1.5" data-testid="user-message-attachments">
            {m.attachments.map((att) => (
              <AttachmentChip key={att.id} att={att} onPreview={() => onPreviewAttachment(att)} />
            ))}
          </div>
        )}
        {m.content && (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-[6px] bg-primary-soft px-3.5 py-2 text-[14px] leading-6 text-foreground">
            {m.kind === "summary" ? (
              <span className="flex items-center gap-1.5"><FileText className="size-3.5 text-primary" />{m.content}</span>
            ) : m.kind === "agent" ? (
              <span className="flex items-center gap-1.5"><Sparkles className="size-3.5 text-primary shrink-0" /><span>{m.content}</span></span>
            ) : (
              m.content
            )}
          </div>
        )}
      </div>
    );
  if (m.agentRun) {
    return (
      <div className="animate-in space-y-2.5" data-testid="assistant-message" data-status={m.status}>
        <AgentRun
          key={m.agentRun.key}
          tabId={m.agentRun.tabId}
          task={m.agentRun.task}
          initialSteps={m.agentRun.steps}
          initialOutcome={m.agentRun.outcome}
          onFinish={onAgentFinish}
        />
        {m.content && (
          <div ref={ref} onClick={onClick} className="md pt-0.5" data-testid="assistant-content">
            <SafeMarkdown>{m.content}</SafeMarkdown>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="animate-in" data-testid="assistant-message" data-status={m.status}>
      <Mascot state={mood ?? "idle"} still={!mood} size={22} className="mb-1.5" />
      {m.status === "error" ? (
        <div className="rounded-card bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
          {m.content && <div className="md mb-2 opacity-80"><SafeMarkdown>{m.content}</SafeMarkdown></div>}
          <div className="flex items-center gap-2"><span className="flex-1" data-testid="assistant-error">{m.error}</span><Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry}>{tr("common.retry")}</Button></div>
        </div>
      ) : !m.content ? (
        <div className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground">
          <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
          {m.pdfProgress ? tr("chat.readingPdf", { done: m.pdfProgress.done, total: m.pdfProgress.total })
            : m.progress && m.progress.total > 1 ? tr("chat.readingSections", { done: m.progress.done, total: m.progress.total }) : m.status === "thinking" ? tr("chat.thinking") : m.kind === "summary" ? tr("chat.readingPage") : ""}
        </div>
      ) : (
        <div ref={ref} onClick={onClick} className={cn("md", m.status === "streaming" && "caret")} data-testid="assistant-content">
          <SafeMarkdown>{m.content}</SafeMarkdown>
        </div>
      )}
      {m.coverage != null && (
        <div data-testid="coverage-notice" className="mt-2 flex items-center gap-1.5 rounded-[10px] bg-muted px-2.5 py-1.5 text-[12px] text-muted-foreground">
          <Info className="size-3.5 shrink-0" />
          {m.kind === "summary" ? tr("chat.coverageSummary", { percent: m.coverage }) : m.retrieved ? tr("chat.coverageRetrieved", { percent: m.coverage }) : tr("chat.coverageChat", { percent: m.coverage })}
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
          {list?.map((c) => {
            const chatTitle = c.chatTitle || deriveChatTitle(c.messages, c.title, c.host);
            const pageText = displayPageTitle(c.title, c.url, c.host) || c.host || tr("chat.noPage");
            return (
              <div key={c.id} className="group flex items-center gap-2 rounded-card bg-card px-3 py-2.5 transition hover:bg-card-strong">
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(c)} data-testid="history-item">
                  <div className="truncate text-[13px] font-medium" data-testid="history-chat-title">{chatTitle}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="history-page-meta">
                    <PageFavicon favIconUrl={c.favIconUrl} url={c.url} host={c.host} size={14} />
                    <span className="truncate">{pageText}</span>
                    <span className="shrink-0">· {new Date(c.updatedAt).toLocaleString()}</span>
                  </div>
                </button>
                <button className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100" aria-label={tr("common.delete")} onClick={async () => { await store.delete(c.id); load(); }}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
