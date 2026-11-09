/**
 * Dual-engine video subtitle translator + multi-stage transcript extractor + in-player style settings:
 * 1. Track Pre-fetch Engine: YouTube TimedText (signed performance resource URL with PO token, JSON3 / XML,
 *    and DOM transcript engagement panel) & HTML5 <video> TextTrack cues with lookahead batch pre-translation.
 * 2. Live Caption DOM Observer Fallback: MutationObserver (childList + characterData) for Bilibili,
 *    Netflix, Udemy, Coursera, Vimeo, Video.js, JWPlayer, Twitch, and fallback YouTube captions.
 * 3. Player-embedded Bilingual Subtitle Overlay (fullscreen-aware) + Compact Dual-CC Control Bar Icon +
 *    2-level Subtitle Settings & Style Customization Popover + Full Transcript extraction for Page Summary & Agent.
 */
import { tr } from "../i18n";
import { defaultSettings } from "./settings";
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

export interface SubtitleTrackStyle {
  fontSize: number;   // percentage: 50 - 150 (100% = 20px normal / 26px fullscreen)
  color: string;      // hex color
  fontFamily: "system" | "sans-serif" | "serif" | "monospace";
  fontWeight: number; // 300 - 700, step 100
}

export interface VideoSubtitleStyleConfig {
  displayType: "bilingual" | "translation-only" | "original-only";
  translationPosition: "above" | "below";
  backgroundOpacity: number; // 0 - 100
  /** Horizontal center position as percentage of player width (8 - 92, default 50). */
  xPct: number;
  /** Vertical distance from player bottom as percentage of player height (2 - 88, default 8.5). */
  bottomPct: number;
  primary: SubtitleTrackStyle;
  secondary: SubtitleTrackStyle;
}

const STYLE_STORAGE_KEY = "pp_vsub_style_v1";

export function defaultVideoSubtitleStyle(): VideoSubtitleStyleConfig {
  return {
    displayType: "bilingual",
    translationPosition: "below",
    backgroundOpacity: 75,
    xPct: 50,
    bottomPct: 8.5,
    primary: {
      fontSize: 75, // ~15px in normal player (compact & legible)
      color: "#4ade80",
      fontFamily: "system",
      fontWeight: 500,
    },
    secondary: {
      fontSize: 65, // ~13px in normal player
      color: "#ffffff",
      fontFamily: "system",
      fontWeight: 400,
    },
  };
}

export function loadVideoSubtitleStyle(): VideoSubtitleStyleConfig {
  const def = defaultVideoSubtitleStyle();
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STYLE_STORAGE_KEY) : null;
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<VideoSubtitleStyleConfig>;
    return {
      displayType:
        parsed.displayType === "translation-only" || parsed.displayType === "original-only"
          ? parsed.displayType
          : "bilingual",
      translationPosition: parsed.translationPosition === "above" ? "above" : "below",
      backgroundOpacity:
        typeof parsed.backgroundOpacity === "number"
          ? Math.max(0, Math.min(100, parsed.backgroundOpacity))
          : def.backgroundOpacity,
      xPct:
        typeof parsed.xPct === "number" && Number.isFinite(parsed.xPct)
          ? Math.max(8, Math.min(92, parsed.xPct))
          : def.xPct,
      bottomPct:
        typeof parsed.bottomPct === "number" && Number.isFinite(parsed.bottomPct)
          ? Math.max(2, Math.min(88, parsed.bottomPct))
          : def.bottomPct,
      primary: {
        fontSize:
          typeof parsed.primary?.fontSize === "number"
            ? Math.max(50, Math.min(150, parsed.primary.fontSize))
            : def.primary.fontSize,
        color: typeof parsed.primary?.color === "string" ? parsed.primary.color : def.primary.color,
        fontFamily:
          parsed.primary?.fontFamily && ["system", "sans-serif", "serif", "monospace"].includes(parsed.primary.fontFamily)
            ? parsed.primary.fontFamily
            : def.primary.fontFamily,
        fontWeight:
          typeof parsed.primary?.fontWeight === "number"
            ? Math.max(300, Math.min(700, parsed.primary.fontWeight))
            : def.primary.fontWeight,
      },
      secondary: {
        fontSize:
          typeof parsed.secondary?.fontSize === "number"
            ? Math.max(50, Math.min(150, parsed.secondary.fontSize))
            : def.secondary.fontSize,
        color: typeof parsed.secondary?.color === "string" ? parsed.secondary.color : def.secondary.color,
        fontFamily:
          parsed.secondary?.fontFamily && ["system", "sans-serif", "serif", "monospace"].includes(parsed.secondary.fontFamily)
            ? parsed.secondary.fontFamily
            : def.secondary.fontFamily,
        fontWeight:
          typeof parsed.secondary?.fontWeight === "number"
            ? Math.max(300, Math.min(700, parsed.secondary.fontWeight))
            : def.secondary.fontWeight,
      },
    };
  } catch {
    return def;
  }
}

export function saveVideoSubtitleStyle(style: VideoSubtitleStyleConfig) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(style));
    }
  } catch {
    /* ignore storage quota / sandboxed iframe errors */
  }
}

const DOMAIN_ENABLED_STORAGE_KEY = "pp_vsub_domain_enabled_v1";

function getDocDomainKey(doc?: Document): string {
  try {
    const d = doc ?? (typeof document !== "undefined" ? document : undefined);
    const host = d?.location?.hostname || (typeof location !== "undefined" ? location.hostname : "");
    return host || "default";
  } catch {
    return "default";
  }
}

export function loadVideoSubtitleDomainEnabled(doc?: Document): boolean {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DOMAIN_ENABLED_STORAGE_KEY) : null;
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    const key = getDocDomainKey(doc);
    return Boolean(parsed?.[key]);
  } catch {
    return false;
  }
}

export function saveVideoSubtitleDomainEnabled(enabled: boolean, doc?: Document) {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(DOMAIN_ENABLED_STORAGE_KEY);
    const parsed: Record<string, boolean> = raw ? JSON.parse(raw) : {};
    const key = getDocDomainKey(doc);
    if (enabled) {
      parsed[key] = true;
    } else {
      delete parsed[key];
    }
    localStorage.setItem(DOMAIN_ENABLED_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore storage quota / sandboxed iframe errors */
  }
}

