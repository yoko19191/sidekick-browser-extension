/**
 * Dual-engine video subtitle translator + transcript extractor:
 * 1. Track Pre-fetch Engine: YouTube TimedText (JSON3 / XML) & HTML5 <video> TextTrack cues with
 *    lookahead batch pre-translation and 0ms timeupdate synchronization.
 * 2. Live Caption DOM Observer Fallback: MutationObserver (childList + characterData) for Bilibili,
 *    Netflix, Udemy, Coursera, Vimeo, Video.js, JWPlayer, Twitch, and fallback YouTube captions.
 * 3. Player-embedded Bilingual Subtitle Overlay (fullscreen-aware) + Full Transcript extraction for Page Summary.
 */
import type { Settings } from "./types";

export interface SubtitleCue {
  start: number; // seconds
  end: number;   // seconds
  text: string;
  translation?: string;
}

export interface YoutubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
  kind?: string;
}

/** Selectors for common video player containers (used to mount the fullscreen-aware subtitle overlay). */
const PLAYER_CONTAINER_SELECTORS = [
  "#movie_player",
  ".html5-video-player",
  ".bpx-player-video-area",
  ".bpx-player-Primary-area",
  ".squirtle-video-wrap",
  ".watch-video--player-view",
  ".video-js",
  ".jwplayer",
  ".plyr__video-wrapper",
  "[data-testid='video-player']",
].join(",");

/** Selectors for live DOM subtitle text nodes across popular video websites. */
export const LIVE_CAPTION_SELECTORS = [
  ".ytp-caption-segment",
  ".bili-subtitle-x-subtitle-panel-text",
  ".bpx-player-subtitle-panel-text",
  ".squirtle-subtitle-item-text",
  ".player-timedtext-text-container span",
  ".vjs-text-track-cue div",
  ".vjs-text-track-display div",
  ".jw-text-track-cue",
  "[data-purpose='captions-cue-text']",
  ".vp-captions span",
  ".plyr__captions span",
].join(",");

/** Format seconds into [MM:SS] or [HH:MM:SS] for video transcript summaries. */
export function formatTimestamp(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Extract YouTube video ID (`v` param or `/shorts/` or `/embed/`) from a URL. */
export function getYoutubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(u.hostname)) return null;
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Extract `captionTracks` array from YouTube HTML or inline `<script>` content containing `ytInitialPlayerResponse`.
 * Optionally verifies that `"videoId"` matches `expectedVideoId` so stale SPA scripts are skipped.
 */
export function extractYoutubeCaptionTracksFromHtml(html: string, expectedVideoId?: string | null): YoutubeCaptionTrack[] {
  if (!html || !html.includes('"captionTracks"')) return [];
  if (expectedVideoId && html.includes('"videoDetails"')) {
    const escapedId = expectedVideoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const vidRe = new RegExp(`"videoId"\\s*:\\s*"${escapedId}"`);
    if (!vidRe.test(html)) return [];
  }
  const marker = '"captionTracks":';
  let pos = 0;
  while ((pos = html.indexOf(marker, pos)) !== -1) {
    const arrayStart = html.indexOf("[", pos + marker.length);
    if (arrayStart === -1 || arrayStart - (pos + marker.length) > 20) {
      pos += marker.length;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = arrayStart; i < html.length && i < arrayStart + 100_000; i++) {
      const ch = html[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(html.slice(arrayStart, i + 1));
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.baseUrl === "string") {
              return parsed as YoutubeCaptionTrack[];
            }
          } catch {
            /* try next occurrence */
          }
          break;
        }
      }
    }
    pos = arrayStart + 1;
  }
  return [];
}

