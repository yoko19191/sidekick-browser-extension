// Renders the mascot (assets/mascot/fanfan-layered.svg, idle face) to public/icon/{32,48}.png with headless Chromium.
// 16.png (simplified fanfan-16.svg) and 128.png are the designer's hand-tuned exports and are left as-is;
// pass --all to also re-render 16 (from fanfan-16.svg) and 128.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const load = (f) => readFileSync(new URL(`../assets/mascot/${f}`, import.meta.url), "utf8").replace(/<svg\b[^>]*>/, (t) => t.replace(/\s(width|height)=(['"])[^'"]*\2/g, ""));
const all = process.argv.includes("--all");
const jobs = [[32, "fanfan-layered.svg"], [48, "fanfan-layered.svg"], ...(all ? [[16, "fanfan-16.svg"], [128, "fanfan-layered.svg"]] : [])];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [s, f] of jobs) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${load(f).replace("<svg", `<svg width="${s}" height="${s}" style="display:block"`)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icon/${s}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log("icons written:", jobs.map(([s]) => s).join(", "));
