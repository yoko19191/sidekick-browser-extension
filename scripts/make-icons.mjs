// NOTE: public/icon/*.png are now the designer's hand-tuned exports (/workspace/sidekick-logo); running this
// overwrites them with a plain render of public/icon.svg. Only use it as a fallback.
// Renders public/icon.svg to public/icon/{16,32,48,128}.png with headless Chromium (Playwright).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const s of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icon/${s}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log("icons written");
