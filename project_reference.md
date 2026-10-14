# YT-DLP GUI Wrapper Reference

This document serves as a technical reference for the Electron-based GUI built around `yt-dlp` and `ffmpeg`. It explains the architecture, IPC messaging, custom utility modules, and the specific underlying commands used to achieve downloading, clipping, dividing, GIF conversion, stream capture, and song recognition.

## Architecture & Communication Flow

The application utilizes a secure, isolated Electron architecture to partition local OS execution from visual rendering.

- **Main Process (`main.js` + `src/main/`)**: `main.js` creates the window, registers the privileged `media-preview://` and `browser-proxy://` schemes, initializes settings, and runs the startup dependency check. Every feature lives in its own module under `src/main/`; each module registers its IPC handlers when `main.js` requires it and publishes its helpers on the shared context object in `src/main/ctx.js`. Modules invoke `yt-dlp`, `ffmpeg`, and `fpcalc` through `child_process.spawn()`.
- **Preload Script (`preload.js`)**: Connects the renderer to the backend using Electron's `contextBridge`. It exposes a limited, sanitized `window.electronAPI` (download triggers, folder actions, settings read/write, dependency management, scan status callbacks, browser view controls, etc.) and never exposes Node globals to the renderer.
- **Renderer Process (`index.html`, `styles.css`, `renderer/`)**: Implements a highly polished, Shadcn-inspired dark mode interface. `index.html` loads `renderer/index.js` as an ES module, which imports one module per tab or feature and shares mutable state through `renderer/state.js`. The root `renderer.js` is a leftover stub from before the module split and is not loaded.

### Main Process Modules (`src/main/`)

| Module | Responsibility |
|--------|----------------|
| `ctx.js` | Shared context object that modules attach their state and helpers to |
| `cache.js` | `SimpleLRUCache` plus caches for probe metadata, playlist probes, video info, and sniffed media URLs |
| `progress.js` | Throttled IPC progress sender (avoids flooding the renderer with stdout chunks) |
| `process-registry.js` | Tracks spawned processes; `killProcessTree` / `stopAllBlockingTasks` for cancel and channel switches |
| `paths.js` | `userData/bin` binary paths; falls back to `yt-dlp` / `ffmpeg` / `fpcalc` on `PATH` |
| `settings.js` | Default settings, `settings.json` load, debounced save, synchronous flush on quit |
| `ytdlp.js` | yt-dlp channels, binary replacement, version detection, update check, cookie args, cookie tester, `runYtDlpProcess` |
| `deps.js` | First-run dependency installer, FFmpeg version checks and updates, combined update manager |
| `folders.js` | Open folder / reveal file (incl. Linux file manager detection), open file, native file drag-out |
| `dialogs.js` | Folder and cookies-file pickers |
| `downloads.js` | Video, audio, subtitles, and Instagram downloads; playlist probe; cancel; clipboard |
| `clipper.js` / `clipper-streams.js` | Clipper metadata + preview stream selection, preview remux, section downloads, googlevideo header rewrites |
| `twitch.js` / `twitch-helpers.js` | Twitch VOD info + downloads; pure URL / format / argument / progress helpers |
| `divider.js` | `probeLocalVideo` (FFmpeg metadata probe), divider import, FFmpeg split job queue |
| `gif.js` | Video to GIF conversion |
| `scan.js` | Music Finder slicing, AcoustID / ACRCloud lookups |
| `browser-view.js` | In-app browser (`WebContentsView`), media sniffer, stream capture, `media-preview` / `browser-proxy` protocol handlers |
| `onboarding.js` | System info, dependency audit, and onboarding completion |

`clipper-streams.js` and `twitch-helpers.js` have no Electron dependency so the unit tests can `require` them under plain Node.

### Inter-Process Communication (IPC)
Most processes follow a standard callback or message payload loop:
1. **Renderer**: Dispatches an action (e.g., `window.electronAPI.scanYoutubeUrl(url)`).
2. **Preload**: Forwards it over IPC (e.g., `ipcRenderer.send('scan-youtube-url', url)`), or uses `ipcRenderer.invoke()` for request/response calls.
3. **Main**: Listens to IPC channels (`ipcMain.on` / `ipcMain.handle`), executes the operations, and either returns a value (for `invoke`) or replies asynchronously back to the window via `win.webContents.send()`.
4. **Renderer**: Subscribes to events (like progress bars and activity logs) and updates UI states.

