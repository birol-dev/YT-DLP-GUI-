# YT-DLP GUI Wrapper Reference

This document serves as a technical reference for the Electron-based GUI built around `yt-dlp` and `ffmpeg`. It explains the architecture, IPC messaging, custom utility modules, and the specific underlying commands used to achieve downloading, clipping, dividing, and song recognition.

## Architecture & Communication Flow

The application utilizes a secure, isolated Electron architecture to partition local OS execution from visual rendering.

- **Main Process (`main.js`)**: Orchestrates window creation, initializes settings, coordinates file system layout, manages background checks/auto-downloads for binaries, and runs `child_process.spawn()` to invoke `yt-dlp` and `ffmpeg`.
- **Preload Script (`preload.js`)**: Connects the renderer to the backend using Electron's `contextBridge`. It exposes limited, sanitized APIs (e.g., download triggers, folder actions, settings read/write, weather data triggers, and scan status callbacks) to avoid exposing Node's global object in the renderer.
- **Renderer Process (`renderer.js`, `index.html`, `styles.css`)**: Implements a highly polished, Shadcn-inspired dark mode interface. Handles user event bindings, updates download/processing state panels, renders lists (like Recents and Music Finder tracks) dynamically, and interfaces with the exposed preload APIs.

### Inter-Process Communication (IPC)
Most processes follow a standard callback or message payload loop:
1. **Renderer**: Dispatches an action (e.g., `window.electronAPI.scanYoutubeUrl(url)`).
2. **Preload**: Encapsulates and registers IPC events (e.g., `ipcRenderer.send('scan-youtube-url', url)`).
3. **Main**: Listens to IPC channels (`ipcMain.on` / `ipcMain.handle`), executes the operations, and replies asynchronously back to the window via `win.webContents.send()`.
4. **Renderer**: Subscribes to events (like progress bars and activity logs) and updates UI states.

---

## Native Binary Management
On startup, `main.js` performs dependency audits for the required binary files. If any binary is missing, the app triggers a setup modal that downloads and extracts zip/tarballs from static repository URLs:
- **`yt-dlp`**: Downloaded directly from the official releases repository (`yt-dlp.exe` on Windows).
- **`ffmpeg`**: Pulled from prebuilt binary releases to handle format conversions, clipping, and video processing tasks.
- **`fpcalc`**: The Chromaprint fingerprinting utility, downloaded from AcoustID releases and extracted dynamically into the app's local user data binary directory.

---

## Core Feature Workflows & Commands

### 1. Video Downloads (Adobe After Effects Compatibility)
Constructs specific stream parameters to download H.264 video paired with M4A audio. This format imports seamlessly into After Effects without codec errors.
- **Command Arguments**:
  ```js
  '-f', 'bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  '--merge-output-format', 'mp4'
  ```
- **Directory**: Saved to `Downloads/yt-videos/`.

### 2. Audio Downloads
Downloads the highest quality raw audio streams and transcodes them into high-fidelity MP3 files.
- **Command Arguments**:
  ```js
  '-f', 'bestaudio',
  '-x',
  '--audio-format', 'mp3',
  '--audio-quality', '0'
  ```
- **Directory**: Saved to `Downloads/yt-audios/`.

### 3. Subtitles Extractor
Retrieves closed-captioning files without downloading video streams.
- **Command Arguments**:
  - Individual languages: `--write-subs`, `--write-auto-subs`, `--sub-langs [lang].*`, `--skip-download`
  - All languages: `--write-subs`, `--write-auto-subs`, `--all-subs`, `--skip-download`
- **Directory**: Saved to `Downloads/yt-subs/`.

### 4. Instagram Media Downloader
Supports downloading Reels, Posts, and IGTV videos as video clips or raw MP3 extractions.
- **Video Arguments**:
  ```js
  '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  '--merge-output-format', 'mp4'
  ```
