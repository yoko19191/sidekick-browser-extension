// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { collectParagraphs, insertTranslation, restoreOriginal } from "@/src/lib/paragraphs";

function dom(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

describe("collectParagraphs", () => {
  it("groups inline text under its nearest block and skips code/pre/nav-less noise", () => {
    const body = dom(`<article><h1>Title <em>here</em></h1><p>Hello <a href="#">link</a> world.</p>
      <pre>const x = 1;</pre><p>Use <code>npm i</code> to install.</p><script>var a</script>
      <ul><li>Item one<ul><li>Nested</li></ul></li></ul><p class="notranslate">Keep me</p></article>`);
    const texts = collectParagraphs(body).map((p) => p.text);
    expect(texts).toEqual(["Title here", "Hello link world.", "Use to install.", "Item one", "Nested"]);
  });
  it("honours user skip selectors and ignores already-translated blocks", () => {
    const body = dom(`<p>One</p><div class="comments"><p>Two</p></div><p>Three</p>`);
    const [first] = collectParagraphs(body, { skipSelectors: ".comments" });
    insertTranslation(first.el, "一", { lang: "zh-CN", style: "dashed" });
    expect(collectParagraphs(body, { skipSelectors: ".comments" }).map((p) => p.text)).toEqual(["Three"]);
  });
  it("survives an invalid user selector", () => {
    const body = dom(`<p>One</p>`);
    expect(collectParagraphs(body, { skipSelectors: "[[[" }).length).toBe(1);
  });
});

describe("insert / restore", () => {
  it("inserts a bilingual node under the original and restores the page exactly", () => {
    const body = dom(`<p id="p">Hello world</p>`);
    const before = body.innerHTML;
    const p = document.getElementById("p")!;
    insertTranslation(p, "你好世界", { lang: "zh-CN", style: "card" });
    insertTranslation(p, "你好，世界", { lang: "zh-CN", style: "card" }); // re-insert replaces, no duplicates
    const nodes = body.querySelectorAll(".pp-trans");
    expect(nodes.length).toBe(1);
    expect(nodes[0].textContent).toBe("你好，世界");
    expect(nodes[0].classList.contains("pp-style-card")).toBe(true);
    expect(p.firstChild?.textContent).toBe("Hello world");
    expect(restoreOriginal(document)).toBe(1);
    expect(body.innerHTML).toBe(before);
  });
});

describe("translation tone", () => {
  it("picks the bright accent for light text (dark pages) and the darker one otherwise", () => {
    document.body.innerHTML = `<p id="a" style="color:#111">Hello</p><p id="b" style="color:rgb(240,240,240)">Hi</p>`;
    expect(insertTranslation(document.getElementById("a")!, "你好", { lang: "zh-CN", style: "green" }).getAttribute("data-pp-tone")).toBe("light");
    expect(insertTranslation(document.getElementById("b")!, "嗨", { lang: "zh-CN", style: "green" }).getAttribute("data-pp-tone")).toBe("dark");
  });
});
