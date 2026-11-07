/**
 * pdf.js loader for extension pages (side panel). Loaded lazily, so HTML pages never pay for the ~1.7 MB library.
 * Not usable in the service worker: MV3 workers have no dynamic import() and cannot start the pdf.js Worker.
 */
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageContent } from "../types";
import { MAX_DOC_CHARS } from "../retrieve";
import { pdfToPage, type PdfDocLike } from "./text";

export async function parsePdf(data: Uint8Array, url: string, opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}): Promise<PageContent> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data,
    // CJK PDFs with predefined CMaps (UniGB-UCS2-H …) decode to garbage without these; copied in by wxt.config.ts.
    cMapUrl: chrome.runtime.getURL("/pdfjs/cmaps/"),
    cMapPacked: true,
    // Text extraction never renders: no font faces, and no WebAssembly image decoders (and their extra fetches).
    disableFontFace: true,
    useWasm: false,
    verbosity: 0,
  });
  const abort = () => void task.destroy();
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    const doc = await task.promise;
    return await pdfToPage(doc as unknown as PdfDocLike, { url, maxChars: MAX_DOC_CHARS, onProgress: opts.onProgress, signal: opts.signal });
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    void task.destroy();
  }
}
