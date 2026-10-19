import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { launch, onboard, openPanel as open } from "./harness";
import { startMock } from "../fixtures/mock-llm.mjs";

let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let base: string;
let article: string;
const stats = async () => (await fetch(`${base}/__stats`)).json();
const openPanel = (url?: string, extra?: string) => open(context, extId, url, extra);
async function openArticle(path = "article.html") {
  const page = await context.newPage();
  await page.goto(`${base}/fixtures/${path}`);
  return page;
}

test.beforeAll(async () => {
  mock = await startMock(0);
  base = `http://127.0.0.1:${mock.port}`;
  article = `${base}/fixtures/article.html`;
  ({ context, extId } = await launch());
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

test.describe.serial("翻翻 Sidekick v1", () => {
  test("manifest permissions are minimal (no userScripts / debugger)", async () => {
    const panel = await openPanel();
    const m = await panel.evaluate(() => chrome.runtime.getManifest());
    expect(m.permissions?.sort()).toEqual(["activeTab", "contextMenus", "scripting", "sidePanel", "storage"]);
    expect(m.optional_host_permissions).toEqual(["<all_urls>"]);
    await panel.close();
  });

  test("first-run onboarding: provider → key + test (must pass, readable error) → language", async () => {
    const panel = await openPanel();
    await expect(panel.getByTestId("onboarding")).toBeVisible();
    await panel.getByTestId("ob-preset-custom").click();
    await expect(panel.getByTestId("ob-next")).toBeDisabled(); // needs a Base URL
    await panel.getByTestId("ob-base-url").fill(`${base}/v1`);
    await panel.getByTestId("ob-next").click();
    // wrong key → readable reason, cannot continue
    await panel.getByTestId("ob-key").fill("bad-key");
    const t0 = Date.now();
    await panel.getByTestId("ob-test").click();
    await expect(panel.locator('[data-testid="ob-test-result"][data-state="fail"]')).toContainText("Key 无效");
    expect(Date.now() - t0).toBeLessThan(5000);
    await expect(panel.getByTestId("ob-next")).toBeDisabled();
    // good key → ✓ → next
    await panel.getByTestId("ob-key").fill("test-key-123");
    await panel.getByTestId("ob-test").click();
    await expect(panel.locator('[data-testid="ob-test-result"][data-state="ok"]')).toContainText("连接成功");
    await panel.getByTestId("ob-next").click();
    await panel.getByTestId("ob-lang").selectOption("zh-CN");
    await panel.getByTestId("ob-finish").click();
    await expect(panel.getByTestId("onboarding")).toHaveCount(0);
    await expect(panel.getByTestId("model-switch")).toContainText("mock-fast");
    await expect(panel.getByTestId("nokey-banner")).toHaveCount(0);
    // key only in storage.local (never sync), sent only as the Authorization header to the provider
    expect(JSON.stringify(await panel.evaluate(() => chrome.storage.sync.get(null)))).not.toContain("test-key-123");
    expect((await stats()).authHeaders).toContain("Bearer test-key-123");
    await panel.close();
  });

  test("panel: model switch dropdown + gear popover holds only quick settings", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    await panel.getByTestId("model-switch").click();
    await panel.getByTestId("model-option-mock-slow").click();
    await expect(panel.getByTestId("model-switch")).toContainText("mock-slow");
    await panel.getByTestId("model-switch").click();
    await panel.getByTestId("model-option-mock-fast").click();
    await panel.getByTestId("open-quick-settings").click();
    const qs = panel.getByTestId("quick-settings");
    await expect(qs).toBeVisible();
    await expect(qs.getByTestId("qs-target-lang")).toBeVisible();
    await expect(qs.getByTestId("qs-display-mode")).toBeVisible();
    await expect(qs.getByTestId("qs-auto-site")).toBeVisible();
    const [options] = await Promise.all([context.waitForEvent("page"), qs.getByTestId("qs-more").click()]);
    await options.waitForLoadState();
    expect(options.url()).toContain("/options.html");
    await options.close();
    await panel.close();
    await page.close();
  });

  test("options page: left nav, 6 sections, advanced collapsed by default, provider detail expands", async () => {
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options.html`);
    for (const s of ["models", "translation", "chat", "appearance", "shortcuts", "data"]) {
      await opt.getByTestId(`nav-${s}`).click();
      await expect(opt.getByTestId(`section-${s}`)).toBeVisible();
    }
    await opt.getByTestId("nav-translation").click();
    const adv = opt.getByTestId("translation-advanced");
    await expect(adv).not.toHaveAttribute("data-open", "");
    await adv.getByRole("button", { name: /批量、并发与站点规则/ }).click();
    await expect(adv).toHaveAttribute("data-open", "");
    await expect(adv.getByTestId("auto-sites")).toBeVisible();
    await opt.getByTestId("nav-models").click();
    await opt.getByTestId("provider-toggle-custom").click();
    await expect(opt.getByTestId("base-url")).toHaveValue(`${base}/v1`);
    await expect(opt.getByTestId("provider-summary")).toContainText("••••-123"); // masked, never the full key
    // a test request carrying a forged baseUrl but no key must use the STORED config (the saved key never goes elsewhere)
    const forged = await opt.evaluate(async () => {
      const { providers } = await chrome.storage.local.get("providers");
      const p = (providers as { presetId: string; baseUrl: string }[]).find((x) => x.presetId === "custom")!;
      return chrome.runtime.sendMessage({ type: "provider:test", provider: { ...p, baseUrl: "http://127.0.0.1:9/v1" }, modelId: "mock-fast" });
    });
    expect(forged.ok).toBe(true);
    await opt.close();
  });

  test("chat: summarize streams Markdown; clicking a citation locates the original text", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    await expect(panel.getByTestId("page-chip")).toContainText("Rooftop Gardens");
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    await expect(msg.locator("h3").first()).toHaveText("关键要点");
    await msg.locator("a[data-footnote-ref]").first().click();
    await expect(page.locator("p.pp-flash")).toContainText("sixty percent of the rain");
    await expect(page.locator(".pp-flash")).toHaveCount(0, { timeout: 4000 }); // highlight clears after ~2s
    // follow-up question in the same conversation
    await panel.getByTestId("composer").fill("降温效果有多大？");
    await panel.getByTestId("send").click();
    await expect(panel.getByTestId("assistant-message").last()).toHaveAttribute("data-status", "done");
    expect(await page.content()).not.toContain("test-key-123");
    // history
    await panel.getByTestId("open-history").click();
    await expect(panel.getByTestId("history-item").first()).toBeVisible();
    await panel.close();
    await page.close();
  });

  test("model output cannot auto-load remote resources (image exfiltration canary)", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    await panel.getByTestId("composer").fill("INJECT-IMAGE please");
    await panel.getByTestId("send").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done");
    await expect(msg.locator("img")).toHaveCount(0);
    await expect(msg.getByTestId("md-image-link")).toHaveText("🖼 status");
    await panel.waitForTimeout(500);
    expect((await stats()).pixelHits).toBe(0);
    await panel.close();
    await page.close();
  });

  test("long article (>20k chars) is summarized section by section then merged", async () => {
    const url = `${base}/fixtures/long.html`;
    const page = await openArticle("long.html");
    const panel = await openPanel(url);
    const before = (await stats()).sectionRequests;
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(msg).toContainText("长文总结");
    expect((await stats()).sectionRequests - before).toBeGreaterThanOrEqual(2);
    await panel.close();
    await page.close();
  });

  test("very long page: summary is capped at 16 sections and says how much it covered", async () => {
    const url = `${base}/fixtures/long.html?chapters=600`;
    const page = await openArticle("long.html?chapters=600");
    const panel = await openPanel(url);
    const before = (await stats()).sectionRequests;
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    expect((await stats()).sectionRequests - before).toBe(16);
    await expect(msg.getByTestId("coverage-notice")).toHaveText(/页面过长，仅总结了前 \d{1,2}%/);
    await panel.close();
    await page.close();
  });

  test("full-page translation: bilingual nodes, code skipped, dynamic content, restore, cache across reload, translation-only", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    const before = (await stats()).translateRequests;
    await panel.getByTestId("translate-toggle").click();
    await expect.poll(() => page.locator(".pp-trans").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(9);
    const h1 = page.locator("h1");
    await expect(h1.locator(".pp-trans")).toHaveText("屋顶花园如何为城市降温");
    // default style: green text directly under the original, same font size, no underline / prefix
    const firstP = page.locator("article p", { hasText: "On a hot July afternoon" });
    const look = await firstP.evaluate((p) => {
      const t = p.querySelector(".pp-trans") as HTMLElement;
      const inner = t.querySelector(".pp-trans-inner") as HTMLElement;
      const cs = getComputedStyle(t);
      return { cls: t.className, color: cs.color, display: cs.display, fs: cs.fontSize, pfs: getComputedStyle(p).fontSize, border: getComputedStyle(inner).borderBottomStyle, last: p.lastElementChild === t, text: t.textContent };
    });
    expect(look.cls).toContain("pp-style-green");
    expect(look.color).toBe("rgb(22, 163, 74)"); // #16a34a on the light fixture page
    expect(look.display).toBe("block");
    expect(look.fs).toBe(look.pfs);
    expect(look.border).toBe("none");
    expect(look.last).toBe(true);
    expect(look.text).toMatch(/^在炎热的七月午后/);
    await expect(h1).toContainText("How Rooftop Gardens Cool Our Cities");
    await expect(page.locator("pre .pp-trans")).toHaveCount(0);
    await expect(panel.getByTestId("translate-status")).toContainText("已译为");
    await page.click("#load-more");
    await expect(page.locator("#dynamic-para .pp-trans")).toHaveText("这一段是在页面渲染完成后动态加载的。", { timeout: 10_000 });
    expect((await stats()).translateRequests).toBeGreaterThan(before);

    // translation-only mode from the gear popover applies live
    await panel.getByTestId("open-quick-settings").click();
    await panel.getByTestId("qs-display-mode").getByText("仅译文").click();
    await expect(page.locator("html")).toHaveClass(/pp-only/);
    await panel.getByTestId("qs-display-mode").getByText("双语对照").click();
    await expect(page.locator("html")).not.toHaveClass(/pp-only/);
    await panel.keyboard.press("Escape");

    // restore original
    await panel.getByTestId("translate-toggle").click();
    await expect(page.locator(".pp-trans")).toHaveCount(0);
    await expect(page.locator("[data-pp-done]")).toHaveCount(0);

    // reload the page and translate again: everything comes from the IndexedDB cache
    const afterFirst = (await stats()).translateRequests;
    await page.reload();
    await panel.reload();
    await panel.getByTestId("translate-toggle").click();
    await expect.poll(() => page.locator(".pp-trans").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(9);
    expect((await stats()).translateRequests).toBe(afterFirst);
    await panel.getByTestId("translate-toggle").click();
    await panel.close();
    await page.close();
  });

  test("selection translation: icon → floating card → 'ask in side panel'; floating button present", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    const ui = page.locator("sidekick-ui");
    await expect(ui.locator(".fab")).toBeVisible({ timeout: 10_000 }); // auto-injected where host access is granted
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("article p")].find((x) => x.textContent!.includes("A vegetated roof works like a sponge"))!;
      const r = document.createRange();
      r.selectNodeContents(p);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      const b = p.getBoundingClientRect();
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.right, clientY: b.bottom }));
    });
    await ui.getByTestId("pp-selection-dot").click();
    await expect(ui.locator(".card .out[data-done]")).toContainText("植被屋顶就像一块海绵");
    await ui.locator(".card .ask").click();
    await expect(panel.getByTestId("composer")).toHaveValue(/A vegetated roof works like a sponge/, { timeout: 5000 });
    // floating button toggles translation
    await ui.locator(".fab").click();
    await expect.poll(() => page.locator(".pp-trans").count(), { timeout: 15_000 }).toBeGreaterThan(3);
    await expect(ui.locator(".fab.on")).toBeVisible();
    await ui.locator(".fab").click();
    await expect(page.locator(".pp-trans")).toHaveCount(0);
    await panel.close();
    await page.close();
  });

  test("home (Kimi-style): mascot + quick actions; 解释选中内容 and 引用选中内容 use the page selection", async () => {
    const page = await openArticle();
    const panel = await openPanel(article);
    const home = panel.getByTestId("home");
    await expect(home.getByTestId("mascot")).toHaveAttribute("data-state", "idle");
    await expect(home.locator("h1")).toHaveText("让翻翻帮你读懂网页");
    for (const id of ["action-summarize", "action-translate", "action-explain", "action-keypoints"]) await expect(panel.getByTestId(id)).toBeVisible();
    // typing → the mascot looks down at the input
    await panel.getByTestId("composer").focus();
    await expect(home.getByTestId("mascot")).toHaveAttribute("data-state", "typing");
    await panel.getByTestId("composer").blur();
    // nothing selected → a hint, no request
    const before = (await stats()).chatRequests;
    await panel.getByTestId("action-explain").click();
    await expect(panel.getByText("先在网页上选中一段文字")).toBeVisible();
    expect((await stats()).chatRequests).toBe(before);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("article p")].find((x) => x.textContent!.includes("A vegetated roof works like a sponge"))!;
      const r = document.createRange();
      r.selectNodeContents(p);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await panel.getByTestId("quote-selection").click();
    await expect(panel.getByTestId("composer")).toHaveValue(/> A vegetated roof works like a sponge/);
    await panel.getByTestId("composer").fill("");
    await panel.getByTestId("action-explain").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    await expect(panel.getByText(/^请用通俗易懂的话解释[\s\S]*A vegetated roof works like a sponge/)).toBeVisible(); // the user turn carries the selection
    await expect(msg.getByTestId("mascot")).toBeVisible(); // small mascot avatar
    await panel.close();
    await page.close();
  });

  test("real side panel opens from page gestures (fab, 发到侧栏追问), 用翻翻追问 menu, and the toast fallback", async () => {
    test.setTimeout(90_000);
    for (const p of context.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();
    const sw = context.serviceWorkers()[0];
    const page = await openArticle();
    // Driver page: the options page has no dev:panel-state listener, so only the real side panel answers.
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extId}/options.html`);
    const dev = (msg: Record<string, unknown>) => driver.evaluate(async (m) => (await chrome.runtime.sendMessage(m))?.data ?? null, msg);
    const panelState = () => driver.evaluate(() => chrome.runtime.sendMessage({ type: "dev:panel-state" }).catch(() => null)) as Promise<{ url: string; composer: string | null } | null>;
    await page.bringToFront();
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, article);
    const winId = await sw.evaluate(async (id) => (await chrome.tabs.get(id)).windowId, tabId);
    const sidePanels = () => sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["SIDE_PANEL" as chrome.runtime.ContextType] })).length);
    const closePanel = async () => {
      await sw.evaluate((w) => (chrome.sidePanel as unknown as { close(o: { windowId: number }): Promise<void> }).close({ windowId: w }).catch(() => {}), winId);
      await expect.poll(sidePanels).toBe(0);
    };
    const ui = page.locator("sidekick-ui");
    const selectAndOpenCard = async () => {
      await page.evaluate(() => {
        const p = [...document.querySelectorAll("article p")].find((x) => x.textContent!.includes("A vegetated roof works like a sponge"))!;
        const r = document.createRange();
        r.selectNodeContents(p);
        const sel = getSelection()!;
        sel.removeAllRanges();
        sel.addRange(r);
        const b = p.getBoundingClientRect();
        p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.right, clientY: b.bottom }));
      });
      await ui.getByTestId("pp-selection-dot").click();
      await ui.locator(".card .out[data-done]").waitFor();
    };
    await expect(ui.locator(".fab")).toBeVisible({ timeout: 10_000 });
    await closePanel(); // the previous test's 发到侧栏追问 already opened a real panel

    // control: without a user gesture Chrome refuses
    const ctl = await sw.evaluate((id) => chrome.sidePanel.open({ tabId: id }).then(() => "opened", (e: Error) => e.message), tabId);
    expect(ctl).toContain("user gesture");

    // 1) floating button (right-click) → content script → SW → sidePanel.open: the gesture carries over
    await ui.locator(".fab").click({ button: "right" });
    await expect.poll(sidePanels).toBe(1);
    await expect.poll(async () => (await panelState())?.url ?? "").toContain("/sidepanel.html");
    await closePanel();

    // 2) selection card "发到侧栏追问" opens the real panel and pre-fills the composer
    await selectAndOpenCard();
    await page.waitForTimeout(1500); // user reads the translation first
    await ui.locator(".card .ask").click();
    await expect.poll(sidePanels).toBe(1);
    await expect.poll(async () => (await panelState())?.composer ?? "").toContain("A vegetated roof works like a sponge");
    await expect(ui.getByTestId("pp-toast")).toHaveCount(0);
    await closePanel();

    // 3) context menu "用翻翻追问": the item is registered, and its real onClicked handler opens the panel with the
    //    selection pre-filled. Playwright cannot click native menus, so the handler is invoked from an extension page;
    //    page.evaluate runs with a user gesture, which Chrome forwards through runtime.sendMessage just like a menu click.
    expect(await dev({ type: "dev:menu-exists", id: "pp-ask-selection" })).toBe(true);
    await dev({ type: "dev:menu-click", id: "pp-ask-selection", text: "Bees, butterflies and birds use rooftop gardens", tabId });
    await expect.poll(sidePanels).toBe(1);
    await expect.poll(async () => (await panelState())?.composer ?? "").toContain("Bees, butterflies and birds");
    await closePanel();

    // 4) fallback: if Chrome refuses to open, the card shows a toast and the question waits in storage.session
    await dev({ type: "dev:force-panel-fail", on: true });
    await selectAndOpenCard();
    await ui.locator(".card .ask").click();
    await expect(ui.getByTestId("pp-toast")).toHaveText("点工具栏的翻翻图标继续");
    expect(await sidePanels()).toBe(0);
    const pending = await sw.evaluate(async () => (await chrome.storage.session.get("pendingAction")).pendingAction as { type: string; text: string });
    expect(pending.type).toBe("ask");
    await dev({ type: "dev:force-panel-fail", on: false });
    await ui.locator(".fab").click({ button: "right" }); // stands in for the toolbar icon
    await expect.poll(async () => (await panelState())?.composer ?? "").toContain("A vegetated roof works like a sponge");
    await closePanel();
    await driver.close();
    await page.close();
  });

  test("M0: pi-ai tool calling works inside the MV3 service worker", async () => {
    const panel = await openPanel();
    const r = await panel.evaluate(async () => chrome.runtime.sendMessage({ type: "dev:selftest-tools" }));
    expect(r.ok).toBe(true);
    expect(r.data.stopReason).toBe("toolUse");
    expect(r.data.toolCalls).toEqual([{ name: "get_weather", arguments: { city: "Paris" } }]);
    await panel.close();
  });

  test("a >30s stream (with a 32s silent gap) survives the MV3 service-worker idle timeout", async () => {
    test.setTimeout(150_000);
    const page = await openArticle();
    const panel = await openPanel(article);
    await panel.getByTestId("model-switch").click();
    await panel.getByTestId("model-option-mock-slow").click();
    const boot0 = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:idle-reset" })).data.bootId);
    await panel.getByTestId("composer").fill("Stream slowly please");
    const t0 = Date.now();
    await panel.getByTestId("send").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    const elapsed = Date.now() - t0;
    await expect(msg).toContainText("chunk-13");
    await expect(msg).toContainText("END-OF-SLOW-STREAM");
    expect(elapsed).toBeGreaterThan(44_000);
    const info = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:info" })).data);
    expect(info.bootId).toBe(boot0);
    // Chrome's rule is "30s without an incoming extension event". The 15s port ping must keep the longest gap well below that,
    // even across the mock's 32s silent stretch — this holds regardless of whether the harness pins the worker.
    expect(info.maxIdleGapMs).toBeLessThan(30_000);
    console.log(`slow stream completed in ${(elapsed / 1000).toFixed(1)}s, SW bootId unchanged (${boot0}), longest idle gap ${(info.maxIdleGapMs / 1000).toFixed(1)}s`);
    await panel.getByTestId("model-switch").click();
    await panel.getByTestId("model-option-mock-fast").click();
    await panel.close();
    await page.close();
  });

  test("control: with no port open the SW sees a >30s event gap (would be recycled by Chrome) — proves the keepalive test is meaningful", async () => {
    test.setTimeout(120_000);
    for (const p of context.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();
    const probe = await openPanel();
    const boot0 = await probe.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:idle-reset" })).data.bootId);
    await probe.close();
    const blank = await context.newPage();
    await blank.waitForTimeout(45_000);
    const again = await openPanel();
    const info = await again.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:info" })).data);
    const boot1 = info.bootId;
    if (boot1 === boot0) expect(info.maxIdleGapMs).toBeGreaterThan(30_000); // no port → the 30s idle limit would have been hit
    console.log(`idle control: bootId ${boot0} → ${boot1} (${boot0 === boot1 ? `NOT recycled — harness pins the SW; but longest idle gap was ${(info.maxIdleGapMs / 1000).toFixed(1)}s > 30s, i.e. Chrome's idle rule would have fired` : "recycled as expected"})`);
    test.info().annotations.push({ type: "sw-idle-recycled", description: String(boot0 !== boot1) });
    await again.close();
    await blank.close();
  });
});
