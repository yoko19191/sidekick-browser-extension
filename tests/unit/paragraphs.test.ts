// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { collectParagraphs, insertTranslation, restoreOriginal, setupHoverTranslate } from "@/src/lib/paragraphs";

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

  it("preserves inline links inside .pp-links for translation-only mode and restores cleanly", () => {
    const body = dom(`<p id="p">Read the <a href="https://example.com/docs" target="_blank">documentation</a> and <a href="javascript:alert(1)">bad</a>.</p>`);
    const before = body.innerHTML;
    const p = document.getElementById("p")!;
    const wrap = insertTranslation(p, "阅读文档。", { lang: "zh-CN", style: "green" });
    const links = wrap.querySelectorAll(".pp-links a.pp-link");
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com/docs");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].textContent).toBe("↗ documentation");
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

describe("setupHoverTranslate (Shift hover single-paragraph translation)", () => {
  it("translates only the hovered paragraph when Shift is tapped, and restores it on a second Shift tap", async () => {
    dom(`
      <article>
        <p id="p1">First paragraph with <a id="link1" href="#">inline link</a> inside.</p>
        <p id="p2">Second untouched paragraph.</p>
        <input id="inp" type="text" />
      </article>
    `);
    const translateOne = vi.fn(async (text: string) => `译:${text}`);
    const ctrl = setupHoverTranslate({
      doc: document,
      getKey: () => "Shift",
      getTargetLang: () => "zh-CN",
      getStyle: () => "green",
      translateOne,
    });

    const link1 = document.getElementById("link1")!;
    const p1 = document.getElementById("p1")!;
    const p2 = document.getElementById("p2")!;

    // Hover over the inline link inside #p1
    link1.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    // Tap Shift+A (combo key) -> should NOT trigger translation
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "A", shiftKey: true, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(translateOne).not.toHaveBeenCalled();

    // Tap solo Shift while hovering over #p1 -> translates #p1 only
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));

    await vi.waitFor(() => expect(translateOne).toHaveBeenCalledOnce());
    expect(translateOne).toHaveBeenCalledWith("First paragraph with inline link inside.");
    expect(p1.querySelector(".pp-trans-inner")?.textContent).toBe("译:First paragraph with inline link inside.");
    expect(p2.querySelector(".pp-trans")).toBeNull();

    // Tap solo Shift again while hovering over #p1 -> restores #p1 back to original
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    expect(p1.querySelector(".pp-trans")).toBeNull();
    expect(p1.hasAttribute("data-pp-done")).toBe(false);

    ctrl.destroy();
  });

  it("marks tight wrapper ancestors (e.g. div#title > h1 > yt-formatted-string) with data-pp-unclip and cleans up on restore", () => {
    dom(`
      <div id="above-the-fold">
        <div id="title">
          <h1 id="heading">
            <yt-formatted-string id="yt-str">시속 500km 첫 돌파...中 전기차 1대당 43억 원</yt-formatted-string>
          </h1>
        </div>
        <div id="other-section">Channel Info and Subscribe Buttons that should not be marked</div>
      </div>
    `);
    const ytStr = document.getElementById("yt-str")!;
    const heading = document.getElementById("heading")!;
    const titleWrap = document.getElementById("title")!;
    const aboveFold = document.getElementById("above-the-fold")!;

    insertTranslation(ytStr, "时速500公里首次突破……中国电动汽车每辆43亿韩元", { lang: "zh-CN", style: "highlight" });
    expect(ytStr.hasAttribute("data-pp-done")).toBe(true);
    expect(heading.hasAttribute("data-pp-unclip")).toBe(true);
    expect(titleWrap.hasAttribute("data-pp-unclip")).toBe(true);
    expect(aboveFold.hasAttribute("data-pp-unclip")).toBe(false);

    restoreOriginal(document);
    expect(ytStr.hasAttribute("data-pp-done")).toBe(false);
    expect(heading.hasAttribute("data-pp-unclip")).toBe(false);
    expect(titleWrap.hasAttribute("data-pp-unclip")).toBe(false);
  });
});
