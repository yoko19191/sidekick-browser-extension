import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/shots", timeout: 240_000, workers: 1, reporter: [["list"]], use: { actionTimeout: 15_000 } });
