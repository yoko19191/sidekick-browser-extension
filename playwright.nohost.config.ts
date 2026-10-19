import { defineConfig } from "@playwright/test";
// Runs against the e2e build WITHOUT host permissions (npm run test:e2e:nohost).
process.env.SIDEKICK_EXT_DIR ??= ".output-e2e-nohost/chrome-mv3";
export default defineConfig({ testDir: "tests/e2e-nohost", timeout: 90_000, workers: 1, reporter: [["list"]], use: { actionTimeout: 15_000 } });
