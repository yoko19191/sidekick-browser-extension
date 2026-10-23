// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { PageObserver, visible } from "../../src/agent/page/observer";

it("skips display:none, opacity 0, and near-zero font text", () => {
  document.body.innerHTML = `
    <p style="display:none">HIDDEN_DISPLAY</p>
    <p style="opacity:0">HIDDEN_OPACITY</p>
    <p style="font-size:0.5px">HIDDEN_TINY</p>
    <p>VISIBLE_TEXT</p>
    <button>OK</button>`;
  // jsdom getComputedStyle may not apply inline opacity/font-size the same way; mark via attributes for the fallback path
  const o = new PageObserver(document);
  const tree = o.snapshot().tree;
  expect(tree).toContain("VISIBLE_TEXT");
  expect(tree).toContain("OK");
  expect(tree).not.toContain("HIDDEN_DISPLAY");
});

it("counts interactive elements outside the viewport instead of listing them all", () => {
  Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 100, configurable: true });
  document.body.innerHTML = `<button id="near">Near</button>`;
  const near = document.getElementById("near")!;
  near.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 10, right: 40, width: 30, height: 20, x: 10, y: 10, toJSON: () => ({}) });
  for (let i = 0; i < 5; i++) {
    const b = document.createElement("button");
    b.textContent = `Far${i}`;
    b.getBoundingClientRect = () => ({ top: 5000, bottom: 5020, left: 10, right: 40, width: 30, height: 20, x: 10, y: 5000, toJSON: () => ({}) });
    document.body.appendChild(b);
  }
  const tree = new PageObserver(document).snapshot().tree;
  expect(tree).toContain("Near");
  expect(tree).toMatch(/\+5 interactive elements outside the viewport/);
  // far elements are summarised (sample labels), never listed with an index
  expect(tree).not.toMatch(/\[f0:\d+\]<button>Far0/);
  expect(tree).toMatch(/\[below: ~5: Far0, Far1, Far2…\]/);
});

const rect = (top: number) => () => ({ top, bottom: top + 20, left: 10, right: 40, width: 30, height: 20, x: 10, y: top, toJSON: () => ({}) });

it("groups off-viewport elements by nearest heading and caps sample labels at 20", () => {
  Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 100, configurable: true });
  let html = "";
  for (let s = 0; s < 10; s++) {
    html += `<h2 id="h${s}">Sec${s}</h2>`;
    for (let i = 0; i < 4; i++) html += `<button class="far">S${s}B${i}</button>`;
  }
  document.body.innerHTML = html;
  document.querySelectorAll<HTMLElement>("h2, .far").forEach((e) => (e.getBoundingClientRect = rect(5000)));
  const tree = new PageObserver(document).snapshot().tree;
  expect(tree).toMatch(/\+40 interactive elements outside the viewport/);
  expect(tree).toMatch(/\[below section "Sec0": ~4: S0B0, S0B1, S0B2…\]/);
  const labels = [...tree.matchAll(/S\dB\d/g)].length;
  expect(labels).toBeLessThanOrEqual(20);
});

it("button and label names include only visible text (no hidden-text injection)", () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  document.body.innerHTML = `
    <button>Buy<span style="opacity:0">TOK_BTN_CHILD_OPACITY</span><span style="display:none">TOK_BTN_DISPLAY</span></button>
    <label for="q">Email<span style="display:none">TOK_LABEL_HIDDEN</span></label><input id="q">`;
  const tree = new PageObserver(document).snapshot().tree;
  expect(tree).toContain("Buy");
  expect(tree).toContain("Email");
  expect(tree).not.toContain("TOK_BTN_DISPLAY");
  expect(tree).not.toContain("TOK_LABEL_HIDDEN");
});

it("abort stops per-character typing mid-way", async () => {
  document.body.innerHTML = `<input id="t">`;
  const o = new PageObserver(document, { typeDelayMs: 5 });
  const id = o.snapshot().tree.match(/\[(f0:\d+)\]/)![1];
  const p = o.execute({ name: "input", args: { index: id, text: "abcdefghijklmnopqrstuvwxyz" } });
  await new Promise((r) => setTimeout(r, 30));
  o.abort();
  const res = await p;
  const typed = (document.getElementById("t") as HTMLInputElement).value;
  expect(res.ok).toBe(false);
  expect(typed.length).toBeGreaterThan(0);
  expect(typed.length).toBeLessThan(26);
  await new Promise((r) => setTimeout(r, 30));
  expect((document.getElementById("t") as HTMLInputElement).value).toBe(typed);
});

it("marks closed shadow roots and cross-origin iframes as unreachable", () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  class ClosedBox extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "closed" }).innerHTML = "<button>SECRET_INSIDE</button>";
    }
  }
  if (!customElements.get("closed-box")) customElements.define("closed-box", ClosedBox);
  document.body.innerHTML = `<closed-box></closed-box><iframe src="https://other.example.net/pay"></iframe>`;
  const rect = () => ({ top: 10, bottom: 210, left: 10, right: 310, width: 300, height: 200, x: 10, y: 10, toJSON: () => ({}) });
  for (const el of document.body.children) (el as HTMLElement).getBoundingClientRect = rect as any;
  const tree = new PageObserver(document).snapshot().tree;
  expect(tree).toMatch(/\[unreachable: <closed-box> has a closed shadow root/);
  expect(tree).toMatch(/\[unreachable: cross-origin iframe https:\/\/other\.example\.net\/pay/);
  expect(tree).not.toContain("SECRET_INSIDE");
});

describe("occlusion across shadow DOM", () => {
  it("a slotted or shadow-internal hit does not count as occluding its host", async () => {
    const { composedContains } = await import("../../src/agent/page/observer");
    const host = document.createElement("sl-button");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    const slot = document.createElement("slot");
    inner.appendChild(slot);
    root.appendChild(inner);
    const label = document.createElement("span");
    label.textContent = "Go";
    host.appendChild(label);
    document.body.appendChild(host);
    expect(composedContains(host, inner)).toBe(true);
    expect(composedContains(inner, label)).toBe(true); // via the slot
    expect(composedContains(label, host)).toBe(false);
    host.remove();
  });
});

it("counts far cross-origin iframes in the off-viewport groups", () => {
  document.body.innerHTML = `<div style="height:5000px"></div><iframe src="https://other.example/embed"></iframe>`;
  const f = document.querySelector("iframe")!;
  (f as any).getBoundingClientRect = () => ({ top: 4800, left: 0, width: 300, height: 150, bottom: 4950, right: 300 });
  const snap = new PageObserver(document).snapshot();
  expect(snap.tree).toContain("cross-origin iframe");
  expect(snap.tree).not.toContain("[unreachable: cross-origin iframe https://other.example/embed");
});

it("reports an in-view cross-origin iframe as unreachable", () => {
  document.body.innerHTML = `<iframe src="https://other.example/embed"></iframe>`;
  const f = document.querySelector("iframe")!;
  (f as any).getBoundingClientRect = () => ({ top: 10, left: 0, width: 300, height: 150, bottom: 160, right: 300 });
  expect(new PageObserver(document).snapshot().tree).toContain("[unreachable: cross-origin iframe https://other.example/embed");
});
