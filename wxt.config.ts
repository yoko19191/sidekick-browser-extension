import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// E2E builds (SIDEKICK_E2E=1) add host permissions for the local fixture server and file:// (local PDF tests) only,
// because Playwright cannot click Chrome's permission prompt. Production builds never include them.
const E2E = process.env.SIDEKICK_E2E === "1";
// SIDEKICK_E2E_NOHOST=1: e2e build WITHOUT the fixture host grant, to exercise the denied-permission paths.
const NOHOST = E2E && process.env.SIDEKICK_E2E_NOHOST === "1";

// pdf.js character maps (needed to decode CJK PDFs that use predefined CMaps) and their LICENSE, served from /pdfjs/cmaps/.
const CMAPS = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "cmaps");

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: NOHOST ? ".output-e2e-nohost" : E2E ? ".output-e2e" : ".output",
  vite: () => ({ plugins: [tailwindcss()], define: { __E2E__: JSON.stringify(E2E) } }),
  hooks: {
    "build:publicAssets": (_wxt, files) => {
      for (const f of readdirSync(CMAPS)) files.push({ absoluteSrc: join(CMAPS, f), relativeDest: `pdfjs/cmaps/${f}` });
    },
    // The content script is injected on demand (registration: "runtime"); WXT would otherwise add its
    // `matches` (<all_urls>) as a required host permission. v1 relies on activeTab + optional per-site grants.
    "build:manifestGenerated": (_wxt, manifest) => {
      if (E2E && !NOHOST) manifest.host_permissions = ["http://127.0.0.1/*", "file:///*"];
      else delete manifest.host_permissions;
    },
  },
  manifest: {
    name: "__MSG_extName__",
    short_name: "__MSG_extShortName__",
    description: "__MSG_extDescription__",
    default_locale: "zh_CN",
    permissions: ["sidePanel", "storage", "activeTab", "scripting", "contextMenus"],
    optional_permissions: ["userScripts"],
    optional_host_permissions: ["<all_urls>"],
    action: { default_title: "__MSG_actionTitle__" },
    commands: {
      "toggle-translate": {
        suggested_key: { default: "Alt+A" },
        description: "__MSG_cmdToggleTranslate__",
      },
    },
    minimum_chrome_version: "138",
  },
});
