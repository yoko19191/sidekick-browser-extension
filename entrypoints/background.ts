import { TranslationCache } from "@/src/lib/cache";
import { buildTranslatePrompt, parseTranslationResponse } from "@/src/lib/batch";
import { translationCacheKey } from "@/src/lib/hash";
import { listModels, streamText, testConnection } from "@/src/lib/llm";
import { pageSystemPrompt, summaryInstruction } from "@/src/lib/prompts";
import { getKey, keyOptional, loadProviders, redactSecrets, resolveModelRef } from "@/src/lib/providers";
import { langName, loadSettings } from "@/src/lib/settings";
import type { ModelRef, PortEvent, PortRequest, ProviderConfig } from "@/src/lib/types";

export const LLM_PORT = "pagepilot-llm";

export default defineBackground({
  type: "module",
  main() {
    const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const cache = new TranslationCache();

    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    // Keys live in storage.local; restrict it to trusted extension contexts where supported.
    try {
      (chrome.storage.local as unknown as { setAccessLevel?: (o: object) => Promise<void> })
        .setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })
        ?.catch?.(() => {});
    } catch {
      /* not supported on this area */
    }

    chrome.runtime.onInstalled.addListener(() => {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "pp-translate", title: "翻译此页 / 显示原文", contexts: ["page", "selection"] });
        chrome.contextMenus.create({ id: "pp-summarize", title: "用 PagePilot 总结此页", contexts: ["page", "selection"] });
      });
    });

    async function usableResolver(providers: ProviderConfig[]) {
      const keys = new Map<string, string | undefined>();
      for (const p of providers) keys.set(p.id, await getKey(p.id));
      return { keys, usable: (p: ProviderConfig) => !!keys.get(p.id) || keyOptional(p) };
    }

    async function resolveTask(ref: ModelRef) {
      const providers = await loadProviders();
      const { keys, usable } = await usableResolver(providers);
      const r = resolveModelRef(ref, providers, usable);
      if (!r) throw new Error("还没有可用的模型：请先在 设置 → 模型服务 中添加 API Key");
      return { ...r, apiKey: keys.get(r.provider.id) };
    }

    async function ensureContentScript(tabId: number) {
      try {
        const pong = await chrome.tabs.sendMessage(tabId, { type: "pp:ping" });
        if (pong?.ok) return;
      } catch {
        /* not injected yet */
      }
      await chrome.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
    }

    async function toggleTranslate(tabId: number, force?: boolean) {
      await ensureContentScript(tabId);
      const settings = await loadSettings();
      return chrome.tabs.sendMessage(tabId, { type: "translate:toggle", force, settings: settings.translation });
    }

    // ---- translation batches from content scripts ----
    async function translateBatch(texts: string[]): Promise<string[]> {
      const s = await loadSettings();
      const t = s.translation;
      const { provider, modelId, apiKey } = await resolveTask(s.models.translate);
      const modelTag = `${provider.presetId}:${modelId}`;
      const variant = t.extraPrompt.trim() ? t.extraPrompt.trim().slice(0, 64) : "";
      const keys = await Promise.all(texts.map((x) => translationCacheKey(x, t.targetLang, modelTag, variant)));
      const cached = t.cacheEnabled ? await cache.getMany(keys) : texts.map(() => undefined);
      const missIdx = cached.map((c, i) => (c === undefined ? i : -1)).filter((i) => i >= 0);
      const out = cached.slice() as (string | undefined)[];

      const run = async (idx: number[]): Promise<void> => {
        if (!idx.length) return;
        const prompt = buildTranslatePrompt(idx.map((i) => texts[i]), langName(t.targetLang), t.extraPrompt);
        const r = await streamText({ provider, modelId, apiKey, system: prompt.system, messages: [{ role: "user", content: prompt.user }], temperature: 0.2, maxTokens: 8192 });
        const parsed = parseTranslationResponse(r.text, idx.length);
        if (!parsed) {
          if (idx.length === 1) throw new Error("模型返回格式无法解析");
          const mid = Math.ceil(idx.length / 2);
          await run(idx.slice(0, mid));
          await run(idx.slice(mid));
          return;
        }
        idx.forEach((i, j) => (out[i] = parsed[j]));
        if (t.cacheEnabled) await cache.putMany(idx.map((i, j) => ({ key: keys[i], translation: parsed[j] })));
      };
      await run(missIdx);
      return out.map((x) => x ?? "");
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const reply = (p: Promise<unknown>) => {
        p.then((data) => sendResponse({ ok: true, data })).catch((e: Error) => sendResponse({ ok: false, error: redactSecrets(e?.message ?? String(e)) }));
        return true;
      };
      // Extension pages (side panel, or the panel page opened in a tab) — never content scripts.
      const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(""));
      switch (msg?.type) {
        case "translate:batch":
          // From our content script. Only translated strings go back — never keys or settings.
          return reply(translateBatch((msg.texts as string[]).map(String)));
        case "sw:info":
          return reply(Promise.resolve({ bootId }));
      }
      if (!fromExtensionPage) return false; // everything below is for the side panel only
      switch (msg?.type) {
        case "translate:toggle":
          return reply(toggleTranslate(msg.tabId, msg.force));
        case "translate:status":
          return reply(chrome.tabs.sendMessage(msg.tabId, { type: "translate:status" }).catch(() => ({ active: false, total: 0, done: 0, errors: 0 })));
        case "page:extract":
          return reply(
            (async () => {
              await ensureContentScript(msg.tabId);
              return chrome.tabs.sendMessage(msg.tabId, { type: "page:extract" });
            })(),
          );
        case "provider:test":
          return reply((async () => testConnection(msg.provider, msg.modelId, (msg.apiKey as string | undefined) ?? (await getKey(msg.provider.id))))());
        case "provider:models":
          return reply((async () => listModels(msg.provider, (msg.apiKey as string | undefined) ?? (await getKey(msg.provider.id))))());
        case "cache:stats":
          return reply(cache.count());
        case "cache:clear":
          return reply(cache.clear());
      }
      return false;
    });

    // ---- streaming chat over a long-lived port (keeps the SW alive while active) ----
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== LLM_PORT || port.sender?.id !== chrome.runtime.id) return;
      const running = new Map<string, AbortController>();
      const send = (e: PortEvent) => {
        try {
          port.postMessage(e);
        } catch {
          /* port closed */
        }
      };
      port.onDisconnect.addListener(() => running.forEach((c) => c.abort()));
      port.onMessage.addListener(async (req: PortRequest) => {
        if (req.type === "ping") return send({ type: "pong", bootId });
        if (req.type === "abort") return running.get(req.id)?.abort();
        if (req.type !== "chat") return;
        const ac = new AbortController();
        running.set(req.id, ac);
        let apiKey: string | undefined;
        try {
          const s = await loadSettings();
          const r = await resolveTask(req.task === "summary" ? s.models.summary : s.models.chat);
          apiKey = r.apiKey;
          send({ type: "start", id: req.id, model: `${r.provider.name} · ${r.modelId}` });
          const messages = req.messages.slice();
          if (req.task === "summary" && messages.length) messages[messages.length - 1] = { role: "user", content: summaryInstruction(s) };
          let thinkingSent = false;
          const res = await streamText(
            { provider: r.provider, modelId: r.modelId, apiKey, system: pageSystemPrompt(s, req.task, req.page), messages, signal: ac.signal, temperature: s.chat.temperature, maxTokens: s.chat.maxTokens },
            {
              onDelta: (text) => send({ type: "delta", id: req.id, text }),
              onThinking: () => {
                if (!thinkingSent) send({ type: "thinking", id: req.id });
                thinkingSent = true;
              },
            },
          );
          send({ type: "done", id: req.id, stopReason: res.stopReason });
        } catch (e) {
          const err = e as Error;
          if (err?.name === "AbortError" || ac.signal.aborted) send({ type: "done", id: req.id, stopReason: "aborted" });
          else send({ type: "error", id: req.id, message: redactSecrets(err?.message ?? String(e), [apiKey]) });
        } finally {
          running.delete(req.id);
        }
      });
    });

    // ---- entry points: shortcut + context menu ----
    chrome.commands.onCommand.addListener((command, tab) => {
      if (command === "toggle-translate" && tab?.id) toggleTranslate(tab.id).catch(() => {});
    });
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (!tab?.id) return;
      if (info.menuItemId === "pp-translate") toggleTranslate(tab.id).catch(() => {});
      if (info.menuItemId === "pp-summarize") {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
        chrome.storage.session.set({ pendingAction: { type: "summarize", tabId: tab.id, at: Date.now() } });
      }
    });
  },
});
