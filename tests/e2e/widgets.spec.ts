import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { launch, openPanel, tabIdFor } from "./harness";
import { startMock } from "../fixtures/mock-llm.mjs";

// Real-Chromium checks for widget patterns that jsdom cannot reproduce (no layout, no checkVisibility):
// a display:contents web-component dialog (Shoelace), label-operated hidden checkboxes (IKEA), target=_blank links.

let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let page: Page;
let panel: Page;
let tabId: number;
let url: string;

test.beforeAll(async () => {
  mock = await startMock(0);
  ({ context, extId } = await launch());
  url = `http://127.0.0.1:${mock.port}/fixtures/agent/widgets.html`;
  page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  panel = await openPanel(context, extId, url);
  tabId = await tabIdFor(panel, url);
  await panel.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, files: ["/content-scripts/content.js"] }), tabId);
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

const snapshot = () => panel.evaluate(async (id) => (await chrome.tabs.sendMessage(id, { type: "agent:snapshot" })).data.tree as string, tabId);
const execute = (action: { name: string; args: Record<string, unknown> }) =>
  panel.evaluate(async ([id, a]) => (await chrome.tabs.sendMessage(id as number, { type: "agent:execute", action: a })).data as { ok: boolean; message: string }, [tabId, action] as const);
const idOf = (tree: string, needle: string) => {
  const line = tree.split("\n").find((l) => l.includes(needle));
  expect(line, `"${needle}" not in snapshot:\n${tree}`).toBeTruthy();
  return line!.match(/\[(f\d+:\d+)\]/)![1];
};
const dialogOpen = () => page.evaluate(() => document.getElementById("dlg")!.hasAttribute("open"));

test("display:contents dialog: its content and close button are in the snapshot, and clicking close closes it", async () => {
  const tree = await snapshot();
  expect(tree).toContain("Welcome dialog");
  expect(tree).toContain("Dialog body text");
  const r = await execute({ name: "click", args: { index: idOf(tree, ">Close<") } });
  expect(r.ok, r.message).toBe(true);
  expect(await dialogOpen()).toBe(false);
});

test("Escape sent to an element inside the dialog's shadow root reaches the document handler", async () => {
  await page.evaluate(() => document.getElementById("dlg")!.setAttribute("open", ""));
  const tree = await snapshot();
  await execute({ name: "send_keys", args: { keys: "Escape", index: idOf(tree, ">Close<") } });
  expect(await dialogOpen()).toBe(false);
});

test("a footer button labelled through a slot is named and closes the dialog", async () => {
  await page.evaluate(() => document.getElementById("dlg")!.setAttribute("open", ""));
  const tree = await snapshot();
  const r = await execute({ name: "click", args: { index: idOf(tree, "<button>No, thanks</button>") } });
  expect(r.ok, r.message).toBe(true);
  expect(await dialogOpen()).toBe(false);
});

test("hidden filter checkboxes are listed by their label and clicking one checks it", async () => {
  const tree = await snapshot();
  expect(tree).toMatch(/<input type=checkbox[^>]*>Width 61-120 cm<\/input>/);
  const r = await execute({ name: "click", args: { index: idOf(tree, "Width 61-120 cm</input>") } });
  expect(r.ok, r.message).toBe(true);
  expect(await page.evaluate(() => (document.getElementById("w1") as HTMLInputElement).checked)).toBe(true);
  expect(await snapshot()).toMatch(/<input type=checkbox[^>]* checked>Width 61-120 cm/);
});

test("a target=_blank link opens in the agent's tab instead of a new tab", async () => {
  const pagesBefore = context.pages().length;
  const tree = await snapshot();
  const r = await execute({ name: "click", args: { index: idOf(tree, "Open details") } });
  expect(r.message).toContain("opened in this tab");
  await page.waitForURL(/\?page=2$/);
  expect(context.pages().length).toBe(pagesBefore);
});
