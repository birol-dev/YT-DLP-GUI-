# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.9.3] - 2026-09-18

### Fixed
- Native file-drag icon paths now resolve from the project root (`website/assets`, `build/icon.png`) instead of the broken `src/main/website/...` location after the main-process split.
- Open Folder fallback for Subtitles / Clipper / GIF completion cards now opens `yt-subs`, `yt-videos`, or `gif-exports` instead of always defaulting to `yt-videos`.
- Download, clip, divider-import, scan, stream, and GIF handlers no longer throw when the window is closed mid-task; spawn `error` (e.g. missing yt-dlp) surfaces as a download/scan error instead of an uncaught exception.
- GIF conversion validates input path and positive duration before spawning FFmpeg.
- `media-preview` local `file:` URLs are restricted to userData, downloads, and temp directories (blocks arbitrary filesystem reads).
- Dependency downloads fall back to a default User-Agent if the browser module has not attached one yet.

## [1.9.2] - 2026-09-17

### Fixed
- Clipper preview now works for modern YouTube streams that Chromium cannot play directly (no progressive MP4).
- Hybrid preview path: prefer Chromium-safe H.264/AAC when available; otherwise remux a local H.264+AAC preview via yt-dlp + FFmpeg.
- Inject Node JS runtime and FFmpeg location into yt-dlp so H.264 DASH formats stay extractable.
- Serve remuxed local previews through `media-preview` without the guest session/Referer (large `file://` playback was breaking).
- Cap remux preview at 480p with `faststart` so long videos load more reliably.
- Mute Clipper player by default so missing audio devices do not kill video decode.
- Clarified Preview Unavailable copy when a playable remux cannot be prepared.

## [1.9.1] - 2026-09-17

### Fixed
- Prevented FFmpeg updater from downgrading modern system PATH builds (e.g. v7.1+) to older static packages (v6.1), with automatic detection and semver version comparison.
- Added automatic recovery to restore system FFmpeg if an older local binary exists.
- Fixed stale status summary text in Settings: `#dependency-update-result-box` now immediately synchronizes when individual components update.
- Fixed update toast sticking on "Installing FFmpeg... Extracting..." by emitting completion IPC events, adding auto-dismissal on completion, and introducing safety fallback timeouts.
- Compacted long build suffixes in UI status badges (e.g., `v7.1` instead of `v7.1-essentials_build-www.gyan.dev`) while preserving full strings in tooltips.
- Separated toast auto-dismiss timeouts and fade-out animation timers to eliminate race conditions on retry or rapid clicks.
- Resolved illegal section nesting in `index.html` to guarantee clean DOM hierarchy across Settings.

## [1.9.0] - 2026-09-17

### Added
- Automatic background updates for yt-dlp and FFmpeg on application startup and on demand.
- Real-time glassmorphism update notification toast with status indicators, download progress, and auto-dismissal.
- Dedicated Component Updates & Management section in Settings with an Automatic Background Updates toggle.
- Status badges and version information for both yt-dlp and FFmpeg, including detection source (local vs system PATH).
- One-click "Check Updates Now" and manual "Update FFmpeg" controls in Settings.
- Comprehensive automated test suite for dependency update flows and concurrency guards.

### Fixed
- FFmpeg updates now download prebuilt releases from ffbinaries, extract into local binary directories, and maintain executable permissions.
- Concurrency guards prevent duplicate or conflicting background update tasks during startup and manual checks.

## [1.8.9] - 2026-09-03

### Added
- Split `renderer.js` and `main.js` into focused modules so features live in files instead of 5000-line blobs.
- Cancel in-progress downloads from the active download card.
- Empty-URL validation with a shake animation and terminal warning on download inputs.

### Fixed
- Copy Path paints green **Copied!** immediately, before the clipboard IPC, so a slow roundtrip cannot hide the feedback.

## [1.8.8] - 2026-08-21

### Fixed
- Replaced hardcoded multi-color gradient accents on download completion cards with theme-adaptive styling (`hsl(var(--primary))`), ensuring top border lines, status icons, and badges seamlessly match the selected settings theme (or clean monochrome on default Zinc).
- Removed inline multi-color gradients on Instagram download completion icons and recent thumbnails for consistent visual harmony.

## [1.8.7] - 2026-08-21

