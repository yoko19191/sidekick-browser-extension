import { expect, test, type BrowserContext } from "@playwright/test";
import { launch, onboard, openPanel, tabIdFor } from "./harness";
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

test("web action: /act fills a form, asks before submit, then finishes", async () => {
  const page = await context.newPage();
  const url = `${base}/fixtures/agent-form.html`;
  await page.goto(url);
  const panel = await openPanel(context, extId, url);
  await onboard(panel, `${base}/v1`);
  await panel.getByTestId("composer").fill("/act sign up as Ada");
  await panel.getByTestId("send").click();
  await expect(panel.getByTestId("agent-run")).toBeVisible();
  // submitting a form is R2: the confirm card must appear and nothing is submitted yet
  await expect(panel.getByTestId("agent-confirm")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[name="name"]')).toHaveValue("Ada");
  await expect(page.locator("#ok")).toHaveText("");
  await panel.getByTestId("agent-allow-once").click();
  await expect(page.locator("#ok")).toHaveText("Thanks Ada", { timeout: 10_000 });
  await expect(panel.getByTestId("agent-status")).toContainText("submitted", { timeout: 15_000 });
});

test("web action: stop ends the run within 500 ms while a confirm is pending", async () => {
  const page = await context.newPage();
  const url = `${base}/fixtures/agent-form.html`;
  await page.goto(url);
  const panel = await openPanel(context, extId, url);
  await panel.getByTestId("composer").fill("/act sign up as Ada");
  await panel.getByTestId("send").click();
  await expect(panel.getByTestId("agent-confirm")).toBeVisible({ timeout: 15_000 });
  const t0 = Date.now();
  await panel.getByTestId("agent-stop").click();
  await expect(panel.getByTestId("agent-stop")).toHaveCount(0, { timeout: 500 });
  expect(Date.now() - t0).toBeLessThan(500);
  await expect(page.locator("#ok")).toHaveText("");
});

test("web action: stop during per-character typing adds no further characters", async () => {
  const page = await context.newPage();
  const url = `${base}/fixtures/agent-form.html?t=longtype`;
  await page.goto(url);
  const panel = await openPanel(context, extId, url);
  await panel.getByTestId("composer").fill("/act LONGTYPE fill the name");
  await panel.getByTestId("send").click();
  const name = page.locator('input[name="name"]');
  await expect.poll(async () => (await name.inputValue()).length, { timeout: 15_000 }).toBeGreaterThan(10);
  const t0 = Date.now();
  await panel.getByTestId("agent-stop").click();
  await expect(panel.getByTestId("agent-stop")).toHaveCount(0, { timeout: 500 });
  expect(Date.now() - t0).toBeLessThan(500);
  const atStop = (await name.inputValue()).length;
  await page.waitForTimeout(800);
  const later = (await name.inputValue()).length;
  expect(later - atStop, "typing must halt right after stop").toBeLessThanOrEqual(2);
  expect(later).toBeLessThan(400);
});

test("observer: a 10k-node page lists the first screens and counts the rest", async () => {
  const url = `${base}/synthetic/big-10k.html`; // synthesized via context.route, no file on disk
  const rows = Array.from({ length: 2500 }, (_, i) => `<div class="row"><p>Row ${i} text</p><button>Btn ${i}</button><a href="#r${i}">Link ${i}</a></div>`).join("");
  await context.route(url, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><title>big</title><body>${rows}<button id="last">LAST_BUTTON</button></body>` }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  const panel = await openPanel(context, extId, url);
  const tabId = await tabIdFor(panel, url);
  const snap = await panel.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["/content-scripts/content.js"] });
    const t0 = performance.now();
    const r = await chrome.tabs.sendMessage(id, { type: "agent:snapshot" });
    return { ms: performance.now() - t0, tree: r.data.tree as string };
  }, tabId);
  expect(snap.tree).toContain("Btn 0");
  expect(snap.tree).not.toContain("LAST_BUTTON");
  const m = snap.tree.match(/\[\+(\d+) interactive elements outside the viewport/);
  expect(m, "snapshot must end with a +N outside-viewport count").not.toBeNull();
  expect(Number(m![1])).toBeGreaterThan(4000);
  expect(snap.ms).toBeLessThan(1500);
});
