import {
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Database,
  Globe2,
  Keyboard,
  KeyRound,
  Languages,
  Link2,
  MessageSquare,
  Monitor,
  Moon,
  MousePointerClick,
  Palette,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_MCP_PORT, type McpBridgeStatus } from "@/src/agent/mcp-bridge";
import { tr } from "@/src/i18n";
import { STYLE_LABELS } from "@/src/lib/batch";
import { keyOptional, resolveModelRef } from "@/src/lib/providers";
import { LANGUAGES } from "@/src/lib/settings";
import type { DisplayMode, HoverTranslateKey, ProviderConfig, Settings, ThemeMode, UiLocale } from "@/src/lib/types";
import { cn, Segmented, Select, Switch } from "./components/ui";
import type { TabInfo, useProviders } from "./hooks";
import { bg } from "./messaging";
import { AgentSection, ChatSection, DataSection, ModelsSection, TranslationSection } from "./options/OptionsApp";

export type SidebarSettingsPage = "root" | "models" | "translation" | "agent" | "data";

export function SidebarSettings({
  settings,
  update,
  providers,
  tab,
  host,
  initialPage = "root",
  onClose,
}: {
  settings: Settings;
  update: (fn: (s: Settings) => Settings) => void;
  providers: ReturnType<typeof useProviders>;
  tab: TabInfo | null;
  host: string;
  initialPage?: SidebarSettingsPage;
  onClose: () => void;
}) {
  const [subPage, setSubPage] = useState<SidebarSettingsPage>(initialPage);
  const [mcpStatus, setMcpStatus] = useState<McpBridgeStatus>({
    enabled: false,
    connected: false,
    port: DEFAULT_MCP_PORT,
    token: "",
    cdpEnabled: false,
  });
  const [shortcut, setShortcut] = useState<string>("");

  useEffect(() => {
    setSubPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (subPage !== "root") setSubPage("root");
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subPage, onClose]);

  useEffect(() => {
    const refreshMcp = () => {
      bg<McpBridgeStatus>({ type: "mcp:status" })
        .then((s) => s && setMcpStatus(s))
        .catch(() => {});
    };
    refreshMcp();
    const timer = window.setInterval(refreshMcp, 2500);
    chrome.commands
      ?.getAll?.()
      .then((cmds) => {
        const c = cmds.find((x) => x.name === "toggle-translate");
        if (c?.shortcut) setShortcut(c.shortcut);
      })
      .catch(() => {});
    return () => clearInterval(timer);
  }, []);

  const usable = (p: ProviderConfig) => !!providers.masked[p.id] || keyOptional(p);
  const chatModel = resolveModelRef(settings.models.chat, providers.providers, usable);

  const t = settings.translation;
  const auto = !!host && t.autoSites.includes(host);
  const setT = (patch: Partial<Settings["translation"]>) =>
    update((s) => ({ ...s, translation: { ...s.translation, ...patch } }));

  async function toggleAutoSite(on: boolean) {
    if (!host || !tab) return;
    if (on) {
      const ok = await chrome.permissions.request({ origins: [`${new URL(tab.url).origin}/*`] }).catch(() => false);
      if (!ok) return;
    }
    setT({
      autoSites: on ? [...new Set([...t.autoSites, host])] : t.autoSites.filter((h) => h !== host),
      neverSites: t.neverSites.filter((h) => h !== host),
    });
    if (on) bg({ type: "translate:toggle", tabId: tab.id, force: true }).catch(() => {});
  }

  async function toggleMcpConnect() {
    const next = !mcpStatus.enabled;
    const s = await bg<McpBridgeStatus>({
      type: "mcp:config",
      config: { enabled: next, port: mcpStatus.port, token: mcpStatus.token },
    });
    if (s) setMcpStatus(s);
  }

  async function toggleMcpCdp(cdpEnabled: boolean) {
    const s = await bg<McpBridgeStatus>({
      type: "mcp:config",
      config: { cdpEnabled },
    });
    if (s) setMcpStatus(s);
  }

  const pageTitle =
    subPage === "models"
      ? tr("nav.models")
      : subPage === "translation"
        ? tr("sb.styleAndPrompts")
        : subPage === "agent"
          ? tr("nav.agent")
          : subPage === "data"
            ? tr("sb.dataAndPrivacy")
            : tr("sb.title");

  const ctx = { settings, update, providers };
  const version = chrome.runtime?.getManifest?.()?.version ?? "0.1.0";

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-background animate-in"
      data-testid="quick-settings"
    >
      {/* Kimi-style Sticky Top Header: < Settings */}
      <header className="flex h-13 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background/95 px-2.5 backdrop-blur">
        <button
          type="button"
          onClick={() => (subPage === "root" ? onClose() : setSubPage("root"))}
          data-testid="settings-back"
          aria-label={tr("common.back")}
          className="flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-[15px] font-semibold tracking-tight text-foreground transition hover:bg-muted"
        >
          <ChevronLeft className="size-5 text-foreground/80" strokeWidth={2.1} />
          <span>{pageTitle}</span>
        </button>
      </header>

      {/* Scrollable Content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3">
        {subPage === "models" && (
          <div className="animate-in space-y-2">
            <ModelsSection {...ctx} />
          </div>
        )}

        {subPage === "translation" && (
          <div className="animate-in space-y-4">
            <TranslationSection {...ctx} />
            <ChatSection {...ctx} />
          </div>
        )}

        {subPage === "agent" && (
          <div className="animate-in">
            <AgentSection />
          </div>
        )}

        {subPage === "data" && (
          <div className="animate-in">
            <DataSection {...ctx} />
          </div>
        )}

        {subPage === "root" && (
          <div className="space-y-5">
            {/* Group 1: Appearance & Language */}
            <KimiSection>
              <KimiRow
                icon={Languages}
                title={tr("opt.uiLocale")}
                right={
                  <Select
                    testId="settings-ui-locale"
                    className="w-32 shrink-0"
                    value={settings.uiLocale ?? "auto"}
                    onChange={(v) => update((s) => ({ ...s, uiLocale: v as UiLocale }))}
                    options={[
                      { value: "auto", label: tr("opt.uiLocaleAuto") },
                      { value: "zh", label: tr("opt.uiLocaleZh") },
                      { value: "en", label: tr("opt.uiLocaleEn") },
                    ]}
                  />
                }
              />
              <KimiRow
                icon={settings.theme === "dark" ? Moon : settings.theme === "light" ? Sun : Monitor}
                title={tr("opt.theme")}
                right={
                  <Segmented<ThemeMode>
                    testId="settings-theme"
                    className="shrink-0"
                    iconOnly
                    value={settings.theme}
                    onChange={(v) => update((s) => ({ ...s, theme: v }))}
                    options={[
                      { value: "system", label: tr("theme.system"), icon: Monitor },
                      { value: "light", label: tr("theme.light"), icon: Sun },
                      { value: "dark", label: tr("theme.dark"), icon: Moon },
                    ]}
                  />
                }
              />
            </KimiSection>

            {/* Group 2: AI Models & Page Translation */}
            <KimiSection title={tr("sb.modelsAndTrans")}>
              <KimiRow
                icon={KeyRound}
                title={tr("nav.models")}
                subtitle={
                  chatModel
                    ? `${chatModel.provider.name} · ${chatModel.modelId}`
                    : tr("opt.notConfigured")
                }
                onClick={() => setSubPage("models")}
                testId="qs-more"
              />
              <KimiRow
                icon={Globe2}
                title={tr("qs.targetLang")}
                right={
                  <Select
                    testId="qs-target-lang"
                    className="w-32 shrink-0"
                    value={t.targetLang}
                    onChange={(v) => setT({ targetLang: v })}
                    options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                  />
                }
              />
              <KimiRow
                icon={Languages}
                title={tr("qs.displayMode")}
                right={
                  <Segmented<DisplayMode>
                    testId="qs-display-mode"
                    className="shrink-0"
                    value={t.displayMode}
                    onChange={(v) => setT({ displayMode: v })}
                    options={[
                      { value: "bilingual", label: tr("mode.bilingual") },
                      { value: "translation-only", label: tr("mode.only") },
                    ]}
                  />
                }
              />
              <KimiRow
                icon={Sparkles}
                title={tr("qs.autoSite")}
                subtitle={host || tr("qs.unsupportedPage")}
                right={
                  <Switch
                    testId="qs-auto-site"
                    checked={auto}
                    onChange={toggleAutoSite}
                    label={tr("qs.autoSite")}
                  />
                }
              />
              <KimiRow
                icon={Palette}
                title={tr("sb.styleAndPrompts")}
                subtitle={STYLE_LABELS[t.style]}
                onClick={() => setSubPage("translation")}
                testId="sb-open-translation"
              />
            </KimiSection>

            {/* Group 3: Local agent remote control (Kimi style) */}
            <KimiSection title={tr("sb.remoteControl")}>
              <KimiRow
                icon={Link2}
                title={
                  <span className="inline-flex items-center gap-2">
                    <span>{tr("sb.connection")}</span>
                    {mcpStatus.enabled && (
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          mcpStatus.indicator === "active"
                            ? "bg-emerald-500 animate-pulse"
                            : mcpStatus.connected
                              ? "bg-blue-500"
                              : "bg-red-500",
                        )}
                      />
                    )}
                  </span>
                }
                subtitle={tr("sb.connectionDesc")}
                right={
                  <button
                    type="button"
                    data-testid="mcp-connect-btn"
                    onClick={toggleMcpConnect}
                    className={cn(
                      "shrink-0 rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium transition",
                      mcpStatus.enabled
                        ? "bg-primary/12 text-primary hover:bg-primary/20"
                        : "bg-muted text-foreground hover:bg-card-strong",
                    )}
                  >
                    {mcpStatus.enabled ? tr("sb.connectedBtn") : tr("sb.connectBtn")}
                  </button>
                }
              />
              <KimiRow
                icon={Zap}
                title={tr("mcp.cdpTitle")}
                subtitle={tr("mcp.cdpDesc")}
                right={
                  <Switch
                    testId="mcp-cdp-enable"
                    checked={Boolean(mcpStatus.cdpEnabled)}
                    onChange={toggleMcpCdp}
                    label={tr("mcp.cdpTitle")}
                  />
                }
              />
              <KimiRow
                icon={SettingsIcon}
                title={tr("sb.connectionAddr")}
                subtitle={`http://127.0.0.1:${mcpStatus.port}/mcp`}
                onClick={() => setSubPage("agent")}
                testId="sb-open-agent"
              />
            </KimiSection>

            {/* Group 4: Quick actions (Kimi style) */}
            <KimiSection title={tr("sb.quickActions")}>
              <KimiRow
                icon={Keyboard}
                title={tr("sb.toggleTranslateKey")}
                right={
                  <button
                    type="button"
                    onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
                    className="rounded-[8px] bg-muted px-2.5 py-1 font-mono text-[12px] text-foreground/85 transition hover:bg-card-strong"
                  >
                    {shortcut || tr("opt.notSet")}
                  </button>
                }
              />
              <KimiRow
                icon={Keyboard}
                title={tr("sb.hoverTranslateKey")}
                subtitle={tr("sb.hoverTranslateKeyHint")}
                right={
                  <Select
                    testId="qs-hover-key"
                    className="w-28 shrink-0"
                    value={t.hoverTranslateKey ?? "Shift"}
                    onChange={(v) => setT({ hoverTranslateKey: v as HoverTranslateKey })}
                    options={[
                      { value: "Shift", label: "Shift" },
                      { value: "Alt", label: "Alt / Option" },
                      { value: "Control", label: "Ctrl" },
                      { value: "off", label: tr("sb.hoverKeyOff") },
                    ]}
                  />
                }
              />
              <KimiRow
                icon={MessageSquare}
                title={tr("sb.selectionToolbar")}
                right={
                  <Switch
                    checked={t.selectionTranslate}
                    onChange={(v) => setT({ selectionTranslate: v })}
                    label={tr("sb.selectionToolbar")}
                  />
                }
              />
              <KimiRow
                icon={MousePointerClick}
                title={tr("sb.floatingBall")}
                right={
                  <Switch
                    testId="fab-switch"
                    checked={t.floatingButton}
                    onChange={(v) => setT({ floatingButton: v })}
                    label={tr("sb.floatingBall")}
                  />
                }
              />
            </KimiSection>

            {/* Group 5: About & Data (Kimi style) */}
            <KimiSection title={tr("sb.about")}>
              <KimiRow
                icon={ArrowUpCircle}
                title={tr("sb.version")}
                right={<span className="font-mono text-[13px] text-muted-foreground">{version}</span>}
              />
              <KimiRow
                icon={Database}
                title={tr("sb.dataAndPrivacy")}
                onClick={() => setSubPage("data")}
                testId="sb-open-data"
              />
            </KimiSection>
          </div>
        )}
      </div>
    </div>
  );
}

function KimiSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      {title && (
        <div className="mb-2 px-1 text-[12.5px] font-medium text-muted-foreground">{title}</div>
      )}
      <div className="divide-y divide-border/55 overflow-hidden rounded-[16px] bg-card px-3.5">
        {children}
      </div>
    </div>
  );
}

function KimiRow({
  icon: Icon,
  title,
  subtitle,
  right,
  onClick,
  testId,
}: {
  icon: typeof KeyRound;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const content = (
    <>
      <Icon className={cn("size-[18px] shrink-0 text-foreground/80", subtitle ? "mt-0.5" : "")} strokeWidth={1.85} />
      <div className="min-w-0 flex-1 text-left">
        <div className={cn("text-[13.5px] font-medium leading-5 text-foreground", !subtitle && "truncate")}>{title}</div>
        {subtitle && (
          <div className="mt-0.5 line-clamp-2 text-[12px] leading-4.5 text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {right ? <div className="shrink-0">{right}</div> : onClick ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex w-full items-center gap-2.5 py-3 text-left transition hover:opacity-85"
      >
        {content}
      </button>
    );
  }

  return (
    <div data-testid={testId} className={cn("flex gap-2.5 py-3", subtitle ? "items-start" : "items-center")}>
      {content}
    </div>
  );
}