### Added
- Rich **Active In-Progress Download Card**: Users now see comprehensive live media metadata while downloading, including the dynamic video thumbnail preview, format & resolution badge (`VIDEO • 1080P MP4`, `AUDIO • MP3`, `INSTAGRAM • REEL`, `SUBTITLES • EN`, `CLIP`), live parsed video title/destination filename, transfer metrics (downloaded/total size, download speed, ETA), and active operation phase.
- Automated unit test coverage in `test/download-complete-ui.test.js` validating the active download banner DOM elements, thumbnail rendering, and progress metrics state.

## [1.8.6] - 2026-08-21

### Added
- Dedicated **Download Complete component** with prominent **"Open Folder"** action buttons across all media download pages (**Video**, **Audio**, **Instagram**, **Subtitles**, **Video Clipper**, **Video Divider**, and **Video to GIF**).
- Direct file playback via **"Play / Open"** action and instant file path clipboard copy with animated feedback.
- Native drag-to-import support directly from the completion card thumbnail preview into Premiere Pro, After Effects, DaVinci Resolve, or File Explorer.
- Automated test coverage in `test/download-complete-ui.test.js` auditing all completion components, open-folder buttons, active download banners, and renderer state managers.

### Fixed
- Fix startup auto-update checker (`checkUpdates`): eliminate unawaited Promise passed into child process spawn arguments that caused `[object Promise]` command line crashes on update checks.
- Add automatic direct GitHub Release fallback download to the auto-checker when built-in `--update-to` fails due to Windows file locks, rate limits, or permission restrictions.
- Prevent browser cookie injection into updater commands on startup, eliminating cookie database lock errors when browsers are open.

## [1.8.5] - 2026-08-21

### Fixed
- Forcefully terminate all blocking tasks (active downloads, scans, video dividers, gif conversions, stream captures, and background child processes) when clicking **Switch Channel Now** or **Force Update yt-dlp**, immediately freeing file locks on the executable and safely hot-swapping builds.
- Enhance binary replacement recovery on Windows by terminating lingering locked processes during retry loops.

### Added
- Process tracking and process-tree termination registry (`activeProcesses`, `killProcessTree`, `stopAllBlockingTasks`) in `main.js`.
- Automated test coverage in `test/channel-switching.test.js` verifying forceful task cancellation, IPC contracts, and clean UI state reset.

## [1.8.4] - 2026-08-21

### Fixed
- Fix syntax error in `renderer.js` caused by an unclosed duplicate function block that broke all UI interactions and event handlers on startup.
- Add `dev` script alias to `package.json` (`npm run dev` / `npm start`).

### Added
- Comprehensive automated regression test suite (`npm test`) using Node's native test runner (`node:test`):
  - **Syntax & Compilation Validation**: Asserts 0 compilation errors across `main.js`, `preload.js`, and `renderer.js`.
  - **Delimiter Balance Audit**: Strict delimiter tokenizer checking balanced braces, brackets, and parentheses across all scripts.
  - **IPC Contract Audit**: Guarantees all `window.electronAPI` methods used in `renderer.js` are exposed in `preload.js`, and all IPC channels in `preload.js` are handled in `main.js`.
  - **DOM & Element Integrity Audit**: Ensures all 270+ element IDs queried in `renderer.js` exist in `index.html` and all navigation tabs have matching panes.
  - **Package & Config Audit**: Verifies script definitions and version parity between `package.json` and `CHANGELOG.md`.
- Automated test execution in GitHub Actions CI workflow to block broken builds prior to release.

## [1.8.3] - 2026-08-20

### Added
- Add **Force Update yt-dlp** button on the Settings panel with live progress, status badges, and direct binary download.
- Add seamless **Settings Auto-Save** with instant saving for dropdowns, checkboxes, sliders, and accent themes, plus debounced auto-save for text inputs.
- Add animated auto-save indicator status feedback in the Settings card.
- Add `force-update-yt-dlp` IPC handler and expose `forceUpdateYtDlp` in preload.

### Fixed
- Make yt-dlp build hot-swapping between `Stable`, `Nightly`, and `Master` foolproof, eliminating Windows file lock (`EBUSY`/`EPERM`) crashes during binary replacement using atomic swapping with exponential backoff retries.
- Fix version and release channel inspection to accurately detect build types across all GitHub release tags.
- Fix settings saving blocking on channel downloads by decoupling config saves from binary replacement operations.

## [1.8.2] - 2026-08-13

### Added
- Double-click a Recents thumbnail to open the downloaded file in the default application.

