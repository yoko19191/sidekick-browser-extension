import { makeBatches, shouldTranslate } from "@/src/lib/batch";
import { extractPage } from "@/src/lib/extract";
import { normalizeText } from "@/src/lib/hash";
import { PageUi } from "@/src/lib/page-ui";
import { collectParagraphs, insertTranslation, markPending, restoreOriginal, TRANSLATION_CSS } from "@/src/lib/paragraphs";
import type { Settings, TranslateState } from "@/src/lib/types";

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
    const host = location.host;

    const send = <T = unknown>(msg: Record<string, unknown>) =>
      chrome.runtime.sendMessage(msg).then((r) => {
        if (!r?.ok) throw new Error(r?.error ?? "后台无响应");
        return r.data as T;
      });

    // The SW opens the side panel inside our click's user-gesture window. If Chrome refuses anyway, the request
    // stays in storage.session and the panel picks it up when the user opens it from the toolbar.
    const openPanel = (msg: Record<string, unknown>) =>
      send<{ opened: boolean }>(msg)
        .then((r) => r.opened)
        .catch(() => false)
        .then((ok) => ok || ui.toast("点工具栏的翻翻图标继续"));

    const ui = new PageUi({
      onFabClick: () => send({ type: "translate:self-toggle" }).catch(() => {}),
      onFabOpenPanel: () => openPanel({ type: "panel:open" }),
      onFabDismiss: () => ui.setFab(false),
      translateSelection: async (text) => (await send<{ translation: string }>({ type: "translate:selection", text })).translation,
      askInPanel: (text) => openPanel({ type: "panel:ask", text }),
    });

    const applyConfig = (s: TSettings) => {
      cfg = s;
      const never = s.neverSites.includes(host);
      ui.selectionEnabled = s.selectionTranslate && !never;
      ui.setFab(s.floatingButton && !never, active);
      document.documentElement.classList.toggle("pp-only", s.displayMode === "translation-only");
    };

    const report = () => {
      state = { ...state, active };
      ui.setFab(!!cfg?.floatingButton && !cfg.neverSites.includes(host), active);
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
    ensureStyle();

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
      el.querySelectorAll(":scope > .pp-failed").forEach((n) => n.remove());
      markPending(el, true);
      queue.push({ el, text });
      clearTimeout(flushTimer);
      flushTimer = window.setTimeout(pump, 60);
    }

    function pump() {
      if (!cfg || !active) return;
      while (inflight < cfg.concurrency && queue.length) {
        const [batch] = makeBatches(queue.map((q, i) => ({ id: i, text: q.text })), { maxChars: cfg.batchMaxChars, maxItems: cfg.batchMaxItems });
        const items = queue.splice(0, batch.length);
        inflight++;
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
      b.textContent = "翻译失败 · 重试";
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
      io?.disconnect();
      mo?.disconnect();
      io = mo = null;
      queue = [];
      seen = new WeakSet();
      restoreOriginal(document);
      state = { active: false, total: 0, done: 0, errors: 0 };
      report();
    }

    /** Scroll to and flash the block containing a verbatim excerpt (answer citations). */
    function locate(excerpt: string): boolean {
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
      switch (msg?.type) {
        case "pp:ping":
          sendResponse({ ok: true });
          return;
        case "pp:config":
          applyConfig(msg.settings);
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
        case "page:locate":
          sendResponse({ found: locate(String(msg.text ?? "")) });
          return;
        case "selection:show":
          ui.showCard(String(msg.text ?? ""));
          sendResponse({ ok: true });
          return;
      }
    });
  },
});