---

## Native Binary Management
When the window finishes loading and onboarding is complete, `main.js` audits the required binaries. On first run, or if any binary is missing, it calls `setupDependencies`, which shows the setup modal and downloads and extracts the binaries into `userData/bin`. Otherwise it silently syncs the yt-dlp channel and, unless **Automatic Background Updates** is turned off, runs the update manager. Before onboarding is complete, the onboarding wizard audits dependencies itself and `finish-onboarding` triggers the same setup.
- **`yt-dlp`**: Downloaded from the selected release channel's `releases/latest/download/` asset (`yt-dlp.exe`, `yt-dlp_macos`, or `yt-dlp`).
- **`ffmpeg`**: Pulled from prebuilt [ffbinaries](https://github.com/ffbinaries/ffbinaries-prebuilt/releases) zips (v6.1 on first setup; the latest ffbinaries tag on updates) to handle format conversions, clipping, and video processing tasks.
- **`fpcalc`**: The Chromaprint fingerprinting utility, downloaded from the AcoustID `chromaprint` v1.6.0 releases and moved out of its nested archive folder into `userData/bin`.

Binaries already on the system `PATH` are detected and not downloaded.

### yt-dlp Release Channels & Binary Management
Users can hot-swap yt-dlp builds from **Settings → yt-dlp Release Channel** without restarting the app, and force-update builds at any time. Fresh installs default to **Master**; settings files created before channel support existed fall back to **Stable**.

| Channel | Source | Best for |
|---------|--------|----------|
| **Stable** | [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) | Maximum reliability; tested releases |
| **Nightly** | [yt-dlp-nightly-builds](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases) | Latest daily patches |
| **Master** | [yt-dlp-master-builds](https://github.com/yt-dlp/yt-dlp-master-builds/releases) | Bleeding-edge fixes; required for most Instagram downloads |

**How Hot-Swapping & Force Updates Work**
1. **Stop Blocking Tasks**: `stopAllBlockingTasks` kills every tracked process tree (downloads, scans, divider jobs, GIF conversions, stream captures) and, on Windows, any stray `yt-dlp.exe`, then notifies the renderer.
2. **Direct Clean Downloads**: The application downloads the authentic release binary directly from the respective GitHub channel release URL into a `yt-dlp.tmp_<timestamp>` file, bypassing yt-dlp CLI internal updater quirks and version downgrade restrictions.
3. **Windows-Safe Binary Replacement**: `replaceLocalBinary` rejects downloads under 1 MB, renames the current binary to a `.old_<timestamp>_<random>` backup, and retries up to 6 times with a linearly increasing delay (300 ms × attempt) to ride out Windows / antivirus executable locks (`EPERM`, `EBUSY`, `EACCES`). From the second attempt it also runs `taskkill` on the locked executable. If the new binary cannot be moved into place, the backup is restored. Leftover `.old_` / `.tmp` files are cleaned up afterwards.
4. **Verification**: Newly installed binaries are inspected via `yt-dlp -v` (falling back to `--version`) to resolve the version string and the channel from the `[debug] yt-dlp version <channel>@<version> from <repo>` line.
5. **Force Update**: A dedicated **Force Update yt-dlp** action re-downloads and reinstalls the latest release for the active channel on demand.
6. **Persistence**: Settings automatically persist `ytDlpChannel`, `ytDlpInstalledChannel`, and `ytDlpInstalledVersion`.

While a switch or force update is running, new downloads, probes, and cookie tests are refused with a "channel switch in progress" message.

**IPC**
- `get-yt-dlp-info` → returns installed version, selected channel, installed channel, and local/PATH status
- `switch-yt-dlp-channel` → performs an immediate foolproof channel switch
- `force-update-yt-dlp` → forcefully downloads and reinstalls the latest release build for the selected channel
- `yt-dlp-channel-changed` → pushed to renderer after a successful switch, force update, or update check

### Automatic Component Updates
`checkAndUpdateAllDependencies` (in `deps.js`) runs at startup when `autoUpdateDependencies` is on, and on demand from Settings. Only one check runs at a time.
- **yt-dlp** (`checkUpdates`): If yt-dlp processes are busy, the check is postponed and retried up to 3 times, 5 seconds apart. Otherwise it runs `yt-dlp --update-to <channel>` without browser cookies; if that fails, it downloads the channel's latest binary directly from GitHub Releases.
- **FFmpeg** (`checkFfmpegUpdate`): If a local FFmpeg is older than the FFmpeg on the system `PATH`, the local copy is deleted so the newer system build is used. It then compares the installed version against the latest ffbinaries tag and only updates when the remote build is strictly newer (or FFmpeg is missing), so it never downgrades.
- **Events**: `dependency-update-status` (phases `checking`, `progress`, `downloading`, `extracting`, `completed`) drives the update toast and the Settings summary; `update-log` lines go to the status terminal.
- **IPC**: `check-all-updates` (`{ force }` force-reinstalls yt-dlp), `update-ffmpeg`, `get-ffmpeg-info`.
- **Settings**: `autoUpdateDependencies`, `ffmpegInstalledVersion`, `lastUpdateCheck`.

### yt-dlp Invocation & Cookies
- **`runYtDlpProcess`** (used for probes, metadata fetches, preview remuxes, cookie tests, and update checks) prefixes `--ffmpeg-location <local ffmpeg>` when a local FFmpeg exists and, when a Node.js binary is found on `PATH`, `--js-runtimes node:<path> --remote-components ejs:github` so YouTube's JavaScript challenges can be solved. Download handlers spawn yt-dlp directly and add `--ffmpeg-location <userData/bin>` when a local FFmpeg exists.
- **Cookies** (`appendYtDlpCookieArgs`, driven by the **Browser Cookies** settings):
  - An installed browser: `--cookies-from-browser <browser>[:<profile>]`
  - `file`: `--cookies <cookiesFile>` (Netscape format)
  - `app-browser`: the in-app browser session's cookies are exported to `userData/app-cookies.txt` and passed with `--cookies`
- **Cookie tester** (`test-browser-cookies`): runs `--simulate` on a public YouTube video, probes the Watch Later / subscriptions / Liked feeds to detect a signed-in YouTube session, and optionally checks a user-supplied test URL.

---

## Core Feature Workflows & Commands

All downloads save under the base download folder from Settings (default: the OS Downloads folder) with the output template `%(title)s.%(ext)s` and `--no-mtime`, except where noted.

### 1. Video Downloads (Adobe After Effects Compatibility)
The default MP4 container requests H.264 video paired with M4A audio, which imports seamlessly into Premiere Pro and After Effects without codec errors. `quality` is the **Max Quality** selection (default from Settings).
- **Command Arguments** (MP4 default):
  ```js
  '-f', `bestvideo[vcodec^=avc1][height<=${quality}]+bestaudio[ext=m4a]/best[ext=mp4]/best`,
  '--merge-output-format', 'mp4'
  ```
- **Other containers**: MKV uses `bestvideo[height<=${quality}]+bestaudio/best`; WebM uses `bestvideo[ext=webm][height<=${quality}]+bestaudio[ext=webm]/best[ext=webm]/best`.
- **Playlists**: For playlist-looking URLs the renderer first calls `probe-playlist` (`--flat-playlist --dump-single-json`) to show the playlist title and item count in the progress banner; yt-dlp then downloads every item.
- **Directory**: Saved to `Downloads/yt-videos/`.

### 2. Audio Downloads
Downloads the best audio stream and converts it to the **Preferred Audio Format** from Settings (MP3, M4A, WAV, or FLAC).
- **Command Arguments**:
  ```js
  '-f', 'bestaudio',
  '-x',
  '--audio-format', audioFormat,
  '--audio-quality', '0'   // MP3 only (LAME V0 VBR)
  ```
- **WAV output** is FFmpeg's default WAV encoding: 16-bit PCM (`pcm_s16le`) at the source sample rate.
- **Directory**: Saved to `Downloads/yt-audios/`.

### 3. Subtitles Extractor
Retrieves uploaded and auto-generated captions without downloading video streams.
- **Command Arguments**:
  - Common: `--write-subs`, `--write-auto-subs`, `--skip-download`, `--compat-options no-live-chat`, `--no-abort-on-error`
  - Individual language: `--sub-langs <lang>,<lang>-orig,<lang>-<lang>,^<lang>(?:-[A-Za-z]{2})?$`. The language list is deliberately narrow: a greedy `<lang>.*` pattern also matches YouTube's 100+ auto-translated tracks (`en-de`, …) and triggers HTTP 429 rate limiting.
  - All languages: `--all-subs`
- **Success**: A run that exits non-zero still counts as success if a subtitle file was written.
- **Directory**: Saved to `Downloads/yt-subs/`.

### 4. Instagram Media Downloader
Supports downloading Reels, Posts, and IGTV videos as video clips or audio extractions. URLs are normalized (query string and hash stripped), and a local yt-dlp on the selected channel is installed first if needed.
- **Video Arguments** (MP4 default; MKV / WebM follow the same pattern as YouTube without the height cap):
  ```js
  '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  '--merge-output-format', 'mp4'
  ```
- **Audio Arguments**: Same as YouTube audio, using the Preferred Audio Format.
- **Errors**: Login / rate-limit / empty-media failures get a hint to configure browser cookies or switch to the Master channel.
- **Directories**: Saved to `Downloads/ig-videos/` or `Downloads/ig-audios/`.

### 5. Video Clipper
Loads metadata with `yt-dlp --dump-json` (`fetch-video-info`) and plays a preview inside the HTML player.
- **Preview selection** (`extractStreamUrls` in `clipper-streams.js`): prefers a combined progressive stream (format 18 or a ≤720p MP4); otherwise picks a separate H.264 video-only stream (360p/480p first) plus an M4A audio stream that `renderer/clipper.js` keeps in sync with a hidden `<audio>` element.
- **Remux fallback**: If no direct stream is usable, yt-dlp downloads an H.264 + AAC preview (480p or lower preferred) with `-movflags +faststart` into `userData/clipper-previews/` (cached by URL hash), served through `media-preview://`.
- **YouTube headers**: Requests to `googlevideo.com` / `youtube.com` get a YouTube `Referer` / `Origin` and permissive CORS response headers so the preview can stream.
- **Command Arguments**: Uses `yt-dlp`'s range-cut parameter to avoid downloading the whole file, forcing keyframes at the cut points:
  ```js
  '--download-sections', `*${startTime}-${endTime}`,
  '--force-keyframes-at-cuts'
  ```
  Output template: `%(title)s_clip_%(section_start)s_%(section_end)s.%(ext)s`.
- **Directories**: Saved to `Downloads/yt-videos/` or `Downloads/yt-audios/` based on format.

### 6. Twitch VOD Downloader
Loads a Twitch VOD, highlight or clip, lists its real renditions, and downloads either the full video or a trimmed in/out range.
- **Modules**: `src/main/twitch.js` (IPC handlers) and `src/main/twitch-helpers.js` (pure URL / format / argument / progress helpers, unit-tested without Electron); UI in `renderer/twitch.js`.
- **IPC**: `fetch-twitch-info` (invoke) returns title, channel, duration, thumbnail, chapters, qualities and a preview stream URL from `yt-dlp --dump-json`. `download-twitch-vod` (send) starts the download and reports through the shared `download-status` / `download-progress` / `download-complete` / `download-error` channels.
- **Preview**: The `<video>` element plays the rendition closest to 480p directly (Chromium's native HLS support), including seeking across multi-hour VODs.
- **Full VOD arguments**:
  ```js
  '-f', `${formatId}/best`, '--remux-video', container, '--concurrent-fragments', fragments, '--embed-metadata'
  ```
- **Trimmed range arguments** (FFmpeg fetches only the needed segments):
  ```js
  '--download-sections', `*${start}-${end}`, '--embed-metadata', '--no-embed-chapters'
  // plus '--force-keyframes-at-cuts' when "Frame-accurate cut" is enabled
  ```
- **Audio**: `'-f', 'Audio_Only/bestaudio/best', '-x', '--audio-format', audioFormat`.
- **Progress**: Range downloads print FFmpeg stats instead of percentages; the main process converts `time=` / `size=` / `speed=` into a yt-dlp style `[download]  45.2% of ~ ... ETA ...` line and drops FFmpeg chatter.
- **Final path**: Resolved with `--print-to-file after_move:filepath` (Unicode-safe), falling back to stdout parsing.
- **Directory**: Saved to `Downloads/twitch-vods/`.

### 7. Video Divider
Slices local video files or imported YouTube downloads into sections or segments using a sequential FFmpeg job queue in `src/main/divider.js`. Every job runs with `-y` (overwrite).
- **Import**: `divider-import-url` downloads the source with the same arguments as a Video download into `Downloads/yt-divided/sources/`, then probes it.
- **Modes**:
  - **Fast Split**: Splits instantly on keyframe bounds without re-encoding:
    `['-ss', startTime, '-i', inputPath, '-t', duration, '-c', 'copy', outputPath]`
  - **Precise Split**: Re-encodes the selected range for frame-accurate cut points:
    `['-i', inputPath, '-ss', startTime, '-to', endTime, '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'aac', outputPath]`
  - **Equal Chunks**: Chops the timeline into equal duration segments named `part000`, `part001`, …:
    `['-i', inputPath, '-c', 'copy', '-f', 'segment', '-segment_time', time, '-reset_timestamps', '1', outputPattern]`
  - **Spatial Split**: Crops the video canvas into halves, re-encoding video (`libx264 -preset faster -crf 18`) and copying audio:
    - Left crop filter: `-vf crop=iw/2:ih:0:0`
    - Right crop filter: `-vf crop=iw/2:ih:iw/2:0`
    - Top crop filter: `-vf crop=iw:ih/2:0:0`
    - Bottom crop filter: `-vf crop=iw:ih/2:0:ih/2`
- **Directory**: Saved to `Downloads/yt-divided/[sanitized_video_name]/`.

### 8. Video to GIF Converter
Converts a trimmed range of a local video into an animated GIF with a generated palette (`convert-video-to-gif`, progress on `gif-progress`, result on `gif-finished`).
- **Command Arguments**:
  ```js
  '-ss', startTime, '-t', duration, '-i', inputPath,
  '-vf', `fps=${fps},scale=${width}:-1:flags=bicubic,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`
  ```
  `width` is `iw` when **Original** is selected.
- **Directory**: Saved to `Downloads/gif-exports/` as `<sanitized_name>_<timestamp>.gif`.

### 9. Music Finder (Audio Fingerprinting & Service Selection)
Slices any audio/video target locally to search and identify songs against either the AcoustID or ACRCloud database. YouTube URLs are first downloaded as MP3 into a temp cache (`yt-music-finder-cache`), scanned, then deleted.
- **Service Selector**: A dropdown selector (`#musicfinder-service-selector`) on the Music Finder tab lets users toggle between AcoustID (Free) and ACRCloud. A Preferred Service setting dropdown is also located on the Settings tab, synchronized bidirectionally.
- **Scan Interval Slider**: Adjustable range sliders exist in both the Settings tab (`#settings-scan-interval`, min 10s, max 180s) and directly inside the Music Finder tab itself (`#musicfinder-scan-interval`). The two sliders are dynamically synchronized in real-time, and changing either slider automatically updates settings on disk.
- **Drag & Drop Visual Transitions**: Dragging files anywhere over the Music Finder card panel (`#musicfinder-card`) triggers a visual boundary focus transition, rendering the card border in `hsl(var(--primary))` to indicate drop targets.
- **Slicing**: Uses `fluent-ffmpeg` to write mono 16 kHz WAV slices every `acoustidScanInterval` seconds. The slice duration is calculated dynamically as `Math.min(30, Math.floor(duration))` (up to 30 seconds).
- **AcoustID Recognition Engine**:
  - Spawns local `fpcalc` binary on each clip to generate Chromaprint string hashes.
  - Queries the AcoustID lookup API with the total audio duration:
    `https://api.acoustid.org/v2/lookup?client=${apiKey}&meta=recordings+releasegroups&duration=${Math.round(duration)}&fingerprint=${fingerprint}`
  - Best Metadata Selection: Sorts results by score and prefers recordings that contain both a valid title and artists, falling back to the first recording of the best match.
  - Cover Art: Connects to the Cover Art Archive release group schema (`https://coverartarchive.org/release-group/{mbid}/front-250`) to render thumbnails.
- **ACRCloud Recognition Engine**:
  - Skips the local `fpcalc` fingerprint step. Reads the local sliced `.wav` file binary into a native `Blob`.
  - Calculates a secure HMAC-SHA1 signature using Node's `crypto` module based on http-method, path (`/v1/identify`), access key, data-type (`audio`), signature version (`1`), and current Unix timestamp.
  - Dispatches a multipart `FormData` POST request containing the audio blob, Access Key, signature, and metadata directly to the regional project host (e.g. `identify-us-west-2.acrcloud.com`).
  - Cover Art: Dynamically checks `external_metadata.spotify` in the JSON response and extracts Spotify Album cover artwork URLs.
- **Rate-Limiting**: Waits 350ms between slices (AcoustID allows at most 3 requests/second).
- **Deduplication**: Eliminates matching adjacent track results (by AcoustID recording ID, ACRCloud ACRID, or normalized title/artist comparisons) to list chronological appearances.
- **UI State Machine**: Manages transitions between `input`, `loading`, `error`, and `results` views, isolating errors cleanly inside an inline destructive red alert banner (`#musicfinder-error-zone`) rather than using default system dialog pop-ups.

### 10. In-App Browser & Media Sniffer
A `WebContentsView` overlaid on the Browser tab (`browser-view-init`, `-load`, `-control`, `-resize`, `-hide`; `browser-clear-data` wipes its storage and cache).
- **Header handling**: Outgoing requests get a desktop Chrome User-Agent, client hints, and a `Referer` / `Origin` derived from the current page. Responses have `X-Frame-Options`, CSP, and COOP/COEP/CORP headers removed and CORS headers rewritten so embedded players load. Known embed-player iframes are fetched with the page as Referer and hydrated via `srcdoc`; a CDP `Fetch` interception injects the Referer for those hosts.
- **Sniffing**: Responses whose URL extension or `Content-Type` looks like media (`.mp4`, `.mkv`, `.webm`, `.mp3`, `.aac`, `.wav`, `.ogg`, `.m3u8`, `.mpd`, `video/*`, `audio/*`, HLS / DASH MIME types; `.ts` segments excluded) are deduplicated and sent as `media-detected`, then probed in the background with FFmpeg (`media-probed`).
- **Stream capture** (`download-media-stream`): `ffmpeg -headers <UA + Referer> -i <url> -c copy <output>`, saved to `Downloads/yt-videos/` (or `yt-audios/` for audio-only content types).
- **Protocols**: `media-preview://fetch?url=…&pageUrl=…` proxies remote media through the guest session with the page as Referer (used by the sniffer preview modal). The same handler serves local `file:` URLs (`media-preview://local/?url=file:…`, used by Clipper previews) only from `userData`, the download folder, or temp. `browser-proxy://` fetches embed documents with Referer fallbacks.

---

## Shared UI Components & State

### Settings Management
Settings are stored locally in `settings.json` within the app's `userData` folder. Saves are merged in memory and written to disk after a 120 ms debounce, and flushed synchronously when the app quits.
- **Auto-Save**: All setting controls (download folders, video/audio formats, default qualities, theme colors, notification sounds, weather location, cookies, and API keys) auto-save seamlessly in real-time with debouncing for text inputs and immediate persist for dropdowns, toggles, and buttons.
- Key properties include `downloadDir`, `defaultQuality`, `defaultSubLang`, `videoFormat`, `audioFormat`, `accentColor`, `soundEnabled`, `autoOpenFolder`, weather location fields, cookie settings (`cookiesFromBrowser`, `cookiesBrowserProfile`, `cookiesFile`), Music Finder credentials (`acoustidKey`, `acrcloudKey`, `acrcloudSecret`, `acrcloudHost`, `musicFinderService`, `acoustidScanInterval`), and the yt-dlp / FFmpeg update state. See `initSettings` in `src/main/settings.js` for the full list of defaults.

### Weather Widget
Featured dynamically in headers of main downloading screens. Resolves user coordinates dynamically to render a custom weather card with automatic search suggestions.

### Active In-Progress Download Card
A real-time progress banner (`.active-download-card`) that replaces the basic progress bar during downloads to inform users what is downloading:
- **Thumbnail / Media Icon**: Renders the video thumbnail dynamically from extracted YouTube video IDs (or a supplied thumbnail URL, e.g. Twitch) or an animated spinner icon.
- **Format & Quality Badge**: Dynamically indicates the chosen configuration (e.g. `VIDEO • 1080P MP4`, `AUDIO • MP3`, `INSTAGRAM • REEL`, `SUBTITLES • EN`, `CLIP`, `TWITCH`).
- **Live Video Title & Phase**: Displays the video title/filename and current pipeline phase (`Downloading media stream...`, `Merging video and audio...`, `Extracting audio track...`).
- **Live Transfer Metrics**: Formats `yt-dlp` stdout progress data to display download file size, transfer speed, and estimated time remaining (ETA).
- **Cancel**: The cancel button calls `cancel-download`, which stops all tracked tasks.

### Download Complete Components
Dedicated, theme-adaptive completion cards (`.download-complete-card`) integrated into every download tab (**Video**, **Audio**, **Instagram**, **Subtitles**, **Video Clipper**, **Twitch VODs**, **Video Divider**, and **Video to GIF**).
- **Triggers**: When `window.electronAPI.onDownloadComplete` receives payload `{ type, url, filePath, status, thumbnail? }`, `showDownloadCompleteCard()` renders the card on the appropriate tab pane.
- **Features**:
  - **Open Folder Button**: Directly invokes `window.electronAPI.openFolder(filePath)` to reveal the file in the OS file manager via Electron's `shell.showItemInFolder()` (or a detected file manager on Linux).
  - **Play / Open Button**: Launches the downloaded media immediately via `window.electronAPI.openFile(filePath)`.
  - **Copy Path Button**: Copies the full file path to the clipboard with visual checkmark feedback.
  - **Drag-and-Drop Thumbnail**: Supports native OS dragging from the preview container directly into Premiere Pro, After Effects, DaVinci Resolve, or File Explorer.
  - **Dismiss**: Hides the card. Starting a new download automatically resets/hides previous completion cards.

### Recents Log
Maintains a log of finished downloads in browser `localStorage`. Uses regular expressions to extract YouTube 11-character video IDs and render thumbnails asynchronously. Clicking thumbnails invokes native platform folder highlights via Electron's `shell.showItemInFolder()`. Double-clicking opens the file, and dragging allows direct import into video editing applications.

---

## Packaging & Distribution
Bundled via `electron-builder` into NSIS executables for Windows.
- Target configuration details are maintained in `package.json` (`build` block); output goes to `dist/`.
- Build scripts:
  - `npm run pack` (directory build)
  - `npm run dist` (standalone setup bundle generation)
- CI: `.github/workflows/build.yml` runs `npm test` and `npm run dist` on `windows-latest`. Pushes to `main` upload the installer as a workflow artifact; `v*` tags (or a manual run with **publish**) publish it to GitHub Releases.

## Tests
`npm test` runs `node --test` over `test/*.test.js` and `test/performance.benchmark.js`. Most suites read the concatenated main / renderer sources via `test/helpers/source.js` and assert on them (IPC contract, DOM IDs, settings schema, feature wiring); `clipper-preview` and `twitch-vod` also unit-test the pure helper modules.
