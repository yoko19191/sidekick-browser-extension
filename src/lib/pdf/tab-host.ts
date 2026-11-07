/**
 * Content script for a tab showing a PDF. Chrome's viewer renders the file in its own process, so the document the
 * script lands in is an empty shell: no translation, floating button or agent — only "this is a PDF" and its bytes.
 */
import { tr } from "@/src/i18n";
import { servePdfChunk, type PdfRef } from "./bytes";

export const isPdfDocument = (doc: Document = document) => doc.contentType === "application/pdf";

export function hostPdfTab() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = String(msg?.type ?? "");
    if (type.startsWith("agent:")) {
      sendResponse({ ok: false, error: tr("page.pdfNoAgent") });
      return;
    }
    switch (type) {
      case "pp:ping":
      case "pp:config":
        sendResponse({ ok: true });
        return;
      case "page:extract":
        sendResponse({ kind: "pdf-ref", url: location.href, title: document.title } satisfies PdfRef);
        return;
      case "pdf:read":
        servePdfChunk(location.href, Number(msg.offset) || 0).then(sendResponse);
        return true;
      case "page:selection":
        // The selection lives inside the viewer, out of reach of page scripts.
        sendResponse({ text: "" });
        return;
      case "page:locate":
        sendResponse({ found: false });
        return;
      case "translate:status":
        sendResponse({ active: false, total: 0, done: 0, errors: 0 });
        return;
      case "translate:toggle":
        sendResponse({ error: tr("page.pdfNoTranslate") });
        return;
    }
  });
}
