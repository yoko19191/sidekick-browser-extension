import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { addMockProvider, launch, tabIdFor } from "./harness";
import { startMock } from "../fixtures/mock-llm.mjs";

let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let base: string;
const stats = async () => (await fetch(`${base}/__stats`)).json();

test.beforeAll(async () => {
  mock = await startMock(0);
  base = `http://127.0.0.1:${mock.port}`;
  ({ context, extId } = await launch());
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

async function openPanel(forTabUrl?: string, route?: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  if (forTabUrl) {
    const id = await tabIdFor(panel, forTabUrl);
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${id}${route ? `&route=${route}` : ""}`);
  }
  return panel;
}

test.describe.serial("PagePilot v1", () => {
  test("manifest permissions are minimal", async () => {
    const panel = await openPanel();
    const m = await panel.evaluate(() => chrome.runtime.getManifest());
    expect(m.permissions?.sort()).toEqual(["activeTab", "contextMenus", "scripting", "sidePanel", "storage"]);
    expect(m.permissions).not.toContain("debugger");
    expect(m.permissions).not.toContain("userScripts");
    await panel.close();
  });

  test("side panel renders and onboarding prompts for a key", async () => {
    const panel = await openPanel();
    await expect(panel.getByText("PagePilot").first()).toBeVisible();
    await expect(panel.getByTestId("onboarding")).toBeVisible();
    await expect(panel.getByTestId("composer")).toBeVisible();
    await panel.close();
  });

  test("settings navigation: level 1 → 2 → 3 and back", async () => {
    const panel = await openPanel();
    await panel.getByTestId("open-settings").click();
    await expect(panel.getByTestId("page-settings")).toBeVisible();
    await panel.getByTestId("nav-translation").click();
    await expect(panel.getByTestId("page-translation")).toHaveAttribute("data-depth", "2");
    await panel.getByTestId("nav-translation-advanced").click();
    await expect(panel.getByTestId("page-translation-advanced")).toHaveAttribute("data-depth", "3");
    await panel.getByTestId("back").click();
    await expect(panel.getByTestId("page-translation")).toBeVisible();
    await panel.getByTestId("style-card").click();
    await panel.getByTestId("back").click();
    await expect(panel.getByTestId("page-settings")).toContainText("卡片");
    await panel.getByTestId("nav-providers").click();
    await panel.getByTestId("add-provider").click();
    await expect(panel.getByTestId("page-provider-presets")).toHaveAttribute("data-depth", "3");
    await panel.getByTestId("back").click();
    await panel.getByTestId("back").click();
    await panel.getByTestId("back").click();
    await expect(panel.getByTestId("composer")).toBeVisible();
    // restore default style for the translation test
    await panel.evaluate(async () => {
      const r = await chrome.storage.local.get("settings");
      r.settings.translation.style = "dashed";
      await chrome.storage.local.set(r);
    });
    await panel.close();
  });

  test("BYOK: add provider, test connection, list models — key stays in the extension", async () => {
    const panel = await openPanel();
    await addMockProvider(panel, `${base}/v1`);
    await expect(panel.getByTestId("test-result")).toContainText("获取到 2 个模型");
    await panel.getByTestId("test-provider").click();
    await expect(panel.getByTestId("test-result")).toContainText("连接成功");
    const s = await stats();
    expect(s.authHeaders).toContain("Bearer test-key-123");
    // key lives only in storage.local, never in sync
    const sync = await panel.evaluate(() => chrome.storage.sync.get(null));
    expect(JSON.stringify(sync)).not.toContain("test-key-123");
    // the UI never renders the full key once saved
    await panel.reload();
    await panel.getByTestId("open-settings").click();
    await panel.getByTestId("nav-providers").click();
    await expect(panel.getByTestId("provider-row-custom")).toContainText("••••-123");
    await panel.close();
  });

  test("summarize the current page with streaming Markdown", async () => {
    const page = await context.newPage();
    const url = `${base}/fixtures/article.html`;
    await page.goto(url);
    const panel = await openPanel(url);
    await expect(panel.getByTestId("page-chip")).toContainText("Rooftop Gardens");
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 20_000 });
    await expect(msg.locator("h3").first()).toHaveText("关键要点");
    await expect(msg.locator("li")).toHaveCount(4);
    // content script never had access to keys: the page's DOM / globals contain no key
    expect(await page.content()).not.toContain("test-key-123");
    await panel.close();
    await page.close();
  });

  test("web translation: bilingual nodes, dynamic content, cache, restore", async () => {
    const page = await context.newPage();
    const url = `${base}/fixtures/article.html`;
    await page.goto(url);
    const panel = await openPanel(url);
    const before = (await stats()).translateRequests;

    await panel.getByTestId("translate-toggle").click();
    await expect(page.locator(".pp-trans").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.locator(".pp-trans").count()).toBeGreaterThanOrEqual(9);
    // inserted under the original, original text untouched
    const h1 = page.locator("h1");
    await expect(h1.locator(".pp-trans")).toHaveText("【译】How Rooftop Gardens Cool Our Cities");
    await expect(h1).toContainText("How Rooftop Gardens Cool Our Cities");
    await expect(page.locator("pre .pp-trans")).toHaveCount(0); // code skipped
    await expect(page.locator("button .pp-trans")).toHaveCount(0);
    await expect(panel.getByTestId("translate-status")).toContainText("已翻译");

    // dynamic content via MutationObserver
    await page.click("#load-more");
    await expect(page.locator("#dynamic-para .pp-trans")).toHaveText(/【译】This paragraph was loaded dynamically/, { timeout: 10_000 });
    const afterFirst = (await stats()).translateRequests;
    expect(afterFirst).toBeGreaterThan(before);

    // restore original
    await panel.getByTestId("translate-toggle").click();
    await expect(page.locator(".pp-trans")).toHaveCount(0);
    await expect(page.locator("[data-pp-done]")).toHaveCount(0);

    // toggle again: everything comes from the IndexedDB cache, no new model requests
    await panel.getByTestId("translate-toggle").click();
    await expect.poll(() => page.locator(".pp-trans").count()).toBeGreaterThanOrEqual(10);
    expect((await stats()).translateRequests).toBe(afterFirst);
    await panel.getByTestId("translate-toggle").click();
    await panel.close();
    await page.close();
  });

  test("a >30s stream (with a 32s silent gap) survives the MV3 service-worker idle timeout", async () => {
    test.setTimeout(150_000);
    const page = await context.newPage();
    const url = `${base}/fixtures/article.html`;
    await page.goto(url);
    const panel = await openPanel(url);
    const boot0 = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:info" })).data.bootId);
    await panel.evaluate(async () => {
      const { providers } = await chrome.storage.local.get("providers");
      const r = await chrome.storage.local.get("settings");
      const s = r.settings ?? {};
      s.models = { ...(s.models ?? {}), chat: `${providers[0].id}::mock-slow` };
      await chrome.storage.local.set({ settings: s });
    });
    await panel.reload();
    await expect(panel.getByTestId("model-chip")).toContainText("mock-slow");
    await panel.getByTestId("composer").fill("Stream slowly please");
    const t0 = Date.now();
    await panel.getByTestId("send").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    const elapsed = Date.now() - t0;
    await expect(msg).toContainText("END-OF-SLOW-STREAM");
    await expect(msg).toContainText("chunk-13");
    expect(elapsed).toBeGreaterThan(44_000);
    const boot1 = await panel.evaluate(async () => (await chrome.runtime.sendMessage({ type: "sw:info" })).data.bootId);
    expect(boot1).toBe(boot0); // same worker instance the whole time
    console.log(`slow stream completed in ${(elapsed / 1000).toFixed(1)}s, SW bootId unchanged (${boot0})`);
    await panel.close();
    await page.close();
  });
});
