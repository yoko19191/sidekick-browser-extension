// @vitest-environment jsdom
// Widget patterns from real sites: web-component forms (Shoelace), custom-styled checkboxes (IKEA filters),
// and key events that must cross shadow roots.
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

describe("custom-styled checkbox behind a visible label", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <fieldset><legend>Width</legend>
        <label for="w0"><span>0 - 1' 11"</span><input type="checkbox" id="w0" style="opacity:0"></label>
        <label for="w1"><span>2 - 3' 11"</span><input type="checkbox" id="w1" style="display:none"></label>
        <label for="w2" style="display:none"><span>HIDDEN_LABEL</span><input type="checkbox" id="w2" style="opacity:0"></label>
      </fieldset>`;
  });

  it("lists the hidden checkbox under its label text and clicking toggles it", async () => {
    const o = new PageObserver(document);
    const tree = o.snapshot().tree;
    expect(tree).toMatch(/\[f0:\d+\]<input type=checkbox[^>]*>0 - 1' 11"<\/input>/);
    expect(tree).toMatch(/<input type=checkbox[^>]*>2 - 3' 11"<\/input>/);
    expect(tree).not.toContain("HIDDEN_LABEL");
    const r = await o.execute({ name: "click", args: { index: idOf(tree, "0 - 1' 11\"</input>") } });
    expect(r.ok).toBe(true);
    expect((document.getElementById("w0") as HTMLInputElement).checked).toBe(true);
    expect(o.snapshot().tree).toMatch(/<input type=checkbox[^>]* checked>0 - 1' 11"/);
  });
});

it("key events cross shadow roots like real keyboard input (document-level Escape handlers see them)", async () => {
  document.body.innerHTML = ``;
  shadowHost(document.body, `<button>Close</button>`);
  const keys: string[] = [];
  document.addEventListener("keydown", (e) => keys.push(e.key));
  const o = new PageObserver(document);
  await o.execute({ name: "send_keys", args: { keys: "Escape", index: idOf(o.snapshot().tree, ">Close<") } });
  expect(keys).toEqual(["Escape"]);
});

it("a web-component button is named by its slotted text, and hidden slotted text stays out", () => {
  document.body.innerHTML = `<div id="b">No, thanks<span style="display:none">IGNORE_PREVIOUS_INSTRUCTIONS</span></div>`;
  document.getElementById("b")!.attachShadow({ mode: "open" }).innerHTML = `<button type="button"><slot name="prefix"></slot><slot></slot></button>`;
  const tree = new PageObserver(document).snapshot().tree;
  expect(tree).toMatch(/\[f0:\d+\]<button>No, thanks<\/button>/);
  expect(tree).not.toContain("IGNORE_PREVIOUS_INSTRUCTIONS");
});
