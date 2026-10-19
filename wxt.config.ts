import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// E2E builds (SIDEKICK_E2E=1) add a host permission for the local fixture server only,
// because Playwright cannot click Chrome's permission prompt. Production builds never include it.
const E2E = process.env.SIDEKICK_E2E === "1";

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
    name: "__MSG_extName__",
    short_name: "__MSG_extShortName__",
    description: "__MSG_extDescription__",
    default_locale: "zh_CN",
    permissions: ["sidePanel", "storage", "activeTab", "scripting", "contextMenus"],
    optional_host_permissions: ["<all_urls>"],
    action: { default_title: "__MSG_actionTitle__" },
    commands: {
      "toggle-translate": {
        suggested_key: { default: "Alt+A" },
        description: "__MSG_cmdToggleTranslate__",
      },
    },
    minimum_chrome_version: "116",
  },
});