/** Choose the best source caption track (prefer manual track over ASR, and non-target language over target language). */
export function pickBestCaptionTrack(tracks: YoutubeCaptionTrack[], targetLang = "zh-CN"): YoutubeCaptionTrack | undefined {
  if (!tracks.length) return undefined;
  const targetBase = targetLang.toLowerCase().split("-")[0];
  const score = (t: YoutubeCaptionTrack) => {
    const lang = (t.languageCode || "").toLowerCase();
    const isTarget = lang === targetLang.toLowerCase() || lang.startsWith(targetBase);
    const isManual = t.kind !== "asr";
    const isEn = lang.startsWith("en");
    return (isTarget ? 0 : 100) + (isManual ? 20 : 0) + (isEn ? 10 : 0);
  };
  return [...tracks].sort((a, b) => score(b) - score(a))[0];
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Parse YouTube TimedText response (supports both `fmt=json3` and XML `<text start="" dur="">` / `<p t="" d="">`).
 * Normalizes overlapping ASR timestamps and merges tiny fragments into clean subtitle cues.
 */
export function parseYoutubeTimedText(raw: string): SubtitleCue[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const rawCues: SubtitleCue[] = [];

  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as {
        events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[];
      };
      for (const ev of data.events ?? []) {
        if (!ev.segs?.length || ev.tStartMs == null) continue;
        const text = ev.segs
          .map((s) => s.utf8 ?? "")
          .join("")
          .replace(/\s+/g, " ")
          .trim();
        if (!text || /^\[.*\]$/.test(text)) continue;
        const start = ev.tStartMs / 1000;
        const dur = Math.min(12, Math.max(0.8, (ev.dDurationMs ?? 3000) / 1000));
        rawCues.push({ start, end: start + dur, text });
      }
    } catch {
      /* fall through to XML parser */
    }
  }

  if (rawCues.length === 0 && trimmed.startsWith("<")) {
    const textRe = /<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/gi;
    let m: RegExpExecArray | null;
    while ((m = textRe.exec(trimmed)) !== null) {
      const attrs = m[1];
      const inner = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (!inner) continue;
      const startSec = attrs.match(/\bstart=["']([\d.]+)["']/i);
      const durSec = attrs.match(/\bdur=["']([\d.]+)["']/i);
      const startMs = attrs.match(/\bt=["'](\d+)["']/i);
      const durMs = attrs.match(/\bd=["'](\d+)["']/i);
      const start = startSec ? Number(startSec[1]) : startMs ? Number(startMs[1]) / 1000 : NaN;
      const dur = durSec ? Number(durSec[1]) : durMs ? Number(durMs[1]) / 1000 : 3;
      if (Number.isFinite(start)) {
        rawCues.push({ start, end: start + Math.min(12, Math.max(0.8, dur)), text: inner });
      }
    }
  }

  if (!rawCues.length) return [];
  rawCues.sort((a, b) => a.start - b.start);

  // Deduplicate identical consecutive lines and clamp overlapping end times (common in YouTube ASR tracks)
  const cleaned: SubtitleCue[] = [];
  for (let i = 0; i < rawCues.length; i++) {
    const cur = { ...rawCues[i] };
    const next = rawCues[i + 1];
    if (next && cur.end > next.start && next.start > cur.start) {
      cur.end = next.start;
    }
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.text === cur.text && Math.abs(cur.start - prev.end) < 0.5) {
      prev.end = Math.max(prev.end, cur.end);
      continue;
    }
    // Merge very short (< 18 chars) consecutive ASR fragments within 0.4s that don't end with sentence punctuation
    if (
      prev &&
      prev.text.length < 36 &&
      cur.text.length < 28 &&
      cur.start - prev.end <= 0.35 &&
      prev.end - prev.start < 4.5 &&
      !/[.!?。！？…]$/.test(prev.text)
    ) {
      prev.text = `${prev.text} ${cur.text}`.replace(/\s+/g, " ").trim();
      prev.end = cur.end;
      continue;
    }
    cleaned.push(cur);
  }
  return cleaned;
}

/** Extract cues from standard HTML5 `<video>` `textTracks` (`VTTCue` list). */
export function extractHtml5TextTrackCues(doc: Document = document): SubtitleCue[] {
  const videos = Array.from(doc.querySelectorAll("video"));
  for (const video of videos) {
    const tracks = Array.from(video.textTracks ?? []);
    const active =
      tracks.find((t) => t.mode === "showing" && t.cues && t.cues.length > 0) ??
      tracks.find((t) => t.cues && t.cues.length > 0);
    if (!active?.cues?.length) continue;
    const cues: SubtitleCue[] = [];
    for (let i = 0; i < active.cues.length; i++) {
      const c = active.cues[i] as VTTCue;
      const text = (c.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      cues.push({ start: c.startTime, end: c.endTime, text });
    }
    if (cues.length > 0) return cues;
  }
  return [];
}

/** Cache of fetched video cues keyed by video URL / ID so both subtitle overlay and page summary reuse it. */
const videoCueCache = new Map<string, SubtitleCue[]>();

/** Fetch YouTube cues for the current document (using inline script data or a fresh HTML fetch on SPA navigation). */
export async function fetchYoutubeCuesForDocument(doc: Document = document, targetLang = "zh-CN"): Promise<SubtitleCue[]> {
  const url = doc.location?.href ?? "";
  const videoId = getYoutubeVideoId(url);
  if (!videoId) return [];
  const cacheKey = `yt:${videoId}:${targetLang}`;
  const cached = videoCueCache.get(cacheKey);
  if (cached?.length) return cached;

  let tracks: YoutubeCaptionTrack[] = [];
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (text.includes('"captionTracks"')) {
      tracks = extractYoutubeCaptionTracksFromHtml(text, videoId);
      if (tracks.length) break;
    }
  }

  // On YouTube SPA navigation, inline <script> tags belong to the initial page load; fetch fresh watch HTML if needed.
  if (!tracks.length && typeof fetch === "function" && /^https?:/i.test(url)) {
    try {
      const html = await fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
      tracks = extractYoutubeCaptionTracksFromHtml(html, videoId);
    } catch {
      /* ignore network failure */
    }
  }

  const chosen = pickBestCaptionTrack(tracks, targetLang);
  if (!chosen?.baseUrl || typeof fetch !== "function") return [];

  try {
    const json3Url = chosen.baseUrl.includes("fmt=")
      ? chosen.baseUrl.replace(/fmt=[^&]+/, "fmt=json3")
      : `${chosen.baseUrl}&fmt=json3`;
    let raw = await fetch(json3Url, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
    let cues = parseYoutubeTimedText(raw);
    if (!cues.length) {
      raw = await fetch(chosen.baseUrl, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
      cues = parseYoutubeTimedText(raw);
    }
    if (cues.length) {
      videoCueCache.set(cacheKey, cues);
    }
    return cues;
  } catch {
    return [];
  }
}

/**
 * Extract a timestamped Markdown transcript for the current video (YouTube or HTML5 `<video>` with `<track>`),
 * used when the user clicks "Summarize Page" or asks questions in the Sidebar.
 */
export async function extractVideoTranscriptMarkdown(doc: Document = document): Promise<string | null> {
  let cues = await fetchYoutubeCuesForDocument(doc);
  if (!cues.length) {
    cues = extractHtml5TextTrackCues(doc);
  }
  if (!cues.length) return null;

  // Group adjacent cues into ~20-30s paragraphs with leading [MM:SS] timestamps so the LLM gets clean structure
  const blocks: string[] = [];
  let bucketStart = cues[0].start;
  let bucketTexts: string[] = [];
  let bucketChars = 0;

  const flush = () => {
    if (!bucketTexts.length) return;
    blocks.push(`[${formatTimestamp(bucketStart)}] ${bucketTexts.join(" ")}`);
    bucketTexts = [];
    bucketChars = 0;
  };

  for (const c of cues) {
    if (bucketTexts.length > 0 && (c.start - bucketStart >= 25 || bucketChars + c.text.length > 320)) {
      flush();
      bucketStart = c.start;
    }
    if (bucketTexts.length === 0) bucketStart = c.start;
    bucketTexts.push(c.text);
    bucketChars += c.text.length + 1;
  }
  flush();

  const descEl = doc.querySelector("#description-inline-expander, #description, [itemprop='description']");
  const desc = (descEl?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const header = desc ? `## Video Description\n\n${desc}\n\n` : "";
  return `${header}## Video Transcript\n\n${blocks.join("\n\n")}`;
}

/** CSS injected for the bilingual video subtitle overlay and optional suppression of redundant native captions. */
export const VIDEO_SUBTITLE_CSS = `
html.pp-yt-sub-active .ytp-caption-window-container {
  opacity: 0 !important;
  pointer-events: none !important;
}
#pp-video-sub-overlay {
  position: absolute;
  left: 6%;
  right: 6%;
  bottom: 9%;
  z-index: 2147483640;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  pointer-events: none;
  text-align: center;
  transition: opacity 0.12s ease;
}
#pp-video-sub-overlay:empty {
  display: none;
}
.pp-vsub-box {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  max-width: min(92%, 920px);
  padding: 6px 14px 7px;
  border-radius: 10px;
  background: rgba(10, 14, 23, 0.78);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.38);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.4;
}
.pp-vsub-orig {
  color: rgba(255, 255, 255, 0.86);
  font-size: clamp(13px, 1.45vw, 20px);
  font-weight: 400;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
html.pp-only .pp-vsub-orig {
  display: none !important;
}
.pp-vsub-trans {
  color: #4ade80;
  font-size: clamp(15px, 1.85vw, 25px);
  font-weight: 600;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
.pp-vsub-box[data-style="plain"] .pp-vsub-trans {
  color: #ffffff;
}
.pp-vsub-box[data-style="highlight"] .pp-vsub-trans {
  color: #fde047;
}
`;

export interface VideoSubtitleControllerDeps {
  doc?: Document;
  translateBatch: (texts: string[]) => Promise<string[]>;
  onStatsChange?: (delta: { total?: number; done?: number; errors?: number }) => void;
}

/**
 * Manages bilingual video subtitles on the page:
 * - Automatically detects `<video>` elements and player containers
 * - Runs Engine 1 (Track Pre-fetch + Lookahead Batch Translation + `timeupdate` sync) when cues are available
 * - Automatically falls back to Engine 2 (Live DOM Caption MutationObserver) for other video sites
 */
export class VideoSubtitleController {
  private readonly doc: Document;
  private active = false;
  private cfg: Settings["translation"] | null = null;
  private cues: SubtitleCue[] = [];
  private translatingIdx = new Set<number>();
  private liveCache = new Map<string, string>();
  private livePending = new Set<string>();
  private currentVideoUrl = "";
  private videoEl: HTMLVideoElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private liveMo: MutationObserver | null = null;
  private pollTimer: number | undefined;
  private liveDebounceTimer: number | undefined;
  private lastRenderedKey = "";

  constructor(private readonly deps: VideoSubtitleControllerDeps) {
    this.doc = deps.doc ?? document;
  }

  start(cfg: Settings["translation"]) {
    this.cfg = cfg;
    if (this.active) {
      this.renderCurrentState();
      return;
    }
    this.active = true;
    this.currentVideoUrl = "";
    this.cues = [];
    this.translatingIdx.clear();
    this.startLiveDomObserver();
    void this.checkVideoSource();
    this.pollTimer = window.setInterval(() => {
      if (!this.active) return;
      void this.checkVideoSource();
      this.syncTrackOverlay();
    }, 250);
  }

  updateConfig(cfg: Settings["translation"]) {
    this.cfg = cfg;
    if (this.active) this.renderCurrentState();
  }

  stop() {
    this.active = false;
    clearInterval(this.pollTimer);
    clearTimeout(this.liveDebounceTimer);
    this.pollTimer = undefined;
    this.liveDebounceTimer = undefined;
    this.liveMo?.disconnect();
    this.liveMo = null;
    if (this.videoEl) {
      this.videoEl.removeEventListener("timeupdate", this.onTimeUpdate);
      this.videoEl.removeEventListener("seeked", this.onTimeUpdate);
      this.videoEl = null;
    }
    this.cues = [];
    this.translatingIdx.clear();
    this.livePending.clear();
    this.lastRenderedKey = "";
    this.doc.documentElement.classList.remove("pp-yt-sub-active");
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private readonly onTimeUpdate = () => {
    if (!this.active) return;
    this.syncTrackOverlay();
  };

  private findPrimaryVideo(): HTMLVideoElement | null {
    const videos = Array.from(this.doc.querySelectorAll("video"));
    if (!videos.length) return null;
    return (
      videos.find((v) => v.readyState > 0 && v.getBoundingClientRect().width > 160) ??
      videos[0]
    );
  }

  private findPlayerContainer(video: HTMLVideoElement | null): HTMLElement | null {
    const fs = this.doc.fullscreenElement as HTMLElement | null;
    if (fs && (!video || fs.contains(video))) return fs;
    if (video) {
      const closest = video.closest(PLAYER_CONTAINER_SELECTORS) as HTMLElement | null;
      if (closest) return closest;
      if (video.parentElement) return video.parentElement;
    }
    return this.doc.querySelector<HTMLElement>(PLAYER_CONTAINER_SELECTORS);
  }

  private ensureOverlay(): HTMLElement | null {
    const video = this.videoEl ?? this.findPrimaryVideo();
    const container = this.findPlayerContainer(video);
    if (!container) return null;
    const cs = this.doc.defaultView?.getComputedStyle(container);
    if (cs?.position === "static") {
      container.style.position = "relative";
    }
    if (!this.overlayEl || !this.overlayEl.isConnected || this.overlayEl.parentElement !== container) {
      this.overlayEl?.remove();
      const el = this.doc.createElement("div");
      el.id = "pp-video-sub-overlay";
      el.setAttribute("data-pp-ui", "");
      container.appendChild(el);
      this.overlayEl = el;
    }
    return this.overlayEl;
  }

  private renderOverlay(origText: string, transText?: string) {
    const key = `${origText}|||${transText ?? ""}|||${this.cfg?.style ?? "green"}`;
    if (key === this.lastRenderedKey && this.overlayEl?.isConnected) return;
    this.lastRenderedKey = key;

    const overlay = this.ensureOverlay();
    if (!overlay) return;
    if (!origText && !transText) {
      overlay.innerHTML = "";
      return;
    }
    const box = this.doc.createElement("div");
    box.className = "pp-vsub-box";
    box.setAttribute("data-style", this.cfg?.style ?? "green");

    if (origText) {
      const orig = this.doc.createElement("div");
      orig.className = "pp-vsub-orig";
      orig.textContent = origText;
      box.appendChild(orig);
    }
    if (transText) {
      const trans = this.doc.createElement("div");
      trans.className = "pp-vsub-trans";
      trans.textContent = transText;
      box.appendChild(trans);
    }
    overlay.replaceChildren(box);
  }

  private renderCurrentState() {
    this.lastRenderedKey = "";
    if (this.cues.length > 0) {
      this.syncTrackOverlay();
    } else {
      this.checkLiveDomCaptions();
    }
  }

  private async checkVideoSource() {
    if (!this.active) return;
    const video = this.findPrimaryVideo();
    if (video !== this.videoEl) {
      if (this.videoEl) {
        this.videoEl.removeEventListener("timeupdate", this.onTimeUpdate);
        this.videoEl.removeEventListener("seeked", this.onTimeUpdate);
      }
      this.videoEl = video;
      if (video) {
        video.addEventListener("timeupdate", this.onTimeUpdate);
        video.addEventListener("seeked", this.onTimeUpdate);
      }
    }

    const url = this.doc.location?.href ?? "";
    const ytId = getYoutubeVideoId(url);
    const sourceKey = ytId ? `yt:${ytId}` : video ? `html5:${url}:${video.textTracks?.length ?? 0}` : "";
    if (!sourceKey || sourceKey === this.currentVideoUrl) {
      // Re-check HTML5 tracks if cues were empty initially and tracks loaded later
      if (!this.cues.length && !ytId && video) {
        const html5Cues = extractHtml5TextTrackCues(this.doc);
        if (html5Cues.length) {
          this.setTrackCues(html5Cues, false);
        }
      }
      return;
    }

    this.currentVideoUrl = sourceKey;
    this.cues = [];
    this.translatingIdx.clear();
    this.doc.documentElement.classList.remove("pp-yt-sub-active");

    if (ytId) {
      const ytCues = await fetchYoutubeCuesForDocument(this.doc, this.cfg?.targetLang);
      if (!this.active || this.currentVideoUrl !== sourceKey) return;
      if (ytCues.length > 0) {
        this.setTrackCues(ytCues.map((c) => ({ ...c })), true);
        return;
      }
    }

    const html5Cues = extractHtml5TextTrackCues(this.doc);
    if (html5Cues.length > 0) {
      this.setTrackCues(html5Cues, false);
    }
  }

  private setTrackCues(cues: SubtitleCue[], isYoutube: boolean) {
    this.cues = cues;
    if (isYoutube) {
      this.doc.documentElement.classList.add("pp-yt-sub-active");
    }
    this.syncTrackOverlay();
  }

  /** Engine 1: Synchronize pre-fetched track cues with `video.currentTime` and prefetch upcoming window. */
  private syncTrackOverlay() {
    if (!this.active || !this.cues.length || !this.videoEl) return;
    const now = this.videoEl.currentTime;

    // Trigger lookahead pre-translation for cues in [now - 1, now + 75]
    this.prefetchLookaheadWindow(now);

    // Find active cue(s) at `now`
    const activeCue = this.cues.find((c) => now >= c.start - 0.08 && now <= c.end + 0.12);
    if (!activeCue) {
      this.renderOverlay("");
      return;
    }
    const cachedTrans = activeCue.translation ?? this.liveCache.get(activeCue.text);
    this.renderOverlay(activeCue.text, cachedTrans);
  }

  private prefetchLookaheadWindow(now: number) {
    const windowEnd = now + 75;
    const batchIndices: number[] = [];
    for (let i = 0; i < this.cues.length && batchIndices.length < 12; i++) {
      const c = this.cues[i];
      if (c.end < now - 1) continue;
      if (c.start > windowEnd) break;
      if (c.translation || this.translatingIdx.has(i)) continue;
      const fromCache = this.liveCache.get(c.text);
      if (fromCache) {
        c.translation = fromCache;
        continue;
      }
      batchIndices.push(i);
    }

    if (!batchIndices.length) return;
    batchIndices.forEach((i) => this.translatingIdx.add(i));
    this.deps.onStatsChange?.({ total: batchIndices.length });

    const texts = batchIndices.map((i) => this.cues[i].text);
    const snapshotCues = this.cues;
    this.deps
      .translateBatch(texts)
      .then((translations) => {
        if (!this.active || this.cues !== snapshotCues) return;
        translations.forEach((t, idx) => {
          const cueIdx = batchIndices[idx];
          const cleanTrans = (t ?? "").trim();
          if (cleanTrans && snapshotCues[cueIdx]) {
            snapshotCues[cueIdx].translation = cleanTrans;
            this.liveCache.set(snapshotCues[cueIdx].text, cleanTrans);
          }
        });
        this.deps.onStatsChange?.({ done: batchIndices.length });
        this.syncTrackOverlay();
      })
      .catch(() => {
        this.deps.onStatsChange?.({ errors: batchIndices.length });
      })
      .finally(() => {
        batchIndices.forEach((i) => this.translatingIdx.delete(i));
      });
  }

  /** Engine 2: Live DOM Caption Observer fallback for video sites without pre-fetchable tracks. */
  private startLiveDomObserver() {
    this.liveMo?.disconnect();
    const MO = this.doc.defaultView?.MutationObserver ?? MutationObserver;
    if (!MO || !this.doc.body) return;
    this.liveMo = new MO((muts) => {
      if (!this.active || this.cues.length > 0) return; // Engine 1 is handling subtitles
      let relevant = false;
      for (const m of muts) {
        const el = (m.target.nodeType === 1 ? m.target : m.target.parentElement) as Element | null;
        if (!el || el.closest("[data-pp-ui]")) continue;
        if (el.matches?.(LIVE_CAPTION_SELECTORS) || el.querySelector?.(LIVE_CAPTION_SELECTORS) || el.closest?.(".ytp-caption-window-container, .bpx-player-subtitle-wrap, .player-timedtext, .vjs-text-track-display")) {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;
      clearTimeout(this.liveDebounceTimer);
      this.liveDebounceTimer = window.setTimeout(() => this.checkLiveDomCaptions(), 45);
    });
    this.liveMo.observe(this.doc.body, { childList: true, characterData: true, subtree: true });
  }

  public checkLiveDomCaptions() {
    if (!this.active || this.cues.length > 0) return;
    const nodes = Array.from(this.doc.querySelectorAll(LIVE_CAPTION_SELECTORS)).filter(
      (el) => !el.closest("[data-pp-ui]"),
    );
    if (!nodes.length) {
      if (this.lastRenderedKey) this.renderOverlay("");
      return;
    }
    const text = nodes
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      this.renderOverlay("");
      return;
    }

    const cached = this.liveCache.get(text);
    if (cached) {
      this.renderOverlay("", cached);
      return;
    }

    // Show nothing or keep previous translation while the fast single-line request is in flight
    if (this.livePending.has(text)) return;
    this.livePending.add(text);
    this.deps.onStatsChange?.({ total: 1 });

    this.deps
      .translateBatch([text])
      .then(([trans]) => {
        if (!this.active) return;
        const cleanTrans = (trans ?? "").trim();
        if (cleanTrans) {
          this.liveCache.set(text, cleanTrans);
          this.deps.onStatsChange?.({ done: 1 });
          // Re-verify if this caption text is still on screen
          const currentText = Array.from(this.doc.querySelectorAll(LIVE_CAPTION_SELECTORS))
            .filter((el) => !el.closest("[data-pp-ui]"))
            .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (currentText === text) {
            this.renderOverlay("", cleanTrans);
          }
        }
      })
      .catch(() => {
        this.deps.onStatsChange?.({ errors: 1 });
      })
      .finally(() => {
        this.livePending.delete(text);
      });
  }
}
