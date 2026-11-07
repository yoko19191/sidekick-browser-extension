import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, onboard, openPanel as open, tabIdFor } from "./harness";
import { PDF_FACT, startMock } from "../fixtures/mock-llm.mjs";
import { makePdf } from "../fixtures/make-pdf.mjs";

// PDF tabs (online and file://) and long documents in chat. The e2e build grants 127.0.0.1 and file:///* up front,
// and Playwright's unpacked extension already has "Allow access to file URLs" on.
let context: BrowserContext;
let extId: string;
let mock: Awaited<ReturnType<typeof startMock>>;
let base: string;
/** A long-lived extension page for chrome.tabs lookups. */
let helper: Page;
const stats = async () => (await fetch(`${base}/__stats`)).json();

test.beforeAll(async () => {
  mock = await startMock(0);
  base = `http://127.0.0.1:${mock.port}`;
  ({ context, extId } = await launch());
  const panel = await open(context, extId);
  await onboard(panel, `${base}/v1`);
  helper = panel;
});
test.afterAll(async () => {
  await context?.close();
  mock?.server.close();
});

async function tabAt(url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url).catch(() => {}); // PDF navigations may report as aborted downloads to Playwright
  await expect.poll(() => helper.evaluate(async (u) => (await chrome.tabs.query({})).some((t) => t.url === u && t.status === "complete"), url)).toBe(true);
  return page;
}

async function ask(panel: Page, text: string) {
  await panel.getByTestId("composer").fill(text);
  await panel.getByTestId("send").click();
  const msg = panel.getByTestId("assistant-message").last();
  await expect(msg).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  return msg;
}

test.describe.serial("PDF tabs and long documents", () => {
  test("online PDF: chat gets the PDF's text, page by page", async () => {
    const url = `${base}/fixtures/report.pdf`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    const msg = await ask(panel, "How much did the Tallinn pilot save?");
    await expect(msg.getByTestId("coverage-notice")).toHaveCount(0);
    const sys = (await stats()).lastChatSystem as string;
    expect(sys).toContain(PDF_FACT);
    expect(sys).toContain("## Page 2");
    expect(sys).toContain("PDF converted to text");
    // CJK PDFs need pdf.js's packed CMaps, shipped with the extension
    expect(await panel.evaluate(async () => (await fetch(chrome.runtime.getURL("/pdfjs/cmaps/UniGB-UCS2-H.bcmap"))).status)).toBe(200);
    await panel.close();
    await page.close();
  });

  test("PDF without a .pdf URL is detected by its content type; summary works", async () => {
    const url = `${base}/fixtures/report?pages=4`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await expect(msg).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    await expect(msg).toContainText("关键要点");
    await panel.close();
    await page.close();
  });

  test("long PDF: chat retrieves the matching pages, citation jumps to the page", async () => {
    const url = `${base}/fixtures/report.pdf?pages=150`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    const msg = await ask(panel, "What did the pilot project in Tallinn save? CITE-PDF");
    await expect(msg.getByTestId("coverage-notice")).toHaveText(/已按问题检索相关段落/);
    const sys = (await stats()).lastChatSystem as string;
    expect(sys).toContain(PDF_FACT); // on page 149: far beyond the 48k-char head
    expect(sys).toContain('excerpted="true"');
    expect(sys).toContain("[§ Page 149]");
    const id = await tabIdFor(panel, url);
    await msg.getByTestId("locate-citation").click();
    await expect.poll(() => panel.evaluate(async (i) => (await chrome.tabs.get(i)).url, id)).toBe(`${url}#page=149`);
    // …and the viewer really shows page 149 (it ignores a fragment-only change; the panel reloads the tab)
    const viewer = () => page.frames().find((f) => f.url().startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"));
    await expect.poll(async () => viewer()?.evaluate(() => {
      const deep = (root: Document | ShadowRoot): HTMLInputElement | null => {
        for (const el of Array.from(root.querySelectorAll("*"))) {
          if (el instanceof HTMLInputElement && el.closest("#pageSelector, viewer-page-selector") !== null) return el;
          const hit = el.shadowRoot && deep(el.shadowRoot);
          if (hit) return hit;
        }
        return null;
      };
      return deep(document)?.value;
    }).catch(() => undefined), { timeout: 10_000 }).toBe("149");
    // the jump changed the URL fragment only: the parsed PDF is reused, not read again
    await ask(panel, "Ask again about Tallinn");
    await panel.close();
    await page.close();
  });

  test("local file:// PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pdf-"));
    const file = join(dir, "local report.pdf");
    writeFileSync(file, makePdf([["Local file first page"], ["The local secret number is 9182."]], { title: "Local Report" }));
    const url = `file://${file.replace(/ /g, "%20")}`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    await expect(panel.getByTestId("page-chip")).toContainText("本地文件");
    await ask(panel, "What is the local secret number?");
    expect((await stats()).lastChatSystem).toContain("The local secret number is 9182.");
    await panel.close();
    await page.close();
  });

  test("scanned PDF (no text layer) and translate say why they cannot work", async () => {
    const url = `${base}/fixtures/report.pdf?pages=2&text=0`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    await panel.getByTestId("composer").fill("anything?");
    await panel.getByTestId("send").click();
    await expect(panel.getByTestId("page-error")).toContainText("没有可提取的文字");
    await panel.getByTestId("translate-toggle").click();
    await expect(panel.getByTestId("page-error")).toContainText("PDF 暂不支持整页翻译");
    await panel.close();
    await page.close();
  });

  test("long web page: chat answers from the matching section, not just the first 48k chars", async () => {
    const url = `${base}/fixtures/long.html?chapters=600`;
    const page = await tabAt(url);
    const panel = await open(context, extId, url);
    const msg = await ask(panel, "What does section 487 discuss?");
    await expect(msg.getByTestId("coverage-notice")).toHaveText(/已按问题检索相关段落（约占全文 \d{1,2}%）/);
    const sys = (await stats()).lastChatSystem as string;
    expect(sys).toContain("Section 487 discusses");
    expect(sys).toContain("A Very Long Report on Green Roofs"); // the opening passage is always kept
    await panel.close();
    await page.close();
  });
});
