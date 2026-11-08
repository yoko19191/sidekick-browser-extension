// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractPage } from "../../src/lib/extract";
import { planChatExcerpts } from "../../src/lib/prompts";

function makeDoc(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

describe("extractPage completeness & fallback", () => {
  it("extracts ALL posts on multi-article pages (forums, Q&A, GitHub issues) instead of just one <article>", () => {
    const doc = makeDoc(`
      <!doctype html>
      <html>
        <head><title>Issue #42: Memory leak in worker</title></head>
        <body>
          <nav>Top Navigation Menu</nav>
          <main>
            <h1>Issue #42: Memory leak in worker</h1>
            <article class="comment-card">
              <h2>Author: Alice</h2>
              <p>${"When running the background worker for more than 10 minutes, memory usage climbs steadily from 50MB to 800MB. ".repeat(4)}</p>
            </article>
            <article class="comment-card">
              <h2>Comment 1: Bob</h2>
              <p>${"I reproduced this issue on macOS Chrome 138. The heap snapshot points to unclosed EventSource listeners in the retry loop. ".repeat(4)}</p>
            </article>
            <article class="comment-card">
              <h2>Comment 2: Carol</h2>
              <p>${"Fixed in PR #45 by calling controller.abort() inside the finally block and clearing the cached map entry after resolution. ".repeat(4)}</p>
            </article>
          </main>
          <footer>Footer copyright 2026</footer>
        </body>
      </html>
    `);
    const res = extractPage(doc);
    expect(res.markdown).toContain("Alice");
    expect(res.markdown).toContain("Bob");
    expect(res.markdown).toContain("Carol");
    expect(res.markdown).toContain("PR #45");
    expect(res.markdown).not.toContain("Top Navigation Menu");
  });

  it("recovers full <main> content when Readability over-prunes multi-section documentation / product pages", () => {
    const doc = makeDoc(`
      <!doctype html>
      <html>
        <head><title>Cloud SDK Reference</title></head>
        <body>
          <header>Site Header</header>
          <main>
            <article>
              <h1>Overview</h1>
              <p>${"This SDK provides low-latency streaming and automatic retries for edge deployments across global regions. ".repeat(3)}</p>
            </article>
            <div class="extra-section community-notes">
              <h2>Configuration Parameters</h2>
              <p>${"Set maxRetries to 5 and timeoutMs to 30000 in your production configuration file to prevent premature disconnects. ".repeat(6)}</p>
            </div>
            <div class="supplemental-benchmark">
              <h2>Benchmark Results</h2>
              <p>${"Throughput reached 14,500 requests per second with p99 latency under 18ms in our Tokyo benchmark cluster. ".repeat(6)}</p>
            </div>
          </main>
        </body>
      </html>
    `);
    const res = extractPage(doc);
    expect(res.markdown).toContain("Overview");
    expect(res.markdown).toContain("Configuration Parameters");
    expect(res.markdown).toContain("maxRetries to 5");
    expect(res.markdown).toContain("Benchmark Results");
    expect(res.markdown).toContain("14,500 requests per second");
  });

  it("converts HTML tables into GFM Markdown tables", () => {
    const doc = makeDoc(`
      <!doctype html>
      <html>
        <head><title>Pricing</title></head>
        <body>
          <main>
            <h1>Model Pricing</h1>
            <p>${"Below is the detailed token pricing breakdown for all supported models in the platform. ".repeat(4)}</p>
            <table>
              <thead>
                <tr><th>Model</th><th>Input ($/1M)</th><th>Output ($/1M)</th></tr>
              </thead>
              <tbody>
                <tr><td>Qwen-Max</td><td>0.80</td><td>2.40</td></tr>
                <tr><td>DeepSeek-V3</td><td>0.27</td><td>1.10</td></tr>
              </tbody>
            </table>
          </main>
        </body>
      </html>
    `);
    const res = extractPage(doc);
    expect(res.markdown).toContain("| Model | Input ($/1M) | Output ($/1M) |");
    expect(res.markdown).toContain("| Qwen-Max | 0.80 | 2.40 |");
    expect(res.markdown).toContain("| DeepSeek-V3 | 0.27 | 1.10 |");
  });

  it("inlines open Shadow DOM content that cloneNode(true) would otherwise drop", () => {
    const doc = makeDoc(`<!doctype html><html><head><title>Shadow App</title></head><body><main><div id="host"></div></main></body></html>`);
    const host = doc.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<article><h1>Shadow Article Title</h1><p>${"Content rendered inside an open web component shadow root is preserved during extraction. ".repeat(5)}</p></article>`;

    const res = extractPage(doc);
    expect(res.markdown).toContain("Shadow Article Title");
    expect(res.markdown).toContain("open web component shadow root");
  });

  it("pads planChatExcerpts when a broad query only hits 1 passage on a long page", () => {
    const sections = Array.from(
      { length: 40 },
      (_, i) => `## Section ${i + 1}\n\n${i === 10 ? "本页面包含关键信息。" : ""}${"Green roofs reduce urban heat and retain stormwater across dense metropolitan areas. ".repeat(15)}`,
    ).join("\n\n");
    const plan = planChatExcerpts(sections, [{ role: "user", content: "提取这个页面的关键信息" }], 18_000)!;
    expect(plan).toBeDefined();
    expect(plan.count).toBeGreaterThan(5);
    expect(plan.excerpts).toContain("Section 1");
    expect(plan.excerpts).toContain("Section 11");
  });
});
