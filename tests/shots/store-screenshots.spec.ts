/**
 * Generates 5 standard 1280×800 Chrome Web Store screenshots into dist/store-assets/.
 * Combines real live screenshots of the built extension with Chrome Web Store header banners.
 */
import { test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, onboard, openPanel } from "../e2e/harness";
import { startMock } from "../fixtures/mock-llm.mjs";

const OUT_DIR = resolve("dist/store-assets");
test.setTimeout(240_000);

function toDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

test("generate 5 standard 1280x800 Chrome Web Store screenshots", async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const logoB64 = toDataUrl(readFileSync(resolve("public/icon/128.png")));

  const mock = await startMock(0);
  const base = `http://127.0.0.1:${mock.port}`;
  const article = `${base}/fixtures/article.html`;
  const agentForm = `${base}/fixtures/agent-form.html`;

  const { context, extId } = await launch({ colorScheme: "light" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 820, height: 640 });
  await page.goto(article);

  // Onboard the extension
  const ob = await openPanel(context, extId, article);
  await onboard(ob, `${base}/v1`);
  await ob.close();

  // Open side panel at 380x640
  const panel = await openPanel(context, extId, article);
  await panel.setViewportSize({ width: 380, height: 640 });
  await panel.getByTestId("action-summarize").waitFor();

  // ---------------------------------------------------------------------------
  // Capture State 1: Selection Toolbar (Translate | Explain | Ask Sidekick) + Composer Quote Card
  // ---------------------------------------------------------------------------
  await page.bringToFront();
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].find((x) =>
      x.textContent!.includes("A vegetated roof works like a sponge"),
    )!;
    const r = document.createRange();
    r.selectNodeContents(p);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    const b = p.getBoundingClientRect();
    p.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: b.left + 20, clientY: b.top + 10 }));
    p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: b.left + 260, clientY: b.bottom - 4 }));
  });
  const ui = page.locator("sidekick-ui");
  await ui.getByTestId("pp-selection-toolbar").waitFor();
  await page.waitForTimeout(250);
  const shot1PageBuf = await page.screenshot();

  // Click "Ask Sidekick" so the panel shows the new compact inline composer-quote card, plus explain response
  await ui.getByTestId("pp-selection-explain").click();
  const explainMsg = panel.getByTestId("assistant-message").last();
  await explainMsg.and(panel.locator('[data-status="done"]')).waitFor({ timeout: 20_000 });
  // Also populate the quote card in composer so user sees how clean the inline quote card looks
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].find((x) =>
      x.textContent!.includes("A vegetated roof works like a sponge"),
    )!;
    const r = document.createRange();
    r.selectNodeContents(p);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await panel.getByTestId("quote-selection").click();
  await panel.getByTestId("composer-quote").waitFor();
  await panel.waitForTimeout(250);
  const shot1PanelBuf = await panel.screenshot();
  await panel.getByTestId("remove-quote").click();

  // ---------------------------------------------------------------------------
  // Capture State 2: Full-Page Bilingual Translation + Quick Settings Drawer
  // ---------------------------------------------------------------------------
  await panel.getByTestId("new-chat").click();
  await page.bringToFront();
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await panel.getByTestId("translate-toggle").click();
  await page.waitForFunction(() => document.querySelectorAll(".pp-trans").length >= 9, null, { timeout: 15_000 });
  await page.waitForTimeout(350);
  const shot2PageBuf = await page.screenshot();

  await panel.getByTestId("open-quick-settings").click();
  await panel.getByTestId("quick-settings").waitFor();
  await panel.waitForTimeout(250);
  const shot2PanelBuf = await panel.screenshot();
  await panel.getByTestId("settings-back").click();

  // ---------------------------------------------------------------------------
  // Capture State 3: Grounded Page Summary + Clickable Citation Highlight
  // ---------------------------------------------------------------------------
  await panel.getByTestId("translate-toggle").click();
  await panel.getByTestId("action-summarize").click();
  const sumMsg = panel.getByTestId("assistant-message").last();
  await sumMsg.and(panel.locator('[data-status="done"]')).waitFor({ timeout: 20_000 });
  await sumMsg.locator("a[data-footnote-ref]").first().click();
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("article p")].find((x) => x.textContent!.includes("sixty percent of the rain"));
    p?.classList.add("pp-flash");
  });
  await page.waitForTimeout(200);
  const shot3PageBuf = await page.screenshot();
  const shot3PanelBuf = await panel.screenshot();

  // ---------------------------------------------------------------------------
  // Capture State 5: Browser Agent Confirmation + Options Page
  // ---------------------------------------------------------------------------
  const optPage = await context.newPage();
  await optPage.setViewportSize({ width: 820, height: 640 });
  await optPage.goto(`chrome-extension://${extId}/options.html`);
  await optPage.getByTestId("section-models").waitFor();
  await optPage.getByTestId("provider-toggle-custom").click();
  await optPage.waitForTimeout(250);
  const shot5OptBuf = await optPage.screenshot();
  await optPage.close();

  const actPage = await context.newPage();
  await actPage.setViewportSize({ width: 820, height: 640 });
  await actPage.goto(agentForm);
  const actPanel = await openPanel(context, extId, agentForm);
  await actPanel.setViewportSize({ width: 380, height: 640 });
  await actPanel.getByTestId("composer").fill("/act sign up as Ada");
  await actPanel.getByTestId("send").click();
  await actPanel.getByTestId("agent-confirm").waitFor({ timeout: 15_000 });
  await actPanel.waitForTimeout(250);
  const shot5PanelBuf = await actPanel.screenshot();
  await actPanel.getByTestId("agent-stop").click();
  await actPanel.close();
  await actPage.close();

  // ---------------------------------------------------------------------------
  // Compose 5 standard 1280×800 Store Screenshots
  // ---------------------------------------------------------------------------
  const canvas = await context.newPage();
  await canvas.setViewportSize({ width: 1280, height: 800 });

  const renderShowcaseFrame = async (opts: {
    fileBase: string;
    badge: string;
    title: string;
    subtitle: string;
    pills: string[];
    urlText: string;
    leftImg: string;
    rightImg: string;
  }) => {
    await canvas.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  body {
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background: radial-gradient(circle at 18% 15%, #1e1b4b 0%, #0f172a 55%, #090d16 100%);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    padding: 28px 36px 0;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
  }
  .brand-head {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand-head img {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(79, 70, 229, 0.35);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(99, 102, 241, 0.18);
    border: 1px solid rgba(129, 140, 248, 0.35);
    color: #a5b4fc;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #ffffff;
  }
  .sub {
    font-size: 14px;
    color: #94a3b8;
    margin-top: 4px;
  }
  .pills {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .pill {
    padding: 6px 12px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 12.5px;
    font-weight: 500;
    color: #e2e8f0;
  }
  .browser-shell {
    flex: 1;
    border-radius: 18px 18px 0 0;
    background: #1e293b;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-bottom: none;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .chrome-bar {
    height: 40px;
    background: #0f172a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 14px;
  }
  .dots { display: flex; gap: 7px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot.r { background: #ef4444; }
  .dot.y { background: #f59e0b; }
  .dot.g { background: #10b981; }
  .addr {
    flex: 1;
    max-width: 680px;
    height: 26px;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #94a3b8;
    font-size: 12px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .viewport {
    flex: 1;
    display: flex;
    background: #ffffff;
    overflow: hidden;
  }
  .left-pane {
    flex: 1;
    height: 100%;
    overflow: hidden;
    border-right: 1px solid #e2e8f0;
  }
  .left-pane img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top left;
  }
  .right-pane {
    width: 380px;
    height: 100%;
    overflow: hidden;
    background: #ffffff;
  }
  .right-pane img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top left;
  }
</style>
</head>
<body>
  <div class="top">
    <div class="brand-head">
      <img src="${logoB64}" alt="Sidekick" />
      <div>
        <div class="badge">${opts.badge}</div>
        <h1>${opts.title}</h1>
        <div class="sub">${opts.subtitle}</div>
      </div>
    </div>
    <div class="pills">
      ${opts.pills.map((p) => `<span class="pill">${p}</span>`).join("")}
    </div>
  </div>
  <div class="browser-shell">
    <div class="chrome-bar">
      <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
      <div class="addr">${opts.urlText}</div>
    </div>
    <div class="viewport">
      <div class="left-pane"><img src="${opts.leftImg}" /></div>
      <div class="right-pane"><img src="${opts.rightImg}" /></div>
    </div>
  </div>
</body>
</html>`);
    await canvas.waitForTimeout(150);
    await canvas.screenshot({ path: resolve(OUT_DIR, `${opts.fileBase}.png`) });
    await canvas.screenshot({ path: resolve(OUT_DIR, `${opts.fileBase}.jpg`), type: "jpeg", quality: 92 });
  };

  // Screenshot 1: Selection Toolbar & Sidebar Quote Q&A
  await renderShowcaseFrame({
    fileBase: "screenshot-1-selection-toolbar-1280x800",
    badge: "光标跟随 · 划词三合一",
    title: "选中文本即刻「翻译 | 解释 | 问翻翻」，一键引用到侧边栏追问",
    subtitle: "智能贴合鼠标释放行，支持页内悬浮快译卡片与侧栏结构化引用卡片",
    pills: ["✦ 鼠标就近弹出", "✦ 页内即看即译", "✦ 侧栏引用卡片"],
    urlText: "https://science-journal.org/articles/urban-rooftop-gardens",
    leftImg: toDataUrl(shot1PageBuf),
    rightImg: toDataUrl(shot1PanelBuf),
  });

  // Screenshot 2: Immersive Bilingual Web Translation
  await renderShowcaseFrame({
    fileBase: "screenshot-2-bilingual-translation-1280x800",
    badge: "沉浸式双语对照 · Shift 悬停速译",
    title: "网页逐段双语对照翻译，悬停任意段落按 Shift 即时单段翻译",
    subtitle: "支持双语对照 / 仅看译文无缝切换，内置五种译文样式与 IndexedDB 极速缓存",
    pills: ["✦ 视口优先微批渲染", "✦ Shift 悬停单段速译", "✦ 代码块智能跳过"],
    urlText: "https://science-journal.org/articles/urban-rooftop-gardens",
    leftImg: toDataUrl(shot2PageBuf),
    rightImg: toDataUrl(shot2PanelBuf),
  });

  // Screenshot 3: Grounded Summary & Citation Highlight
  await renderShowcaseFrame({
    fileBase: "screenshot-3-grounded-summary-1280x800",
    badge: "长文 / 视频 / PDF 总结 · 原文溯源",
    title: "一键提炼网页、视频与百页 PDF 核心要点，点击引用角标直达原文",
    subtitle: "每条结论均附带可点击溯源角标，自动滚动并高亮定位网页原句或 PDF 页码",
    pills: ["✦ 点击角标高亮原文", "✦ 超长文分段总结", "✦ 在线与本地 PDF 解析"],
    urlText: "https://science-journal.org/articles/urban-rooftop-gardens#citation-1",
    leftImg: toDataUrl(shot3PageBuf),
    rightImg: toDataUrl(shot3PanelBuf),
  });

  // Screenshot 4: Bilingual Video Subtitles & Timestamp Summary (custom rich HTML preview + real panel)
  await canvas.setContent(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  body {
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background: radial-gradient(circle at 18% 15%, #1e1b4b 0%, #0f172a 55%, #090d16 100%);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    padding: 28px 36px 0;
  }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
  .brand-head { display: flex; align-items: center; gap: 16px; }
  .brand-head img { width: 52px; height: 52px; border-radius: 14px; box-shadow: 0 8px 24px rgba(79, 70, 229, 0.35); }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(16, 185, 129, 0.16); border: 1px solid rgba(52, 211, 153, 0.35); color: #6ee7b7; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff; }
  .sub { font-size: 14px; color: #94a3b8; margin-top: 4px; }
  .pills { display: flex; gap: 8px; }
  .pill { padding: 6px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); font-size: 12.5px; font-weight: 500; color: #e2e8f0; }
  .browser-shell { flex: 1; border-radius: 18px 18px 0 0; background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.14); border-bottom: none; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); overflow: hidden; display: flex; flex-direction: column; }
  .chrome-bar { height: 40px; background: #090d16; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; padding: 0 16px; gap: 14px; }
  .dots { display: flex; gap: 7px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .dot.r { background: #ef4444; } .dot.y { background: #f59e0b; } .dot.g { background: #10b981; }
  .addr { flex: 1; max-width: 680px; height: 26px; border-radius: 7px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8; font-size: 12px; display: flex; align-items: center; padding: 0 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .viewport { flex: 1; display: flex; background: #0b0f19; overflow: hidden; }
  .video-stage { flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .player { flex: 1; border-radius: 16px; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 55%, #064e3b 100%); border: 1px solid rgba(255,255,255,0.12); position: relative; display: flex; flex-direction: column; justify-content: flex-end; padding: 24px; overflow: hidden; }
  .video-tag { position: absolute; top: 18px; left: 18px; background: #ef4444; color: #fff; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px; letter-spacing: 0.04em; }
  .drag-hint { position: absolute; top: 18px; right: 18px; background: rgba(15, 23, 42, 0.78); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1; font-size: 12px; padding: 5px 12px; border-radius: 999px; }
  .sub-box { margin: 0 auto 28px; max-width: 680px; width: 92%; background: rgba(10, 14, 24, 0.82); border: 1px solid rgba(52, 211, 153, 0.45); border-radius: 14px; padding: 14px 20px; text-align: center; box-shadow: 0 12px 32px rgba(0,0,0,0.45); }
  .sub-en { font-size: 15.5px; color: #f8fafc; line-height: 1.45; }
  .sub-zh { font-size: 17px; font-weight: 600; color: #4ade80; margin-top: 6px; line-height: 1.45; }
  .ctrl-bar { height: 42px; border-radius: 10px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; padding: 0 16px; gap: 14px; color: #cbd5e1; font-size: 13px; }
  .cc-btn { margin-left: auto; background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; color: #6ee7b7; padding: 4px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; }
  .style-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .sc { background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.09); border-radius: 12px; padding: 12px 14px; }
  .sc-title { font-size: 12.5px; font-weight: 600; color: #a5b4fc; margin-bottom: 4px; }
  .sc-desc { font-size: 12px; color: #94a3b8; line-height: 1.45; }
  .right-pane { width: 380px; height: 100%; overflow: hidden; background: #ffffff; border-left: 1px solid #e2e8f0; }
  .right-pane img { width: 100%; height: 100%; object-fit: cover; object-position: top left; }
</style>
</head>
<body>
  <div class="top">
    <div class="brand-head">
      <img src="${logoB64}" alt="Sidekick" />
      <div>
        <div class="badge">YouTube & Bilibili · 双引擎视频双语字幕</div>
        <h1>视频双语字幕自由拖拽与样式定制，一键生成带时间戳的视频总结</h1>
        <div class="sub">播放器控制栏原生 CC 开关（按站点自动记忆），点击侧栏 [MM:SS] 时间戳直接跳转视频对应秒数</div>
      </div>
    </div>
    <div class="pills">
      <span class="pill">✦ ASR 碎句智能合并</span>
      <span class="pill">✦ 字幕任意位置拖拽</span>
      <span class="pill">✦ [MM:SS] 时间戳跳转</span>
    </div>
  </div>
  <div class="browser-shell">
    <div class="chrome-bar">
      <div class="dots"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span></div>
      <div class="addr">https://www.youtube.com/watch?v=alphagenome-deepmind-keynote</div>
    </div>
    <div class="viewport">
      <div class="video-stage">
        <div class="player">
          <div class="video-tag">▶ YOUTUBE / BILIBILI</div>
          <div class="drag-hint">✥ 双语字幕框支持自由拖拽 · 双击复位</div>
          <div class="sub-box">
            <div class="sub-en">We pre-fetch the full transcript and merge fragmented captions into natural sentences with context.</div>
            <div class="sub-zh">我们会预取完整字幕轨，并将碎片化的语音字幕智能重组为语序自然的完整双语句子。</div>
          </div>
          <div class="ctrl-bar">
            <span>▶ 04:18 / 18:45</span>
            <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.2);overflow:hidden"><div style="width:32%;height:100%;background:#6366f1"></div></div>
            <span class="cc-btn">CC 双语字幕 ON · 样式设置</span>
          </div>
        </div>
        <div class="style-cards">
          <div class="sc">
            <div class="sc-title">引擎 1：全量轨道预取与断句重排</div>
            <div class="sc-desc">自动合并自动字幕碎句，滑动上下文批量预翻译，译文语序地道流畅</div>
          </div>
          <div class="sc">
            <div class="sc-title">引擎 2：实时 DOM 字幕兜底</div>
            <div class="sc-desc">直播流或自定义播放器自动切换 DOM 监听实时直译</div>
          </div>
          <div class="sc">
            <div class="sc-title">二级样式面板实时调优</div>
            <div class="sc-desc">自定义双语/仅译文、字号比例 (50%–150%)、主副轨颜色、字重与背景透明度</div>
          </div>
        </div>
      </div>
      <div class="right-pane"><img src="${toDataUrl(shot3PanelBuf)}" /></div>
    </div>
  </div>
</body>
</html>`);
  await canvas.waitForTimeout(150);
  await canvas.screenshot({ path: resolve(OUT_DIR, "screenshot-4-video-subtitles-1280x800.png") });
  await canvas.screenshot({ path: resolve(OUT_DIR, "screenshot-4-video-subtitles-1280x800.jpg"), type: "jpeg", quality: 92 });

  // Screenshot 5: Browser Agent & BYOK Multi-Provider Options
  await renderShowcaseFrame({
    fileBase: "screenshot-5-browser-agent-byok-1280x800",
    badge: "Browser Agent 自动化 · 100% 本地 BYOK",
    title: "内置网页自动化任务助手，支持 10+ 模型服务商直连与敏感操作安全确认",
    subtitle: "支持 DeepSeek、OpenAI、Claude、Gemini、Kimi、通义千问、Ollama 等，API Key 仅保存在本地浏览器",
    pills: ["✦ 10+ 模型预设直连", "✦ 敏感操作二次确认", "✦ MCP 本地桥接支持"],
    urlText: "chrome-extension://sidekick/options.html#models",
    leftImg: toDataUrl(shot5OptBuf),
    rightImg: toDataUrl(shot5PanelBuf),
  });

  await canvas.close();
  await panel.close();
  await page.close();
  await context.close();
  mock.server.close();
});
