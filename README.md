<div align="center">
  <img src="public/icon/128.png" width="88" height="88" alt="Sidekick Logo" />
  <h1>Sidekick (翻翻)</h1>
  <p><strong>Your Privacy-First AI Sidekick for Chrome</strong><br/>Immersive Bilingual Web, PDF &amp; Video Subtitle Translation · Grounded Page &amp; Video Summaries · Autonomous Browser Agent (BYOK)</p>
  <p>
    <strong>English</strong> | <a href="./README_zh.md">简体中文</a>
  </p>
  <p>
    <a href="https://github.com/yoko19191/sidekick-browser-extension/releases"><img src="https://img.shields.io/github/v/release/yoko19191/sidekick-browser-extension?style=flat-square&label=Release" alt="Release" /></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License" /></a>
    <img src="https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome MV3" />
    <img src="https://img.shields.io/badge/BYOK-100%25%20Client--Side-10b981?style=flat-square" alt="BYOK" />
  </p>
</div>

---

## Why Sidekick?

**Sidekick (翻翻)** is an all-in-one AI reading, watching, and browsing companion built on Chrome Manifest V3. Unlike cloud-locked extensions that require subscriptions or route your browsing data through third-party relay servers, Sidekick is **100% client-side (BYOK — Bring Your Own Key)**. Your API keys stay in local browser storage, and requests go directly from your browser to the LLM provider of your choice.

---

## Core Product Features

### 1. Immersive Bilingual Web Translation
- **Paragraph-by-Paragraph Bilingual View**: Read translations right alongside the original text, or switch to **Translation-Only** mode with one click.
- **Hover Single-Paragraph Quick Translate (`Shift`)**: Don't want to translate the whole page? Simply hover your mouse over any paragraph, heading, or list item and tap `Shift` (configurable) to translate or restore that single block instantly.
- **Selection Popup & Context Menu**: Select any phrase on a webpage to trigger an instant floating translation card—copy with one click or send it to the AI Side Panel for deeper explanation.
- **Smart Layout Preservation**: Automatically unclips tight title/card containers so multi-line translations are never cut off, while skipping `<pre>`, `<code>`, and custom excluded selectors.
- **Viewport-First Micro-Batching & Caching**: Prioritizes paragraphs currently in view so the first screen renders in ~1 second, backed by an IndexedDB LRU translation cache.

### 2. Bilingual Video Subtitles & Studio-Grade Styling
- **In-Player `CC` Switch**: Injects a dedicated bilingual subtitle toggle directly into the video player control bar (YouTube, Bilibili, HTML5 `<video>`, etc.) and **remembers your ON/OFF preference per video domain**.
- **Dual-Engine Subtitle Pipeline**:
  - **Engine 1 (Pre-Fetch & Sentence Realignment)**: Extracts full subtitle tracks (`ytInitialPlayerResponse`, timedtext JSON3/SRV3/VTT, `<track>`), merges fragmented auto-generated ASR captions into complete sentences, and pre-translates with sliding context so word order feels natural.
  - **Engine 2 (Live DOM Caption Observer)**: Automatically falls back to real-time DOM caption observation and translation for live streams or custom players.
- **Freely Draggable & Customizable Subtitle Overlay**:
  - **Drag Anywhere**: Drag the subtitle box anywhere inside the video player to avoid covering key visuals (double-click to reset).
  - **2-Level Style Popover**: Customize display mode (*Bilingual / Translation Only / Original Only*), translation order (*Above / Below*), background opacity, font size (`50%–150%`), text color, font family, and font weight for both primary and secondary tracks in real time.

### 3. Grounded Page, Video & PDF Summarization
- **One-Click Video Summarization**: On YouTube, Bilibili, or any video page with subtitles, click **"Summarize Video"** in the Side Panel to extract the full timestamped transcript and generate structured takeaways.
- **Clickable Source Citations & Timestamp Jump**: Every AI summary and answer includes grounded footnote badges:
  - Click a **text citation** to scroll to the exact paragraph on the page and highlight it.
  - Click a **`[MM:SS]` video citation** to seek the video player directly to that moment.
  - Click a **`Page N` PDF citation** to jump directly to the cited page.
