/**
 * Step-2 gate tests (代码审查测试 Bot). Own mock LLM + two fixture origins, real Chromium + built extension.
 * Run: SIDEKICK_EXT_DIR=<.output-e2e/chrome-mv3> npx playwright test -c tests/gate/playwright.gate.config.ts
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, onboard, openPanel } from "../e2e/harness";

// ---------- scripted mock LLM ----------
type Mode =
  | { kind: "observe" } // capture snapshot, then done
  | { kind: "click"; label: RegExp } // click first element whose snapshot line matches, then done
  | { kind: "type"; text: string } // type into first text input
  | { kind: "hang"; streamFirst: boolean }; // never finish (optionally send one chunk first)
let mode: Mode = { kind: "observe" };
let snapshots: string[] = [];
let hang: { startedAt?: number; closedAt?: number } = {};
let agentReqs = 0;

const chunk = (model: string, delta: object, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "m", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const toolCall = (res: ServerResponse, model: string, name: string, args: object) => {
  res.write(chunk(model, { role: "assistant", tool_calls: [{ index: 0, id: `call_${agentReqs}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }));
  res.write(chunk(model, {}, "tool_calls"));
  res.write("data: [DONE]\n\n");
  res.end();
};

async function llm(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, "http://x");
  if (url.pathname === "/v1/models") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "mock-model", object: "model" }] }));
  if (url.pathname !== "/v1/chat/completions") return false;
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  const model = body.model;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const tools: string[] = (body.tools ?? []).map((t: any) => t.function?.name);
  if (!tools.includes("done")) {
    res.write(chunk(model, { role: "assistant", content: "ok" }));
    res.write(chunk(model, {}, "stop"));
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  agentReqs++;
  const last = body.messages[body.messages.length - 1];
  const lastText = typeof last.content === "string" ? last.content : (last.content ?? []).map((p: any) => p.text ?? "").join("");
  snapshots.push(lastText);
  const done = () => toolCall(res, model, "done", { success: true, text: "gate-done" });
  const calls: string[] = body.messages.flatMap((m: any) => m.tool_calls ?? []).map((c: any) => c.function.name);
  if (mode.kind === "observe") return done();
  if (mode.kind === "hang") {
    hang.startedAt = Date.now();
    res.on("close", () => (hang.closedAt ??= Date.now()));
    req.on("close", () => (hang.closedAt ??= Date.now()));
    if (mode.streamFirst) res.write(chunk(model, { role: "assistant", content: "" }));
    return; // never ends
  }
  const line = (re: RegExp) => lastText.split("\n").find((l: string) => re.test(l) && /\[f\d+:\d+\]/.test(l));
  const idOf = (l?: string) => l?.match(/\[(f\d+:\d+)\]/)?.[1];
  if (mode.kind === "click") {
    if (calls.includes("click")) return done();
    return toolCall(res, model, "click", { index: idOf(line(mode.label)) ?? "f0:999" });
  }
  if (mode.kind === "type") {
    if (calls.includes("input")) return done();
    return toolCall(res, model, "input", { index: idOf(line(/[<‹]input type=text/)) ?? "f0:999", text: mode.text });
  }
}

// ---------- fixtures ----------
const SHADOW = `<!doctype html><html><head><meta charset="utf-8"><title>shadow</title>
<style>body{font:16px sans-serif;margin:20px} #overlay{position:fixed;left:0;top:520px;width:600px;height:80px;background:rgba(0,0,0,.6);z-index:10}</style>
<script>
const def=(n,html)=>customElements.define(n,class extends HTMLElement{constructor(){super();this.attachShadow({mode:'open'}).innerHTML=html}});
// sl-button: real <button> lives in the shadow root, label is slotted text
def('x-button','<style>button{padding:6px 12px}</style><button part="base"><span part="label"><slot></slot></span></button>');
// sl-dialog: panel in shadow, light-DOM content (incl. buttons) slotted in, plus a shadow overlay *behind* the panel
def('x-dialog','<style>.ov{position:absolute;inset:0;background:#0002}.p{position:relative;z-index:1;background:#fff;border:1px solid #888;padding:10px}</style><div class="ov" part="overlay"></div><div class="p" part="panel" role="dialog"><slot></slot><footer><slot name="footer"></slot></footer></div>');
// sl-select: trigger button inside shadow
def('x-select','<button part="combobox" role="combobox" aria-expanded="false">Choose <slot name="label"></slot></button>');
// sl-tab-group: tabs slotted into a shadow nav
def('x-tabs','<nav part="nav" style="display:flex;gap:6px"><slot name="nav"></slot></nav><div part="body"><slot></slot></div>');
</script></head><body>
<h1>Shadow fixture</h1>
<x-dialog style="display:block;position:relative;width:500px">
  <p>Dialog body</p>
  <button id="slotted" onclick="window.__hits.push('slotted')">SlottedOkay</button>
  <x-button id="xb" slot="footer" onclick="window.__hits.push('xbutton')">ShadowSave</x-button>
</x-dialog>
<x-select style="display:block;margin-top:10px" onclick="window.__hits.push('select')"><span slot="label">Fruit</span></x-select>
<x-tabs style="display:block;margin-top:10px"><button slot="nav" role="tab" onclick="window.__hits.push('tab2')">TabTwo</button><p>panel</p></x-tabs>
<div style="position:absolute;top:540px;left:20px"><button id="covered" onclick="window.__hits.push('covered')">CoveredButton</button></div>
<div id="overlay"></div>
<script>window.__hits=[]</script>
</body></html>`;

const iframePage = (other: string, self: string) => `<!doctype html><html><head><meta charset="utf-8"><title>frames</title></head><body>
<h1>Frames</h1>
<iframe id="xo" src="${other}/inner.html" width="400" height="120"></iframe>
<iframe id="so" src="${self}/inner-same.html" width="400" height="120"></iframe>
<iframe id="nav" name="res" width="400" height="120"></iframe>
<div style="height:3000px"></div><iframe id="far" src="${other}/inner.html?far=1" width="400" height="120"></iframe>
<script>/* JSFiddle-style: no src attribute, navigated cross-origin by name */ window.open("${other}/inner.html?nav=1", "res");</script>
</body></html>`;
const INNER = `<!doctype html><body><button>CrossOriginButton</button></body>`;
const INNER_SAME = `<!doctype html><body><button onclick="parent.__hits=(parent.__hits||[]).concat('same')">SameOriginButton</button></body>`;
const FORM = `<!doctype html><html><head><meta charset="utf-8"><title>form</title></head><body>
<h1>Form</h1><form onsubmit="event.preventDefault()"><label>Name <input type="text" name="name"></label><button type="submit">Submit</button></form>
<script>window.__inputs=[];document.querySelector('input').addEventListener('input',()=>window.__inputs.push(performance.timeOrigin+performance.now()))</script>
</body></html>`;

let srvA: Server, srvB: Server;
let A = "", B = "";
let context: BrowserContext;
let extId = "";

function page(res: ServerResponse, html: string) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
}

test.beforeAll(async () => {
  srvA = createServer(async (req, res) => {
    const p = new URL(req.url!, "http://x").pathname;
    if (p.startsWith("/v1/")) {
      if ((await llm(req, res)) === false) res.writeHead(404).end();
      return;
    }
    if (p === "/shadow.html") return page(res, SHADOW);
    if (p === "/frames.html") return page(res, iframePage(B, A));
    if (p === "/inner-same.html") return page(res, INNER_SAME);
    if (p === "/form.html") return page(res, FORM);
    res.writeHead(404).end();
  });
  srvB = createServer((req, res) => (new URL(req.url!, "http://x").pathname === "/inner.html" ? page(res, INNER) : res.writeHead(404).end()));
  await new Promise<void>((r) => srvA.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => srvB.listen(0, "127.0.0.1", r));
  A = `http://127.0.0.1:${(srvA.address() as any).port}`;
  B = `http://localhost:${(srvB.address() as any).port}`; // different host+port = cross-origin
  ({ context, extId } = await launch());
  const p = await context.newPage();
  await p.goto(`${A}/form.html`);
  const panel = await openPanel(context, extId, `${A}/form.html`);
  await onboard(panel, `${A}/v1`);
  await panel.close();
  await p.close();
});
test.afterAll(async () => {
  await context?.close();
  srvA?.close();
  srvB?.close();
});
test.beforeEach(() => {
  snapshots = [];
  hang = {};
  agentReqs = 0;
});

