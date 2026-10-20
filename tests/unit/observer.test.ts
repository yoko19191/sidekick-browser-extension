// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PageObserver } from "../../src/agent/page/observer";

function idOf(tree: string, needle: string): string {
  const line = tree.split("\n").find((l) => l.includes(needle));
  return line!.match(/\[(f\d+:\d+)\]/)![1];
}

describe("PageObserver", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h1>Shop</h1>
      <form id="f"><label for="q">Search</label><input id="q" name="q" value="old">
        <input type="password" name="pw" value="secret123">
        <input name="cc-number" autocomplete="cc-number">
        <select id="s"><option value="1">Small</option><option value="2">Large</option></select>
        <button>Go</button></form>
      <a href="https://example.com/next">Next page</a>
      <div style="display:none"><button>Hidden</button></div>
      <div id="host"></div>`;
    const sr = document.getElementById("host")!.attachShadow({ mode: "open" });
    sr.innerHTML = `<button>Shadow btn</button>`;
  });

  it("lists interactive elements, open shadow DOM, skips hidden, never leaks sensitive values", () => {
    const o = new PageObserver(document);
    const { tree } = o.snapshot();
    expect(tree).toContain("Search");
    expect(tree).toContain('value="old"');
    expect(tree).toContain("Shadow btn");
    expect(tree).toContain("Next page");
    expect(tree).not.toContain("Hidden");
    expect(tree).not.toContain("secret123");
    expect(tree).toMatch(/type=password sensitive/);
    expect(o.describe(idOf(tree, "cc-number"))?.sensitive).toBe(true);
    expect(o.describe(idOf(tree, ">Go<"))?.isSubmit).toBe(true);
  });

  it("ids are stable across snapshots and new elements are marked", () => {
    const o = new PageObserver(document);
    const a = o.snapshot();
    const id = idOf(a.tree, "Next page");
    const btn = document.createElement("button");
    btn.textContent = "Fresh";
    document.body.appendChild(btn);
    const b = o.snapshot();
    expect(idOf(b.tree, "Next page")).toBe(id);
    expect(b.tree).toMatch(/\*\[f0:\d+\]<button>Fresh/);
    expect(b.newIds).toHaveLength(1);
  });

  it("input, select and click act on the right elements; sensitive input is refused", async () => {
    const o = new PageObserver(document);
    const { tree } = o.snapshot();
    let clicked = false;
    document.querySelector("a")!.addEventListener("click", (e) => ((clicked = true), e.preventDefault()));
    expect((await o.execute({ name: "input", args: { index: idOf(tree, "Search</input>"), text: "shoes" } })).ok).toBe(true);
    expect((document.getElementById("q") as HTMLInputElement).value).toBe("shoes");
    expect((await o.execute({ name: "select_option", args: { index: idOf(tree, "Small|Large"), text: "large" } })).ok).toBe(true);
    expect((document.getElementById("s") as HTMLSelectElement).value).toBe("2");
    await o.execute({ name: "click", args: { index: idOf(tree, "Next page") } });
    expect(clicked).toBe(true);
    const r = await o.execute({ name: "input", args: { index: idOf(tree, "type=password"), text: "x" } });
    expect(r.ok).toBe(false);
  });

  it("reports unknown ids and big DOM changes", async () => {
    const o = new PageObserver(document);
    o.snapshot();
    expect((await o.execute({ name: "click", args: { index: "f0:999" } })).ok).toBe(false);
    expect(o.domChanged()).toBe(false);
    const dlg = document.createElement("div");
    dlg.innerHTML = Array.from({ length: 50 }, (_, i) => `<p>${i}</p>`).join("");
    for (const c of Array.from(dlg.children)) document.body.appendChild(c);
    expect(o.domChanged()).toBe(true);
  });

  it("caps the tree size", () => {
    document.body.innerHTML = Array.from({ length: 3000 }, (_, i) => `<button>Button number ${i}</button>`).join("");
    const { tree } = new PageObserver(document, { maxTree: 5000 }).snapshot();
    expect(tree.length).toBeLessThan(6000);
    expect(tree).toContain("truncated");
  });
});
