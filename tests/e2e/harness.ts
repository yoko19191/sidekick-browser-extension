import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EXT_DIR = resolve(process.env.SIDEKICK_EXT_DIR ?? ".output-e2e/chrome-mv3");

export async function launch(opts: { colorScheme?: "light" | "dark" } = {}): Promise<{ context: BrowserContext; extId: string }> {
  const userDataDir = mkdtempSync(join(tmpdir(), "pp-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium", // full Chromium (new headless) — supports extensions
    headless: process.env.HEADED !== "1",
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--no-first-run", "--disable-gpu", "--lang=zh-CN"],
    locale: "zh-CN",
    colorScheme: opts.colorScheme ?? "light",
    viewport: { width: 1280, height: 860 },
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  return { context, extId: new URL(sw.url()).host };
}

export async function tabIdFor(page: Page, url: string): Promise<number> {
  return page.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url);
}

/** Opens the side-panel page in a tab, bound to the tab showing `forUrl` (the real panel binds to the active tab). */
export async function openPanel(context: BrowserContext, extId: string, forUrl?: string, extra = ""): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 760 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  if (forUrl) {
    const id = await tabIdFor(panel, forUrl);
    await panel.goto(`chrome-extension://${extId}/sidepanel.html?tabId=${id}${extra}`);
  }
  return panel;
}

/** Walks the real 3-step onboarding against the mock (custom OpenAI-compatible provider). */
export async function onboard(panel: Page, baseUrl: string, key = "test-key-123") {
  await panel.getByTestId("ob-preset-custom").click();
  await panel.getByTestId("ob-base-url").fill(baseUrl);
  await panel.getByTestId("ob-next").click();
  await panel.getByTestId("ob-key").fill(key);
  await panel.getByTestId("ob-test").click();
  await panel.locator('[data-testid="ob-test-result"][data-state="ok"]').waitFor({ timeout: 10_000 });
  await panel.getByTestId("ob-next").click();
  await panel.getByTestId("ob-finish").click();
}
