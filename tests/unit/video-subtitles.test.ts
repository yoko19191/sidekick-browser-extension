// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  extractYoutubeCaptionTracksFromHtml,
  formatTimestamp,
  getYoutubeVideoId,
  parseYoutubeTimedText,
  pickBestCaptionTrack,
  VideoSubtitleController,
} from "../../src/lib/video-subtitles";
import { defaultSettings } from "../../src/lib/settings";

describe("video-subtitles helpers", () => {
  it("parses YouTube video IDs from watch, shorts, embed, and youtu.be URLs", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s")).toBe("dQw4w9WgXcQ");
    expect(getYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=123")).toBe("dQw4w9WgXcQ");
    expect(getYoutubeVideoId("https://www.youtube.com/shorts/abc123XYZ")).toBe("abc123XYZ");
    expect(getYoutubeVideoId("https://example.com/watch?v=123")).toBeNull();
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
      const trans = doc.querySelector("#pp-video-sub-overlay .pp-vsub-trans")?.textContent;
      expect(trans).toBe("译:Live subtitle line");
    });
    ctrl.stop();
  });
});
