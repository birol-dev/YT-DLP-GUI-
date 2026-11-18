# Compress Tab — Feature Spec & Contract

Status: approved scope "Everything". Version target: 1.11.0.

A HandBrake-style video compressor/converter tab built on the FFmpeg the app already manages
(`ctx.getFfmpegPath()`). Plus a **Compress** button (with quick presets) on every
download-complete card, auto-compress after download, and a watch folder.

---

## 1. User-facing features

### 1.1 Input
- Drag & drop one or many files onto the tab, or **Browse** (multi-select).
- Arrive from the download-complete card's **Compress** button (file preloaded).
- One file is "active" in the workspace (preview + settings). Extra files dropped go straight
  into the **queue** using the current settings (batch).

### 1.2 Goal (top-level mode, segmented control)
| Mode | What it does |
|------|--------------|
| **Target size** | "Fit under N MB" (chips 8 / 10 / 25 / 50 / 100 / custom) or "% of original" (25/50/75). Bitrate is computed from duration. Software encoders use **two-pass**; GPU encoders use one-pass VBR and **auto-retry once** at a lower bitrate if the result is over target. |
| **Quality** | Slider 0–100 (labels: Smallest · Small · Balanced · High · Best). Mapped to CRF/CQ per encoder. |
| **Convert only** | Lossless remux (`-c copy`) into another container (MKV→MP4 etc.), optional trim. All filters disabled in this mode. |

### 1.3 Video
- Codec: H.264 · H.265/HEVC · AV1 · VP9 (only those the FFmpeg build can actually encode).
- Encoder: **Auto** (prefer verified GPU: NVENC → QSV → AMF → VideoToolbox, else software) or an
  explicit encoder from the verified list. GPU badge shown when used.
- Speed: Fast · Balanced · Slow (maps to encoder presets).
- Resolution cap: Source · 2160 · 1440 · 1080 · 720 · 480 · 360 (max height, aspect kept, never upscale, even dims).
- FPS cap: Source · 60 · 30 · 24 · 15 (never increases).

### 1.4 Picture (Handbrake tools)
- Trim start/end (timeline handles, like GIF/Divider tabs).
- Crop: manual (top/bottom/left/right px) + **Auto-detect black bars** (cropdetect).
- Rotate 0/90/180/270, flip H / flip V.
- Deinterlace (bwdif), Denoise off/light/medium/strong (hqdn3d).
- Playback speed 0.25×–4× (video setpts + audio atempo chain).

### 1.5 Audio
- Mode: Keep original (copy, when compatible) · Re-encode · Remove audio.
- Codec AAC / Opus / MP3, bitrate 48–320 kbps, channels Source / Stereo / Mono.
- Track picker (multi-track files).
- Normalize loudness (loudnorm, single pass, I=-16 LUFS), volume ± dB.

### 1.6 Subtitles
- Burn in: none · embedded track · external .srt/.ass/.vtt file.
- Keep soft subtitles (when container supports; mp4 → mov_text, mkv → copy).

### 1.7 Output
- Default: **next to the original**, named `<name> (compressed).<ext>`; if taken → `(compressed 2)`, ….
  Never overwrites the input. Optional custom folder.
- Container: MP4 · MKV · WebM · MOV (incompatible codec combos auto-corrected with a visible note).
- Strip metadata toggle; `+faststart` for MP4/MOV always.
- Encodes go to a temp name `<final>.partial` (with explicit `-f`) and are renamed on success.

### 1.8 Presets
Built-in (platform) presets, shown as chips at the top of settings:

| id | Label | Settings |
|----|-------|----------|
| `discord` | Discord (10 MB) | size 10 MB, H.264, ≤720p, ≤30fps*, AAC 96k, mp4 |
| `discord-nitro` | Discord Nitro (500 MB) | size 500 MB, H.264, ≤1080p, AAC 128k |
| `whatsapp` | WhatsApp (16 MB) | size 16 MB, H.264, ≤720p, ≤30fps, AAC 96k |
| `email` | Email (25 MB) | size 25 MB, H.264, ≤720p, AAC 96k |
| `telegram` | Telegram | quality 65, H.264, ≤1080p, AAC 128k |
| `x` | X / Twitter | quality 70, H.264, ≤1080p, ≤60fps, AAC 128k |
| `reels` | Instagram Reels | quality 72, H.264, ≤1080p, ≤30fps, AAC 128k |
| `youtube` | YouTube upload | quality 88, H.264, source res, AAC 192k |
| `half` | Half the size | size 50 %, same codec family H.264 |
| `hevc-archive` | Smaller (HEVC) | quality 70, HEVC, source res, AAC 128k, `-tag:v hvc1` |
| `av1-smallest` | Smallest (AV1) | quality 55, AV1, AAC/Opus 96k |
| `remux-mp4` | Convert to MP4 | Convert only, mp4 |

