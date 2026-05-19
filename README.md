# YouTube Downloader (yt-dlp GUI Wrapper)

A premium, open-source desktop application that wraps the powerful `yt-dlp` command-line utility in a beautifully designed Electron GUI. Built for content creators, video editors, and power users who need high-quality, reliable media downloads with a seamless user experience.

---

## Key Features

- 🎥 **High-Quality Video Downloads**: Pair high-resolution video streams with the best matching audio formats (optimized for Adobe After Effects compatibility with standard H.264 MP4 wrapping).
- 🎵 **Variable Bitrate MP3 Extraction**: Extract pure, high-quality audio streams encoded directly to MP3 (up to 320kbps Variable Bitrate level 0) via `ffmpeg`.
- 💬 **Subtitle Extraction**: Download YouTube closed-captions and standard subtitles in English and other languages instantly without downloading the video itself.
- 🎨 **Shadcn-Inspired Design**: A sleek, fully responsive true dark-mode dashboard featuring modern glassmorphism elements, Lucide UI icons, and smooth micro-animations.
- ⚡ **Asynchronous Background Checkers**: Instant verification of `yt-dlp` updates and `ffmpeg` availability on application launch, keeping the UI fully interactive.
- 🕒 **Cached Recents History**: Locally cached history (via `localStorage`) showing active YouTube thumbnails fetched dynamically from video IDs.
- 📁 **Direct Folder Navigation**: Instantly reveal downloaded items in Windows Explorer with a single click on history thumbnails.

---

## Technical Architecture

The application strictly separates backend OS processes from the frontend rendering layer for security, utilizing Electron's safe IPC bridge architecture.

```mermaid
graph TD
    subgraph Renderer [Renderer Process (Chromium)]
        UI["HTML/CSS Dashboard"] <--> RenderJS["renderer.js"]
    end

    subgraph Bridge [Bridge (Context Isolation)]
        Preload["preload.js (contextBridge)"]
    end

    subgraph Main [Main Process (Node.js)]
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

To run this application, ensure the following command-line tools are accessible on your system's environment PATH:

1. **`yt-dlp`**: The core media extraction tool. It will check and auto-update itself on application launch if it has permission.
2. **`ffmpeg`**: Required for merging video and audio streams, as well as extracting and encoding MP3 audio.

---

## Getting Started

### 1. Installation

Clone the repository and install the project dependencies:

```bash
git clone https://github.com/your-username/youtube-downloader.git
cd youtube-downloader
npm install
```

### 2. Development Mode

Launch the Electron window in development mode:

```bash
npm start
```

### 3. Packaging & Building

Compile and bundle the production-ready standalone Windows installer (`.exe`) using **electron-builder**:

```bash
npm run dist
```

This encapsulates all code and maps designated icons (`build/icon.png`) into a single setup executable.

---

## Automated Skills System

This repository includes a localized, project-specific AI skill directory under `.skills/` to guide artificial intelligence pair programmers. 

- **Changelog & README Updater Skill** ([SKILL.md](file:///c:/Users/omerb/Desktop/antigravity/youtube%20downloader/.skills/changelog-updater/SKILL.md)): Instructs AI developers to automatically document all workspace changes, features, and refactoring under appropriate Semantic Version blocks in `CHANGELOG.md` and keep the master `README.md` updated as new features or configurations are added.

---

## License

This project is licensed under the MIT License. Feel free to use, modify, and distribute it for personal and commercial applications.
