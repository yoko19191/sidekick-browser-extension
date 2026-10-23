import { expect, test, type BrowserContext } from "@playwright/test";
import { launch, openPanel, tabIdFor } from "./harness";
import { startMock } from "../fixtures/mock-llm.mjs";

// Step 3: hidden-text acceptance. Snapshots tests/fixtures/agent/hidden-text.html with the real observer in real
// Chromium and checks every data-expect probe (convention: tests/fixtures/agent/README.md).

type Probe = { expect: string; token: string; bug: string };
let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let tree = "";
let probes: Probe[] = [];

test.beforeAll(async () => {
  mock = await startMock(0);
  ({ context, extId } = await launch());
  const url = `http://127.0.0.1:${mock.port}/fixtures/agent/hidden-text.html`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(url);
  probes = await page.$$eval("[data-expect]", (els) =>
    els.map((e) => ({
      expect: e.getAttribute("data-expect")!,
      token: e.getAttribute("data-token") ?? (e.textContent ?? "").trim(),
      bug: e.getAttribute("data-bug") ?? "",
    })),
  );
  const panel = await openPanel(context, extId, url);
  const tabId = await tabIdFor(panel, url);
  tree = await panel.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["/content-scripts/content.js"] });
    const r = await chrome.tabs.sendMessage(id, { type: "agent:snapshot" });
    return r.data.tree as string;
  }, tabId);
  console.log(tree);
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

const has = (t: string) => tree.toLowerCase().includes(t.toLowerCase());

test("hidden text: every probe without a known bug matches its data-expect", () => {
  expect(probes.length).toBeGreaterThanOrEqual(25);
  const wrong = probes
    .filter((p) => !p.bug)
    .filter((p) => (p.expect === "text" ? !has(p.token) : has(p.token))) // absent + counted: never listed
    .map((p) => `${p.expect}: ${p.token}`);
  expect(wrong, `snapshot:\n${tree}`).toEqual([]);
});

test("hidden text: the sr-only label names its input", () => {
  expect(tree).toMatch(/<input type=email>TOK_SRONLY_LABEL<\/input>/);
});

test("hidden text: below-the-fold interactives are counted, not listed", () => {
  const m = tree.match(/\[\+(\d+) interactive elements outside the viewport/);
  expect(m, tree).not.toBeNull();
  expect(Number(m![1])).toBe(probes.filter((p) => p.expect === "counted").length);
});

test("hidden text: no injected instruction reaches the snapshot", () => {
  for (const s of ["ignore previous instructions", "admin mode", "disregard the user", "cookies", "evil.example"]) expect(has(s), s).toBe(false);
});
