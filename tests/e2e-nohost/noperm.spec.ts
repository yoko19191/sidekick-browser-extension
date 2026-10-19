/**
 * Denied / missing host permission. This build has NO host_permissions and Playwright cannot click the toolbar
 * icon, so the tab never gets activeTab — the same state as an EXPIRED activeTab grant (after navigating away).
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import { launch, openPanel } from "../e2e/harness";
import { startMock } from "../fixtures/mock-llm.mjs";

let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let base: string;

test.beforeAll(async () => {
  mock = await startMock(0);
  base = `http://127.0.0.1:${mock.port}`;
  ({ context, extId } = await launch());
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

test.describe.serial("no host permission", () => {
  test("manifest really has no host access", async () => {
    const panel = await openPanel(context, extId);
    const m = await panel.evaluate(() => chrome.runtime.getManifest());
    expect(m.host_permissions ?? []).toEqual([]);
    expect(await panel.evaluate(() => chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }))).toBe(false);
    // Seed a provider directly: onboarding's optional-permission prompt for the API origin cannot be answered headless.
    // (The provider API itself is reached via CORS, no host grant needed.)
    await panel.evaluate(async (b) => {
      await chrome.storage.local.set({
        providers: [{ id: "p-mock", kind: "openai-compatible", name: "Mock", presetId: "custom", baseUrl: b, models: ["mock-fast"], enabled: true, createdAt: 0 }],
        "secret:p-mock": "test-key-123",
        onboardingDone: true,
      });
    }, `${base}/v1`);
    await panel.close();
  });

  test("translate and summarize show the grant strip instead of failing silently; nothing is injected", async () => {
    const url = `${base}/fixtures/article.html`;
    const page = await context.newPage();
    await page.goto(url);
    // Without host access Chrome hides tab.url, so look the tab up as the active one (what the real panel does).
    const sw = context.serviceWorkers()[0];
    await page.bringToFront();
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id!);
    expect(await sw.evaluate(async (id) => (await chrome.tabs.get(id)).url, tabId)).toBeUndefined();
    const panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 760 });
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`);
    await panel.getByTestId("translate-toggle").click();
    const strip = panel.getByTestId("page-error");
    await expect(strip).toHaveAttribute("data-needs-grant", "");
    await expect(strip).toContainText("点一下工具栏的翻翻图标"); // url unknown → activeTab is the way in
    await expect(panel.getByTestId("grant-site")).toHaveCount(0);
    await expect(page.locator("sidekick-ui")).toHaveCount(0); // no floating button / selection UI without access
    await expect(page.locator(".pp-trans")).toHaveCount(0);

    await strip.getByRole("button", { name: "关闭" }).click();
    const chatBefore = (await (await fetch(`${base}/__stats`)).json()).chatRequests;
    await panel.getByTestId("action-summarize").click();
    await expect(panel.getByTestId("page-error")).toHaveAttribute("data-needs-grant", "");
    // readable local error, and nothing is sent to the model without the page
    await expect(panel.getByTestId("assistant-error")).toHaveText("无法读取当前页面内容");
    expect((await (await fetch(`${base}/__stats`)).json()).chatRequests).toBe(chatBefore);
    await expect(page.locator("sidekick-ui")).toHaveCount(0);
    await panel.close();
    await page.close();
  });
});
