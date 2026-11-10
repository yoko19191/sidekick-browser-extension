// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  extractVideoTranscriptMarkdown,
  extractYoutubeCaptionTracksFromHtml,
  formatTimestamp,
  getYoutubeVideoId,
  hasVideoSubtitlesAvailable,
  isVideoWatchUrl,
  loadVideoSubtitleDomainEnabled,
  parseYoutubeTimedText,
  pickBestCaptionTrack,
  saveVideoSubtitleDomainEnabled,
  VideoSubtitleController,
} from "../../src/lib/video-subtitles";
import { PageObserver } from "../../src/agent/page/observer";
import { defaultSettings } from "../../src/lib/settings";

describe("video-subtitles helpers", () => {
  it("parses YouTube video IDs from watch, shorts, embed, and youtu.be URLs", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toBe("dQw4w9WgXcQ");
    expect(getYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=123")).toBe("dQw4w9WgXcQ");
    expect(getYoutubeVideoId("https://www.youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
    expect(getYoutubeVideoId("https://example.com/watch?v=123")).toBeNull();
    expect(isVideoWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isVideoWatchUrl("https://www.bilibili.com/video/BV1xx411c7mD/")).toBe(true);
    expect(isVideoWatchUrl("https://www.youtube.com/")).toBe(false);

    const docWithSub = document.implementation.createHTMLDocument("Video Sub Available");
    docWithSub.body.innerHTML = `<div><video><track kind="subtitles" /></video></div>`;
    expect(hasVideoSubtitlesAvailable(docWithSub)).toBe(true);

    const docPlain = document.implementation.createHTMLDocument("Plain Page");
    docPlain.body.innerHTML = `<article><p>Just an article</p></article>`;
    expect(hasVideoSubtitlesAvailable(docPlain)).toBe(false);
  });

  it("extracts captionTracks from YouTube inline script HTML and selects the best source track", () => {
    const html = `
      <script>
        var ytInitialPlayerResponse = {
          "videoDetails": {"videoId": "vid123"},
          "captions": {
            "playerCaptionsTracklistRenderer": {
              "captionTracks": [
                {"baseUrl": "https://www.youtube.com/api/timedtext?v=vid123&lang=en&kind=asr", "languageCode": "en", "kind": "asr"},
                {"baseUrl": "https://www.youtube.com/api/timedtext?v=vid123&lang=en", "languageCode": "en"},
                {"baseUrl": "https://www.youtube.com/api/timedtext?v=vid123&lang=zh-CN", "languageCode": "zh-CN"}
              ]
            }
          }
        };
      </script>
    `;
    const tracks = extractYoutubeCaptionTracksFromHtml(html, "vid123");
    expect(tracks).toHaveLength(3);
    expect(extractYoutubeCaptionTracksFromHtml(html, "otherVid")).toEqual([]);
    const best = pickBestCaptionTrack(tracks, "zh-CN");
    expect(best?.baseUrl).toBe("https://www.youtube.com/api/timedtext?v=vid123&lang=en");
  });

  it("parses YouTube json3 and XML timedtext, clamping overlaps and merging short ASR fragments", () => {
    const json3 = JSON.stringify({
      events: [
        { tStartMs: 1000, dDurationMs: 5000, segs: [{ utf8: "Welcome to " }, { utf8: "the lecture" }] },
        { tStartMs: 2500, dDurationMs: 2000, segs: [{ utf8: "on distributed systems." }] },
        { tStartMs: 6000, dDurationMs: 2000, segs: [{ utf8: "[Music]" }] },
      ],
    });
    const cues = parseYoutubeTimedText(json3);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Welcome to the lecture on distributed systems.");
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(4.5);

    const xml = `<transcript><text start="10.5" dur="2.5">First &amp; foremost.</text><text start="14.0" dur="3.0">Second line here.</text></transcript>`;
    const xmlCues = parseYoutubeTimedText(xml);
    expect(xmlCues).toEqual([
      { start: 10.5, end: 13, text: "First & foremost." },
      { start: 14, end: 17, text: "Second line here." },
    ]);
    expect(formatTimestamp(75)).toBe("01:15");
    expect(formatTimestamp(3661)).toBe("01:01:01");

    // Re-align mid-cue sentence boundaries so dangling sentence starters move into the next cue
    const splitBoundaryJson3 = JSON.stringify({
      events: [
        {
          tStartMs: 10000,
          dDurationMs: 4500,
          segs: [{ utf8: "argue with us on our podcast, The World Leader Leaderboard. Find it over on the" }],
        },
        {
          tStartMs: 14500,
          dDurationMs: 3500,
          segs: [{ utf8: "Too Long channel or wherever you get your podcasts." }],
        },
      ],
    });
    const realigned = parseYoutubeTimedText(splitBoundaryJson3);
    expect(realigned).toHaveLength(2);
    expect(realigned[0].text).toBe("argue with us on our podcast, The World Leader Leaderboard.");
    expect(realigned[1].text).toBe("Find it over on the Too Long channel or wherever you get your podcasts.");
  });
});

describe("VideoSubtitleController dual engines", () => {
  it("Engine 1: pre-translates HTML5 textTrack cues and renders bilingual overlay synchronized with currentTime", async () => {
    const doc = document.implementation.createHTMLDocument("Video Test");
    doc.body.innerHTML = `<div class="html5-video-player"><video></video></div>`;
    const video = doc.querySelector("video") as any;
    video.currentTime = 1.2;
    Object.defineProperty(video, "textTracks", {
      configurable: true,
      value: [
        {
          mode: "showing",
          cues: [
            { startTime: 1.0, endTime: 3.5, text: "Hello world from track" },
            { startTime: 4.0, endTime: 6.5, text: "Second subtitle cue" },
          ],
        },
      ],
    });

    const translateBatch = vi.fn(async (texts: string[]) => texts.map((t) => `ZH:${t}`));
    const ctrl = new VideoSubtitleController({ doc, translateBatch });
    ctrl.start(defaultSettings("zh-CN").translation);

    await vi.waitFor(() => expect(translateBatch).toHaveBeenCalledOnce());
    expect(translateBatch).toHaveBeenCalledWith(["Hello world from track", "Second subtitle cue"]);

    const overlay = doc.getElementById("pp-video-sub-overlay")!;
    expect(overlay).toBeTruthy();
    expect(overlay.querySelector(".pp-vsub-orig")?.textContent).toBe("Hello world from track");
    expect(overlay.querySelector(".pp-vsub-trans")?.textContent).toBe("ZH:Hello world from track");

    // Advance video time to the second cue: 0ms instant switch from pre-translated cue
    video.currentTime = 4.5;
    video.dispatchEvent(new Event("timeupdate"));
    expect(overlay.querySelector(".pp-vsub-orig")?.textContent).toBe("Second subtitle cue");
    expect(overlay.querySelector(".pp-vsub-trans")?.textContent).toBe("ZH:Second subtitle cue");

    ctrl.stop();
    expect(doc.getElementById("pp-video-sub-overlay")).toBeNull();
  });

  it("Engine 2: falls back to live DOM caption observer when no pre-fetchable track exists", async () => {
    const doc = document.implementation.createHTMLDocument("Bilibili Live Sub");
    doc.body.innerHTML = `
      <div class="bpx-player-video-area">
        <video></video>
        <div class="bpx-player-subtitle-wrap">
          <span class="bili-subtitle-x-subtitle-panel-text">Live subtitle line</span>
        </div>
      </div>
    `;
    const translateBatch = vi.fn(async (texts: string[]) => texts.map((t) => `译:${t}`));
    const ctrl = new VideoSubtitleController({ doc, translateBatch });
    ctrl.start(defaultSettings("zh-CN").translation);
    ctrl.checkLiveDomCaptions();

    await vi.waitFor(() => {
      const orig = doc.querySelector("#pp-video-sub-overlay .pp-vsub-orig")?.textContent;
      const trans = doc.querySelector("#pp-video-sub-overlay .pp-vsub-trans")?.textContent;
      expect(orig).toBe("Live subtitle line");
      expect(trans).toBe("译:Live subtitle line");
    });
    ctrl.stop();
  });

  it("mounts standalone toggle switch (#pp-video-sub-btn) in player bottom control bar and toggles subtitles on click", async () => {
    const doc = document.implementation.createHTMLDocument("YouTube Player Bar");
    doc.body.innerHTML = `
      <div class="html5-video-player">
        <video></video>
        <div class="ytp-chrome-bottom">
          <div class="ytp-chrome-controls">
            <div class="ytp-right-controls">
              <button class="ytp-button ytp-subtitles-button" aria-pressed="false"></button>
              <button class="ytp-button ytp-settings-button"></button>
            </div>
          </div>
        </div>
        <div class="ytp-caption-window-container">
          <span class="ytp-caption-segment">Hello from YouTube player</span>
        </div>
      </div>
    `;
    const translateBatch = vi.fn(async (texts: string[]) => texts.map((t) => `中文:${t}`));
    const ctrl = new VideoSubtitleController({ doc, translateBatch });

    // Enable control bar without starting full-page translation
    ctrl.setControlBarEnabled(true, defaultSettings("zh-CN").translation);

    const rightControls = doc.querySelector(".ytp-right-controls")!;
    const btn = doc.getElementById("pp-video-sub-btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    // Should be mounted as the first child of .ytp-right-controls (leftmost slot in right controls)
    expect(rightControls.firstElementChild).toBe(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(ctrl.isActive()).toBe(false);

    // Click the standalone switch to turn ON bilingual subtitles
    btn.click();
    expect(ctrl.isActive()).toBe(true);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.hasAttribute("data-active")).toBe(true);

    await vi.waitFor(() => {
      const orig = doc.querySelector("#pp-video-sub-overlay .pp-vsub-orig")?.textContent;
      const trans = doc.querySelector("#pp-video-sub-overlay .pp-vsub-trans")?.textContent;
      expect(orig).toBe("Hello from YouTube player");
      expect(trans).toBe("中文:Hello from YouTube player");
    });

    // Click again to turn OFF bilingual subtitles; button stays in control bar in OFF state
    btn.click();
    expect(ctrl.isActive()).toBe(false);
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(doc.getElementById("pp-video-sub-overlay")).toBeNull();
    expect(doc.getElementById("pp-video-sub-btn")).toBe(btn);

    ctrl.setControlBarEnabled(false);
    expect(doc.getElementById("pp-video-sub-btn")).toBeNull();
  });

  it("positions #pp-video-sub-btn between playback-rate and volume icons in Bilibili control bar (.bpx-player-control-bottom-right)", async () => {
    const doc = document.implementation.createHTMLDocument("Bilibili Player Bar");
    doc.body.innerHTML = `
      <div class="bpx-player-Primary-area">
        <div class="bpx-player-video-area">
          <video></video>
          <div class="bpx-player-control-bottom">
            <div class="bpx-player-control-bottom-right"></div>
          </div>
        </div>
      </div>
    `;
    const translateBatch = vi.fn(async (texts: string[]) => texts);
    const ctrl = new VideoSubtitleController({ doc, translateBatch });
    ctrl.setControlBarEnabled(true, defaultSettings("zh-CN").translation);

    const rightBar = doc.querySelector(".bpx-player-control-bottom-right")!;
    const btn = doc.getElementById("pp-video-sub-btn")!;
    expect(btn).toBeTruthy();
    expect(btn.classList.contains("bpx-player-ctrl-btn")).toBe(true);

    // Simulate Bilibili asynchronously mounting quality, playbackrate, volume, and setting buttons
    const quality = doc.createElement("div");
    quality.className = "bpx-player-ctrl-btn bpx-player-ctrl-quality";
    const rate = doc.createElement("div");
    rate.className = "bpx-player-ctrl-btn bpx-player-ctrl-playbackrate";
    const volume = doc.createElement("div");
    volume.className = "bpx-player-ctrl-btn bpx-player-ctrl-volume";
    const setting = doc.createElement("div");
    setting.className = "bpx-player-ctrl-btn bpx-player-ctrl-setting";
    rightBar.append(quality, rate, volume, setting);

    ctrl.ensurePlayerButton();
    expect(btn.previousElementSibling).toBe(rate);
    expect(btn.nextElementSibling).toBe(volume);

    ctrl.setControlBarEnabled(false);
  });

  it("opens 2-level Subtitle Settings & Style popover and live-updates position, display mode, opacity, and font size", async () => {
    const doc = document.implementation.createHTMLDocument("Subtitle Style Menu");
    doc.body.innerHTML = `
      <div class="html5-video-player">
        <video></video>
        <div class="ytp-right-controls"></div>
        <div class="ytp-caption-window-container">
          <span class="ytp-caption-segment">Original subtitle line</span>
        </div>
      </div>
    `;
    const translateBatch = vi.fn(async (texts: string[]) => texts.map((t) => `译文:${t}`));
    const ctrl = new VideoSubtitleController({ doc, translateBatch });
    ctrl.start(defaultSettings("zh-CN").translation);

    await vi.waitFor(() => {
      expect(doc.querySelector("#pp-video-sub-overlay .pp-vsub-trans")?.textContent).toBe("译文:Original subtitle line");
    });

    // Open main settings menu
    const menu = ctrl.openSettingsMenu("main")!;
    expect(menu).toBeTruthy();

    // Change translation position to "above" (译文在原文上方)
    const posSelect = menu.querySelector<HTMLSelectElement>('[data-testid="pp-vsm-trans-pos"]')!;
    posSelect.value = "above";
    posSelect.dispatchEvent(new Event("change"));

    const box = doc.querySelector("#pp-video-sub-overlay .pp-vsub-box")!;
    expect(box.firstElementChild?.classList.contains("pp-vsub-trans")).toBe(true);
    expect(box.lastElementChild?.classList.contains("pp-vsub-orig")).toBe(true);

    // Navigate to Subtitle Style sub-panel
    menu.querySelector<HTMLElement>('[data-testid="pp-vsm-open-style"]')?.click();
    const sizeSlider = menu.querySelector<HTMLInputElement>('[data-testid="pp-vsm-primary-size"]')!;
    expect(sizeSlider).toBeTruthy();
    sizeSlider.value = "90";
    sizeSlider.dispatchEvent(new Event("input"));

    const transEl = doc.querySelector<HTMLElement>("#pp-video-sub-overlay .pp-vsub-trans")!;
    expect(transEl.style.fontSize).toBe("18px"); // 90% of 20px base

    // Drag subtitle overlay to a new position and verify percentage coordinates update
    const overlay = doc.getElementById("pp-video-sub-overlay")!;
    expect(overlay.style.left).toBe("50%");
    expect(overlay.style.bottom).toBe("8.5%");

    overlay.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 300, clientY: 300, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 236, clientY: 228, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 236, clientY: 228, bubbles: true }));

    expect(overlay.style.left).toBe("40%");
    expect(overlay.style.bottom).toBe("28.5%");

    // Double-click resets subtitle overlay position back to default center-bottom
    overlay.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(overlay.style.left).toBe("50%");
    expect(overlay.style.bottom).toBe("8.5%");

    ctrl.closeSettingsMenu();
    ctrl.stop();
  });

  it("extracts video transcript from YouTube DOM transcript segments and exposes it to Agent extract/search_page", async () => {
    const doc = document.implementation.createHTMLDocument("YouTube Transcript Test");
    doc.body.innerHTML = `
      <main>
        <h1>How China Is Slowly Trying to Take Over the UN</h1>
        <div id="description">Brief description of the video.</div>
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">0:05</div>
          <div class="segment-text">Welcome back to TLDR News Global.</div>
        </ytd-transcript-segment-renderer>
        <ytd-transcript-segment-renderer>
          <div class="segment-timestamp">0:42</div>
          <div class="segment-text">Today we examine United Nations funding and leadership.</div>
        </ytd-transcript-segment-renderer>
      </main>
    `;

    const md = await extractVideoTranscriptMarkdown(doc);
    expect(md).toContain("## Video Transcript");
    expect(md).toContain("[00:05] Welcome back to TLDR News Global.");
    expect(md).toContain("[00:42] Today we examine United Nations funding and leadership.");

    const obs = new PageObserver(doc);
    const extracted = await obs.execute({ name: "extract", args: { query: "video transcript" } });
    expect(extracted.ok).toBe(true);
    expect(extracted.message).toContain("Welcome back to TLDR News Global.");
    expect(extracted.message).toContain("Today we examine United Nations funding and leadership.");
  });

  it("persists video subtitle switch state per video domain across controller instances", () => {
    localStorage.clear();
    const doc1 = document.implementation.createHTMLDocument("Domain Persistence 1");
    doc1.body.innerHTML = `
      <div class="html5-video-player">
        <video></video>
        <div class="ytp-right-controls"></div>
      </div>
    `;
    const translateBatch = vi.fn(async (texts: string[]) => texts);
    const ctrl1 = new VideoSubtitleController({ doc: doc1, translateBatch });
    ctrl1.setControlBarEnabled(true, defaultSettings("zh-CN").translation);
    expect(ctrl1.isActive()).toBe(false);
    expect(loadVideoSubtitleDomainEnabled(doc1)).toBe(false);

    // User toggles video subtitles ON via player button
    doc1.getElementById("pp-video-sub-btn")!.click();
    expect(ctrl1.isActive()).toBe(true);
    expect(loadVideoSubtitleDomainEnabled(doc1)).toBe(true);
    ctrl1.stop();
    ctrl1.setControlBarEnabled(false);

    // Simulating a new page load on the same domain: setControlBarEnabled(true) auto-starts subtitles
    const doc2 = document.implementation.createHTMLDocument("Domain Persistence 2");
    doc2.body.innerHTML = `
      <div class="html5-video-player">
        <video></video>
        <div class="ytp-right-controls"></div>
      </div>
    `;
    const ctrl2 = new VideoSubtitleController({ doc: doc2, translateBatch });
    ctrl2.setControlBarEnabled(true, defaultSettings("zh-CN").translation);
    expect(ctrl2.isActive()).toBe(true);
    expect(doc2.getElementById("pp-video-sub-btn")?.getAttribute("aria-pressed")).toBe("true");

    // User toggles video subtitles OFF -> clears domain persistence
    doc2.getElementById("pp-video-sub-btn")!.click();
    expect(ctrl2.isActive()).toBe(false);
    expect(loadVideoSubtitleDomainEnabled(doc2)).toBe(false);
    ctrl2.setControlBarEnabled(false);
    saveVideoSubtitleDomainEnabled(false, doc2);
  });
});