- **Audio Arguments**: Extracts audio as MP3 at maximum quality.
- **Directories**: Saved to `Downloads/ig-videos/` or `Downloads/ig-audios/`.

### 5. Video Clipper
Features a stream preview layout that queries metadata JSON and plays compatible MP4/webm video streams directly inside the HTML player.
- **Command Arguments**: Uses `yt-dlp`'s range-cut command parameter to avoid downloading the whole file:
  ```js
  '--download-sections', `*${startTime}-${endTime}`
  ```
- **Directories**: Saved to `Downloads/yt-videos/` or `Downloads/yt-audios/` based on format.

### 6. Video Divider
Automates slicing local video files or YouTube source downloads into divided sections or segments using a linear FFmpeg job queue in `main.js`.
- **Modes**:
  - **Fast Split**: Splits instantly on keyframe bounds without re-encoding:
    `['-ss', startTime, '-i', inputPath, '-t', duration, '-c', 'copy', outputPath]`
  - **Precise Split**: Re-encodes frames around cuts for precise cutting bounds:
    `['-i', inputPath, '-ss', startTime, '-to', endTime, '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', outputPath]`
  - **Equal Chunks**: Chops the timeline into equal duration segments:
    `['-i', inputPath, '-c', 'copy', '-f', 'segment', '-segment_time', time, '-reset_timestamps', '1', outputPattern]`
  - **Spatial Split**: Crops the video canvas into quadrant regions:
    - Left crop filter: `-vf crop=iw/2:ih:0:0`
    - Right crop filter: `-vf crop=iw/2:ih:iw/2:0`
    - Top crop filter: `-vf crop=iw:ih/2:0:0`
    - Bottom crop filter: `-vf crop=iw:ih/2:0:ih/2`
- **Directory**: Saved to `Downloads/yt-divided/[sanitized_video_name]/`.

### 7. Music Finder (Audio Fingerprinting)
Slices any audio/video target locally to run song searches against the AcoustID database.
- **Slicing**: Spawns `fluent-ffmpeg` to write 12-second wave slices every 90 seconds.
- **Fingerprinting**: Spawns local `fpcalc` binary on each clip to generate Chromaprint string hashes.
- **Lookup Service**: Sequentially queries the AcoustID API:
  `https://api.acoustid.org/v2/lookup?client=${apiKey}&meta=recordings+releasegroups&duration=12&fingerprint=${fingerprint}`
- **Rate-Limiting**: Applies a strict 350ms delay between fetches to respect database limits (maximum 3 requests/second).
- **Deduplication**: Eliminates matching adjacent track results (by MBID or normalized title/artist comparisons) to list chronological appearances.
- **Cover Art**: Connects to the Cover Art Archive release group schema (`https://coverartarchive.org/release-group/{mbid}/front-250`) to render thumbnails, falling back to a vinyl record vector representation on error.
- **UI State Machine**: Manages transitions between `input`, `loading`, `error`, and `results` views, isolating errors cleanly inside an inline destructive red alert banner (`#musicfinder-error-zone`) rather than using default system dialog pop-ups.

---

## Shared UI Components & State

### Settings Management
Settings are stored locally in `settings.json` within the app's `userData` folder.
- Key properties include download directories, default media qualities, interface themes, and the user's local AcoustID API Key (`acoustidKey`).

### Weather Widget
Featured dynamically in headers of main downloading screens. Resolves user coordinates dynamically to render a custom weather card with automatic search suggestions.

### Recents Log
Maintains a log of finished downloads in browser `localStorage`. Uses regular expressions to extract YouTube 11-character video IDs and render thumbnails asynchronously. Clicking thumbnails invokes native platform folder highlights via Electron's `shell.showItemInFolder()`.

---

## Packaging & Distribution
Bundled via `electron-builder` into NSIS executables for Windows.
- Target configuration details are maintained in `package.json` (`build` block).
- Build scripts:
  - `npm run pack` (directory build)
  - `npm run dist` (standalone setup bundle generation)
