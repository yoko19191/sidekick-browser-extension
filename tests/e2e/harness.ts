import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EXT_DIR = resolve(process.env.PAGEPILOT_EXT_DIR ?? ".output-e2e/chrome-mv3");

export async function launch(): Promise<{ context: BrowserContext; extId: string }> {
  const userDataDir = mkdtempSync(join(tmpdir(), "pp-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium", // full Chromium (new headless) — supports extensions
    headless: process.env.HEADED !== "1",
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-first-run", "--disable-gpu", "--lang=zh-CN"],
    locale: "zh-CN",
    viewport: { width: 1280, height: 860 },
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  return { context, extId };
}

export async function tabIdFor(panel: Page, url: string): Promise<number> {
  return panel.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url === u)!.id!;
  }, url);
}

/** Configure a custom OpenAI-compatible provider pointing at the mock, through the real settings UI. */
export async function addMockProvider(panel: Page, baseUrl: string, key = "test-key-123") {
  await panel.getByTestId("open-settings").click();
  await panel.getByTestId("nav-providers").click();
  await panel.getByTestId("add-provider").click();
  await panel.getByTestId("preset-custom").click();
  await panel.getByTestId("base-url").fill(baseUrl);
  await panel.getByTestId("api-key").fill(key);
  await panel.getByTestId("save-provider").click();
  await panel.getByTestId("test-result").waitFor();
  await panel.getByTestId("fetch-models").click();
  await panel.getByTestId("model-list").getByText("mock-slow").waitFor({ timeout: 10_000 });
}
