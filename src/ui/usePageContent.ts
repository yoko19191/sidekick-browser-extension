/**
 * The current tab's content for chat: HTML pages via the content script (Readability), PDF tabs via pdf.js in the
 * panel. Owns the per-tab cache, page-access errors and the one-click fix for each of them, and citation jumps.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isFileUrl, looksLikeLocalPdf, PdfAccessError, readPdfBytes, type PdfChunk, type PdfRef } from "@/src/lib/pdf/bytes";
import { pageOfExcerpt, PdfNoTextError } from "@/src/lib/pdf/text";
import type { PageContent } from "@/src/lib/types";
import { tr } from "@/src/i18n";
import { bg } from "./messaging";
import type { TabInfo } from "./hooks";

/** What the error strip's button does. */
export type PageFix = "grant-site" | "grant-file" | "file-access";
export interface PageError {
  text: string;
  fix?: PageFix;
}

export const restrictedUrl = (url: string) => !/^https?:|^file:/.test(url) || /^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);

const GRANT_HINT = /permission|Cannot access|must request/i;

/** Map any failure while reading the page to a message (and fix) the strip can show. */
export function pageErrorOf(e: unknown, url: string): PageError {
  if (e instanceof PdfNoTextError) return { text: tr("chat.pdfNoText") };
  if (e instanceof PdfAccessError) {
    if (e.code === "pdf-file-access") return { text: tr("chat.pdfFileAccess"), fix: "file-access" };
    if (e.code === "pdf-file-grant") return { text: tr("chat.pdfFileGrant"), fix: "grant-file" };
    if (e.code === "pdf-too-large") return { text: tr("chat.pdfTooLarge") };
    return { text: tr("chat.pdfReadFailed", { msg: e.message }) };
  }
  const text = (e as Error)?.message ?? String(e);
  if (!GRANT_HINT.test(text)) return { text };
  // A file:// page the extension may not script: same two switches as a local PDF.
  return isFileUrl(url) ? { text: tr("chat.pdfFileAccess"), fix: "file-access" } : { text, fix: "grant-site" };
}

export function usePageContent(tab: TabInfo | null) {
  /** In-flight or finished reads; PDFs are keyed without the #fragment, which citation jumps change. */
  const cache = useRef(new Map<string, Promise<PageContent>>());
  const pdfs = useRef(new Map<string, PageContent>());
  const [error, setError] = useState<PageError | null>(null);
  const [lastPage, setLastPage] = useState<PageContent | null>(null);

  useEffect(() => {
    setLastPage(null);
  }, [tab?.id, tab?.url]);

  const keyOf = (t: TabInfo) => `${t.id}|${t.url}`;
  const pdfKeyOf = (t: TabInfo) => `${t.id}|${t.url.split("#")[0]}`;

  const read = async (t: TabInfo, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<PageContent> => {
    const toPdf = async (url: string) => {
      const data = await readPdfBytes(url, { signal, readChunk: (offset) => bg<PdfChunk>({ type: "pdf:read", tabId: t.id, offset }) });
      const { parsePdf } = await import("@/src/lib/pdf/load");
      const page = await parsePdf(data, url, { onProgress, signal });
      pdfs.current.set(pdfKeyOf({ ...t, url }), page);
      return page;
    };
    // Local *.pdf: the panel reads the file itself; injecting into the viewer would need the same file access anyway.
    if (looksLikeLocalPdf(t.url)) return toPdf(t.url);
    const r = await bg<PageContent | PdfRef>({ type: "page:extract", tabId: t.id });
    return "kind" in r && r.kind === "pdf-ref" ? toPdf(r.url) : (r as PageContent);
  };

  /** Page content for the next request, or undefined (with `error` set) when it cannot be read. */
  const getPage = useCallback(
    async (opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<PageContent | undefined> => {
      if (!tab || (tab.url && restrictedUrl(tab.url))) return undefined; // url "" = hidden (no access yet), still worth trying
      const pdf = pdfs.current.get(pdfKeyOf(tab));
      if (pdf) {
        setLastPage(pdf);
        return pdf;
      }
      const k = keyOf(tab);
      let p = cache.current.get(k);
      if (!p) {
        p = read(tab, opts.onProgress, opts.signal);
        cache.current.set(k, p);
        p.catch(() => cache.current.delete(k));
      }
      try {
        const page = await p;
        setError(null);
        setLastPage(page);
        return page;
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return undefined;
        setError(pageErrorOf(e, tab.url));
        return undefined;
      }
    },
    [tab?.id, tab?.url],
  );

  /** Run the error strip's fix. Must be called from a click: permission prompts need a user gesture. */
  const fix = useCallback(async () => {
    if (!tab || !error?.fix) return;
    if (error.fix === "file-access") {
      // Chrome reloads the extension when the switch flips, which closes this panel; the user reopens it afterwards.
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return;
    }
    // Without host access Chrome hides tab.url; fall back to requesting <all_urls> so the user can grant access in one click.
    const origins = error.fix === "grant-file" ? ["file:///*"] : /^https?:/.test(tab.url) ? [`${new URL(tab.url).origin}/*`] : ["<all_urls>"];
    const ok = await chrome.permissions.request({ origins }).catch(() => false);
    if (ok) setError(null);
  }, [tab?.id, tab?.url, error?.fix]);

  /** Show the cited excerpt: scroll + flash on HTML pages, jump to its page in a PDF. */
  const locate = useCallback(
    async (text: string): Promise<boolean> => {
      if (!tab) return false;
      const pdf = pdfs.current.get(pdfKeyOf(tab));
      if (pdf) {
        const n = pageOfExcerpt(pdf.markdown, text);
        if (!n) return false;
        // Chrome's viewer reads #page=N only on load: a fragment change alone leaves it where it is, so reload.
        // The PDF usually comes from the HTTP cache; the parsed text here is kept (cached without the fragment).
        const target = `${tab.url.split("#")[0]}#page=${n}`;
        const curUrl = (await chrome.tabs.get(tab.id).catch(() => undefined))?.url ?? tab.url;
        if (curUrl === target) return true;
        await chrome.tabs.update(tab.id, { url: target });
        // update() resolves before the fragment navigation commits; reloading earlier would reload the old URL.
        for (let i = 0; i < 40 && (await chrome.tabs.get(tab.id)).url !== target; i++) await new Promise((r) => setTimeout(r, 25));
        await chrome.tabs.reload(tab.id);
        return true;
      }
      return (await bg<{ found: boolean }>({ type: "page:locate", tabId: tab.id, text })).found;
    },
    [tab?.id, tab?.url],
  );

  return { getPage, lastPage, error, setError, fix, locate };
}