### Fixed
- Fix Recents thumbnail drag-out to Explorer and Premiere Pro by supplying a non-empty 32×32 PNG icon to `webContents.startDrag`, matching Electron's native file drag-and-drop docs. The previous code used `nativeImage.createFromPath` on the video/audio file and fell back to `createEmpty()`, which makes `startDrag` no-op.
- Fix Recents thumbnail click/double-click doing nothing after a drag attempt. Electron does not fire `dragend` after the required `preventDefault()` on `dragstart`, so the old `didDrag` flag stayed true and swallowed later clicks.

## [1.7.0] - 2026-07-01

### Added
- Add hot-swappable yt-dlp release channels in Settings: **Stable**, **Nightly**, and **Master**.
- Add `Switch Channel Now` control and live installed-version display for yt-dlp.
- Add IPC handlers `get-yt-dlp-info` and `switch-yt-dlp-channel` for channel management without restarting the app.
- Add tab-level troubleshooting hints on download tabs pointing users to yt-dlp channel settings when downloads fail.

### Changed
- Default yt-dlp channel is **Master** for fresh installs; existing installs keep **Stable** until changed in Settings.
- First-run dependency installer and startup sync now respect the selected yt-dlp channel.
- Instagram downloads ensure a local yt-dlp binary is installed on the configured channel before starting.

### Fixed
- Fix Instagram downloads failing with `empty media response` when the app was using the stable yt-dlp release.

## [1.6.2] - 2026-06-22

_Previous release._

## [1.5.0] - 2026-06-13

### Added
- Add a new "File Specifications" metadata card in the Left Pane of the Video Divider tab displaying resolution, aspect ratio, frame rate, file size, video codec, audio codec, and system path.
- Add a custom asynchronous video analysis loader spinner (`#divider-loading`) on file drops or browse file selection to prevent visual UI freezing.
- Add standard browser-fallback environment mocking to support stand-alone testing in browser pages.

### Changed
- Refactor the Video Divider configuration wizard to place Mode Selection as Step 1 (unskippable) and contextual parameter input selectors as Step 2.
- Move the "Change Divide Mode" navigation control to the top of Step 2.
- Relocate the video metadata details card persistently to the top of the right-hand configuration column.

## [1.4.0] - 2026-06-13

### Added
- Add a new "Video Divider" tab in the Electron sidebar navigation.
- Add local video file importing via drag-and-drop or browse file picker.
- Add remote YouTube video import downloading first via yt-dlp.
- Add interactive dual-slider timeline range controls with millisecond accuracy (`HH:MM:SS.mmm`).
- Add four local FFmpeg splitting modes: Fast Split (keyframe copy), Precise Split (x264 re-encode), Equal Chunks segmentation, and Spatial Canvas cropping (Left/Right/Top/Bottom halves).
- Add dynamic inline SVG icons and premium Shadcn-style minimalist vector mode diagrams.
- Add webUtils integration in preload script to support secure file path resolution in Electron v32+.

## [1.3.3] - 2026-06-05

### Fixed
- Fix weather widget city estimation to fetch and display local weather dynamically using `ipapi.co` IP geolocation when the weather location input is left blank in Settings.
- Fix settings save handler to geocode manually typed weather location names via the Open-Meteo Geocoding API if they are saved without selecting an autocomplete dropdown item.
- Fix weather widget SVG gradient rendering bug on hidden tabs (Audio and Instagram) by assigning unique gradient IDs to each widget instance.

## [1.2.2] - 2026-05-27

### Fixed
- Improve final file path detection after successful downloads by falling back to the newest completed file in the target download folder when `yt-dlp` output parsing does not provide a usable final path.

## [1.2.0] - 2026-05-25

### Added
- Add an automatic, self-contained dependency installer that verifies, downloads, and configures required `yt-dlp` and `ffmpeg` binaries automatically on first launch.
- Add a premium glassmorphism dependency installer modal overlay with visual status tracking, download progress bars, and real-time step descriptions.
- Add cross-platform download support for Windows (x64/x86), macOS, and Linux configurations using official GitHub and ffbinaries static builds.

### Changed
- Refactor the main process start sequence to run startup checks on window load before triggering background update checkers.
- Update Electron IPC bridge to stream dependency setup status, download progress percentages, extraction steps, and error details between processes.
- Refactor all YouTube media download channels to target resolved local executables and specify the `--ffmpeg-location` parameter pointing to the local bin directory when appropriate.

### Fixed
- Fix Mermaid diagram syntax in `README.md` by quoting subgraph labels containing parentheses, preventing parse errors when rendering on GitHub.

## [1.1.1] - 2026-05-19

