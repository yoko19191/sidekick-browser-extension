import { useCallback, useEffect, useState } from "react";
import { defaultSettings, loadSettings, saveSettings, SETTINGS_KEY } from "@/src/lib/settings";
import { keyStatus, loadProviders, PROVIDERS_KEY, saveProviders } from "@/src/lib/providers";
import type { ProviderConfig, Settings } from "@/src/lib/types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => defaultSettings(chrome.i18n?.getUILanguage?.()));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    const onChange = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && ch[SETTINGS_KEY]) loadSettings().then(setSettings);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  const update = useCallback((fn: (s: Settings) => Settings) => {
    setSettings((prev) => {
      const next = fn(structuredClone(prev));
      saveSettings(next);
      return next;
    });
  }, []);
  return { settings, update, loaded };
}

export function useProviders() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [masked, setMasked] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    setProviders(await loadProviders());
    setMasked(await keyStatus());
  }, []);
  useEffect(() => {
    refresh();
    const onChange = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && Object.keys(ch).some((k) => k === PROVIDERS_KEY || k.startsWith("secret:"))) refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [refresh]);
  const save = useCallback(async (list: ProviderConfig[]) => {
    await saveProviders(list);
    setProviders(list);
  }, []);
  return { providers, masked, save, refresh };
}

export function useTheme(mode: Settings["theme"]) {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mode === "dark" || (mode === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
}

/** The tab the panel is "about". `?tabId=` overrides it (used when the panel page is opened in a tab, e.g. tests). */
export function useActiveTab(): TabInfo | null {
  const [tab, setTab] = useState<TabInfo | null>(null);
  useEffect(() => {
    const forced = Number(new URLSearchParams(location.search).get("tabId")) || undefined;
    let windowId: number | undefined;
    const pick = (t?: chrome.tabs.Tab) => t?.id != null && setTab({ id: t.id, url: t.url ?? "", title: t.title ?? "", favIconUrl: t.favIconUrl });
    const refresh = async () => {
      if (forced) return pick(await chrome.tabs.get(forced).catch(() => undefined));
      if (windowId == null) windowId = (await chrome.windows.getCurrent()).id;
      const [t] = await chrome.tabs.query({ active: true, windowId });
      pick(t);
    };
    refresh();
    const onActivated = () => refresh();
    const onUpdated = (id: number, info: { status?: string; title?: string; url?: string }) => {
      if (info.status === "complete" || info.title || info.url) refresh();
      void id;
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}