*fps cap only applied when source is higher.
Users can **save current settings as a preset**, rename/delete their own. Stored in settings `compressCustomPresets`.

Quick presets on the download card: `discord`, `whatsapp`, `email`, `half`, `hevc-archive`.

### 1.9 Preview & compare
- **Preview 10 s**: encodes a 10-second sample starting at the playhead with the current settings
  → shows sample size, projected full size, and opens **Compare**.
- **Compare**: original vs. compressed, synced playback, draggable **wipe slider** (split view),
  plus side-by-side toggle. Also available for finished queue jobs.

### 1.10 Queue
- One job runs at a time; others wait. Each row: thumbnail/icon, name, settings summary, status,
  pass X/2, % , fps, speed ×, ETA, before → after size (and % saved).
- Actions: cancel (running), remove (queued), retry (failed), open file, show in folder, compare, copy path.
- Clear finished. Queue survives tab switches (lives in main).
- On finish: success chime (if sound enabled), item added to Recents (type `compress`).

### 1.11 Automation
- **Auto-compress after download**: toggle + preset; every successful *video* download is queued.
- **Watch folder**: toggle + folder + preset; new video files that appear (size stable for 3 s)
  are queued. Never re-processes our own outputs (`(compressed` in name / `.partial`).

### 1.12 Download-complete card
- New **Compress** split button on all video-capable cards (video, instagram, clipper, twitch):
  main part opens the Compress tab with the file loaded; ▾ opens a small menu with the quick
  presets that queue immediately and show a small "Queued — view" confirmation.
- Injected by JS (no per-card HTML duplication).

---

## 2. Architecture & file ownership

| Area | Files | Owner |
|------|-------|-------|
| Scaffolding (preload, main require, process group, settings defaults, nav button, section shell, CSS links, renderer imports, bus) | `preload.js`, `main.js`, `src/main/process-registry.js`, `src/main/settings.js`, `index.html` (nav + empty section), `renderer/index.js`, `renderer/nav.js`, `renderer/compress-bus.js` | Lead (done before builders start) |
| **A — Backend** | `src/main/compressor-helpers.js` (pure, no Electron), `src/main/compressor.js` (IPC, queue, ffmpeg runs, capabilities, watch), `test/compressor-helpers.test.js` | Builder A |
| **B — Workspace UI** | contents of `<section id="compress-tab">` in `index.html`, `styles/compress.css`, `renderer/compressor.js` | Builder B |
| **C — Queue, compare, automation, card** | `renderer/compress-queue.js`, `renderer/compress-compare.js`, `renderer/compress-card.js`, `styles/compress-queue.css` | Builder C |

Rules: touch only your files. C renders into root elements B's markup provides (ids below). Only
call `document.getElementById` with ids that exist in `index.html` (a test enforces this) —
for JS-created nodes use `querySelector` within your root or keep references.

### 2.1 Root ids B must provide inside the section (C renders into them)
- `compress-queue-root` — queue panel
- `compress-compare-root` — compare overlay/modal container
- `compress-automation-root` — automation settings block

---

## 3. Options object (renderer → main)

All fields optional; main resolves `presetId` first, then overlays explicit fields, then fills defaults
(`resolveOptions` in helpers).

