/** Shadow-DOM UI injected into web pages: floating button + selection-translation card. No chrome.* here. */

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.fab { position: fixed; right: 0; top: 62%; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 10px 0 9px; border-radius: 19px 0 0 19px; border: 1px solid rgba(0,0,0,.06); border-right: 0;
  background: #fff; color: #4f46e5; cursor: pointer; box-shadow: 0 8px 28px -6px rgba(16,24,40,.22), 0 2px 6px rgba(16,24,40,.06);
  transform: translateX(14px); transition: transform .18s cubic-bezier(.2,.8,.2,1), background .15s; user-select: none; }
.fab:hover { transform: translateX(0); }
.fab svg { width: 20px; height: 20px; flex: none; }
.fab.on { background: #4f46e5; color: #fff; }
.fab .x { display: none; width: 16px; height: 16px; border-radius: 8px; place-items: center; font-size: 11px; color: inherit; opacity: .55; }
.fab:hover .x { display: grid; }
.fab .x:hover { opacity: 1; }
.dot { position: fixed; z-index: 2147483647; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center;
  background: #4f46e5; color: #fff; cursor: pointer; box-shadow: 0 8px 28px -6px rgba(16,24,40,.3); animation: in .15s ease-out; }
.dot svg { width: 16px; height: 16px; }
.card { position: fixed; z-index: 2147483647; width: 340px; max-width: calc(100vw - 16px); border-radius: 16px; background: #fff; color: #18181b;
  border: 1px solid rgba(0,0,0,.06); box-shadow: 0 8px 28px -6px rgba(16,24,40,.22), 0 2px 6px rgba(16,24,40,.06); animation: in .18s cubic-bezier(.2,.8,.2,1); overflow: hidden; }
.hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; font-size: 12px; color: #71717a; }
.hd b { color: #4f46e5; font-weight: 600; flex: 1; }
.src { padding: 6px 12px 0; font-size: 12.5px; line-height: 1.55; color: #71717a; max-height: 72px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.out { padding: 8px 12px 12px; font-size: 14px; line-height: 1.65; white-space: pre-wrap; max-height: 260px; overflow: auto; }
.err { color: #e11d48; }
.ft { display: flex; gap: 6px; padding: 8px 10px; background: #f6f6f8; }
button { all: unset; cursor: pointer; }
.btn { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: #3f3f46; }
.btn:hover { background: #ececf1; }
.btn.primary { background: #4f46e5; color: #fff; margin-left: auto; }
.btn.primary:hover { background: #4338ca; }
.close { width: 22px; height: 22px; border-radius: 8px; display: grid; place-items: center; color: #a1a1aa; font-size: 13px; }
.close:hover { background: #f1f1f4; color: #18181b; }
.sk { height: 10px; border-radius: 5px; background: linear-gradient(90deg,#f1f1f4,#e7e7ec,#f1f1f4); background-size: 200% 100%; animation: sh 1.2s infinite; margin: 6px 0; }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 2147483647; padding: 9px 14px; border-radius: 12px;
  background: #18181b; color: #fafafa; font-size: 13px; box-shadow: 0 8px 28px rgba(0,0,0,.18); animation: in .18s ease-out; }
@keyframes sh { to { background-position: -200% 0; } }
@keyframes in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-color-scheme: dark) {
  .fab { background: #232329; color: #a5b4fc; border-color: rgba(255,255,255,.08); }
  .fab.on { background: #6366f1; color: #fff; }
  .card { background: #232329; color: #ececf1; border-color: rgba(255,255,255,.08); }
  .ft { background: #1f1f25; } .btn { color: #d4d4d8; } .btn:hover { background: #2e2e36; }
  .close:hover { background: #2e2e36; color: #fff; } .hd b { color: #a5b4fc; }
  .sk { background: linear-gradient(90deg,#2a2a31,#34343d,#2a2a31); background-size: 200% 100%; }
}
`;

const ICON_TRANSLATE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;

export interface PageUiHandlers {
  onFabClick: () => void;
  onFabOpenPanel: () => void;
  onFabDismiss: () => void;
  translateSelection: (text: string) => Promise<string>;
  askInPanel: (text: string) => void;
}

export class PageUi {
  private host: HTMLElement;
  private root: ShadowRoot;
  private fab: HTMLElement | null = null;
  private dot: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  selectionEnabled = true;

  constructor(private h: PageUiHandlers) {
    this.host = document.createElement("sidekick-ui");
    this.host.setAttribute("data-pp-ui", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const st = document.createElement("style");
    st.textContent = CSS;
    this.root.appendChild(st);
    document.documentElement.appendChild(this.host);
    document.addEventListener("mouseup", (e) => this.onMouseUp(e), true);
    document.addEventListener("mousedown", (e) => {
      if (!e.composedPath().includes(this.host)) this.hideSelection();
    }, true);
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.hideSelection(), true);
    window.addEventListener("scroll", () => this.dot && this.hideDot(), { passive: true });
  }

  setFab(visible: boolean, active = false) {
    if (!visible) {
      this.fab?.remove();
      this.fab = null;
      return;
    }
    if (!this.fab) {
      const f = document.createElement("div");
      f.className = "fab";
      f.setAttribute("role", "button");
      f.title = "点击：翻译 / 显示原文 · 右键或长按：打开侧栏";
      f.innerHTML = `${ICON_TRANSLATE}<button class="x" title="在本站隐藏">✕</button>`;
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
    if (!this.selectionEnabled || e.composedPath().includes(this.host)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || !text || text.length > 3000 || sel.rangeCount === 0) return this.hideDot();
      const node = sel.anchorNode?.parentElement;
      if (node?.closest("input,textarea,[contenteditable=''],[contenteditable='true']")) return;
      const r = sel.getRangeAt(sel.rangeCount - 1).getBoundingClientRect();
      this.showDot(text, Math.min(r.right + 4, innerWidth - 36), Math.min(r.bottom + 6, innerHeight - 36));
    }, 10);
  }

  private showDot(text: string, x: number, y: number) {
    this.hideDot();
    const d = document.createElement("button");
    d.className = "dot";
    d.title = "翻译选中文字";
    d.setAttribute("data-testid", "pp-selection-dot");
    d.innerHTML = ICON_TRANSLATE;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.addEventListener("click", () => this.showCard(text, x, y));
    this.root.appendChild(d);
    this.dot = d;
  }
  private hideDot() {
    this.dot?.remove();
    this.dot = null;
  }
  hideSelection() {
    this.hideDot();
    this.card?.remove();
    this.card = null;
  }

  /** Public so the context menu "翻译选中文字" can open the card directly. */
  async showCard(text: string, x?: number, y?: number) {
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
    c.innerHTML = `<div class="hd"><b>划词翻译</b><button class="close" title="关闭">✕</button></div>
      <div class="src"></div><div class="out"><div class="sk" style="width:92%"></div><div class="sk" style="width:70%"></div></div>
      <div class="ft"><button class="btn copy">复制</button><button class="btn primary ask">发到侧栏追问</button></div>`;
    (c.querySelector(".src") as HTMLElement).textContent = text;
    c.querySelector(".close")!.addEventListener("click", () => this.hideSelection());
    const out = c.querySelector(".out") as HTMLElement;
    let result = "";
    c.querySelector(".copy")!.addEventListener("click", () => navigator.clipboard.writeText(result || text).catch(() => {}));
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
