import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// E2E builds (PAGEPILOT_E2E=1) add a host permission for the local fixture server only,
// because Playwright cannot click Chrome's permission prompt. Production builds never include it.
const E2E = process.env.PAGEPILOT_E2E === "1";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  outDir: E2E ? ".output-e2e" : ".output",
  vite: () => ({ plugins: [tailwindcss()], define: { __E2E__: JSON.stringify(E2E) } }),
  hooks: {
    // The content script is injected on demand (registration: "runtime"); WXT would otherwise add its
    // `matches` (<all_urls>) as a required host permission. v1 relies on activeTab + optional per-site grants.
    "build:manifestGenerated": (_wxt, manifest) => {
      if (E2E) manifest.host_permissions = ["http://127.0.0.1/*"];
      else delete manifest.host_permissions;
    },
  },
  manifest: {
    name: "PagePilot",
    description: "AI side panel: bilingual web translation and page summaries with your own API key.",
    default_locale: undefined,
    permissions: ["sidePanel", "storage", "activeTab", "scripting", "contextMenus"],
    optional_host_permissions: ["<all_urls>"],
    action: { default_title: "打开 PagePilot" },
    commands: {
      "toggle-translate": {
        suggested_key: { default: "Alt+A" },
        description: "翻译当前页面 / 显示原文",
      },
    },
    minimum_chrome_version: "116",
  },
});
