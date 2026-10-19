import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "off", actionTimeout: 15_000, navigationTimeout: 20_000 },
});
