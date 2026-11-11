import { makeBatches, shouldTranslate } from "@/src/lib/batch";
import { extractPage } from "@/src/lib/extract";
import { normalizeText } from "@/src/lib/hash";
import { PageUi } from "@/src/lib/page-ui";
import { collectParagraphs, insertTranslation, markPending, restoreOriginal, setupHoverTranslate, TRANSLATION_CSS } from "@/src/lib/paragraphs";
import { extractVideoTranscriptMarkdown, hasVideoSubtitlesAvailable, loadVideoSubtitleDomainEnabled, VIDEO_SUBTITLE_CSS, VideoSubtitleController } from "@/src/lib/video-subtitles";
import type { Settings, TranslateState } from "@/src/lib/types";
import { setLocale, tr } from "@/src/i18n";
import { handleAgentMessage } from "@/src/agent/page/content-host";
import { hostPdfTab, isPdfDocument } from "@/src/lib/pdf/tab-host";

/**
 * Injected on demand (chrome.scripting.executeScript) — never declared in the manifest.
 * It never sees API keys: it sends text to the service worker and receives translations.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    const w = window as unknown as { __sidekick?: boolean };
    if (w.__sidekick) return;
    w.__sidekick = true;
    if (isPdfDocument()) return hostPdfTab();

    type TSettings = Settings["translation"];
    let cfg: TSettings | null = null;
    let active = false;
    let state: TranslateState = { active: false, total: 0, done: 0, errors: 0 };
    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let queue: { el: Element; text: string; inViewport?: boolean }[] = [];
    let inflight = 0;
    let dispatchedBatches = 0;
    let flushTimer: number | undefined;
    let seen = new WeakSet<Element>();
    let paraText = new WeakMap<Element, string>();
    const host = location.host;

    const send = <T = unknown>(msg: Record<string, unknown>) =>
      chrome.runtime.sendMessage(msg).then((r) => {
        if (!r?.ok) throw new Error(r?.error ?? tr("common.noResponse"));
        return r.data as T;
      });

    // The SW opens the side panel inside our click's user-gesture window. If Chrome refuses anyway, the request
    // stays in storage.session and the panel picks it up when the user opens it from the toolbar.
    const openPanel = (msg: Record<string, unknown>) =>
      send<{ opened: boolean }>(msg)
        .then((r) => r.opened)
        .catch(() => false)
        .then((ok) => ok || ui.toast(tr("page.openPanelFallback")));

    const ui = new PageUi({
      onFabClick: () => send({ type: "translate:self-toggle" }).catch(() => {}),
      onFabOpenPanel: () => openPanel({ type: "panel:open" }),
      onFabDismiss: () => ui.setFab(false),
      translateSelection: async (text) => (await send<{ translation: string }>({ type: "translate:selection", text })).translation,
      askInPanel: (text) => openPanel({ type: "panel:ask", text }),
      explainInPanel: (text) => openPanel({ type: "panel:explain", text }),
    });

    const applyConfig = (s: TSettings, uiLocale?: string) => {
      if (uiLocale) setLocale(uiLocale);
      cfg = s;
      const never = s.neverSites.includes(host);
      ui.selectionEnabled = s.selectionTranslate && !never;
      ui.setFab(s.floatingButton && !never, active);
      document.documentElement.classList.toggle("pp-only", s.displayMode === "translation-only");
      subtitleCtrl.setControlBarEnabled(!never, s);
      subtitleCtrl.updateConfig(s);
    };

    const report = () => {
      state = {
        ...state,
        active,
        subtitlesActive: subtitleCtrl.isActive(),
        videoSubtitlesAvailable: hasVideoSubtitlesAvailable(document),
      };
      ui.setFab(!!cfg?.floatingButton && !cfg.neverSites.includes(host), active);
      chrome.runtime.sendMessage({ type: "translate:state", state }).catch(() => {});
    };

    const subtitleCtrl = new VideoSubtitleController({
      doc: document,
      translateBatch: (texts, contextBefore) =>
        send<string[]>({ type: "translate:batch", texts, mode: "subtitle", contextBefore }),
      onStatsChange: ({ total = 0, done = 0, errors = 0 }) => {
        if (!active) return;
        state.total += total;
        state.done += done;
        state.errors += errors;
        report();
      },
    });

    const ensureStyle = () => {
      if (document.getElementById("pp-style")) return;
      const st = document.createElement("style");
      st.id = "pp-style";
      st.setAttribute("data-pp-ui", "");
      st.textContent = `${TRANSLATION_CSS}\n${VIDEO_SUBTITLE_CSS}`;
      (document.head ?? document.documentElement).appendChild(st);
    };
    ensureStyle();
    subtitleCtrl.setControlBarEnabled(true);
    setupHoverTranslate({
      doc: document,
      getKey: () => cfg?.hoverTranslateKey ?? "Shift",
      getTargetLang: () => cfg?.targetLang ?? "zh-CN",
      getStyle: () => cfg?.style ?? "green",
      getSkipSelectors: () => cfg?.skipSelectors ?? "",
      isDisabled: () => Boolean(cfg?.neverSites.includes(host)),
      translateOne: async (text) => {
        ensureStyle();
        const res = await send<string[]>({ type: "translate:batch", texts: [text] });
        return res?.[0] ?? "";
      },
    });
    send<TSettings & { uiLocale?: string }>({ type: "pp:get-config" })
      .then((s) => {
        if (s && !cfg) applyConfig(s, s.uiLocale);
      })
      .catch(() => {});

    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect?.();
      if (!r || (r.width === 0 && r.height === 0)) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };

    function scan(root: Element) {
      if (!cfg) return;
      const paras = collectParagraphs(root, { skipSelectors: cfg.skipSelectors, isVisible }).filter((p) => shouldTranslate(p.text, cfg!.targetLang));
      for (const p of paras) {
        if (seen.has(p.el)) continue;
        seen.add(p.el);
        paraText.set(p.el, p.text);
        state.total++;
        io?.observe(p.el);
      }
      report();
    }

    function enqueue(el: Element) {
      if (!cfg) return;
      const text = paraText.get(el) ?? collectParagraphs(el, { skipSelectors: cfg.skipSelectors }).find((p) => p.el === el)?.text;
      if (!text) return;
      el.querySelectorAll(":scope > .pp-failed").forEach((n) => n.remove());
      markPending(el, true);
      const r = (el as HTMLElement).getBoundingClientRect?.();
      const inViewport = !!r && r.bottom > 0 && r.top < (window.innerHeight || 800);
      queue.push({ el, text, inViewport });
      clearTimeout(flushTimer);
      flushTimer = window.setTimeout(pump, 12);
    }

    function pump() {
      if (!cfg || !active) return;
      // Prioritize paragraphs actually inside the current viewport ahead of the 800px rootMargin buffer.
      queue.sort((a, b) => (a.inViewport === b.inViewport ? 0 : a.inViewport ? -1 : 1));
      const maxConcurrency = Math.max(cfg.concurrency, 4);
      while (inflight < maxConcurrency && queue.length) {
        // Progressive micro-batching: keep the first 2 batches small so the top of the page renders in ~1s.
        const fastFirstScreen = dispatchedBatches < 2;
        const maxChars = fastFirstScreen ? Math.min(500, cfg.batchMaxChars) : cfg.batchMaxChars;
        const maxItems = fastFirstScreen ? Math.min(4, cfg.batchMaxItems) : cfg.batchMaxItems;
        const [batch] = makeBatches(queue.map((q, i) => ({ id: i, text: q.text })), { maxChars, maxItems });
        const items = queue.splice(0, batch.length);
        inflight++;
        dispatchedBatches++;
        runBatch(items).finally(() => {
          inflight--;
          pump();
        });
      }
    }

    function markFailed(el: Element) {
      const span = document.createElement("span");
      span.className = "pp-trans pp-failed";
      span.setAttribute("data-pp-ui", "");
      const b = document.createElement("button");
      b.className = "pp-retry";
      b.textContent = tr("page.retryFailed");
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.errors = Math.max(0, state.errors - 1);
        enqueue(el);
      });
      span.appendChild(b);
      el.appendChild(span);
    }

    async function runBatch(items: { el: Element; text: string }[]) {
      try {
        const data = await send<string[]>({ type: "translate:batch", texts: items.map((i) => i.text) });
        if (!active) return;
        data.forEach((t, i) => {
          const el = items[i].el as HTMLElement;
          markPending(el, false);
          if (t) {
            el.style.setProperty("--pp-fs", getComputedStyle(el).fontSize);
            insertTranslation(el, t, { lang: cfg!.targetLang, style: cfg!.style });
          }
          state.done++;
        });
      } catch (e) {
        if (!active) return;
        items.forEach((i) => {
          markPending(i.el, false);
          markFailed(i.el);
        });
        state.errors += items.length;
        state.lastError = (e as Error).message;
      }
      report();
    }

    function start(s: TSettings) {
      applyConfig(s);
      active = true;
      dispatchedBatches = 0;
      state = { active: true, total: 0, done: 0, errors: 0 };
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) {
              io?.unobserve(e.target);
              enqueue(e.target);
            }
        },
        { rootMargin: "800px 0px" },
      );
      scan(document.body);
      subtitleCtrl.start(s);
      if (s.autoTranslateDynamic) {
        let pending: Element[] = [];
        let t: number | undefined;
        mo = new MutationObserver((muts) => {
          for (const m of muts)
            m.addedNodes.forEach((n) => {
              if (n.nodeType !== 1) return;
              const el = n as Element;
              if (el.closest("[data-pp-ui]") || el.classList?.contains("pp-trans") || el.tagName === "SIDEKICK-UI") return;
              pending.push(el);
            });
          if (!pending.length) return;
          clearTimeout(t);
          t = window.setTimeout(() => {
            const roots = pending.filter((el) => el.isConnected);
            pending = [];
            roots.forEach((r) => scan(r.parentElement ?? r));
          }, 250);
        });
        mo.observe(document.body, { childList: true, subtree: true });
      }
    }

    function stop() {
      active = false;
      if (!loadVideoSubtitleDomainEnabled(document)) {
        subtitleCtrl.stop();
      }
      io?.disconnect();
      mo?.disconnect();
      io = mo = null;
      queue = [];
      dispatchedBatches = 0;
      seen = new WeakSet();
      paraText = new WeakMap();
      chrome.runtime.sendMessage({ type: "translate:abort" }).catch(() => {});
      restoreOriginal(document);
      state = { active: false, total: 0, done: 0, errors: 0 };
      report();
    }

    /** Scroll to and flash the block containing a verbatim excerpt (or seek video when a [MM:SS] timestamp is cited). */
    function locate(excerpt: string): boolean {
      const tsMatch = excerpt.match(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/);
      if (tsMatch) {
        const video = document.querySelector("video");
        if (video) {
          const sec = tsMatch[3] != null
            ? Number(tsMatch[1]) * 3600 + Number(tsMatch[2]) * 60 + Number(tsMatch[3])
            : Number(tsMatch[1]) * 60 + Number(tsMatch[2]);
          video.currentTime = sec;
          video.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
      }
      const needle = normalizeText(excerpt).replace(/^["“'「]+|["”'」.。…]+$/g, "").toLowerCase();
      if (needle.length < 4) return false;
      const probes = [needle, needle.slice(0, 48), needle.slice(0, 24)];
      const blocks = collectParagraphs(document.body, {});
      for (const probe of probes) {
        const hit = blocks.find((b) => b.text.toLowerCase().includes(probe)) ?? [...document.querySelectorAll(".pp-trans")].map((el) => ({ el: el.parentElement!, text: el.textContent ?? "" })).find((b) => normalizeText(b.text).toLowerCase().includes(probe));
        if (hit) {
          hit.el.scrollIntoView({ behavior: "smooth", block: "center" });
          hit.el.classList.add("pp-flash");
          setTimeout(() => hit.el.classList.remove("pp-flash"), 2000);
          return true;
        }
      }
      return false;
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (typeof msg?.type === "string" && msg.type.startsWith("agent:")) {
        handleAgentMessage(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
        return true;
      }
      switch (msg?.type) {
        case "pp:ping":
          sendResponse({ ok: true });
          return;
        case "pp:config":
          applyConfig(msg.settings, msg.uiLocale);
          sendResponse({ ok: true });
          return;
        case "translate:toggle": {
          const want = msg.force ?? !active;
          if (want && !active) start(msg.settings);
          else if (!want && active) stop();
          sendResponse({ ...state, active });
          return;
        }
        case "subtitles:toggle": {
          if (msg.settings) applyConfig(msg.settings);
          const subActive = subtitleCtrl.toggle(msg.force);
          sendResponse({ active: subActive });
          return;
        }
        case "translate:status":
          sendResponse({
            ...state,
            active,
            subtitlesActive: subtitleCtrl.isActive(),
            videoSubtitlesAvailable: hasVideoSubtitlesAvailable(document),
          });
          return;
        case "page:extract":
          (async () => {
            let extracted = extractPage(document);
            // If an SPA is still mounting its initial DOM, wait briefly (up to 450ms) for content to appear.
            for (let attempt = 0; attempt < 3 && (document.readyState === "loading" || extracted.markdown.length < 80); attempt++) {
              await new Promise((r) => setTimeout(r, 150));
              extracted = extractPage(document);
            }
            const videoTranscript = await extractVideoTranscriptMarkdown(document).catch(() => null);
            if (videoTranscript) {
              const pageTail = extracted.markdown ? extracted.markdown.slice(0, 4000) : "";
              const combined = pageTail
                ? `${videoTranscript}\n\n---\n\n${pageTail}`
                : videoTranscript;
              extracted = {
                ...extracted,
                markdown: combined,
                length: combined.length,
              };
            }
            sendResponse(extracted);
          })();
          return true;
        case "page:locate":
          sendResponse({ found: locate(String(msg.text ?? "")) });
          return;
        case "page:selection":
          sendResponse({ text: (getSelection()?.toString() ?? "").trim().slice(0, 4000) });
          return;
        case "selection:show":
          ui.showCard(String(msg.text ?? ""));
          sendResponse({ ok: true });
          return;
      }
    });
  },
});