### Fixed
- Fix command-line arguments construction bug for audio downloads, preventing `yt-dlp` exits with error code 2 when extracting to MP3 by sequentially building arguments instead of using fragile `splice` offsets.
- Fix sequential parameter building for subtitle downloads, replacing fragile `splice` logic to prevent potential argument-parsing errors in the future.
- Fix UI copywriting mismatch in "Download Video" and "Download Audio" cards, making card descriptions update dynamically to match the user's preferred format settings immediately upon load or save.

### Changed
- Align package metadata and documentation for public release, correcting repository clone placeholders in the README, aligning the package.json license descriptor to MIT, and generating a dedicated root LICENSE file.

## [1.1.0] - 2026-05-19

### Added
- Add a comprehensive and premium "Settings" tab to allow users to customize their experience (`index.html`, `styles.css`).
- Add visual, native folder selection using Electron's `dialog.showOpenDialog` to let users choose a custom base download folder, with "Reset" and "Browse" actions.
- Add dynamic theme selection with an interactive color picker supporting 6 premium accent palettes (Sleek Silver, YouTube Red, Cyan Spark, Emerald Green, Royal Velvet Purple, and Amber Gold) featuring instant live preview.
- Add real-time success chime synthesized dynamically via Web Audio API oscillators and gains when a download successfully completes.
- Add an "Auto-Open File Location" checkbox to automatically reveal files in Windows Explorer upon successful download completion.
- Add customizable download defaults pre-selected for new videos (Quality/Resolution) and subtitles (Language).
- Add customizable Preferred Video Format (MP4, MKV, WebM) and Audio Format (MP3, M4A, WAV, FLAC) selectors in Settings, including full formatting guidance (e.g. MP4 for Premiere/After Effects, WAV for lossless sound editing).
- Add a premium, Shadcn-style custom progress bar with smooth CSS width transitions that parses the yt-dlp console output in real-time to display active percentage levels during media downloads.
- Add an active download blocking locking system that warns the user with a focused dialog and a warning log if they attempt to launch new downloads before current processes conclude.
- Add responsive drag-to-resize panel support for the Status Terminal via a top resize drag-bar that allows manual height customization with precise limit bounds.
- Add quick-access folder navigation buttons ("Open Videos Folder", "Open Audios Folder") to the Recents activity tab header, instantly revealing target save locations.
- Add a premium, modern `README.md` with visual architecture diagrams and detailed system prerequisites.
- Add local project-level auto-updater skill under `.skills/changelog-updater/SKILL.md` to guide automated tools in automatically recording future workspace changes.

### Changed
- Refactor all download channels (Video, Audio, and Subtitles) to retrieve and apply the user's custom save location dynamically, falling back to the default OS Downloads directory.
- Expose secure settings retrieval, directory browse dialog, and settings saving APIs using Electron's two-way IPC `invoke` and `handle` mechanisms (`preload.js`, `main.js`, `renderer.js`).
- Refactor video and audio download routines to dynamically request and map container formats (WebM/MKV/MP4) and audio codecs (MP3/M4A/WAV/FLAC) in yt-dlp arguments, preserving strict H.264 MP4 and high VBR MP3 as editing-compatible defaults.
- Refactor the main dashboard layout to make the status terminal panel more compact (default height of 160px with top-resize handle styling).
- Hide the status terminal and progress bar elements from view entirely when transitioning to the settings tab to preserve a clean and premium setup aesthetic.
- Refactor final file path matches in download streams to support direct WebM, uncompressed WAV, lossless FLAC, and standard M4A files while strictly excluding intermediate stream fragments (.fXXX) and .ytdl files, keeping all history thumbnail click folder reveal and highlight actions fully functional.
- Add filesystem fallback checks to standard file opening methods, automatically opening containing directory folders in Windows Explorer if the downloaded media files themselves are deleted or renamed.

## [1.0.0] - 2026-04-11

### Added
- Add Electron wrapper with modern Shadcn-inspired responsive user interface (`index.html`, `styles.css`, `renderer.js`).
- Add robust `yt-dlp` integration supporting high-quality video (Adobe After Effects compatible H.264 MP4), audio-only (MP3 320kbps), and subtitle extraction (`main.js`).
- Add asynchronous background update checkers for `yt-dlp` and `ffmpeg` availability on launch.
- Add file path tracking to capture final downloaded file paths from `yt-dlp` stdout.
- Add beautiful Recents list with YouTube thumbnails fetched synchronously from video IDs (`renderer.js`).
- Add secure folder opening on Windows Explorer when clicking history cards, calling Electron's `shell.showItemInFolder()` via IPC.
- Add standard NPM packaging scripts and `electron-builder` configuration for distributables.