let seq = 0;
async function act(url0: string, task: string): Promise<{ page: Page; panel: Page }> {
  const url = `${url0}?run=${++seq}`; // unique URL: openPanel binds to the first tab with this URL
  const page = await context.newPage();
  await page.goto(url);
  const panel = await openPanel(context, extId, url);
  await panel.getByTestId("composer").fill(`/act ${task}`);
  await panel.getByTestId("send").click();
  await expect(panel.getByTestId("agent-run")).toBeVisible();
  return { page, panel };
}
const lineOf = (snap: string, re: RegExp) => snap.split("\n").find((l) => re.test(l)) ?? "";

// ---------- 1. shadow DOM occlusion ----------
test.describe("gate 1: shadow DOM occlusion", () => {
  test("slotted / shadow elements are not marked occluded; a real overlay is", async () => {
    mode = { kind: "observe" };
    const { panel } = await act(`${A}/shadow.html`, "observe");
    await expect.poll(() => snapshots.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const s = snapshots[0];
    if (process.env.GATE_DEBUG) console.log(s);
    for (const label of [/SlottedOkay/, /ShadowSave/, /Choose/, /TabTwo/]) {
      expect(lineOf(s, label), `element ${label} must be listed`).toMatch(/\[f\d+:\d+\]/);
    }
    const wrong = s.split("\n").filter((l) => /\boccluded\b/.test(l) && !/CoveredButton/.test(l));
    expect(wrong, "shadow/slotted elements wrongly marked occluded").toEqual([]);
    expect(lineOf(s, /CoveredButton/), "button under a fixed overlay must be occluded").toMatch(/\boccluded\b/);
    await panel.close();
  });
  for (const [label, hit] of [[/SlottedOkay/, "slotted"], [/ShadowSave/, "xbutton"], [/TabTwo/, "tab2"]] as const) {
    test(`click on ${label.source} succeeds`, async () => {
      mode = { kind: "click", label };
      const { page, panel } = await act(`${A}/shadow.html`, `click ${label.source}`);
      await expect.poll(() => page.evaluate(() => (window as any).__hits as string[]), { timeout: 15_000 }).toContain(hit).catch(async (e) => {
        console.log("PANEL:", await panel.getByTestId("agent-run").innerText().catch(() => ""));
        throw e;
      });
      await panel.close();
    });
  }
});

// ---------- 2. cross-origin iframe ----------
test.describe("gate 2: cross-origin iframe", () => {
  test("snapshot reports [unreachable: cross-origin iframe]; same-origin frame content listed", async () => {
    mode = { kind: "observe" };
    const { page, panel } = await act(`${A}/frames.html`, "observe");
    await page.frameLocator("#xo").locator("button").waitFor();
    await expect.poll(() => snapshots.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const s = snapshots[0];
    if (process.env.GATE_DEBUG) console.log(s);
    await page.frameLocator("#nav").locator("button").waitFor();
    expect(s).toContain("[unreachable: cross-origin iframe");
    expect(s.split("[unreachable: cross-origin iframe").length - 1, "all 3 cross-origin frames (src=, name-navigated JSFiddle-style, far below the viewport) must be reported").toBe(3);
    expect(s, "cross-origin content must not leak").not.toContain("CrossOriginButton");
    expect(lineOf(s, /SameOriginButton/)).toMatch(/\[f[1-9]\d*:\d+\]/);
    await panel.close();
  });
  test("same-origin iframe button is clickable", async () => {
    mode = { kind: "click", label: /SameOriginButton/ };
    const { page, panel } = await act(`${A}/frames.html`, "click same origin");
    await expect.poll(() => page.evaluate(() => (window as any).__hits ?? []), { timeout: 15_000 }).toContain("same");
    await panel.close();
  });
});

// ---------- 3. stop timing ----------
async function armStopTimer(panel: Page) {
  await panel.evaluate(() => {
    const w = window as any;
    w.__t0 = 0;
    w.__t1 = 0;
    document.addEventListener("click", (e) => {
      if ((e.target as Element).closest?.('[data-testid="agent-stop"]')) w.__t0 = performance.timeOrigin + performance.now();
    }, true);
    new MutationObserver(() => {
      if (w.__t0 && !w.__t1 && !document.querySelector('[data-testid="agent-stop"]')) w.__t1 = performance.timeOrigin + performance.now();
    }).observe(document.body, { childList: true, subtree: true });
  });
}
test.describe("gate 3: stop timing", () => {
  for (const streamFirst of [false, true]) {
    test(`stop while model request in flight (${streamFirst ? "stream opened" : "no bytes yet"}) → UI + fetch stop < 500 ms`, async () => {
      mode = { kind: "hang", streamFirst };
      const { panel } = await act(`${A}/form.html`, "hang");
      await expect.poll(() => hang.startedAt ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
      await panel.waitForTimeout(300);
      await armStopTimer(panel);
      await panel.getByTestId("agent-stop").click();
      await panel.waitForTimeout(1500);
      const { t0, t1 } = await panel.evaluate(() => ({ t0: (window as any).__t0 as number, t1: (window as any).__t1 as number }));
      expect(t0).toBeGreaterThan(0);
      expect(t1, "stop button never went away").toBeGreaterThan(0);
      expect(t1 - t0, "UI stop latency").toBeLessThan(500);
      expect(hang.closedAt, "LLM fetch was not aborted").toBeTruthy();
      expect(hang.closedAt! - t0, "fetch abort latency").toBeLessThan(500);
      await panel.close();
    });
  }
  test("stop during per-character typing → no new characters after stop", async () => {
    mode = { kind: "type", text: "y".repeat(600) };
    const { page, panel } = await act(`${A}/form.html`, "type");
    await expect.poll(() => page.evaluate(() => (window as any).__inputs.length), { timeout: 15_000 }).toBeGreaterThan(10);
    await armStopTimer(panel);
    await panel.getByTestId("agent-stop").click();
    await page.waitForTimeout(1000);
    const t0 = await panel.evaluate(() => (window as any).__t0 as number);
    const t1 = await panel.evaluate(() => (window as any).__t1 as number);
    const inputs: number[] = await page.evaluate(() => (window as any).__inputs);
    const after = inputs.filter((t) => t > t0 + 100).length; // allow 100 ms for the abort message to cross processes
    expect(t1 - t0, "UI stop latency").toBeLessThan(500);
    expect(after, "chars typed >100 ms after stop").toBe(0);
    expect(inputs.length).toBeLessThan(600);
    await panel.close();
  });
});

// ---------- 4. request timeout ----------
function findTimeoutMs(): number | undefined {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(resolve("src/agent"));
  files.push(resolve("src/lib/llm.ts"));
  for (const f of files) {
    const m = readFileSync(f, "utf8").match(/(?:REQUEST|LLM|MODEL|STREAM|AGENT)[A-Z_]*TIMEOUT[A-Z_]*\s*=\s*([\d_]+)(?:\s*\*\s*(\d+))?/);
    if (m) return Number(m[1].replace(/_/g, "")) * (m[2] ? Number(m[2]) : 1);
    const d = readFileSync(f, "utf8").match(/[Tt]imeoutMs\s*\?\?\s*([\d_]+)/); // e.g. opts.requestTimeoutMs ?? 120_000
    if (d) return Number(d[1].replace(/_/g, ""));
  }
  return undefined;
}
test.describe("gate 4: request timeout", () => {
  test("hanging model request ends the run with a timeout error", async () => {
    const ms = findTimeoutMs();
    test.fixme(ms === undefined, "no *TIMEOUT* constant for agent model requests found in src/agent or src/lib/llm.ts");
    test.fixme(ms !== undefined && ms > 150_000, `timeout ${ms} ms too long for e2e; expose an override`);
    test.setTimeout(ms! + 60_000);
    mode = { kind: "hang", streamFirst: false };
    const { panel } = await act(`${A}/form.html`, "hang");
    await expect(panel.getByTestId("agent-stop")).toHaveCount(0, { timeout: ms! + 15_000 });
    await expect(panel.getByTestId("agent-run")).toContainText(/超时|timeout|timed out/i);
    expect(hang.closedAt, "request must be aborted on timeout").toBeTruthy();
  });
});
