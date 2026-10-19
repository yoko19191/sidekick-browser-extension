/** Generates the deliverable screenshots (light + dark). Run: npm run screenshots */
import { test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { launch, onboard, openPanel } from "../e2e/harness";
import { startMock } from "../fixtures/mock-llm.mjs";

const OUT = process.env.SHOTS_DIR ?? "/workspace/deliverables/sidepanel-ext";
test.setTimeout(240_000);

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots ${scheme}`, async () => {
    const mock = await startMock(0);
    const base = `http://127.0.0.1:${mock.port}`;
    const article = `${base}/fixtures/article.html`;
    const { context, extId } = await launch({ colorScheme: scheme });
    const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
    const page = await context.newPage();
    await page.goto(article);

    // onboarding
    const ob = await openPanel(context, extId, article);
    await shot(ob, "01-onboarding-provider");
    await ob.getByTestId("ob-preset-custom").click();
    await ob.getByTestId("ob-base-url").fill(`${base}/v1`);
    await ob.getByTestId("ob-next").click();
    await ob.getByTestId("ob-key").fill("bad-key");
    await ob.getByTestId("ob-test").click();
    await ob.locator('[data-testid="ob-test-result"][data-state="fail"]').waitFor();
    await shot(ob, "02-onboarding-key-error");
    await ob.close();
    const ob2 = await openPanel(context, extId, article);
    await onboard(ob2, `${base}/v1`);
    await ob2.close();

    // main panel (empty state)
    const panel = await openPanel(context, extId, article);
    await panel.getByTestId("action-summarize").waitFor();
    await panel.mouse.move(330, 300); // the mascot glances toward the pointer
    await panel.waitForTimeout(600);
    await shot(panel, "03-home");

    // level 1: gear popover
    await panel.getByTestId("open-quick-settings").click();
    await panel.getByTestId("quick-settings").waitFor();
    await panel.waitForTimeout(250);
    await shot(panel, "04-settings-L1-popover");
    await panel.keyboard.press("Escape");

    // summary result
    await panel.getByTestId("action-summarize").click();
    const msg = panel.getByTestId("assistant-message").last();
    await msg.and(panel.locator('[data-status="done"]')).waitFor({ timeout: 20_000 });
    await panel.waitForTimeout(250);
    await shot(panel, "05-summary-result");

    // full-page translation of the fixture
    await page.bringToFront();
    await panel.getByTestId("translate-toggle").click();
    await page.waitForFunction(() => document.querySelectorAll(".pp-trans").length >= 9, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    await shot(page, "06-translated-page");
    await panel.waitForTimeout(200);
    await shot(panel, "06b-panel-translating");
    await panel.getByTestId("translate-toggle").click();

    // selection card
    await page.evaluate(() => {
      const p = [...document.querySelectorAll("article p")].find((x) => x.textContent!.includes("A vegetated roof works like a sponge"))!;
      const r = document.createRange();
      r.selectNodeContents(p);
      const sel = getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      const b = p.getBoundingClientRect();
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.right, clientY: b.bottom }));
    });
    const ui = page.locator("sidekick-ui");
    await ui.getByTestId("pp-selection-dot").click();
    await ui.locator(".card .out[data-done]").waitFor();
    await page.waitForTimeout(250);
    await shot(page, "07-selection-card");

    // level 2 / 3: options page
    const opt = await context.newPage();
    await opt.setViewportSize({ width: 1100, height: 820 });
    await opt.goto(`chrome-extension://${extId}/options.html`);
    await opt.getByTestId("section-models").waitFor();
    await shot(opt, "08-settings-L2-models");
    await opt.getByTestId("nav-translation").click();
    await opt.waitForTimeout(250);
    await shot(opt, "09-settings-L2-translation");
    await opt.getByTestId("nav-models").click();
    await opt.getByTestId("provider-toggle-custom").click();
    await opt.getByTestId("fetch-models").click().catch(() => {});
    await opt.waitForTimeout(3600); // let the toast clear
    await shot(opt, "10-settings-L3-provider-detail");
    await opt.getByTestId("nav-translation").click();
    const adv = opt.getByTestId("translation-advanced");
    await adv.getByRole("button", { name: /批量、并发与站点规则/ }).click();
    await adv.getByTestId("auto-sites").waitFor();
    await adv.scrollIntoViewIfNeeded();
    await opt.waitForTimeout(250);
    await shot(opt, "11-settings-L3-translation-advanced");

    // dev-only mascot expression gallery (every state), normal + reduced-motion
    const gal = await context.newPage();
    await gal.setViewportSize({ width: 900, height: 420 });
    await gal.goto(`chrome-extension://${extId}/sidepanel.html#mascot-gallery${scheme === "dark" ? "-dark" : ""}`);
    await gal.getByTestId("mascot-gallery").waitFor();
    await gal.waitForTimeout(1200);
    await gal.screenshot({ path: `${OUT}/${scheme}-12-mascot-gallery.png`, fullPage: true });
    await gal.emulateMedia({ reducedMotion: "reduce" });
    await gal.reload();
    await gal.getByTestId("mascot-gallery").waitFor();
    await gal.waitForTimeout(300);
    await gal.screenshot({ path: `${OUT}/${scheme}-13-mascot-gallery-reduced-motion.png`, fullPage: true });
    await gal.close();

    // composite: page + panel side by side, like the real browser
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await panel.bringToFront();
    const pageBuf = readFileSync(`${OUT}/${scheme}-06-translated-page.png`).toString("base64");
    const panelBuf = readFileSync(`${OUT}/${scheme}-05-summary-result.png`).toString("base64");
    const comp = await context.newPage();
    await comp.setViewportSize({ width: 1280 + 400 + 1, height: 860 });
    await comp.setContent(`<body style="margin:0;display:flex;background:${scheme === "dark" ? "#333" : "#ddd"}"><img src="data:image/png;base64,${pageBuf}" style="width:1280px;height:860px;object-fit:cover;object-position:top"><div style="width:1px"></div><img src="data:image/png;base64,${panelBuf}" style="width:400px;height:760px"></body>`);
    await shot(comp, "00-overview");

    await context.close();
    mock.server.close();
  });
}
