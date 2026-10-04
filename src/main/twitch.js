const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const ctx = require('./ctx');
const {
  TWITCH_SUBFOLDER,
  classifyTwitchUrl,
  buildTwitchQualities,
  findTwitchAudioFormat,
  pickTwitchPreviewUrl,
  normalizeTwitchChapters,
  buildTwitchDownloadArgs,
  parseFfmpegProgressLine,
  formatSectionProgressLine,
  isYtDlpStatusLine,
  describeTwitchError
} = require('./twitch-helpers');

function getTwitchDownloadDir() {
  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const dir = path.join(baseDir, TWITCH_SUBFOLDER);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readPrintedFilePath(printFile) {
  try {
    if (!printFile || !fs.existsSync(printFile)) return '';
    const lines = fs.readFileSync(printFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.length > 0 ? lines[lines.length - 1] : '';
  } catch {
    return '';
  } finally {
    try { fs.unlinkSync(printFile); } catch { /* ignore */ }
  }
}

ipcMain.handle('fetch-twitch-info', async (_event, url) => {
  if (ctx.ytDlpChannelSwitchInProgress) {
    return { success: false, error: 'A yt-dlp update or channel switch is currently in progress. Please try again in a moment.' };
  }

  const classified = classifyTwitchUrl(url);
  if (classified.kind === 'channel') {
    return { success: false, error: 'That looks like a channel page. Open the channel\'s Videos tab on Twitch and paste the link of a specific VOD (twitch.tv/videos/…) or clip.' };
  }
  if (classified.kind === 'invalid') {
    return { success: false, error: 'Please enter a valid Twitch VOD or clip URL (e.g. https://www.twitch.tv/videos/123456789).' };
  }

  const result = await ctx.runYtDlpProcess(['--no-playlist', '--no-warnings', '--dump-json', classified.url]);
  if (result.code !== 0) {
    return { success: false, error: describeTwitchError(result.stderr) };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    return { success: false, error: 'Could not read the VOD details returned by yt-dlp: ' + e.message };
  }

  if (parsed.is_live) {
    return { success: false, error: 'This broadcast is still live. Wait for the stream to end, then download its VOD.' };
  }

  const duration = Number(parsed.duration) || 0;
  const qualities = buildTwitchQualities(parsed);
  if (qualities.length === 0) {
    return { success: false, error: 'No downloadable video qualities were found for this VOD.' };
  }

  const thumbnails = Array.isArray(parsed.thumbnails) ? parsed.thumbnails : [];
  return {
    success: true,
    kind: classified.kind,
    url: classified.url,
    startSeconds: Math.min(classified.startSeconds || 0, duration),
    id: String(parsed.id || classified.id || ''),
    title: parsed.title || 'Untitled Broadcast',
    uploader: parsed.uploader || parsed.creator || parsed.uploader_id || '',
    duration,
    timestamp: Number(parsed.timestamp) || 0,
    viewCount: Number(parsed.view_count) || 0,
    thumbnail: parsed.thumbnail || (thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : ''),
    qualities,
    audio: findTwitchAudioFormat(parsed),
    chapters: normalizeTwitchChapters(parsed, duration),
    previewUrl: pickTwitchPreviewUrl(parsed)
  };
});

ipcMain.on('download-twitch-vod', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const data = payload || {};
  const isAudioRequest = data.mode === 'audio';
  const label = `[TWITCH ${isAudioRequest ? 'AUDIO' : 'VIDEO'}]`;

  let built;
  let twitchDir;
  const printFile = path.join(app.getPath('temp'), `ytdlp-gui-twitch-${Date.now()}.txt`);
  try {
    twitchDir = getTwitchDownloadDir();
    built = buildTwitchDownloadArgs({
      url: data.url,
      mode: data.mode,
      formatId: data.formatId,
      container: data.container,
      audioFormat: ctx.settings.audioFormat || 'mp3',
      startTime: data.startTime,
      endTime: data.endTime,
      duration: data.duration,
      precise: !!data.precise,
      embedMetadata: data.embedMetadata !== false,
      fragments: data.fragments,
      outDir: twitchDir,
      pathSep: path.sep,
      printToFile: printFile
    });
  } catch (err) {
    ctx.safeSend(win, 'download-error', `${label} ${err.message}`);
    return;
  }

  const { args, range, isAudio } = built;
  if (fs.existsSync(ctx.localFfmpeg)) {
    args.unshift('--ffmpeg-location', ctx.localBinDir);
  }
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);

  const scope = range.isSection
    ? `section ${range.start}s-${range.end}s${data.precise ? ' (frame-accurate)' : ''}`
    : 'full VOD';
  ctx.safeSend(win, 'download-status', `${label} Starting download of ${scope} (${isAudio ? 'audio' : (data.formatId || 'best')}) for ${built.url}...`);

  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ctx.getYtDlpPath(), finalArgs, { windowsHide: true });
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';
  let stderrTail = '';
  let settled = false;

  const handleLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const destMatch = line.match(/Destination:\s*(.+)/);
    if (destMatch && !ctx.isTemporaryDownloadPath(destMatch[1])) finalPath = destMatch[1].trim();
    const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
    if (existMatch) finalPath = existMatch[1].trim();

    if (range.isSection) {
      // FFmpeg does the fetching for sections: translate its stats and drop its chatter
      const ffmpegProgress = parseFfmpegProgressLine(line);
      if (ffmpegProgress) {
        const synthetic = formatSectionProgressLine(ffmpegProgress, range.length);
        if (synthetic) throttledProgress.push(synthetic);
        return;
      }
      if (!isYtDlpStatusLine(line)) return;
    }
    throttledProgress.push(line);
  };

  const makeChunkHandler = (isStderr) => {
    let buffer = '';
    return (chunk) => {
      const text = chunk.toString();
      if (isStderr) stderrTail = (stderrTail + text).slice(-4000);
      buffer += text;
      const parts = buffer.split(/\r\n|\n|\r/);
      buffer = parts.pop();
      parts.forEach(handleLine);
    };
  };

  ytProcess.stdout.on('data', makeChunkHandler(false));
  ytProcess.stderr.on('data', makeChunkHandler(true));

  ytProcess.on('error', (err) => {
    if (settled) return;
    settled = true;
    throttledProgress.flush();
    try { fs.unlinkSync(printFile); } catch { /* ignore */ }
    ctx.safeSend(win, 'download-error', `${label} Failed to start yt-dlp: ${err.message}`);
  });

  ytProcess.on('close', (code) => {
    if (settled) return;
    settled = true;
    throttledProgress.flush();
    const printedPath = readPrintedFilePath(printFile);

    if (code === 0) {
      finalPath = ctx.resolveFinalDownloadPath(printedPath || finalPath, twitchDir, downloadStartedAt);
      ctx.safeSend(win, 'download-complete', {
        type: isAudio ? 'twitch-audio' : 'twitch',
        url: built.url,
        status: 'Success',
        filePath: finalPath,
        thumbnail: typeof data.thumbnail === 'string' ? data.thumbnail : ''
      });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    } else if (code === null) {
      // Killed (user cancelled / channel switch) — the registry already notified the renderer
    } else {
      const hasYtDlpError = /ERROR/i.test(stderrTail);
      const reason = hasYtDlpError ? describeTwitchError(stderrTail) : `Download failed with code ${code}`;
      ctx.safeSend(win, 'download-error', `${label} ${reason}`);
    }
  });
});

module.exports = { getTwitchDownloadDir };
