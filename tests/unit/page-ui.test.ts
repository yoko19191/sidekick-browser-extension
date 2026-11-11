// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageUi } from "../../src/lib/page-ui";
import { setLocale } from "../../src/i18n";

describe("PageUi selection toolbar", () => {
  beforeEach(() => {
    document.body.innerHTML = "<article><p id='target'>Towards more autonomous Agent systems</p></article>";
    document.documentElement.querySelectorAll("sidekick-ui").forEach((el) => el.remove());
    setLocale("zh-CN");
  });

  function mockSelection(el: Element) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.getBoundingClientRect = () =>
      ({
        left: 120,
        top: 100,
        right: 320,
        bottom: 124,
        width: 200,
        height: 24,
        x: 120,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  it("renders Translate | Explain | Ask Sidekick toolbar on text selection and triggers handlers", async () => {
    const askInPanel = vi.fn();
    const explainInPanel = vi.fn();
    const translateSelection = vi.fn(async (t: string) => `译：${t}`);

    new PageUi({
      onFabClick: () => {},
      onFabOpenPanel: () => {},
      onFabDismiss: () => {},
      translateSelection,
      askInPanel,
      explainInPanel,
    });

    const p = document.getElementById("target")!;
    mockSelection(p);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));

    const host = document.documentElement.querySelector("sidekick-ui")!;
    const root = host.shadowRoot!;
    const toolbar = root.querySelector('[data-testid="pp-selection-toolbar"]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute("role")).toBe("toolbar");
    expect(toolbar.getAttribute("focusgroup")).toBe("toolbar wrap");

    const btnTranslate = toolbar.querySelector('[data-testid="pp-selection-dot"]') as HTMLButtonElement;
    const btnExplain = toolbar.querySelector('[data-testid="pp-selection-explain"]') as HTMLButtonElement;
    const btnAsk = toolbar.querySelector('[data-testid="pp-selection-ask"]') as HTMLButtonElement;

    expect(btnTranslate.textContent).toBe("翻译");
    expect(btnExplain.textContent).toBe("解释");
    expect(btnAsk.textContent).toBe("问翻翻");

    // Roving tabindex fallback sets first button to tabIndex=0 and others to -1
    expect(btnTranslate.tabIndex).toBe(0);
    expect(btnExplain.tabIndex).toBe(-1);
    expect(btnAsk.tabIndex).toBe(-1);

    // Click Explain -> calls explainInPanel and hides toolbar
    btnExplain.click();
    expect(explainInPanel).toHaveBeenCalledWith("Towards more autonomous Agent systems");
    expect(root.querySelector('[data-testid="pp-selection-toolbar"]')).toBeNull();

    // Re-select and click Ask Sidekick -> calls askInPanel and hides toolbar
    mockSelection(p);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));
    (root.querySelector('[data-testid="pp-selection-ask"]') as HTMLButtonElement).click();
    expect(askInPanel).toHaveBeenCalledWith("Towards more autonomous Agent systems");
    expect(root.querySelector('[data-testid="pp-selection-toolbar"]')).toBeNull();

    // Re-select and click Translate -> opens in-page translation card
    mockSelection(p);
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 25));
    (root.querySelector('[data-testid="pp-selection-dot"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(translateSelection).toHaveBeenCalledWith("Towards more autonomous Agent systems");
    expect(root.querySelector(".card .out")?.textContent).toBe("译：Towards more autonomous Agent systems");
  });

  it("positions the selection toolbar near the mouse release point on multi-line selections", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    new PageUi({
      onFabClick: () => {},
      onFabOpenPanel: () => {},
      onFabDismiss: () => {},
      translateSelection: async (t) => t,
      askInPanel: () => {},
    });

    const p = document.getElementById("target")!;
    const range = document.createRange();
    range.selectNodeContents(p);
    // Simulate a 5-line paragraph spanning top: 100 -> bottom: 260
    range.getBoundingClientRect = () =>
      ({ left: 80, top: 100, right: 780, bottom: 260, width: 700, height: 160, x: 80, y: 100, toJSON: () => ({}) }) as DOMRect;
    range.getClientRects = () =>
      [
        { left: 80, top: 100, right: 780, bottom: 124, width: 700, height: 24, x: 80, y: 100, toJSON: () => ({}) },
        { left: 80, top: 236, right: 640, bottom: 260, width: 560, height: 24, x: 80, y: 236, toJSON: () => ({}) },
      ] as unknown as DOMRectList;
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    // 1. Forward drag (top-left -> bottom-right): toolbar appears just below the last line, centered near clientX=620
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 85, clientY: 110 }));
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 620, clientY: 248 }));
    await new Promise((r) => setTimeout(r, 25));

    const root = document.documentElement.querySelector("sidekick-ui")!.shadowRoot!;
    const bar1 = root.querySelector('[data-testid="pp-selection-toolbar"]') as HTMLElement;
    expect(parseInt(bar1.style.top, 10)).toBe(270); // 260 (last line bottom) + 10px
    expect(parseInt(bar1.style.left, 10)).toBeGreaterThan(450); // centered near clientX=620, not stuck at left=80

    // 2. Backward drag (bottom-right -> top-left): toolbar appears just above the first line, centered near clientX=140
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 620, clientY: 248 }));
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 140, clientY: 110 }));
    await new Promise((r) => setTimeout(r, 25));

    const bar2 = root.querySelector('[data-testid="pp-selection-toolbar"]') as HTMLElement;
    expect(parseInt(bar2.style.top, 10)).toBeLessThan(100); // placed above first line (top=100)
    expect(parseInt(bar2.style.left, 10)).toBeLessThan(100); // centered near clientX=140
  });

  it("never renders duplicate selection toolbars across re-injection or rapid mouseup events", async () => {
    const handlers1 = {
      onFabClick: () => {},
      onFabOpenPanel: () => {},
      onFabDismiss: () => {},
      translateSelection: async (t: string) => t,
      askInPanel: vi.fn(),
    };
    const handlers2 = {
      onFabClick: () => {},
      onFabOpenPanel: () => {},
      onFabDismiss: () => {},
      translateSelection: async (t: string) => t,
      askInPanel: vi.fn(),
    };

    // Simulate an older PageUi instance left in the page followed by a newly injected PageUi instance
    new PageUi(handlers1);
    new PageUi(handlers2);

    const p = document.getElementById("target")!;
    mockSelection(p);
    // Fire two rapid mouseup events back-to-back
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 250, clientY: 112 }));
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 260, clientY: 112 }));
    await new Promise((r) => setTimeout(r, 25));

    const hosts = document.documentElement.querySelectorAll("sidekick-ui");
    expect(hosts.length).toBe(1);
    const toolbars = hosts[0].shadowRoot!.querySelectorAll('[data-testid="pp-selection-toolbar"]');
    expect(toolbars.length).toBe(1);

    (toolbars[0].querySelector('[data-testid="pp-selection-ask"]') as HTMLButtonElement).click();
    expect(handlers1.askInPanel).not.toHaveBeenCalled();
    expect(handlers2.askInPanel).toHaveBeenCalledTimes(1);
  });
});