```js
{
  presetId: 'discord',                // optional
  mode: 'size' | 'quality' | 'remux',
  targetSizeMB: 10,                   // mode 'size'
  targetSizePercent: null,            // mode 'size' alternative (1–99); wins if set
  quality: 70,                        // 0–100, mode 'quality'
  codec: 'h264' | 'hevc' | 'av1' | 'vp9',
  encoder: 'auto' | '<ffmpeg encoder name>',
  speed: 'fast' | 'balanced' | 'slow',
  container: 'mp4' | 'mkv' | 'webm' | 'mov',
  maxHeight: null | 2160 | 1440 | 1080 | 720 | 480 | 360,
  maxFps: null | 60 | 30 | 24 | 15,
  trim: { start: null | seconds, end: null | seconds },
  crop: null | { top, bottom, left, right },     // pixels of the SOURCE frame
  rotate: 0 | 90 | 180 | 270,
  flipH: false, flipV: false,
  deinterlace: false,
  denoise: 'off' | 'light' | 'medium' | 'strong',
  speedFactor: 1,                     // 0.25–4
  audio: {
    mode: 'copy' | 'encode' | 'none',
    codec: 'aac' | 'opus' | 'mp3',
    bitrateKbps: 128,
    channels: 'source' | 2 | 1,
    trackIndex: null | number,        // audio-relative index (0 = first audio stream)
    normalize: false,
    volumeDb: 0
  },
  subtitles: {
    burn: { kind: 'none' | 'track' | 'file', trackIndex: null | number, filePath: null | string },
    keepSoft: false
  },
  stripMetadata: false,
  output: { dir: null /* = next to original */, suffix: ' (compressed)' }
}
```

Defaults: mode `quality`, quality 70, codec `h264`, encoder `auto`, speed `balanced`, container `mp4`,
audio `{ mode:'encode', codec:'aac', bitrateKbps:128, channels:'source', normalize:false, volumeDb:0 }`.

### 3.1 Resolution rules (helpers)
- Effective duration `D = (trimEnd ?? duration) - (trimStart ?? 0)`, divided by `speedFactor`.
- Target bits: `targetBytes * 8 * 0.96` (container overhead margin). Audio kbps subtracted
  (0 if none). `videoKbps = floor(totalKbps - audioKbps)`. If `videoKbps < 80` → error-level warning
  "Target too small for this length" and clamp to 80; if `< 400` and height > 720 → warning suggesting 720p
  (and if `maxHeight` is null, auto-cap to 720 with a note in `warnings`).
- Container compat: webm ⇒ codec vp9/av1 + audio opus (auto-switch + note). mp4/mov + opus ⇒ aac (note).
  mp3 in webm ⇒ opus. Audio `copy` falls back to encode when trim with speed≠1, normalize, volume,
  channels change, or codec incompatible with container.
- Remux mode ignores every filter; if any are set, `warnings` notes they were ignored.
- Quality→rate control: x264 CRF `round(34 - q*0.18)` (q=0→34, 100→16); x265 `round(36 - q*0.18)`;
  libaom/libsvtav1 CRF `round(52 - q*0.30)`; vp9 CRF `round(50 - q*0.30)` with `-b:v 0`;
  NVENC `-rc vbr -cq <x264 value> -b:v 0`; QSV `-global_quality <x264 value>`;
  AMF `-rc cqp -qp_i v -qp_p v`; VideoToolbox `-q:v round(30 + q*0.5)`.
- Speed→preset: x264/x265 veryfast/medium/slow; NVENC p2/p5/p7 (+`-tune hq`); QSV veryfast/medium/slow;
  AMF speed/balanced/quality; libaom `-cpu-used 8/6/4 -row-mt 1`; svtav1 `-preset 10/8/6`;
  vp9 `-deadline good -cpu-used 5/3/1 -row-mt 1`.
- Size mode, software: two passes (`-pass 1 -passlogfile <tmp> -an -f null NUL|/dev/null`, then pass 2).
  libaom: two-pass too; svtav1: one pass `-b:v` (no 2-pass support in ffmpeg) treated like GPU.
  GPU: `-b:v V -maxrate 1.5V -bufsize 2V`, one pass, then if `outputBytes > targetBytes` retry once with
  `V * (targetBytes/outputBytes) * 0.95`.
- Filter chain order: deinterlace → crop → scale → fps → rotate/flip → denoise → subtitles burn → setpts.
  Scale: `scale=-2:min(ih\,H)` style (never upscale, even width). Rotation via transpose. Pixel format
  `yuv420p` for h264/hevc(8-bit) for compatibility.
