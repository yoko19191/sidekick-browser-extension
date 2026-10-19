import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@/src/ui/App";
import "@/src/ui/styles.css";
import { tr } from "@/src/i18n";

declare const __E2E__: boolean;

document.title = tr("brand.name");

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (__E2E__ && location.hash.startsWith("#mascot-gallery")) {
  // dev-only expression gallery (dead code in production builds)
  document.documentElement.classList.toggle("dark", location.hash.includes("dark"));
  import("@/src/ui/dev/MascotGallery").then(({ MascotGallery }) => root.render(<MascotGallery />));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// e2e builds only: lets tests read the real side panel (which Playwright cannot attach to as a page) via the SW.
if (__E2E__) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "dev:panel-state") return false;
    const composer = document.querySelector<HTMLTextAreaElement>('[data-testid="composer"]');
    sendResponse({ url: location.href, composer: composer?.value ?? null });
    return false;
  });
}
