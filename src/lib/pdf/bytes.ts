/**
 * Getting a PDF tab's bytes to the side panel, where pdf.js runs.
 *
 * - http(s): the content script injected into the PDF tab fetches its own URL (same origin, so the user's cookies
 *   apply and it usually comes from the HTTP cache; activeTab is enough) and hands it over in base64 chunks,
 *   because extension messaging is JSON-only and capped at 64 MiB per message.
 * - file://: page scripts cannot read file URLs at all; the panel fetches it itself, which needs Chrome's
 *   "Allow access to file URLs" switch plus the optional file:///* host grant.
 */

export const PDF_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export type PdfAccessCode = "pdf-file-access" | "pdf-file-grant" | "pdf-too-large" | "pdf-read-failed";

export class PdfAccessError extends Error {
  constructor(readonly code: PdfAccessCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PdfAccessError";
  }
}

/** What the content script reports instead of extracted text when its document is a PDF. */
export interface PdfRef {
  kind: "pdf-ref";
  url: string;
  title: string;
}

export interface PdfChunk {
  size: number;
  /** base64 of bytes [offset, offset + PDF_CHUNK_BYTES) */
  data: string;
  error?: string;
}

export const isFileUrl = (url: string) => /^file:/i.test(url);
/** A local file whose name says PDF: read it directly, without injecting into the viewer first. */
export const looksLikeLocalPdf = (url: string) => isFileUrl(url) && /\.pdf$/i.test(url.split(/[?#]/)[0]);

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function readLocal(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) throw new PdfAccessError("pdf-file-access");
  if (!(await chrome.permissions.contains({ origins: ["file:///*"] }))) throw new PdfAccessError("pdf-file-grant");
  let res: Response;
  try {
    res = await fetch(url.split("#")[0], { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new PdfAccessError("pdf-read-failed", (e as Error).message);
  }
  if (!res.ok) throw new PdfAccessError("pdf-read-failed", `HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_PDF_BYTES) throw new PdfAccessError("pdf-too-large");
  return buf;
}

async function readRemote(readChunk: (offset: number) => Promise<PdfChunk>, signal?: AbortSignal): Promise<Uint8Array> {
  const first = await readChunk(0);
  if (first.error) throw new PdfAccessError(first.error === "pdf-too-large" ? "pdf-too-large" : "pdf-read-failed", first.error);
  const out = new Uint8Array(first.size);
  let offset = 0;
  for (let c: PdfChunk = first; ; ) {
    const bytes = fromBase64(c.data);
    out.set(bytes, offset);
    offset += bytes.byteLength;
    if (offset >= first.size || !bytes.byteLength) break;
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    c = await readChunk(offset);
    if (c.error) throw new PdfAccessError("pdf-read-failed", c.error);
  }
  return out;
}

export function readPdfBytes(url: string, deps: { readChunk: (offset: number) => Promise<PdfChunk>; signal?: AbortSignal }): Promise<Uint8Array> {
  return isFileUrl(url) ? readLocal(url, deps.signal) : readRemote(deps.readChunk, deps.signal);
}

// ---- content-script side ----

let held: { url: string; bytes: Promise<ArrayBuffer> } | null = null;

function toBase64(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes]));
  });
}

/** Serve one chunk of the current document's bytes. The buffer is kept until its last chunk has been read. */
export async function servePdfChunk(url: string, offset: number): Promise<PdfChunk> {
  try {
    if (!held || held.url !== url || offset === 0) {
      held = {
        url,
        bytes: fetch(url.split("#")[0], { cache: "force-cache", credentials: "include" }).then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          if (Number(r.headers.get("content-length")) > MAX_PDF_BYTES) throw new Error("pdf-too-large");
          return r.arrayBuffer();
        }),
      };
    }
    const all = await held.bytes;
    if (all.byteLength > MAX_PDF_BYTES) throw new Error("pdf-too-large");
    const end = Math.min(all.byteLength, offset + PDF_CHUNK_BYTES);
    const data = await toBase64(all.slice(offset, end));
    if (end >= all.byteLength) held = null;
    return { size: all.byteLength, data };
  } catch (e) {
    held = null;
    return { size: 0, data: "", error: (e as Error).message || "pdf-read-failed" };
  }
}
