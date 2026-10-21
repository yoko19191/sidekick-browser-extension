import { expect, test } from "@playwright/test";
import { chromium } from "playwright";
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const SITES = [
  "https://example.com/",
  "https://news.ycombinator.com/",
  "https://en.wikipedia.org/wiki/Main_Page",
];

test.skip(!process.env.SMOKE, "public-site smoke runs only with SMOKE=1");

test("observer smoke: snapshot finishes under 150 ms on a few public pages", async () => {
  await build({ entryPoints: ["src/agent/page/observer.ts"], bundle: true, format: "iife", globalName: "OBS", outfile: "/tmp/obs-smoke.js", logLevel: "silent" });
  const browser = await chromium.launch();
  try {
    for (const url of SITES) {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.addScriptTag({ path: "/tmp/obs-smoke.js" });
      const r = await page.evaluate(() => {
        const o = new (window as any).OBS.PageObserver(document);
        const t0 = performance.now();
        const snap = o.snapshot();
        return { ms: performance.now() - t0, chars: snap.tree.length, hasUnreachable: /unreachable/.test(snap.tree) };
      });
      expect(r.ms, url).toBeLessThan(150);
      expect(r.chars, url).toBeGreaterThan(10);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
