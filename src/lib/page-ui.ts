import { tr } from "@/src/i18n";

/** Catalog strings are ours, but escape anyway: a future translation must not be able to inject markup. */
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** Shadow-DOM UI injected into web pages: floating button + selection action toolbar + translation card. No chrome.* here. */

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.fab { position: fixed; right: 0; top: 62%; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 10px 0 9px; border-radius: 19px 0 0 19px; border: 1px solid rgba(0,0,0,.06); border-right: 0;
  background: #fff; color: #4f46e5; cursor: pointer; box-shadow: 0 8px 28px -6px rgba(16,24,40,.22), 0 2px 6px rgba(16,24,40,.06);
  transform: translateX(14px); user-select: none; }
.fab svg { width: 20px; height: 20px; flex: none; }
.fab.on { background: #4f46e5; color: #fff; }
.fab .x { display: none; width: 16px; height: 16px; border-radius: 8px; place-items: center; font-size: 11px; color: inherit; opacity: .55; }
.toolbar { position: fixed; z-index: 2147483647; display: inline-flex; align-items: center; padding: 4px;
  border-radius: 12px; background: #fff; color: #18181b; border: 1px solid rgba(0,0,0,.08);
  box-shadow: 0 8px 24px -4px rgba(16,24,40,.16), 0 2px 6px rgba(16,24,40,.06); user-select: none; }
.tb-group { display: inline-flex; align-items: center; }
.tb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-inline-size: 24px; min-block-size: 28px; padding: 0 10px; border-radius: 8px;
  font-size: 13.5px; font-weight: 500; line-height: 1; color: #18181b; white-space: nowrap; }
.tb-btn svg { width: 16px; height: 16px; flex: none; display: block; }
.tb-btn:focus-visible, .btn:focus-visible, .close:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
.tb-sep { display: inline-block; inline-size: 0; block-size: 14px; margin: 0 2px; border-inline-start: 1px solid rgba(0,0,0,.12); flex: none; }
.card { position: fixed; z-index: 2147483647; width: 340px; max-width: calc(100vw - 16px); border-radius: 16px; background: #fff; color: #18181b;
  border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 28px -6px rgba(16,24,40,.22), 0 2px 6px rgba(16,24,40,.06); overflow: hidden; }
.hd { display: flex; align-items: center; gap: 6px; padding: 10px 12px 0; font-size: 12px; color: #71717a; }
.hd svg { width: 14px; height: 14px; color: #4f46e5; flex: none; }
.hd b { color: #4f46e5; font-weight: 600; flex: 1; }
.src { padding: 6px 12px 0; font-size: 12.5px; line-height: 1.55; color: #71717a; max-height: 72px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.out { padding: 8px 12px 12px; font-size: 14px; line-height: 1.65; white-space: pre-wrap; max-height: 260px; overflow: auto; }
.err { color: #e11d48; }
.ft { display: flex; align-items: center; gap: 6px; padding: 8px 10px; background: #f6f6f8; }
button { all: unset; cursor: pointer; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-inline-size: 28px; min-block-size: 28px; padding: 0 10px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: #3f3f46; }
.btn.icon-only { padding: 0; inline-size: 28px; block-size: 28px; }
.btn svg { width: 15px; height: 15px; flex: none; display: block; }
.btn.primary { background: #4f46e5; color: #fff; margin-left: auto; }
.close { min-inline-size: 24px; min-block-size: 24px; border-radius: 8px; display: grid; place-items: center; color: #a1a1aa; font-size: 13px; }
.sk { height: 10px; border-radius: 5px; background: linear-gradient(90deg,#f1f1f4,#e7e7ec,#f1f1f4); background-size: 200% 100%; animation: sh 1.2s infinite; margin: 6px 0; }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; padding: 9px 14px; border-radius: 12px;
  background: #18181b; color: #fafafa; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,.18); }
@keyframes sh { to { background-position: -200% 0; } }
@keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .fab { transition: transform .18s cubic-bezier(.2,.8,.2,1), background .15s; }
  .toolbar, .toast { animation: in .15s ease-out; }
  .card { animation: in .18s cubic-bezier(.2,.8,.2,1); }
}
@media (hover: hover) {
  .fab:hover { transform: translateX(0); }
  .fab:hover .x { display: grid; }
  .fab .x:hover { opacity: 1; }
  .tb-btn:hover { background: #f4f4f5; }
  .btn:hover { background: #ececf1; }
  .btn.primary:hover { background: #4338ca; }
  .close:hover { background: #f1f1f4; color: #18181b; }
}
@media (pointer: coarse) {
  .tb-btn { min-block-size: 34px; padding: 0 12px; }
}
@media (prefers-color-scheme: dark) {
  .fab { background: #232329; color: #a5b4fc; border-color: rgba(255,255,255,.08); }
  .fab.on { background: #6366f1; color: #fff; }
  .toolbar { background: #232329; color: #f4f4f5; border-color: rgba(255,255,255,.1); }
  .tb-btn { color: #f4f4f5; }
  .tb-sep { border-inline-start-color: rgba(255,255,255,.14); }
  .card { background: #232329; color: #ececf1; border-color: rgba(255,255,255,.08); }
  .ft { background: #1f1f25; } .btn { color: #d4d4d8; }
  .hd b { color: #a5b4fc; }
  .sk { background: linear-gradient(90deg,#2a2a31,#34343d,#2a2a31); background-size: 200% 100%; }
}
@media (prefers-color-scheme: dark) and (hover: hover) {
  .tb-btn:hover { background: #2e2e36; }
  .btn:hover { background: #2e2e36; }
  .close:hover { background: #2e2e36; color: #fff; }
}
@media (forced-colors: active) {
  .toolbar, .card { border: 1px solid ButtonText; }
  .tb-btn, .btn, .close { color: ButtonText; }
  .tb-btn:focus-visible, .btn:focus-visible, .close:focus-visible { outline-color: Highlight; }
}
`;

const ICON_TRANSLATE = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const ICON_EXPLAIN = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>`;
const ICON_COPY = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const ICON_CHECK = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const ICON_MASCOT = `<svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none"><defs><radialGradient id="pp-mg" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#93c5fd"/><stop offset="50%" stop-color="#4f46e5"/><stop offset="100%" stop-color="#3730a3"/></radialGradient></defs><circle cx="10" cy="10.5" r="8" fill="url(#pp-mg)"/><path d="M13.5 1.8 L17.8 2.2 L15.2 5.6 Z" fill="#22c55e"/><rect x="6.5" y="7.8" width="2.1" height="4.1" rx="1.05" fill="#fff" transform="rotate(-6 7.5 9.8)"/><rect x="11.1" y="7.8" width="2.1" height="4.1" rx="1.05" fill="#fff" transform="rotate(-6 12.1 9.8)"/></svg>`;

export interface PageUiHandlers {
  onFabClick: () => void;
  onFabOpenPanel: () => void;
  onFabDismiss: () => void;
  translateSelection: (text: string) => Promise<string>;
  askInPanel: (text: string) => void;
  explainInPanel?: (text: string) => void;
}

export class PageUi {
  private host: HTMLElement;
  private root: ShadowRoot;
  private fab: HTMLElement | null = null;
  private dot: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private downPos = { x: 0, y: 0 };
  private upTimer: number | undefined;
  private destroyed = false;
  private onDocMouseUp = (e: MouseEvent) => this.onMouseUp(e);
  private onDocMouseDown = (e: MouseEvent) => {
    if (!this.isAlive()) return;
    this.downPos = { x: e.clientX, y: e.clientY };
    if (!e.composedPath().includes(this.host)) this.hideSelection();
  };
  private onDocKeyDown = (e: KeyboardEvent) => {
    if (!this.isAlive()) return;
    if (e.key === "Escape") this.hideSelection();
  };
  private onWinScroll = () => {
    if (!this.isAlive()) return;
    if (this.dot) this.hideDot();
  };
  selectionEnabled = true;

  constructor(private h: PageUiHandlers) {
    this.host = document.createElement("sidekick-ui");
    this.host.setAttribute("data-pp-ui", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = CSS;
    this.root.appendChild(st);
    this.purgeStaleHosts();
    document.documentElement.appendChild(this.host);
    document.addEventListener("mouseup", this.onDocMouseUp, true);
    document.addEventListener("mousedown", this.onDocMouseDown, true);
    document.addEventListener("keydown", this.onDocKeyDown, true);
    window.addEventListener("scroll", this.onWinScroll, { passive: true });
  }

  /** Remove any older <sidekick-ui> instances left over from extension reloads or duplicate injections. */
  private purgeStaleHosts() {
    document.querySelectorAll("sidekick-ui").forEach((el) => {
      if (el !== this.host) {
        el.setAttribute("data-pp-superseded", "");
        if (el.shadowRoot) el.shadowRoot.innerHTML = "";
        el.remove();
      }
    });
  }

  private isAlive(): boolean {
    if (this.destroyed) return false;
    const g = globalThis as unknown as { chrome?: { runtime?: { id?: string } } };
    const extDead = Boolean(g.chrome?.runtime && "id" in g.chrome.runtime && !g.chrome.runtime.id);
    if (!this.host.isConnected || this.host.hasAttribute("data-pp-superseded") || extDead) {
      this.destroy();
      return false;
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.upTimer);
    document.removeEventListener("mouseup", this.onDocMouseUp, true);
    document.removeEventListener("mousedown", this.onDocMouseDown, true);
    document.removeEventListener("keydown", this.onDocKeyDown, true);
    window.removeEventListener("scroll", this.onWinScroll);
    this.host.remove();
  }

  setFab(visible: boolean, active = false) {
    if (!this.isAlive()) return;
    this.purgeStaleHosts();
    if (!visible) {
      this.fab?.remove();
      this.fab = null;
      return;
    }
    if (!this.fab) {
      const f = document.createElement("div");
      f.className = "fab";
      f.setAttribute("role", "button");
      f.title = tr("page.fabTitle");
      f.innerHTML = `${ICON_TRANSLATE}<button class="x" title="${esc(tr("page.hideOnSite"))}">✕</button>`;
      let timer: number | undefined;
      let long = false;
      f.addEventListener("pointerdown", () => {
        long = false;
        timer = window.setTimeout(() => {
          long = true;
          this.h.onFabOpenPanel();
        }, 550);
      });
      f.addEventListener("pointerup", () => clearTimeout(timer));
      f.addEventListener("pointerleave", () => clearTimeout(timer));
      f.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("x")) return this.h.onFabDismiss();
        if (!long) this.h.onFabClick();
      });
      f.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.h.onFabOpenPanel();
      });
      this.root.appendChild(f);
      this.fab = f;
    }
    this.fab.classList.toggle("on", active);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.isAlive()) return;
    if (!this.selectionEnabled || e.composedPath().includes(this.host)) return;
    const upX = e.clientX;
    const upY = e.clientY;
    const downX = this.downPos.x;
    const downY = this.downPos.y;
    clearTimeout(this.upTimer);
    this.upTimer = window.setTimeout(() => {
      if (!this.isAlive()) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || !text || text.length > 3000 || sel.rangeCount === 0) return this.hideDot();
      const node = sel.anchorNode?.parentElement;
      if (node?.closest("input,textarea,[contenteditable=''],[contenteditable='true']")) return;
      const range = sel.getRangeAt(sel.rangeCount - 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return this.hideDot();

      const rects = Array.from(range.getClientRects?.() ?? []).filter((rc) => rc.width > 0 && rc.height > 0);
      const hasMouse = upX > 0 || upY > 0;
      const draggedUp = hasMouse && (downX > 0 || downY > 0) && (upY < downY - 8 || (Math.abs(upY - downY) <= 8 && upX < downX - 8));

      let lineTop = r.top;
      let lineBottom = r.bottom;
      let anchorX = r.right;

      if (hasMouse) {
        anchorX = upX;
        if (rects.length > 0) {
          // Pick the text line rect closest to the cursor release point so multi-line selections anchor at the cursor's line.
          const best = rects.reduce((acc, rc) => {
            const distAcc = upY >= acc.top && upY <= acc.bottom ? 0 : Math.min(Math.abs(upY - acc.top), Math.abs(upY - acc.bottom));
            const distRc = upY >= rc.top && upY <= rc.bottom ? 0 : Math.min(Math.abs(upY - rc.top), Math.abs(upY - rc.bottom));
            return distRc < distAcc ? rc : acc;
          }, rects[rects.length - 1]);
          lineTop = best.top;
          lineBottom = best.bottom;
        } else if (r.height > 44) {
          lineTop = Math.max(r.top, upY - 14);
          lineBottom = Math.min(r.bottom, upY + 14);
        }
      } else if (rects.length > 0) {
        const last = rects[rects.length - 1];
        anchorX = last.right;
        lineTop = last.top;
        lineBottom = last.bottom;
      }

      this.showDot(text, { anchorX, lineTop, lineBottom, draggedUp });
    }, 10);
  }

  private showDot(text: string, pos: { anchorX: number; lineTop: number; lineBottom: number; draggedUp: boolean }) {
    if (!this.isAlive()) return;
    this.purgeStaleHosts();
    this.hideDot();
    const bar = document.createElement("div");
    bar.className = "toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("focusgroup", "toolbar wrap");
    bar.setAttribute("aria-label", tr("page.selectionToolbar"));
    bar.setAttribute("data-testid", "pp-selection-toolbar");
    bar.innerHTML = `<div class="tb-group" role="group" aria-label="${esc(tr("page.selectionTitle"))}">
        <button type="button" class="tb-btn" data-testid="pp-selection-dot">${ICON_TRANSLATE}<span>${esc(tr("page.selectionTranslate"))}</span></button>
      </div>
      <span class="tb-sep" role="separator" aria-orientation="vertical"></span>
      <div class="tb-group" role="group" aria-label="${esc(tr("brand.header"))}">
        <button type="button" class="tb-btn" data-testid="pp-selection-explain">${ICON_EXPLAIN}<span>${esc(tr("page.selectionExplain"))}</span></button>
        <span class="tb-sep" role="separator" aria-orientation="vertical"></span>
        <button type="button" class="tb-btn tb-ask" data-testid="pp-selection-ask">${ICON_MASCOT}<span>${esc(tr("page.selectionAsk"))}</span></button>
      </div>`;
    bar.addEventListener("mousedown", (e) => e.preventDefault());

    if (!("focusGroup" in HTMLElement.prototype)) {
      const items = Array.from(bar.querySelectorAll<HTMLButtonElement>("button.tb-btn"));
      items.forEach((b, i) => (b.tabIndex = i ? -1 : 0));
      bar.addEventListener("focusin", ({ target }) => {
        if (items.includes(target as HTMLButtonElement)) {
          items.forEach((b) => (b.tabIndex = b === target ? 0 : -1));
        }
      });
      bar.addEventListener("keydown", (ev) => {
        const vertical = bar.getAttribute("aria-orientation") === "vertical";
        const rtl = getComputedStyle(bar).direction === "rtl";
        const steps: Record<string, number> = vertical
          ? { ArrowDown: 1, ArrowUp: -1 }
          : { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
        const cur = items.indexOf(bar.ownerDocument.activeElement as HTMLButtonElement);
        const activeIdx = cur >= 0 ? cur : items.findIndex((b) => b.tabIndex === 0);
        let next = -1;
        if (ev.key in steps) {
          next = (Math.max(0, activeIdx) + steps[ev.key] + items.length) % items.length;
        } else if (ev.key === "Home") {
          next = 0;
        } else if (ev.key === "End") {
          next = items.length - 1;
        }
        if (next >= 0 && items[next]) {
          ev.preventDefault();
          items[next].focus();
        }
      });
    }

    this.root.appendChild(bar);
    const bw = bar.offsetWidth || 216;
    const bh = bar.offsetHeight || 38;
    const left = Math.max(8, Math.min(Math.round(pos.anchorX - bw / 2), innerWidth - bw - 8));
    const preferAbove = pos.draggedUp && pos.lineTop >= bh + 12;
    const fitsBelow = pos.lineBottom + 10 + bh <= innerHeight - 8;
    const top = preferAbove || !fitsBelow
      ? Math.max(8, Math.round(pos.lineTop - bh - 8))
      : Math.max(8, Math.round(pos.lineBottom + 10));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;

    const cardX = Math.max(8, Math.min(pos.anchorX, innerWidth - 36));
    const cardY = Math.min(pos.lineBottom + 8, innerHeight - 36);
    bar.querySelector('[data-testid="pp-selection-dot"]')!.addEventListener("click", () => this.showCard(text, cardX, cardY));
    bar.querySelector('[data-testid="pp-selection-explain"]')!.addEventListener("click", () => {
      this.hideSelection();
      this.h.explainInPanel?.(text);
    });
    bar.querySelector('[data-testid="pp-selection-ask"]')!.addEventListener("click", () => {
      this.hideSelection();
      this.h.askInPanel(text);
    });

    this.dot = bar;
  }
  private hideDot() {
    clearTimeout(this.upTimer);
    this.dot?.remove();
    this.dot = null;
    this.root.querySelectorAll(".toolbar").forEach((el) => el.remove());
  }
  hideSelection() {
    this.hideDot();
    this.card?.remove();
    this.card = null;
    this.root.querySelectorAll(".card").forEach((el) => el.remove());
  }

  /** Public so the context menu "翻译选中文字" can open the card directly. */
  async showCard(text: string, x?: number, y?: number) {
    if (!this.isAlive()) return;
    this.purgeStaleHosts();
    this.hideSelection();
    if (x == null || y == null) {
      const sel = window.getSelection();
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      x = r ? r.left : innerWidth / 2 - 170;
      y = r ? r.bottom + 8 : 80;
    }
    const c = document.createElement("div");
    c.className = "card";
    c.setAttribute("data-pp-card", "");
    c.style.left = `${Math.max(8, Math.min(x - 160, innerWidth - 348))}px`;
    c.style.top = `${y + 280 > innerHeight ? Math.max(8, y - 300) : y}px`;
    c.innerHTML = `<div class="hd">${ICON_TRANSLATE}<b>${esc(tr("page.selectionTitle"))}</b><button class="close" title="${esc(tr("common.close"))}" aria-label="${esc(tr("common.close"))}">✕</button></div>
      <div class="src"></div><div class="out"><div class="sk" style="width:92%"></div><div class="sk" style="width:70%"></div></div>
      <div class="ft"><button class="btn icon-only copy" title="${esc(tr("common.copy"))}" aria-label="${esc(tr("common.copy"))}">${ICON_COPY}</button><button class="btn primary ask" title="${esc(tr("page.askInPanel"))}" aria-label="${esc(tr("page.askInPanel"))}">${ICON_MASCOT}<span>${esc(tr("page.selectionAsk"))}</span></button></div>`;
    (c.querySelector(".src") as HTMLElement).textContent = text;
    c.querySelector(".close")!.addEventListener("click", () => this.hideSelection());
    const out = c.querySelector(".out") as HTMLElement;
    let result = "";
    const copyBtn = c.querySelector(".copy") as HTMLButtonElement;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(result || text).catch(() => {});
      copyBtn.innerHTML = ICON_CHECK;
      setTimeout(() => {
        if (copyBtn.isConnected) copyBtn.innerHTML = ICON_COPY;
      }, 1200);
    });
    c.querySelector(".ask")!.addEventListener("click", () => {
      this.h.askInPanel(text);
      this.hideSelection();
    });
    this.root.appendChild(c);
    this.card = c;
    try {
      result = await this.h.translateSelection(text);
      out.textContent = result;
      out.setAttribute("data-done", "");
    } catch (e) {
      out.innerHTML = "";
      const span = document.createElement("span");
      span.className = "err";
      span.textContent = (e as Error).message;
      out.appendChild(span);
    }
  }

  /** Short notice at the bottom of the page (e.g. when the side panel could not be opened). */
  toast(text: string, ms = 4000) {
    this.root.querySelector(".toast")?.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("data-testid", "pp-toast");
    t.textContent = text;
    this.root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  /** For tests / debugging. */
  cardText() {
    return this.card?.querySelector(".out")?.textContent ?? "";
  }
}