- Audio chain: atempo (split into factors within 0.5–2) → loudnorm → volume.
- Output path: `<dir>/<sanitized base><suffix>.<ext>`, collision counter, temp `<final>.partial`, `-f` explicit.
  HEVC in mp4/mov → `-tag:v hvc1`. mp4/mov → `-movflags +faststart`. stripMetadata → `-map_metadata -1 -map_chapters -1`.
- Progress: spawn with `-progress pipe:1 -nostats -hide_banner -y`; parse `out_time_us`/`out_time_ms`,
  `fps`, `speed`. Two-pass weighting: pass 1 = 0–35 %, pass 2 = 35–100 %.

---

## 4. IPC contract

All exposed in `preload.js` (lead adds them up front). `invoke` = request/response.

| preload method | channel | kind | payload → result |
|---|---|---|---|
| `compressGetCapabilities()` | `compress-get-capabilities` | invoke | → `Capabilities` (cached after first call; `{refresh:true}` re-tests) |
| `compressProbe(filePath)` | `compress-probe` | invoke | → `ProbeInfo` |
| `compressDetectCrop(filePath)` | `compress-detect-crop` | invoke | → `{ top, bottom, left, right, width, height }` |
| `compressEstimate({ probe, options })` | `compress-estimate` | invoke | → `Estimate` |
| `compressEnqueue({ jobs:[{ inputPath, options, source? }] })` | `compress-enqueue` | invoke | → `{ jobIds: string[] }` |
| `compressCancel(jobId)` | `compress-cancel` | invoke | `'all'` cancels running + clears queued → `{ ok }` |
| `compressRemove(jobId)` | `compress-remove` | invoke | queued/finished job removed → `{ ok }` |
| `compressRetry(jobId)` | `compress-retry` | invoke | → `{ jobId }` |
| `compressClearFinished()` | `compress-clear-finished` | invoke | → `{ ok }` |
| `compressGetQueue()` | `compress-get-queue` | invoke | → `Job[]` |
| `compressPreview({ inputPath, options, startSeconds, durationSeconds })` | `compress-preview` | invoke | → `PreviewResult` (rejects on failure; only one at a time, new call cancels old) |
| `compressCancelPreview()` | `compress-cancel-preview` | invoke | → `{ ok }` |
| `compressSelectFiles()` | `compress-select-files` | invoke | → `string[]` (multi) |
| `compressSelectSubtitle()` | `compress-select-subtitle` | invoke | → `string \| null` |
| `compressListPresets()` | `compress-list-presets` | invoke | → `{ builtIn: Preset[], custom: Preset[] }` |
| `compressSavePreset(preset)` | `compress-save-preset` | invoke | `{ id?, label, options }` → `Preset` |
| `compressDeletePreset(id)` | `compress-delete-preset` | invoke | → `{ ok }` |
| `compressGetAutomation()` | `compress-get-automation` | invoke | → `Automation` |
| `compressSetAutomation(partial)` | `compress-set-automation` | invoke | → `Automation` (validates folder, starts/stops watcher) |
| `onCompressQueueUpdate(cb)` | `compress-queue-update` | event | `Job[]` full snapshot, throttled ≤ 4/s, plus immediately on status change |
| `onCompressJobDone(cb)` | `compress-job-done` | event | `Job` (status done/failed/cancelled) |
| `onCompressLog(cb)` | `compress-log` | event | `string` |

Existing reused: `selectFolder`, `getFileUrl`, `openFile`, `openFolder`, `startFileDrag`, `copyToClipboard`, `getPathForFile`.