- **Long-Document & Local/Online PDF Q&A**:
  - Built-in `pdf.js` extraction (with CJK CMap support) for both online PDFs and local `file://` PDFs up to 100 MB.
  - Automatic hierarchical map-reduce summarization for long articles (>20k chars) and local BM25 retrieval for multi-turn Q&A over massive documents (up to 1M chars).
- **Rich Multimodal Chat**: Attach images or files, switch between preset personas, or save custom prompt templates.

### 4. Autonomous Browser Agent & MCP Bridge
- **In-Tab Browser Use Agent**: Switch the Side Panel input to **Agent Mode** and let Sidekick observe, click, type, scroll, switch tabs, and extract structured information across webpages to complete multi-step tasks.
- **Single-Tab Navigation & Persistent Sidebar**: Keeps autonomous navigation inside your active tab and maintains conversation state across tab switches.
- **Safety Guardrails**: High-risk actions (such as form submissions, checkouts, or deletions) pause and require explicit user confirmation in the Side Panel before executing.
- **External MCP Server (`sidekick-mcp`)**: Connect external AI coding assistants (Claude Code, Cursor, etc.) to your live browser session via the bundled Model Context Protocol server.

### 5. Bring Your Own Key (BYOK) & Multi-Provider Support
- **10+ Built-in Providers**: First-class presets for **DeepSeek, OpenAI, Anthropic (Claude), Google Gemini, Kimi (Moonshot), Qwen (DashScope), Zhipu GLM, OpenRouter, Ollama (Local)**, and any custom **OpenAI-Compatible** endpoint.
- **Per-Task Model Routing**: Assign a fast, lightweight model (e.g., `deepseek-chat` or `gpt-4o-mini`) for instant web/subtitle translation, and a frontier reasoning model for complex Q&A and Browser Agent tasks.
- **100% Local Privacy**: Zero telemetry, zero backend servers, and strict Manifest V3 permission boundaries (`activeTab` on-demand injection).

---

## Installation

### Option 1: Install from GitHub Releases (Recommended)
1. Go to the [**Releases**](https://github.com/yoko19191/sidekick-browser-extension/releases) page and download the latest `sidekick-extension-<version>-chrome.zip` (or `.crx`).
2. Unzip `sidekick-extension-<version>-chrome.zip` to a local folder.
3. Open `chrome://extensions` in Chrome / Edge / Brave / Arc and enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped folder (or drag-and-drop the `.crx` package onto `chrome://extensions`).
5. Click the **Sidekick (翻翻)** icon in your browser toolbar, configure your API key in the 3-step onboarding wizard, and start browsing!

### Option 2: Build from Source
```bash
git clone https://github.com/yoko19191/sidekick-browser-extension.git
cd sidekick-browser-extension
npm install
npm run build
```
Then load `.output/chrome-mv3` as an unpacked extension at `chrome://extensions`.

---

## Keyboard Shortcuts & Quick Entry Points

| Action | Default Shortcut / Trigger | Customizable |
| :--- | :--- | :---: |
| **Toggle Full-Page Translation** | `Alt + A` (or click the right-edge floating button) | Yes (Settings → Shortcuts) |
| **Translate / Restore Hovered Paragraph** | Hover mouse over text + tap `Shift` | Yes (`Shift` / `Alt` / `Ctrl` / `~` / Off) |
| **Open Sidekick Side Panel** | Click toolbar icon, or right-click / long-press the floating button | — |
| **Toggle Video Bilingual Subtitles** | Click the `CC` icon in the video player bottom control bar | Per-domain auto-memory |
| **Customize Video Subtitle Style** | Hover or right-click the `CC` icon in the video player | Live preview |

---

## Development & Packaging

```bash
npm run dev                 # Start WXT dev server with hot reload
npm run compile             # TypeScript type-check (tsc --noEmit)
npm test                    # Run Vitest unit test suite
npm run build               # Production build -> .output/chrome-mv3/
npm run zip                 # Package ZIP -> .output/sidekick-extension-<ver>-chrome.zip
npm run crx                 # Package signed CRX3 -> .output/sidekick-extension-<ver>-chrome.crx
npm run check:permissions   # Verify manifest permissions against allowlist
npm run test:e2e            # Run Playwright E2E suite against local mock LLM server
```

### Related Documentation
- [Permissions & Privacy Architecture](./PERMISSIONS.md)
- [Manual QA Checklist](./MANUAL-QA.md)

## License

[MIT](./LICENSE)
