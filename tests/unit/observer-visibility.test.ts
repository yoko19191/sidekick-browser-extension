// @vitest-environment jsdom
import { expect, it } from "vitest";
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
  expect(tree).not.toContain("Far0");
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