### 4.1 Types
```ts
Capabilities = {
  ffmpegPath, ffmpegVersion,
  codecs: { h264: Enc[], hevc: Enc[], av1: Enc[], vp9: Enc[] },   // verified only; software first, then GPU
  autoEncoder: { h264, hevc, av1, vp9 },                          // name or null if codec unavailable
  gpu: { nvenc: bool, qsv: bool, amf: bool, videotoolbox: bool },
  features: { subtitlesBurn: bool /* libass */, loudnorm: bool, opus: bool /* libopus */, mp3: bool /* libmp3lame */ }
}
Enc = { name: 'h264_nvenc', label: 'NVIDIA NVENC', hardware: true, twoPass: false }
ProbeInfo = { filePath, filename, size, duration, width, height, fps, vcodec, videoKbps, bitrateKbps,
  container, rotation, hasVideo, audioTracks:[{ index, codec, channels, lang, title, kbps }],
  subtitleTracks:[{ index, codec, lang, title, text: bool }] }   // index = type-relative
Estimate = { mode, videoKbps, audioKbps, estimatedBytes /* null for quality mode unless heuristic */,
  estimateKind: 'exact-target' | 'heuristic' | 'remux', resolvedOptions, encoder, outputWidth, outputHeight,
  effectiveDuration, warnings: string[], notes: string[] }
Job = { id, inputPath, filename, outputPath /* final path or null */, status: 'queued'|'running'|'done'|'failed'|'cancelled',
  source: 'manual'|'auto'|'watch'|'card', presetId, summary /* "H.264 · 720p · 10 MB target" */,
  pass, passes, percent, fps, speed, etaSeconds, inputSize, outputSize, startedAt, finishedAt,
  error, warnings, encoder, attempt }
PreviewResult = { previewPath, sourceStart, duration, sampleBytes, projectedBytes, encoder, warnings }
Preset = { id, label, builtIn: bool, description, options }
Automation = { autoAfterDownload: bool, autoPresetId, watchEnabled: bool, watchDir, watchPresetId, watchActive: bool, watchError }
```

### 4.2 Settings keys (defaults added by lead)
`compressCustomPresets: []`, `compressLastOptions: null`, `compressAutoAfterDownload: false`,
`compressAutoPresetId: 'discord'`, `compressWatchEnabled: false`, `compressWatchDir: ''`, `compressWatchPresetId: 'half'`.

### 4.3 Renderer bus (`renderer/compress-bus.js`, lead)
```js
export const compressBus = {
  on(event, fn), off(event, fn), emit(event, payload),
  openFiles(paths, { presetId } = {}),   // switches to compress tab and emits 'open-files'
  openCompare({ originalPath, compressedPath, startSeconds, duration }), // emits 'open-compare'
};
```
Events: `open-files` (B listens: first path becomes active, rest enqueued), `open-compare` (C listens),
`presets-changed` (B emits after save/delete), `active-file-changed`.

---

## 5. UX & visual direction
- Follow `DESIGN.md` tokens (Shadcn zinc dark, `hsl(var(--token))`, Inter, Lucide icons, 6 accent themes).
  No hard-coded colors except where existing tabs already do (e.g. `#000` video bg).
- Layout mirrors Divider/GIF: empty state = large drop zone with a short value line
  ("Shrink videos for Discord, WhatsApp and email — or convert formats without quality loss").
  Workspace = left column (player, timeline with trim handles, crop overlay, file specs) + right column
  (presets chips → goal segmented control → collapsible sections Video / Picture / Audio / Subtitles / Output)
  + **sticky action bar** at the bottom of the right column: live estimate ("≈ 9.6 MB · −84 %", with a
  before→after bar), encoder badge (GPU/CPU), **Preview 10 s**, **Add to queue**, **Compress** (primary).
- Queue panel below the workspace (full width), collapsible, with a count badge.
- Every control has a hint or tooltip in plain words; disabled controls say why (e.g. "Not available in Convert only").
- Warnings appear inline next to the estimate, not as alerts.
- Keyboard: Space play/pause, I / O set trim in/out, Enter = Compress when focus not in input.
- Must work at the app's minimum window width; right column scrolls independently.

---

## 6. Testing
- `test/compressor-helpers.test.js`: arg building per encoder & mode, bitrate math, filter chain order,
  container compat corrections, output naming/collisions, preset resolution, progress parsing, atempo split.
- Optional integration test (skips if no ffmpeg on PATH/local): 3 s `lavfi testsrc` → size mode 0.2 MB → output ≤ target·1.05.
- Existing suites (`npm test`) must stay green: dom-integrity, ipc-contract, syntax.

## 7. Process
1. Lead scaffolds (section 2) → 2. Builders A/B/C in parallel → 3. Lead integrates, runs tests, launches
the app and visually inspects the tab, polishes UX → 4. OpenCode + Codex review → 5. Lead verifies findings, fixes, re-tests.
