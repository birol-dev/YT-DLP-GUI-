# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-19

### Added
- Add a comprehensive and premium "Settings" tab to allow users to customize their experience (`index.html`, `styles.css`).
- Add visual, native folder selection using Electron's `dialog.showOpenDialog` to let users choose a custom base download folder, with "Reset" and "Browse" actions.
- Add dynamic theme selection with an interactive color picker supporting 6 premium accent palettes (Sleek Silver, YouTube Red, Cyan Spark, Emerald Green, Royal Velvet Purple, and Amber Gold) featuring instant live preview.
- Add real-time success chime synthesized dynamically via Web Audio API oscillators and gains when a download successfully completes.
- Add an "Auto-Open File Location" checkbox to automatically reveal files in Windows Explorer upon successful download completion.
- Add customizable download defaults pre-selected for new videos (Quality/Resolution) and subtitles (Language).

### Changed
- Refactor all download channels (Video, Audio, and Subtitles) to retrieve and apply the user's custom save location dynamically, falling back to the default OS Downloads directory.
- Expose secure settings retrieval, directory browse dialog, and settings saving APIs using Electron's two-way IPC `invoke` and `handle` mechanisms (`preload.js`, `main.js`, `renderer.js`).

## [1.0.0] - 2026-05-19

### Added
- Add Electron wrapper with modern Shadcn-inspired responsive user interface (`index.html`, `styles.css`, `renderer.js`).
- Add robust `yt-dlp` integration supporting high-quality video (Adobe After Effects compatible H.264 MP4), audio-only (MP3 320kbps), and subtitle extraction (`main.js`).
- Add asynchronous background update checkers for `yt-dlp` and `ffmpeg` availability on launch.
- Add file path tracking to capture final downloaded file paths from `yt-dlp` stdout.
- Add beautiful Recents list with YouTube thumbnails fetched synchronously from video IDs (`renderer.js`).
- Add secure folder opening on Windows Explorer when clicking history cards, calling Electron's `shell.showItemInFolder()` via IPC.
- Add standard NPM packaging scripts and `electron-builder` configuration for distributables.
- Add local project-level auto-updater skill under `.skills/changelog-updater/SKILL.md` to guide AI agents in automatically recording future workspace changes.
