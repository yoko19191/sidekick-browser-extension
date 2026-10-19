import { makeBatches, shouldTranslate } from "@/src/lib/batch";
import { extractPage } from "@/src/lib/extract";
import { collectParagraphs, insertTranslation, markPending, restoreOriginal, TRANSLATION_CSS } from "@/src/lib/paragraphs";
import type { Settings, TranslateState } from "@/src/lib/types";

/**
 * Injected on demand (chrome.scripting.executeScript) — never declared in the manifest.
 * It never sees API keys: it sends paragraph text to the service worker and receives translations.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    const w = window as unknown as { __pagepilot?: boolean };
    if (w.__pagepilot) return;
    w.__pagepilot = true;

    type TSettings = Settings["translation"];
    let cfg: TSettings | null = null;
    let active = false;
    let state: TranslateState = { active: false, total: 0, done: 0, errors: 0 };
    let io: IntersectionObserver | null = null;
    let mo: MutationObserver | null = null;
    let queue: { el: Element; text: string }[] = [];
    let inflight = 0;
    let flushTimer: number | undefined;
    let seen = new WeakSet<Element>();

    const report = () => {
      state = { ...state, active };
      chrome.runtime.sendMessage({ type: "translate:state", state }).catch(() => {});
    };

    const ensureStyle = () => {
      if (document.getElementById("pp-style")) return;
      const st = document.createElement("style");
      st.id = "pp-style";
      st.setAttribute("data-pp-ui", "");
      st.textContent = TRANSLATION_CSS;
      (document.head ?? document.documentElement).appendChild(st);
    };

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
        state.total++;
        io?.observe(p.el);
      }
      report();
    }

    function enqueue(el: Element) {
      if (!cfg) return;
      const text = collectParagraphs(el, { skipSelectors: cfg.skipSelectors }).find((p) => p.el === el)?.text;
      if (!text) return;
      markPending(el, true);
      queue.push({ el, text });
      clearTimeout(flushTimer);
      flushTimer = window.setTimeout(pump, 60);
    }

    async function pump() {
      if (!cfg || !active) return;
      while (inflight < cfg.concurrency && queue.length) {
        const [batch] = makeBatches(
          queue.map((q, i) => ({ id: i, text: q.text })),
          { maxChars: cfg.batchMaxChars, maxItems: cfg.batchMaxItems },
        );
        const items = queue.splice(0, batch.length);
        inflight++;
        runBatch(items).finally(() => {
          inflight--;
          pump();
        });
      }
    }

    async function runBatch(items: { el: Element; text: string }[]) {
      try {
        const res = await chrome.runtime.sendMessage({ type: "translate:batch", texts: items.map((i) => i.text) });
        if (!res?.ok) throw new Error(res?.error ?? "翻译失败");
        if (!active) return;
        (res.data as string[]).forEach((t, i) => {
          markPending(items[i].el, false);
          if (t) insertTranslation(items[i].el, t, { lang: cfg!.targetLang, style: cfg!.style });
          state.done++;
        });
      } catch (e) {
        items.forEach((i) => {
          markPending(i.el, false);
          seen.delete(i.el); // allow retry on the next toggle
        });
        state.errors += items.length;
        state.lastError = (e as Error).message;
      }
      report();
    }

    function start(s: TSettings) {
      cfg = s;
      active = true;
      state = { active: true, total: 0, done: 0, errors: 0 };
      ensureStyle();
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
      if (s.autoTranslateDynamic) {
        let pending: Element[] = [];
        let t: number | undefined;
        mo = new MutationObserver((muts) => {
          for (const m of muts)
            m.addedNodes.forEach((n) => {
              if (n.nodeType !== 1) return;
              const el = n as Element;
              if (el.closest("[data-pp-ui]") || el.classList?.contains("pp-trans")) return;
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
      io?.disconnect();
      mo?.disconnect();
      io = mo = null;
      queue = [];
      seen = new WeakSet();
      restoreOriginal(document);
      state = { active: false, total: 0, done: 0, errors: 0 };
      report();
    }

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg?.type) {
        case "pp:ping":
          sendResponse({ ok: true });
          return;
        case "translate:toggle": {
          const want = msg.force ?? !active;
          if (want && !active) start(msg.settings);
          else if (!want && active) stop();
          sendResponse({ ...state, active });
          return;
        }
        case "translate:status":
          sendResponse({ ...state, active });
          return;
        case "page:extract":
          sendResponse(extractPage(document));
          return;
      }
    });
  },
});
