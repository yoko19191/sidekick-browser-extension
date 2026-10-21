import { expect, test, type BrowserContext } from "@playwright/test";
import { launch, onboard, openPanel } from "./harness";
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
