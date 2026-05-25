# YouTube Downloader (yt-dlp GUI Wrapper)

A premium, open-source desktop application that wraps the powerful `yt-dlp` command-line utility in a beautifully designed Electron GUI. Built for content creators, video editors, and power users who need high-quality, reliable media downloads with a seamless user experience.

[![Download Latest Release](https://img.shields.io/github/v/release/eact6/youtube-downloader?label=Download%20Latest%20Release&style=for-the-badge)](https://github.com/eact6/youtube-downloader/releases)

---

## Key Features

- 🎥 **High-Quality Video Downloads**: Support for multiple format containers (MP4, MKV, WebM) with H.264/H.265 video paired with AAC/Opus audio (MP4 is default and pre-optimized for Adobe Premiere/After Effects compatibility).
- 🎵 **Variable Bitrate & Lossless Audio Extraction**: Extract audio streams directly to MP3 (up to 320kbps Level 0 VBR), M4A, FLAC (lossless compressed), or WAV (PCM uncompressed, 24-bit 48kHz for high-fidelity studio editing) via `ffmpeg`.
- 💬 **Subtitle Extraction**: Download YouTube closed-captions and standard subtitles in English and other languages instantly without downloading the video itself.
- ⚙️ **Persistent Application Settings**: Dynamically change and persist your base save locations, pre-selected default video qualities, preferred subtitle languages, and preferred output container and codec formats, with dynamic tab card descriptions reflecting your active selections.
- 🎨 **Dynamic Theme Accent Palettes**: Re-theme the entire application instantly with one of six curated color scheme styles (Silver, YouTube Red, Cyan Spark, Emerald, Velvet Purple, and Gold Mine) featuring dynamic CSS variables.
- 🔊 **Dynamic Sound Synthesizer**: Premium double-tone completion chimes synthesized dynamically in real-time using the Web Audio API on successful downloads.
- 📂 **Auto-Reveal Downloads**: Optional setting to automatically open the download folder in Windows Explorer and highlight the file once the download completes.
- 🎨 **Shadcn-Inspired Design**: A sleek, fully responsive true dark-mode dashboard featuring modern glassmorphism elements, Lucide UI icons, and smooth micro-animations.
- ⚡ **Asynchronous Background Checkers**: Instant verification of `yt-dlp` updates and `ffmpeg` availability on application launch, keeping the UI fully interactive.
- 🕒 **Cached Recents History**: Locally cached history (via `localStorage`) showing active YouTube thumbnails fetched dynamically from video IDs.
- 📁 **Direct Folder Navigation**: Instantly reveal downloaded items in Windows Explorer with a single click on history thumbnails.

---

## Configuration & Media Formats

### 1. Supported Media Output Formats
The application allows you to configure preferred containers and codecs under the **Settings** tab. Dynamic card copywriting will update to explain compatibility based on your choice:

| Format | Type | Use Case & Details |
| :--- | :--- | :--- |
| **`MP4`** | Video | Optimized for maximum compatibility, specifically pre-configured with **H.264 / AAC** for instant import in Adobe Premiere Pro and After Effects. |
| **`MKV`** | Video | Matroska container optimized for high-quality archiving, supporting rich subtitle layers and multiple audio streams. |
| **`WebM`** | Video | High compression efficiency using VP9/AV1 video and Opus audio, ideal for web delivery. |
| **`MP3`** | Audio | Highly compatible audio extraction at 320kbps Level 0 Variable Bitrate (VBR). |
| **`M4A`** | Audio | Highly efficient web-standard audio using the AAC codec. |
| **`WAV`** | Audio | Lossless, uncompressed studio-grade PCM format (24-bit) ideal for high-fidelity sound editing. |
| **`FLAC`** | Audio | Lossless compressed format preserving high-fidelity audio while optimizing file size. |

### 2. Curated Theme Accent Colors
Transform the UI styling instantly with one of six custom-built accent color palettes:

- 🎚️ **Sleek Silver**: Minimalist steel gray, providing a clean professional interface.
- 🟥 **YouTube Red**: Brand-accurate vibrant red accents paired with deep dark mode.
- 💎 **Cyan Spark**: Energetic electric cyan styling for a futuristic tech look.
- 🟢 **Emerald Green**: Refreshing lively emerald palette with deep forest hues.
- 🔮 **Velvet Purple**: Premium royal velvet purple accents for a high-end luxury feel.
- 🪙 **Amber Gold**: Warm, rich metallic gold detailing for a premium touch.

### 3. Integrated Micro-Features
- **Status Terminal Resizer**: Drag the resize bar at the top of the Status Terminal to adjust its height manually between 100px and 450px.
- **Real-Time Progress Tracking**: Custom CSS transition-backed progress bar that reads stdout percentage from `yt-dlp` in real-time.
- **Concurrent Download Lockout**: Restricts the application from running multiple simultaneous download processes to prevent `yt-dlp` IP throttling and corruption of files.
- **Web Audio Chime**: An oscillator-synthesized success melody triggers automatically upon completion when enabled, using zero external audio files.

---

## Technical Architecture

The application strictly separates backend OS processes from the frontend rendering layer for security, utilizing Electron's safe IPC bridge architecture.

```mermaid
graph TD
    subgraph Renderer ["Renderer Process (Chromium)"]
        UI["HTML/CSS Dashboard"] <--> RenderJS["renderer.js"]
    end

    subgraph Bridge ["Bridge (Context Isolation)"]
        Preload["preload.js (contextBridge)"]
    end

    subgraph Main ["Main Process (Node.js)"]
        MainJS["main.js"] <--> YTDLP["yt-dlp child_process"]
        MainJS <--> FFmpeg["ffmpeg child_process"]
        MainJS <--> Shell["shell.showItemInFolder"]
    end

    RenderJS <-->|Secure API Calls| Preload
    Preload <-->|IPC Channels| MainJS
```

- **Main Process (`main.js`)**: Executes in Node.js, holds full OS access, spawns asynchronous child processes for checking and updating `yt-dlp`, executes the download commands, and streams shell outputs back to the GUI.
- **Preload Script (`preload.js`)**: A secure, isolated context bridge exposing only specific, safe IPC methods to the frontend without exposing Node.js primitives.
- **Renderer Process (`renderer.js`)**: The frontend UI that captures user events, displays download progress logs, updates localStorage history, and communicates with the preload bridge.

---

## System Prerequisites

The application is fully self-contained and automatically configures its environment:

1. **`yt-dlp`**: Automatically downloaded and setup locally in the application's userData directory on first launch if not already available in the system PATH.
2. **`ffmpeg`**: Automatically downloaded, extracted, and setup locally in the application's userData directory on first launch if not already available in the system PATH.

*Note: If you already have these tools installed in your system PATH, the application will detect them automatically and skip downloading.*

---

## Getting Started

### 📦 Download Precompiled Binaries
You can download the latest precompiled standalone Windows installer (`.exe`) directly from the **[Releases Page](https://github.com/eact6/youtube-downloader/releases)**.

### 🛠️ Local Developer Setup

#### 1. Installation
Clone the repository and install the project dependencies:

```bash
git clone https://github.com/eact6/youtube-downloader.git
cd youtube-downloader
npm install
```

#### 2. Development Mode
Launch the Electron window in development mode:

```bash
npm start
```

#### 3. Packaging & Building

Compile and bundle the production-ready standalone Windows installer (`.exe`) using **electron-builder**:

```bash
npm run dist
```

This encapsulates all code and maps designated icons (`build/icon.png`) into a single setup executable.

---

## Automated Skills System

This repository includes a localized, project-specific skill directory under `.skills/` to guide developers and automation tools. 

- **Changelog & README Updater Skill** ([SKILL.md](.skills/changelog-updater/SKILL.md)): Instructs developers to automatically document all workspace changes, features, and refactoring under appropriate Semantic Version blocks in `CHANGELOG.md` and keep the master `README.md` updated as new features or configurations are added.

---

## License

This project is licensed under the MIT License. Feel free to use, modify, and distribute it for personal and commercial applications.