function fontFamilyCss(f: SubtitleTrackStyle["fontFamily"]): string {
  switch (f) {
    case "serif":
      return 'Georgia, "Noto Serif SC", "Songti SC", serif';
    case "monospace":
      return 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", monospace';
    case "sans-serif":
      return '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif';
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';
  }
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

/** Selectors for video player bottom control bars where the standalone bilingual subtitle toggle switch is mounted. */
export const PLAYER_CONTROL_BAR_SELECTORS = [
  ".html5-video-player .ytp-right-controls",
  ".ytp-chrome-controls .ytp-right-controls",
  ".bpx-player-control-bottom-right",
  ".squirtle-controller-wrap-right",
  ".vjs-control-bar",
  ".plyr__controls",
  ".jw-button-container",
];

/** Compact 20x20 Dual-CC SVG icon designed to match native YouTube / Bilibili control bar icon proportions. */
const SUBTITLE_BTN_ICON = `<svg class="pp-vsub-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect width="19" height="15" x="2.5" y="4.5" rx="2.5"/><path d="M6.5 10.2h5.5"/><path d="M14.5 10.2h3"/><path d="M6.5 14.2h3.5"/><path d="M12.5 14.2h5"/></svg>`;

const ICON_GEAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const ICON_SUB_TRACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4"/><path d="M15 15h2"/><path d="M7 11h2"/><path d="M13 11h4"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
const ICON_NEXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

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

/** Parse a timestamp string like "0:12", "05:32", or "1:02:15" into seconds. */
function parseTimestampString(ts: string): number {
  const parts = ts
    .trim()
    .split(":")
    .map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return NaN;
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

/** Fast URL heuristic for known video watch pages (YouTube, Bilibili, TED, Vimeo, Coursera/Udemy lectures). */
export function isVideoWatchUrl(url: string): boolean {
  if (!url) return false;
  if (getYoutubeVideoId(url)) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;
    if (/(^|\.)bilibili\.com$/.test(host) && /^\/(?:video\/(?:BV|av)|bangumi\/play\/)/i.test(path)) return true;
    if (/(^|\.)ted\.com$/.test(host) && /^\/talks\//i.test(path)) return true;
    if (/(^|\.)vimeo\.com$/.test(host) && /^\/\d+/.test(path)) return true;
    if (/(^|\.)coursera\.org$/.test(host) && /\/lecture\//i.test(path)) return true;
    if (/(^|\.)udemy\.com$/.test(host) && /\/learn\/lecture\//i.test(path)) return true;
    return false;
  } catch {
    return false;
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

  return normalizeAndMergeCues(rawCues);
}

const DANGLING_CLAUSE_END_RE =
  /([,،、]|\b(?:the|a|an|to|of|in|on|at|for|with|by|from|into|onto|upon|about|as|and|or|but|nor|so|yet|that|which|who|whom|whose|where|when|why|how|if|because|although|though|while|unless|until|since|whether|is|are|was|were|be|been|being|am|have|has|had|do|does|did|will|would|shall|should|can|could|may|might|must|over|under|between|through|during|before|after|without|within|against|among|around|behind|beyond|near|off|out|up|down|our|your|their|his|her|its|my|this|these|those|some|any|no|every|each|more|most|very|too|quite|rather))$/i;

const ABBREV_END_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.N|U\.K)\.$/i;

/**
 * Re-align mid-cue sentence boundaries when a raw caption cue splits right before or right after a sentence break
 * (e.g. `"...Leaderboard. Find it over on the"` + `"Too Long channel..."` -> `"...Leaderboard."` + `"Find it over on the Too Long channel..."`).
 */
function realignMidCueSentenceBoundaries(cues: SubtitleCue[]): SubtitleCue[] {
  const out = cues.map((c) => ({ ...c }));
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    const next = out[i + 1];
    const gap = next.start - cur.end;
    if (gap > 1.2) continue;

    // Case A (Tail Carry-Forward): `cur` has a completed sentence followed by a short trailing incomplete clause
    const tailMatch = cur.text.match(/^(.{12,}?[.!?。！？])\s+([^.!?。！？]{2,45})$/);
    if (tailMatch && !ABBREV_END_RE.test(tailMatch[1])) {
      const head = tailMatch[1].trim();
      const tail = tailMatch[2].trim();
      const totalChars = head.length + tail.length;
      const dur = Math.max(0.8, cur.end - cur.start);
      const splitTime = Number((cur.start + dur * Math.max(0.35, Math.min(0.85, head.length / totalChars))).toFixed(2));
      cur.text = head;
      cur.end = Math.max(cur.start + 0.6, splitTime);
      next.text = `${tail} ${next.text}`.replace(/\s+/g, " ").trim();
      next.start = Math.min(next.start, cur.end);
      continue;
    }

    // Case B (Head Pull-Backward): `cur` is an unfinished sentence and `next` starts with its short final phrase + period + a new sentence
    if (!/[.!?。！？…:;]$/.test(cur.text) && gap <= 1.0) {
      const headMatch = next.text.match(/^([^.!?。！？]{2,32}[.!?。！？])\s+(.{10,})$/);
      if (
        headMatch &&
        !ABBREV_END_RE.test(headMatch[1]) &&
        cur.text.length + 1 + headMatch[1].length <= 115
      ) {
        const lead = headMatch[1].trim();
        const rest = headMatch[2].trim();
        const totalChars = lead.length + rest.length;
        const nextDur = Math.max(0.8, next.end - next.start);
        const shiftTime = Number((next.start + nextDur * Math.min(0.6, Math.max(0.15, lead.length / totalChars))).toFixed(2));
        cur.text = `${cur.text} ${lead}`.replace(/\s+/g, " ").trim();
        cur.end = Math.max(cur.end, shiftTime);
        next.text = rest;
        next.start = Math.min(next.end - 0.5, shiftTime);
      }
    }
  }
  return out;
}

function normalizeAndMergeCues(rawCues: SubtitleCue[]): SubtitleCue[] {
  if (!rawCues.length) return [];
  const sorted = [...rawCues]
    .map((c) => ({ ...c, text: c.text.replace(/\s+/g, " ").trim() }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return [];

  // Pass 1: Deduplicate identical/rolling consecutive lines and clamp overlapping end times (common in YouTube ASR tracks)
  const deduped: SubtitleCue[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = { ...sorted[i] };
    const next = sorted[i + 1];
    if (next && cur.end > next.start && next.start > cur.start) {
      cur.end = next.start;
    }
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === cur.text && Math.abs(cur.start - prev.end) < 0.5) {
      prev.end = Math.max(prev.end, cur.end);
      continue;
    }
    if (
      prev &&
      cur.text.startsWith(prev.text) &&
      cur.text.length > prev.text.length &&
      cur.start - prev.end < 0.4 &&
      cur.end - prev.start <= 7
    ) {
      prev.text = cur.text;
      prev.end = Math.max(prev.end, cur.end);
      continue;
    }
    deduped.push(cur);
  }

  // Pass 2: Re-align mid-cue sentence breaks so each cue aligns with natural sentence boundaries
  const realigned = realignMidCueSentenceBoundaries(deduped);

  // Pass 3: Merge fragmented consecutive clauses that belong to the same sentence
  const merged: SubtitleCue[] = [];
  for (let i = 0; i < realigned.length; i++) {
    const cur = { ...realigned[i] };
    const prev = merged[merged.length - 1];
    if (prev && !/[.!?。！？…:;]$/.test(prev.text)) {
      const gap = cur.start - prev.end;
      const combinedLen = prev.text.length + 1 + cur.text.length;
      const combinedDur = cur.end - prev.start;
      const isShortFragment =
        prev.text.length < 38 && cur.text.length < 32 && gap <= 0.35 && prev.end - prev.start < 4.5;
      const hasDanglingSyntax =
        gap <= 0.85 &&
        combinedLen <= 96 &&
        combinedDur <= 7.5 &&
        (DANGLING_CLAUSE_END_RE.test(prev.text) || /^[a-z]/.test(cur.text));
      if (isShortFragment || hasDanglingSyntax) {
        prev.text = `${prev.text} ${cur.text}`.replace(/\s+/g, " ").trim();
        prev.end = cur.end;
        continue;
      }
    }
    merged.push(cur);
  }

  // Final pass: if merging created a cue with a trailing starter for the next cue, realign once more
  return realignMidCueSentenceBoundaries(merged);
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

/** Cache of fetched video cues keyed by video ID / URL so subtitle overlay, page summary, and Agent all share it. */
const videoCueCache = new Map<string, SubtitleCue[]>();
/** Live captions observed during playback (fallback when a video streams captions dynamically without a track URL). */
const liveObservedCueCache = new Map<string, SubtitleCue[]>();

function recordLiveCue(doc: Document, text: string, currentTime: number) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) return;
  const url = doc.location?.href ?? "";
  const ytId = getYoutubeVideoId(url);
  const key = ytId ? `yt:${ytId}` : `url:${url.split("#")[0]}`;
  let list = liveObservedCueCache.get(key);
  if (!list) {
    list = [];
    liveObservedCueCache.set(key, list);
  }
  const last = list[list.length - 1];
  if (last) {
    if (last.text === cleanText) {
      last.end = Math.max(last.end, currentTime + 2);
      return;
    }
    // Rolling ASR caption where the new text extends the previous partial line
    if (cleanText.startsWith(last.text) && currentTime - last.start < 6) {
      last.text = cleanText;
      last.end = Math.max(last.end, currentTime + 2);
      return;
    }
  }
  list.push({
    start: Math.max(0, currentTime),
    end: Math.max(0, currentTime) + 3,
    text: cleanText,
  });
}

/**
 * Look up the latest signed `/api/timedtext` URL (which includes YouTube's player `&pot=...` PO token)
 * from `performance.getEntriesByType("resource")`.
 */
function findSignedYoutubeTimedTextUrl(doc: Document, videoId: string): string | null {
  try {
    const perf = doc.defaultView?.performance ?? (typeof performance !== "undefined" ? performance : undefined);
    if (!perf || typeof perf.getEntriesByType !== "function") return null;
    const entries = perf.getEntriesByType("resource") as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i]?.name ?? "";
      if (!name.includes("/api/timedtext")) continue;
      if (name.includes(`v=${videoId}`) || name.includes(`v%3D${videoId}`)) {
        return name;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function fetchTimedTextFromUrl(baseUrl: string): Promise<SubtitleCue[]> {
  if (!baseUrl || typeof fetch !== "function") return [];
  try {
    // Strip any auto-translation tlang param so we get the clean original track
    const cleanUrl = baseUrl.replace(/([?&])tlang=[^&]+&?/g, "$1").replace(/[?&]$/, "");
    const json3Url = cleanUrl.includes("fmt=")
      ? cleanUrl.replace(/fmt=[^&]+/, "fmt=json3")
      : `${cleanUrl}${cleanUrl.includes("?") ? "&" : "?"}fmt=json3`;
    let raw = await fetch(json3Url, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
    let cues = parseYoutubeTimedText(raw);
    if (!cues.length) {
      raw = await fetch(cleanUrl, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
      cues = parseYoutubeTimedText(raw);
    }
    return cues;
  } catch {
    return [];
  }
}

/** Read segments from YouTube's native Transcript Engagement Panel DOM (`ytd-transcript-segment-renderer`). */
function readYoutubeDomTranscriptSegments(doc: Document): SubtitleCue[] {
  const els = Array.from(doc.querySelectorAll("ytd-transcript-segment-renderer"));
  if (!els.length) return [];
  const cues: SubtitleCue[] = [];
  for (const el of els) {
    const tsText = (el.querySelector(".segment-timestamp")?.textContent ?? "").trim();
    const bodyText = (el.querySelector(".segment-text")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!bodyText) continue;
    const start = parseTimestampString(tsText);
    if (!Number.isFinite(start)) continue;
    cues.push({ start, end: start + 4, text: bodyText });
  }
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i + 1].start > cues[i].start) {
      cues[i].end = cues[i + 1].start;
    }
  }
  return normalizeAndMergeCues(cues);
}

/**
 * Fallback for YouTube when `/api/timedtext` requires a player-generated `pot` token or DOM transcript:
 * 1. Briefly toggles `.ytp-subtitles-button` so YouTube's player issues a signed `/api/timedtext?...&pot=...` request,
 *    then captures that URL from `performance.getEntriesByType("resource")`.
 * 2. Or opens YouTube's native Transcript Engagement Panel ("Show transcript") invisibly and reads `ytd-transcript-segment-renderer`.
 */
async function fetchYoutubeCuesViaPlayerOrTranscriptPanel(doc: Document, videoId: string): Promise<SubtitleCue[]> {
  // 1) Check if transcript engagement panel already has segments rendered in DOM
  const existingDomCues = readYoutubeDomTranscriptSegments(doc);
  if (existingDomCues.length > 0) return existingDomCues;

  // 2) Trigger YouTube's native CC button to make the player request a signed /api/timedtext URL with `pot`
  const ytCcBtn = doc.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (ytCcBtn && ytCcBtn.getAttribute("aria-disabled") !== "true") {
    const wasPressed = ytCcBtn.getAttribute("aria-pressed") === "true";
    const subOverlayActive = doc.documentElement.classList.contains("pp-yt-sub-active");
    try {
      if (!subOverlayActive) {
        doc.documentElement.classList.add("pp-yt-sub-active");
      }
      if (!wasPressed) {
        ytCcBtn.click();
      } else {
        // Toggle off & back on to force a fresh resource request if performance buffer didn't have it
        ytCcBtn.click();
        await new Promise((r) => setTimeout(r, 50));
        ytCcBtn.click();
      }
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 85));
        const signedUrl = findSignedYoutubeTimedTextUrl(doc, videoId);
        if (signedUrl) {
          const cues = await fetchTimedTextFromUrl(signedUrl);
          if (cues.length > 0) {
            if (!wasPressed && !subOverlayActive && ytCcBtn.getAttribute("aria-pressed") === "true") {
              ytCcBtn.click();
            }
            if (!subOverlayActive) {
              doc.documentElement.classList.remove("pp-yt-sub-active");
            }
            return cues;
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      if (!wasPressed && !subOverlayActive && ytCcBtn.getAttribute("aria-pressed") === "true") {
        try {
          ytCcBtn.click();
        } catch {
          /* ignore */
        }
      }
      if (!subOverlayActive) {
        doc.documentElement.classList.remove("pp-yt-sub-active");
      }
    }
  }

  // 3) Trigger YouTube's built-in "Show transcript" button and read `ytd-transcript-segment-renderer` from DOM
  const transcriptBtn = doc.querySelector<HTMLElement>(
    "ytd-video-description-transcript-section-renderer button, button[aria-label*='transcript' i], button[aria-label*='\u8f6c\u5f55'], button[aria-label*='\u6587\u5b57\u7a3f']",
  );
  if (transcriptBtn) {
    const panel = doc.querySelector<HTMLElement>(
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    );
    const prevOpacity = panel?.style.opacity ?? "";
    const prevPointer = panel?.style.pointerEvents ?? "";
    try {
      if (panel) {
        panel.style.opacity = "0";
        panel.style.pointerEvents = "none";
      }
      transcriptBtn.click();
      for (let i = 0; i < 18; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const segs = readYoutubeDomTranscriptSegments(doc);
        if (segs.length > 0) {
          return segs;
        }
      }
    } catch {
      /* ignore */
    } finally {
      if (panel) {
        panel.style.opacity = prevOpacity;
        panel.style.pointerEvents = prevPointer;
        const closeBtn = panel.querySelector<HTMLElement>(
          "#visibility-button button, button[aria-label*='Close' i], button[aria-label*='\u5173\u95ed']",
        );
        try {
          closeBtn?.click();
        } catch {
          /* ignore */
        }
      }
    }
  }

  return [];
}

/** Fetch YouTube cues for the current document (multi-stage: signed resource URL -> captionTracks -> player CC trigger -> transcript panel). */
export async function fetchYoutubeCuesForDocument(doc: Document = document, targetLang = "zh-CN"): Promise<SubtitleCue[]> {
  const url = doc.location?.href ?? "";
  const videoId = getYoutubeVideoId(url);
  if (!videoId) return [];
  const cacheKey = `yt:${videoId}`;
  const cached = videoCueCache.get(cacheKey);
  if (cached?.length) return cached;

  // Stage 1: If the player already requested a signed `/api/timedtext` URL (with `&pot=...`), use it first
  const existingSignedUrl = findSignedYoutubeTimedTextUrl(doc, videoId);
  if (existingSignedUrl) {
    const signedCues = await fetchTimedTextFromUrl(existingSignedUrl);
    if (signedCues.length > 0) {
      videoCueCache.set(cacheKey, signedCues);
      return signedCues;
    }
  }

  // Stage 2: Extract `captionTracks` from inline <script> or fresh watch HTML
  let tracks: YoutubeCaptionTrack[] = [];
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (text.includes('"captionTracks"')) {
      tracks = extractYoutubeCaptionTracksFromHtml(text, videoId);
      if (tracks.length) break;
    }
  }

  if (!tracks.length && typeof fetch === "function" && /^https?:/i.test(url)) {
    try {
      const html = await fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.text() : ""));
      tracks = extractYoutubeCaptionTracksFromHtml(html, videoId);
    } catch {
      /* ignore network failure */
    }
  }

  const chosen = pickBestCaptionTrack(tracks, targetLang);
  if (chosen?.baseUrl) {
    const cues = await fetchTimedTextFromUrl(chosen.baseUrl);
    if (cues.length > 0) {
      videoCueCache.set(cacheKey, cues);
      return cues;
    }
  }

  // Stage 3: Trigger player signed TimedText request (with PO token) or read YouTube Transcript Engagement Panel
  const fallbackCues = await fetchYoutubeCuesViaPlayerOrTranscriptPanel(doc, videoId);
  if (fallbackCues.length > 0) {
    videoCueCache.set(cacheKey, fallbackCues);
    return fallbackCues;
  }

  return [];
}

/**
 * Check whether the current document is a video page with available subtitles/captions
 * (used to surface the "Summarize video" quick action in the Sidebar New Chat home view).
 */
export function hasVideoSubtitlesAvailable(doc: Document = document): boolean {
  const url = doc.location?.href ?? "";
  const ytId = getYoutubeVideoId(url);
  if (ytId) {
    if (videoCueCache.get(`yt:${ytId}`)?.length || liveObservedCueCache.get(`yt:${ytId}`)?.length) return true;
    const ytCcBtn = doc.querySelector<HTMLElement>(".ytp-subtitles-button");
    if (ytCcBtn && ytCcBtn.getAttribute("aria-disabled") !== "true") return true;
    if (doc.querySelector("ytd-transcript-segment-renderer, ytd-video-description-transcript-section-renderer")) return true;
    for (const s of Array.from(doc.querySelectorAll("script"))) {
      if ((s.textContent ?? "").includes('"captionTracks"')) return true;
    }
    if (!ytCcBtn && doc.querySelector("video")) return true;
  }

  const videos = Array.from(doc.querySelectorAll("video"));
  if (!videos.length && !isVideoWatchUrl(url)) return false;

  if (extractHtml5TextTrackCues(doc).length > 0) return true;
  for (const v of videos) {
    if ((v.textTracks?.length ?? 0) > 0 || v.querySelector("track")) return true;
  }
  if (
    doc.querySelector(
      ".bpx-player-ctrl-subtitle, .bpx-player-subtitle-wrap, .squirtle-subtitle-wrap, .vjs-subs-caps-button, .jw-icon-cc, .plyr__captions, [data-purpose='captions-cue-text']",
    ) ||
    doc.querySelector(LIVE_CAPTION_SELECTORS)
  ) {
    return true;
  }
  const liveKey = ytId ? `yt:${ytId}` : `url:${url.split("#")[0]}`;
  if (liveObservedCueCache.get(liveKey)?.length) return true;
  return isVideoWatchUrl(url) && videos.length > 0;
}

/**
 * Extract a timestamped Markdown transcript for the current video (YouTube, Bilibili, or HTML5 `<video>` with `<track>`),
 * used when the user clicks "Summarize Page", chats in the Sidebar, or runs the Browser-Use Agent.
 */
export async function extractVideoTranscriptMarkdown(doc: Document = document): Promise<string | null> {
  const url = doc.location?.href ?? "";
  const ytId = getYoutubeVideoId(url);
  let cues = await fetchYoutubeCuesForDocument(doc);
  if (!cues.length) {
    cues = readYoutubeDomTranscriptSegments(doc);
  }
  if (!cues.length) {
    cues = extractHtml5TextTrackCues(doc);
  }
  if (!cues.length) {
    const liveKey = ytId ? `yt:${ytId}` : `url:${url.split("#")[0]}`;
    const observed = liveObservedCueCache.get(liveKey);
    if (observed && observed.length > 0) {
      cues = observed;
    }
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

  const titleEl = doc.querySelector("ytd-watch-metadata h1, #title h1, .video-title, h1");
  const titleText = (titleEl?.textContent ?? "").replace(/\s+/g, " ").trim();
  const descEl = doc.querySelector("#description-inline-expander, #description, [itemprop='description'], .video-desc-container");
  const desc = (descEl?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
  const titleHeader = titleText ? `# ${titleText}\n\n` : "";
  const descHeader = desc ? `## Video Description\n\n${desc}\n\n` : "";
  return `${titleHeader}${descHeader}## Video Transcript\n\n${blocks.join("\n\n")}`;
}

/** CSS injected for the bilingual video subtitle overlay, compact control bar icon, and 2-page Subtitle Settings popover. */
export const VIDEO_SUBTITLE_CSS = `
html.pp-yt-sub-active .ytp-caption-window-container {
  opacity: 0 !important;
  pointer-events: none !important;
}
#pp-video-sub-btn {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  vertical-align: top !important;
  height: 100% !important;
  width: 42px !important;
  min-width: 42px !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  background: transparent !important;
  color: rgba(255, 255, 255, 0.9) !important;
  cursor: pointer !important;
  position: relative !important;
  box-sizing: border-box !important;
  user-select: none !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  outline: none !important;
  z-index: 20 !important;
  opacity: 0.92;
  transition: opacity 0.15s ease, transform 0.15s ease !important;
}
#pp-video-sub-btn:hover {
  opacity: 1 !important;
  color: #ffffff !important;
}
#pp-video-sub-btn .pp-vsub-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  transition: background 0.15s ease;
}
#pp-video-sub-btn:hover .pp-vsub-icon-wrap {
  background: rgba(255, 255, 255, 0.12);
}
#pp-video-sub-btn .pp-vsub-icon-svg {
  width: 20px !important;
  height: 20px !important;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
}
#pp-video-sub-btn[aria-pressed="true"] {
  color: #ffffff !important;
  opacity: 1 !important;
}
#pp-video-sub-btn[aria-pressed="true"]::after {
  content: "";
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 7px;
  width: 14px;
  height: 2.5px;
  border-radius: 2px;
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.65);
}
#pp-video-sub-btn.pp-vsub-toggle-floating {
  position: absolute !important;
  right: 14px !important;
  bottom: 14px !important;
  width: 34px !important;
  min-width: 34px !important;
  height: 34px !important;
  border-radius: 8px !important;
  background: rgba(20, 20, 23, 0.78) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  backdrop-filter: blur(6px) !important;
  z-index: 2147483641 !important;
}
#pp-video-sub-btn.pp-vsub-toggle-floating[aria-pressed="true"]::after {
  bottom: 3px;
}
#pp-video-sub-overlay {
  position: absolute;
  left: 50%;
  bottom: 8.5%;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(90%, 820px);
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
  gap: 2px;
  max-width: 100%;
  padding: 4px 11px 5px;
  border-radius: 7px;
  background: rgba(12, 15, 22, 0.75);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.32);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.38;
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  touch-action: none;
  outline: 1.5px dashed transparent;
  transition: outline-color 0.14s ease, box-shadow 0.14s ease;
}
.pp-vsub-box:hover {
  outline-color: rgba(255, 255, 255, 0.28);
}
#pp-video-sub-overlay[data-dragging] .pp-vsub-box {
  cursor: grabbing !important;
  outline-color: rgba(74, 222, 128, 0.75);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55) !important;
}
.pp-vsub-orig {
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  font-weight: 400;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
html.pp-only .pp-vsub-orig {
  display: none !important;
}
.pp-vsub-trans {
  color: #4ade80;
  font-size: 15px;
  font-weight: 500;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}
.pp-vsub-box[data-style="plain"] .pp-vsub-trans {
  color: #ffffff;
}
.pp-vsub-box[data-style="highlight"] .pp-vsub-trans {
  color: #fde047;
}

/* In-player Subtitle Settings & Style Popover (matches mature dual-subtitle extensions) */
#pp-video-sub-menu {
  position: absolute;
  right: 12px;
  bottom: 58px;
  width: 288px;
  max-width: calc(100% - 24px);
  border-radius: 14px;
  background: rgba(22, 22, 25, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
  color: #f4f4f5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  z-index: 2147483645;
  pointer-events: auto;
  user-select: none;
  overflow: hidden;
  text-align: left;
  animation: pp-vsub-pop 0.14s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes pp-vsub-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.pp-vsm-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  font-size: 13.5px;
  font-weight: 600;
  color: #ffffff;
}
.pp-vsm-hd-title {
  flex: 1;
}
.pp-vsm-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.78);
  cursor: pointer;
  padding: 0;
  transition: background 0.14s, color 0.14s;
}
.pp-vsm-icon-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}
.pp-vsm-icon-btn svg {
  width: 15px;
  height: 15px;
}
.pp-vsm-switch {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.22);
  cursor: pointer;
  padding: 0;
  transition: background 0.18s ease;
}
.pp-vsm-switch[aria-checked="true"] {
  background: #4ade80;
}
.pp-vsm-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.pp-vsm-switch[aria-checked="true"]::after {
  transform: translateX(16px);
}
.pp-vsm-body {
  padding: 10px 14px 12px;
  max-height: 310px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pp-vsm-body::-webkit-scrollbar {
  width: 4px;
}
.pp-vsm-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}
.pp-vsm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  color: rgba(255, 255, 255, 0.92);
}
.pp-vsm-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 4px 8px;
  margin: 0 -8px;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  border: none;
  background: transparent;
  font: inherit;
  width: calc(100% + 16px);
  transition: background 0.14s;
}
.pp-vsm-nav-row:hover {
  background: rgba(255, 255, 255, 0.08);
}
.pp-vsm-nav-row svg {
  width: 15px;
  height: 15px;
  color: rgba(255, 255, 255, 0.55);
}
.pp-vsm-select {
  appearance: none;
  -webkit-appearance: none;
  height: 30px;
  padding: 0 26px 0 11px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 8px center;
  color: #ffffff;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  outline: none;
}
.pp-vsm-select:hover {
  border-color: rgba(255, 255, 255, 0.32);
  background-color: rgba(255, 255, 255, 0.1);
}
.pp-vsm-select option {
  background: #18181b;
  color: #ffffff;
}
.pp-vsm-sec-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  margin-top: 2px;
}
.pp-vsm-sec-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pp-vsm-sec-title svg {
  width: 14px;
  height: 14px;
  opacity: 0.85;
}
.pp-vsm-card {
  border-radius: 11px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  background: rgba(255, 255, 255, 0.03);
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.pp-vsm-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin: 1px -9px;
}
.pp-vsm-slider-pill {
  position: relative;
  height: 34px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.09);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 11px;
  font-size: 12.5px;
}
.pp-vsm-slider-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.12);
  pointer-events: none;
  border-right: 2px solid rgba(255, 255, 255, 0.45);
}
.pp-vsm-slider-label,
.pp-vsm-slider-val {
  position: relative;
  z-index: 1;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.88);
}
.pp-vsm-slider-val {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.pp-vsm-slider-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: ew-resize;
  margin: 0;
  z-index: 2;
}
.pp-vsm-colors {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pp-vsm-color-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  cursor: pointer;
  padding: 0;
  transition: transform 0.12s, border-color 0.12s;
}
.pp-vsm-color-dot:hover,
.pp-vsm-color-dot[data-selected] {
  transform: scale(1.14);
  border-color: #ffffff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}
.pp-vsm-color-picker-wrap {
  position: relative;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.35);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
}
.pp-vsm-color-picker-wrap input[type="color"] {
  position: absolute;
  inset: -6px;
  width: 36px;
  height: 36px;
  border: none;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
`;

export interface VideoSubtitleControllerDeps {
  doc?: Document;
  translateBatch: (texts: string[], contextBefore?: string[]) => Promise<string[]>;
  onStatsChange?: (delta: { total?: number; done?: number; errors?: number }) => void;
  onActiveChange?: (active: boolean) => void;
}

const COLOR_PRESETS = ["#ffffff", "#4ade80", "#fde047", "#38bdf8"];

/**
 * Manages bilingual video subtitles on the page:
 * - Mounts a compact Dual-CC button (`#pp-video-sub-btn`) inside the player's bottom control bar
 * - Provides a 2-level Subtitle Settings & Style customization popover (`#pp-video-sub-menu`)
 * - Runs Engine 1 (Track Pre-fetch + Lookahead Batch Translation + `timeupdate` sync) when cues are available
 * - Automatically falls back to Engine 2 (Live DOM Caption MutationObserver) for other video sites
 */
export class VideoSubtitleController {
  private readonly doc: Document;
  private active = false;
  private controlBarEnabled = false;
  private cfg: Settings["translation"] | null = null;
  private styleCfg: VideoSubtitleStyleConfig;
  private cues: SubtitleCue[] = [];
  private translatingIdx = new Set<number>();
  private liveCache = new Map<string, string>();
  private livePending = new Set<string>();
  private recentLiveTexts: string[] = [];
  private lastLiveTranslation = "";
  private currentVideoUrl = "";
  private videoEl: HTMLVideoElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private toggleBtnEl: HTMLButtonElement | null = null;
  private menuEl: HTMLElement | null = null;
  private menuPage: "main" | "style" = "main";
  private menuHideTimer: number | undefined;
  private liveMo: MutationObserver | null = null;
  private controlMo: MutationObserver | null = null;
  private pollTimer: number | undefined;
  private controlPollTimer: number | undefined;
  private liveDebounceTimer: number | undefined;
  private noticeTimer: number | undefined;
  private noticeText = "";
  private lastRenderedKey = "";
  private lastOrigText = "";
  private lastTransText = "";

  constructor(private readonly deps: VideoSubtitleControllerDeps) {
    this.doc = deps.doc ?? document;
    this.styleCfg = loadVideoSubtitleStyle();
  }

  isActive(): boolean {
    return this.active;
  }

  getStyleConfig(): VideoSubtitleStyleConfig {
    return this.styleCfg;
  }

  updateStyleConfig(patch: Partial<VideoSubtitleStyleConfig> | ((prev: VideoSubtitleStyleConfig) => VideoSubtitleStyleConfig)) {
    this.styleCfg = typeof patch === "function" ? patch(this.styleCfg) : { ...this.styleCfg, ...patch };
    saveVideoSubtitleStyle(this.styleCfg);
    this.lastRenderedKey = "";
    if (this.active) {
      this.renderCurrentState();
    } else if (this.menuEl?.isConnected) {
      this.renderPreviewIfIdle();
    }
  }

  /**
   * Enable or disable the standalone in-player bottom control bar switch (`#pp-video-sub-btn`).
   * Can be called on initial page load even when full-page translation is not active.
   */
  setControlBarEnabled(enabled: boolean, cfg?: Settings["translation"]) {
    if (cfg) this.cfg = cfg;
    this.controlBarEnabled = enabled;
    if (!enabled) {
      this.controlMo?.disconnect();
      this.controlMo = null;
      clearInterval(this.controlPollTimer);
      this.controlPollTimer = undefined;
      this.closeSettingsMenu();
      this.toggleBtnEl?.remove();
      this.toggleBtnEl = null;
      return;
    }
    this.ensurePlayerButton();
    if (!this.active && loadVideoSubtitleDomainEnabled(this.doc)) {
      this.start(this.cfg ?? defaultSettings().translation);
    }
    if (!this.controlMo && this.doc.body) {
      const MO = this.doc.defaultView?.MutationObserver ?? MutationObserver;
      if (MO) {
        this.controlMo = new MO(() => {
          if (!this.controlBarEnabled) return;
          if (!this.toggleBtnEl || !this.toggleBtnEl.isConnected) {
            this.ensurePlayerButton();
          }
        });
        this.controlMo.observe(this.doc.body, { childList: true, subtree: true });
      }
    }
    if (!this.controlPollTimer) {
      this.controlPollTimer = window.setInterval(() => {
        if (!this.controlBarEnabled) return;
        this.ensurePlayerButton();
      }, 1000);
    }
  }

  /** Toggle video bilingual subtitles on/off independently of full-page translation (persisted per domain). */
  toggle(force?: boolean): boolean {
    const want = force ?? !this.active;
    saveVideoSubtitleDomainEnabled(want, this.doc);
    if (want) {
      this.start(this.cfg ?? defaultSettings().translation, { showNotice: true });
    } else {
      this.stop();
    }
    return this.active;
  }

  start(cfg?: Settings["translation"], opts?: { showNotice?: boolean }) {
    if (cfg) this.cfg = cfg;
    else if (!this.cfg) this.cfg = defaultSettings().translation;
    if (this.active) {
      this.setControlBarEnabled(true, this.cfg);
      this.syncToggleButtonState();
      this.renderCurrentState();
      return;
    }
    this.active = true;
    this.setControlBarEnabled(true, this.cfg);
    this.currentVideoUrl = "";
    this.cues = [];
    this.translatingIdx.clear();
    this.lastLiveTranslation = "";
    this.syncToggleButtonState();
    this.deps.onActiveChange?.(true);
    if (opts?.showNotice) {
      this.showTransientNotice(tr("page.videoSubLoading"), 2400);
    }
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
    this.syncToggleButtonState();
    if (this.active) this.renderCurrentState();
  }

  stop() {
    const wasActive = this.active;
    this.active = false;
    clearInterval(this.pollTimer);
    clearTimeout(this.liveDebounceTimer);
    clearTimeout(this.noticeTimer);
    this.pollTimer = undefined;
    this.liveDebounceTimer = undefined;
    this.noticeTimer = undefined;
    this.noticeText = "";
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
    this.lastLiveTranslation = "";
    this.lastRenderedKey = "";
    this.lastOrigText = "";
    this.lastTransText = "";
    this.doc.documentElement.classList.remove("pp-yt-sub-active");
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.syncToggleButtonState();
    if (wasActive) {
      this.deps.onActiveChange?.(false);
    }
  }

  private showTransientNotice(msg: string, durationMs = 2400) {
    clearTimeout(this.noticeTimer);
    this.noticeText = msg;
    this.renderOverlay("", msg);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeText = "";
      if (this.active) this.renderCurrentState();
    }, durationMs);
  }

  private clearTransientNotice() {
    if (!this.noticeText) return;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.noticeText = "";
  }

  /** Find the player's bottom control bar or fallback player container and mount `#pp-video-sub-btn`. */
  public ensurePlayerButton(): HTMLButtonElement | null {
    if (!this.controlBarEnabled) return null;
    let targetBar: HTMLElement | null = null;
    let isFloating = false;
    for (const sel of PLAYER_CONTROL_BAR_SELECTORS) {
      const found = this.doc.querySelector<HTMLElement>(sel);
      if (found) {
        targetBar = found;
        break;
      }
    }
    if (!targetBar) {
      const video = this.videoEl ?? this.findPrimaryVideo();
      const container = this.findPlayerContainer(video);
      if (container && video) {
        targetBar = container;
        isFloating = true;
      }
    }
    if (!targetBar) return null;

    if (isFloating) {
      const cs = this.doc.defaultView?.getComputedStyle(targetBar);
      if (cs?.position === "static") {
        targetBar.style.position = "relative";
      }
    }

    if (!this.toggleBtnEl || !this.toggleBtnEl.isConnected || this.toggleBtnEl.parentElement !== targetBar) {
      this.toggleBtnEl?.remove();
      const btn = this.doc.createElement("button");
      btn.id = "pp-video-sub-btn";
      btn.type = "button";
      btn.setAttribute("data-pp-ui", "");
      btn.setAttribute("data-testid", "pp-video-sub-btn");
      btn.className = isFloating
        ? "pp-vsub-toggle-btn pp-vsub-toggle-floating"
        : targetBar.classList.contains("ytp-right-controls")
          ? "ytp-button pp-vsub-toggle-btn"
          : "pp-vsub-toggle-btn";
      btn.innerHTML = `<span class="pp-vsub-icon-wrap">${SUBTITLE_BTN_ICON}</span>`;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openSettingsMenu("main");
      });
      btn.addEventListener("mouseenter", () => {
        clearTimeout(this.menuHideTimer);
        this.openSettingsMenu(this.menuPage);
      });
      btn.addEventListener("mouseleave", () => {
        this.scheduleCloseSettingsMenu();
      });
      if (!isFloating && targetBar.firstChild) {
        targetBar.insertBefore(btn, targetBar.firstChild);
      } else {
        targetBar.appendChild(btn);
      }
      this.toggleBtnEl = btn;
    } else {
      this.toggleBtnEl.classList.toggle("pp-vsub-toggle-floating", isFloating);
    }

    this.syncToggleButtonState();
    return this.toggleBtnEl;
  }

  private scheduleCloseSettingsMenu(delay = 280) {
    clearTimeout(this.menuHideTimer);
    this.menuHideTimer = window.setTimeout(() => {
      this.closeSettingsMenu();
    }, delay);
  }

  public closeSettingsMenu() {
    clearTimeout(this.menuHideTimer);
    this.menuEl?.remove();
    this.menuEl = null;
    this.menuPage = "main";
    if (!this.active) {
      this.overlayEl?.remove();
      this.overlayEl = null;
    }
  }

  /** Open the 2-level Subtitle Settings (`字幕设置` / `字幕样式`) popover inside the video player container. */
  public openSettingsMenu(page: "main" | "style" = "main"): HTMLElement | null {
    clearTimeout(this.menuHideTimer);
    this.menuPage = page;
    const video = this.videoEl ?? this.findPrimaryVideo();
    const container = this.findPlayerContainer(video);
    if (!container) return null;
    const cs = this.doc.defaultView?.getComputedStyle(container);
    if (cs?.position === "static") {
      container.style.position = "relative";
    }
    if (!this.menuEl || !this.menuEl.isConnected || this.menuEl.parentElement !== container) {
      this.menuEl?.remove();
      const menu = this.doc.createElement("div");
      menu.id = "pp-video-sub-menu";
      menu.setAttribute("data-pp-ui", "");
      menu.setAttribute("data-testid", "pp-video-sub-menu");
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.addEventListener("mousedown", (e) => e.stopPropagation());
      menu.addEventListener("mouseenter", () => clearTimeout(this.menuHideTimer));
      menu.addEventListener("mouseleave", () => this.scheduleCloseSettingsMenu(320));
      container.appendChild(menu);
      this.menuEl = menu;
    }
    this.renderSettingsMenuContent();
    if (page === "style") {
      this.renderPreviewIfIdle();
    }
    return this.menuEl;
  }

  private renderPreviewIfIdle() {
    if (this.lastOrigText || this.lastTransText) {
      this.lastRenderedKey = "";
      this.renderOverlay(this.lastOrigText, this.lastTransText);
      return;
    }
    this.lastRenderedKey = "";
    this.renderOverlay("The quick brown fox jumps over the lazy dog.", tr("opt.stylePreview"));
  }

  private renderSettingsMenuContent() {
    const menu = this.menuEl;
    if (!menu) return;
    const s = this.styleCfg;

    if (this.menuPage === "main") {
      menu.innerHTML = `
        <div class="pp-vsm-hd">
          <span class="pp-vsm-hd-title">${tr("page.vsubSettingsTitle")}</span>
          <button type="button" class="pp-vsm-switch" data-testid="pp-vsm-master-switch" role="switch" aria-checked="${this.active ? "true" : "false"}" title="${this.active ? tr("page.videoSubTitleOn") : tr("page.videoSubTitleOff")}"></button>
        </div>
        <div class="pp-vsm-body">
          <div class="pp-vsm-row">
            <span>${tr("page.vsubDisplayType")}</span>
            <select class="pp-vsm-select" data-testid="pp-vsm-display-type">
              <option value="bilingual" ${s.displayType === "bilingual" ? "selected" : ""}>${tr("page.vsubTypeBilingual")}</option>
              <option value="translation-only" ${s.displayType === "translation-only" ? "selected" : ""}>${tr("page.vsubTypeTransOnly")}</option>
              <option value="original-only" ${s.displayType === "original-only" ? "selected" : ""}>${tr("page.vsubTypeOrigOnly")}</option>
            </select>
          </div>
          <div class="pp-vsm-row">
            <span>${tr("page.vsubTransPos")}</span>
            <select class="pp-vsm-select" data-testid="pp-vsm-trans-pos">
              <option value="above" ${s.translationPosition === "above" ? "selected" : ""}>${tr("page.vsubPosAbove")}</option>
              <option value="below" ${s.translationPosition === "below" ? "selected" : ""}>${tr("page.vsubPosBelow")}</option>
            </select>
          </div>
          <button type="button" class="pp-vsm-nav-row" data-testid="pp-vsm-open-style">
            <span>${tr("page.vsubStyleEntry")}</span>
            ${ICON_NEXT}
          </button>
        </div>
      `;

      menu.querySelector('[data-testid="pp-vsm-master-switch"]')?.addEventListener("click", () => {
        this.toggle();
      });
      menu.querySelector<HTMLSelectElement>('[data-testid="pp-vsm-display-type"]')?.addEventListener("change", (e) => {
        const val = (e.target as HTMLSelectElement).value as VideoSubtitleStyleConfig["displayType"];
        this.updateStyleConfig({ displayType: val });
      });
      menu.querySelector<HTMLSelectElement>('[data-testid="pp-vsm-trans-pos"]')?.addEventListener("change", (e) => {
        const val = (e.target as HTMLSelectElement).value as VideoSubtitleStyleConfig["translationPosition"];
        this.updateStyleConfig({ translationPosition: val });
      });
      menu.querySelector('[data-testid="pp-vsm-open-style"]')?.addEventListener("click", () => {
        this.openSettingsMenu("style");
      });
      return;
    }

    const buildTrackSection = (kind: "primary" | "secondary", title: string, track: SubtitleTrackStyle) => {
      const sizePct = ((track.fontSize - 50) / 100) * 100;
      const weightPct = ((track.fontWeight - 300) / 400) * 100;
      const dots = COLOR_PRESETS.map(
        (c) =>
          `<button type="button" class="pp-vsm-color-dot" data-kind="${kind}" data-color="${c}" style="background:${c}" ${track.color.toLowerCase() === c ? "data-selected" : ""}></button>`,
      ).join("");
      return `
        <div class="pp-vsm-sec-hd">
          <span class="pp-vsm-sec-title">${ICON_SUB_TRACK}<span>${title}</span></span>
          <button type="button" class="pp-vsm-icon-btn" data-reset="${kind}" title="${tr("page.vsubReset")}">${ICON_RESET}</button>
        </div>
        <div class="pp-vsm-card">
          <div class="pp-vsm-slider-pill">
            <div class="pp-vsm-slider-fill" data-fill="${kind}-size" style="width:${sizePct}%"></div>
            <span class="pp-vsm-slider-label">${tr("page.vsubFontSize")}</span>
            <span class="pp-vsm-slider-val" data-val="${kind}-size">${track.fontSize}%</span>
            <input type="range" class="pp-vsm-slider-input" data-testid="pp-vsm-${kind}-size" data-slider="${kind}-size" min="50" max="150" step="5" value="${track.fontSize}" />
          </div>
          <div class="pp-vsm-divider"></div>
          <div class="pp-vsm-row">
            <span>${tr("page.vsubColor")}</span>
            <div class="pp-vsm-colors">
              ${dots}
              <label class="pp-vsm-color-picker-wrap" style="background:${track.color}">
                <input type="color" data-color-input="${kind}" value="${track.color}" />
              </label>
            </div>
          </div>
          <div class="pp-vsm-divider"></div>
          <div class="pp-vsm-row">
            <span>${tr("page.vsubFontFamily")}</span>
            <select class="pp-vsm-select" data-font="${kind}">
              <option value="system" ${track.fontFamily === "system" ? "selected" : ""}>system</option>
              <option value="sans-serif" ${track.fontFamily === "sans-serif" ? "selected" : ""}>sans-serif</option>
              <option value="serif" ${track.fontFamily === "serif" ? "selected" : ""}>serif</option>
              <option value="monospace" ${track.fontFamily === "monospace" ? "selected" : ""}>monospace</option>
            </select>
          </div>
          <div class="pp-vsm-divider"></div>
          <div class="pp-vsm-slider-pill">
            <div class="pp-vsm-slider-fill" data-fill="${kind}-weight" style="width:${weightPct}%"></div>
            <span class="pp-vsm-slider-label">${tr("page.vsubFontWeight")}</span>
            <span class="pp-vsm-slider-val" data-val="${kind}-weight">${track.fontWeight}</span>
            <input type="range" class="pp-vsm-slider-input" data-slider="${kind}-weight" min="300" max="700" step="100" value="${track.fontWeight}" />
          </div>
        </div>
      `;
    };

    menu.innerHTML = `
      <div class="pp-vsm-hd">
        <button type="button" class="pp-vsm-icon-btn" data-testid="pp-vsm-back">${ICON_BACK}</button>
        <span class="pp-vsm-hd-title">${tr("page.vsubStyleEntry")}</span>
      </div>
      <div class="pp-vsm-body">
        <div class="pp-vsm-sec-hd">
          <span class="pp-vsm-sec-title">${ICON_GEAR}<span>${tr("page.vsubGeneral")}</span></span>
          <button type="button" class="pp-vsm-icon-btn" data-reset="general" title="${tr("page.vsubReset")}">${ICON_RESET}</button>
        </div>
        <div class="pp-vsm-card">
          <div class="pp-vsm-slider-pill">
            <div class="pp-vsm-slider-fill" data-fill="bg-opacity" style="width:${s.backgroundOpacity}%"></div>
            <span class="pp-vsm-slider-label">${tr("page.vsubBgOpacity")}</span>
            <span class="pp-vsm-slider-val" data-val="bg-opacity">${s.backgroundOpacity}%</span>
            <input type="range" class="pp-vsm-slider-input" data-testid="pp-vsm-bg-opacity" data-slider="bg-opacity" min="0" max="100" step="5" value="${s.backgroundOpacity}" />
          </div>
        </div>
        ${buildTrackSection("primary", tr("page.vsubPrimary"), s.primary)}
        ${buildTrackSection("secondary", tr("page.vsubSecondary"), s.secondary)}
      </div>
    `;

    menu.querySelector('[data-testid="pp-vsm-back"]')?.addEventListener("click", () => {
      this.openSettingsMenu("main");
    });

    // Reset handlers
    menu.querySelectorAll<HTMLElement>("[data-reset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.getAttribute("data-reset");
        const def = defaultVideoSubtitleStyle();
        if (kind === "general") {
          this.updateStyleConfig({
            backgroundOpacity: def.backgroundOpacity,
            xPct: def.xPct,
            bottomPct: def.bottomPct,
          });
        } else if (kind === "primary") this.updateStyleConfig({ primary: def.primary });
        else if (kind === "secondary") this.updateStyleConfig({ secondary: def.secondary });
        this.renderSettingsMenuContent();
      });
    });

    // Slider handlers
    menu.querySelectorAll<HTMLInputElement>("[data-slider]").forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.getAttribute("data-slider")!;
        const num = Number(input.value);
        const fill = menu.querySelector<HTMLElement>(`[data-fill="${key}"]`);
        const valEl = menu.querySelector<HTMLElement>(`[data-val="${key}"]`);
        if (key === "bg-opacity") {
          if (fill) fill.style.width = `${num}%`;
          if (valEl) valEl.textContent = `${num}%`;
          this.updateStyleConfig({ backgroundOpacity: num });
        } else if (key === "primary-size" || key === "secondary-size") {
          const target = key.startsWith("primary") ? "primary" : "secondary";
          if (fill) fill.style.width = `${num - 50}%`;
          if (valEl) valEl.textContent = `${num}%`;
          this.updateStyleConfig((prev) => ({ ...prev, [target]: { ...prev[target], fontSize: num } }));
        } else if (key === "primary-weight" || key === "secondary-weight") {
          const target = key.startsWith("primary") ? "primary" : "secondary";
          if (fill) fill.style.width = `${((num - 300) / 400) * 100}%`;
          if (valEl) valEl.textContent = `${num}`;
          this.updateStyleConfig((prev) => ({ ...prev, [target]: { ...prev[target], fontWeight: num } }));
        }
      });
    });

    // Color preset dot handlers
    menu.querySelectorAll<HTMLElement>(".pp-vsm-color-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        const kind = dot.getAttribute("data-kind") as "primary" | "secondary";
        const color = dot.getAttribute("data-color")!;
        this.updateStyleConfig((prev) => ({ ...prev, [kind]: { ...prev[kind], color } }));
        this.renderSettingsMenuContent();
      });
    });

    // Native color input handlers
    menu.querySelectorAll<HTMLInputElement>("[data-color-input]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const kind = inp.getAttribute("data-color-input") as "primary" | "secondary";
        const color = inp.value;
        const wrap = inp.parentElement as HTMLElement | null;
        if (wrap) wrap.style.background = color;
        this.updateStyleConfig((prev) => ({ ...prev, [kind]: { ...prev[kind], color } }));
      });
    });

    // Font family handlers
    menu.querySelectorAll<HTMLSelectElement>("[data-font]").forEach((sel) => {
      sel.addEventListener("change", () => {
        const kind = sel.getAttribute("data-font") as "primary" | "secondary";
        const fontFamily = sel.value as SubtitleTrackStyle["fontFamily"];
        this.updateStyleConfig((prev) => ({ ...prev, [kind]: { ...prev[kind], fontFamily } }));
      });
    });
  }

  private syncToggleButtonState() {
    const btn = this.toggleBtnEl;
    if (btn) {
      btn.setAttribute("aria-pressed", this.active ? "true" : "false");
      if (this.active) btn.setAttribute("data-active", "");
      else btn.removeAttribute("data-active");
      const title = this.active ? tr("page.videoSubTitleOn") : tr("page.videoSubTitleOff");
      btn.title = title;
      btn.setAttribute("aria-label", title);
    }
    const masterSwitch = this.menuEl?.querySelector('[data-testid="pp-vsm-master-switch"]');
    if (masterSwitch) {
      masterSwitch.setAttribute("aria-checked", this.active ? "true" : "false");
    }
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

  private applyOverlayPosition(overlay: HTMLElement) {
    const xPct = Math.max(8, Math.min(92, this.styleCfg.xPct ?? 50));
    const bottomPct = Math.max(2, Math.min(88, this.styleCfg.bottomPct ?? 8.5));
    overlay.style.left = `${xPct}%`;
    overlay.style.bottom = `${bottomPct}%`;
  }

  private bindOverlayDrag(overlay: HTMLElement) {
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    overlay.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const def = defaultVideoSubtitleStyle();
      this.updateStyleConfig({ xPct: def.xPct, bottomPct: def.bottomPct });
    });
    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const container = overlay.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const width = Math.max(200, rect.width || 640);
      const height = Math.max(120, rect.height || 360);
      const startX = e.clientX;
      const startY = e.clientY;
      const startXPct = this.styleCfg.xPct ?? 50;
      const startBottomPct = this.styleCfg.bottomPct ?? 8.5;

      overlay.setAttribute("data-dragging", "");
      const win = this.doc.defaultView ?? window;

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const nextX = Math.max(8, Math.min(92, Number((startXPct + (dx / width) * 100).toFixed(1))));
        const nextBottom = Math.max(2, Math.min(88, Number((startBottomPct - (dy / height) * 100).toFixed(1))));
        this.styleCfg = { ...this.styleCfg, xPct: nextX, bottomPct: nextBottom };
        this.applyOverlayPosition(overlay);
      };

      const onUp = (ev: MouseEvent) => {
        ev.stopPropagation();
        overlay.removeAttribute("data-dragging");
        win.removeEventListener("mousemove", onMove, true);
        win.removeEventListener("mouseup", onUp, true);
        saveVideoSubtitleStyle(this.styleCfg);
      };

      win.addEventListener("mousemove", onMove, true);
      win.addEventListener("mouseup", onUp, true);
    });
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
      this.bindOverlayDrag(el);
      container.appendChild(el);
      this.overlayEl = el;
    }
    this.applyOverlayPosition(this.overlayEl);
    return this.overlayEl;
  }

  private renderOverlay(origText: string, transText?: string) {
    if (origText || transText) {
      this.lastOrigText = origText;
      this.lastTransText = transText ?? "";
    }
    const s = this.styleCfg;
    const isFullscreen = !!this.doc.fullscreenElement;
    const key = [
      origText,
      transText ?? "",
      this.cfg?.style ?? "green",
      s.displayType,
      s.translationPosition,
      s.backgroundOpacity,
      s.xPct,
      s.bottomPct,
      s.primary.fontSize,
      s.primary.color,
      s.primary.fontFamily,
      s.primary.fontWeight,
      s.secondary.fontSize,
      s.secondary.color,
      s.secondary.fontFamily,
      s.secondary.fontWeight,
      isFullscreen ? "fs" : "norm",
    ].join("|||");

    if (key === this.lastRenderedKey && this.overlayEl?.isConnected) return;
    this.lastRenderedKey = key;

    const overlay = this.ensureOverlay();
    if (!overlay) return;
    if (!origText && !transText) {
      overlay.innerHTML = "";
      return;
    }

    const basePx = isFullscreen ? 26 : 20;
    const primaryPx = Math.round((basePx * s.primary.fontSize) / 100 * 10) / 10;
    const secondaryPx = Math.round((basePx * s.secondary.fontSize) / 100 * 10) / 10;

    const box = this.doc.createElement("div");
    box.className = "pp-vsub-box";
    box.setAttribute("data-style", this.cfg?.style ?? "green");
    const alpha = Math.max(0, Math.min(1, s.backgroundOpacity / 100));
    box.style.background = `rgba(12, 15, 22, ${alpha})`;
    box.style.backdropFilter = alpha > 0.08 ? "blur(4px)" : "none";
    box.style.boxShadow = alpha > 0.08 ? "0 2px 12px rgba(0, 0, 0, 0.32)" : "none";

    const showOrig = s.displayType !== "translation-only" && !!origText;
    const showTrans = s.displayType !== "original-only" && !!transText;

    const origNode = showOrig ? this.doc.createElement("div") : null;
    if (origNode) {
      origNode.className = "pp-vsub-orig";
      origNode.textContent = origText;
      origNode.style.fontSize = `${secondaryPx}px`;
      origNode.style.color = s.secondary.color;
      origNode.style.fontFamily = fontFamilyCss(s.secondary.fontFamily);
      origNode.style.fontWeight = String(s.secondary.fontWeight);
    }

    const transNode = showTrans ? this.doc.createElement("div") : null;
    if (transNode) {
      transNode.className = "pp-vsub-trans";
      transNode.textContent = transText!;
      transNode.style.fontSize = `${primaryPx}px`;
      transNode.style.color = s.primary.color;
      transNode.style.fontFamily = fontFamilyCss(s.primary.fontFamily);
      transNode.style.fontWeight = String(s.primary.fontWeight);
    }

    if (s.translationPosition === "above") {
      if (transNode) box.appendChild(transNode);
      if (origNode) box.appendChild(origNode);
    } else {
      if (origNode) box.appendChild(origNode);
      if (transNode) box.appendChild(transNode);
    }

    if (!box.childNodes.length) {
      overlay.innerHTML = "";
      return;
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

  /** If on YouTube and pre-fetched tracks are unavailable, ensure YouTube's native CC stream is enabled for Engine 2. */
  private ensureYoutubeNativeCaptionsEnabled() {
    const ytCcBtn = this.doc.querySelector<HTMLElement>(".ytp-subtitles-button");
    if (!ytCcBtn) return;
    if (ytCcBtn.getAttribute("aria-pressed") === "false" && ytCcBtn.getAttribute("aria-disabled") !== "true") {
      try {
        ytCcBtn.click();
      } catch {
        /* ignore */
      }
    }
  }

  private async checkVideoSource() {
    if (!this.active) return;
    this.ensurePlayerButton();
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
      if (!this.cues.length) {
        this.checkLiveDomCaptions();
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
      // Fallback: when YouTube TimedText requires player PO token, activate native CC so Engine 2 captures live segments
      this.ensureYoutubeNativeCaptionsEnabled();
    }

    const html5Cues = extractHtml5TextTrackCues(this.doc);
    if (html5Cues.length > 0) {
      this.setTrackCues(html5Cues, false);
      return;
    }

    this.checkLiveDomCaptions();
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
      if (!this.noticeText) this.renderOverlay("");
      return;
    }
    this.clearTransientNotice();
    const cachedTrans = activeCue.translation ?? this.liveCache.get(activeCue.text);
    this.renderOverlay(activeCue.text, cachedTrans);
  }

  private prefetchLookaheadWindow(now: number) {
    const windowEnd = now + 90;
    const batchIndices: number[] = [];
    for (let i = 0; i < this.cues.length && batchIndices.length < 16; i++) {
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
    const firstCueIdx = batchIndices[0];
    const contextBefore =
      firstCueIdx > 0
        ? this.cues
            .slice(Math.max(0, firstCueIdx - 2), firstCueIdx)
            .map((c) => c.text)
            .filter(Boolean)
        : [];
    const snapshotCues = this.cues;
    const req = contextBefore.length > 0 ? this.deps.translateBatch(texts, contextBefore) : this.deps.translateBatch(texts);
    req
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
      .catch((err) => {
        this.deps.onStatsChange?.({ errors: batchIndices.length });
        if (this.active && err?.message) {
          this.showTransientNotice(String(err.message), 3500);
        }
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
      this.liveDebounceTimer = window.setTimeout(() => this.checkLiveDomCaptions(), 65);
    });
    this.liveMo.observe(this.doc.body, { childList: true, characterData: true, subtree: true });
  }

  public checkLiveDomCaptions() {
    if (!this.active || this.cues.length > 0) return;
    const nodes = Array.from(this.doc.querySelectorAll(LIVE_CAPTION_SELECTORS)).filter(
      (el) => !el.closest("[data-pp-ui]"),
    );
    if (!nodes.length) {
      if (this.lastRenderedKey && !this.noticeText) this.renderOverlay("");
      return;
    }
    const isYtCaption = nodes.some((n) => n.classList?.contains("ytp-caption-segment"));
    if (isYtCaption) {
      this.doc.documentElement.classList.add("pp-yt-sub-active");
    }
    const text = nodes
      .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      if (!this.noticeText) this.renderOverlay("");
      return;
    }

    // Record live caption for transcript extraction fallback
    recordLiveCue(this.doc, text, this.videoEl?.currentTime ?? 0);

    this.clearTransientNotice();
    const cached = this.liveCache.get(text);
    if (cached) {
      this.lastLiveTranslation = cached;
      this.renderOverlay(text, cached);
      return;
    }

    // Immediately show the original caption line (plus any recent translation while the new request is in flight)
    this.renderOverlay(text, this.lastLiveTranslation || undefined);

    if (this.livePending.has(text)) return;
    this.livePending.add(text);
    const contextBefore = this.recentLiveTexts.filter((t) => t !== text).slice(-2);
    if (this.recentLiveTexts[this.recentLiveTexts.length - 1] !== text) {
      this.recentLiveTexts.push(text);
      if (this.recentLiveTexts.length > 6) this.recentLiveTexts.shift();
    }
    this.deps.onStatsChange?.({ total: 1 });

    const req = contextBefore.length > 0 ? this.deps.translateBatch([text], contextBefore) : this.deps.translateBatch([text]);
    req
      .then(([trans]) => {
        if (!this.active) return;
        const cleanTrans = (trans ?? "").trim();
        if (cleanTrans) {
          this.liveCache.set(text, cleanTrans);
          this.lastLiveTranslation = cleanTrans;
          this.deps.onStatsChange?.({ done: 1 });
          // Re-verify what caption text is currently on screen
          const currentText = Array.from(this.doc.querySelectorAll(LIVE_CAPTION_SELECTORS))
            .filter((el) => !el.closest("[data-pp-ui]"))
            .map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (currentText === text) {
            this.renderOverlay(text, cleanTrans);
          } else if (currentText) {
            this.renderOverlay(currentText, this.liveCache.get(currentText) ?? cleanTrans);
          }
        }
      })
      .catch((err) => {
        this.deps.onStatsChange?.({ errors: 1 });
        if (this.active && err?.message) {
          this.showTransientNotice(String(err.message), 3500);
        }
      })
      .finally(() => {
        this.livePending.delete(text);
      });
  }
}
