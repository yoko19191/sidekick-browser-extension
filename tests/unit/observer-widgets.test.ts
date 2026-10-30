// @vitest-environment jsdom
// Widget patterns from real sites: web-component forms (Shoelace).
import { beforeEach, describe, expect, it } from "vitest";
import { PageObserver } from "../../src/agent/page/observer";

function idOf(tree: string, needle: string): string {
  const line = tree.split("\n").find((l) => l.includes(needle));
  if (!line) throw new Error(`"${needle}" not in tree:\n${tree}`);
  return line.match(/\[(f\d+:\d+)\]/)![1];
}

/** A light-DOM host whose real control lives in its open shadow root, like <sl-button> / <sl-input>. */
function shadowHost(parent: Element, inner: string) {
  const host = document.createElement("div");
  parent.appendChild(host);
  host.attachShadow({ mode: "open" }).innerHTML = inner;
  return host;
}

describe("web-component forms", () => {
  beforeEach(() => {
    document.body.innerHTML = `<form id="pay"></form><form id="plain"></form>`;
    shadowHost(document.getElementById("pay")!, `<input type="password" name="pin">`);
    shadowHost(document.getElementById("pay")!, `<button type="submit">Continue</button>`);
    shadowHost(document.getElementById("plain")!, `<input name="title">`);
    shadowHost(document.getElementById("plain")!, `<button type="submit">Save</button>`);
  });

  it("a submit button inside a shadow root belongs to the enclosing form, and sees its shadow password field", () => {
    const o = new PageObserver(document);
    const tree = o.snapshot().tree;
    const pay = o.describe(idOf(tree, ">Continue<"))!;
    expect(pay).toMatchObject({ inForm: true, isSubmit: true, formSensitive: true, formSubmitText: "Continue" });
    const plain = o.describe(idOf(tree, ">Save<"))!;
    expect(plain).toMatchObject({ inForm: true, isSubmit: true, formSensitive: false });
  });
});
