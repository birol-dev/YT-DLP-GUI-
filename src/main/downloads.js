const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

function isTemporaryDownloadPath(filePath) {
  const normalized = filePath.trim().replace(/^"|"$/g, '');
  return normalized.endsWith('.part') ||
    normalized.endsWith('.ytdl') ||
    /\.f\d+\.[^.]+$/.test(normalized);
}

function findNewestCompletedFile(dirPath, startedAtMs) {
  try {
    if (!fs.existsSync(dirPath)) return '';

    const minModifiedAt = startedAtMs - 2000;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let newestPath = '';
    let newestMtime = minModifiedAt;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.isFile()) continue;
      const fileName = entry.name;
      if (isTemporaryDownloadPath(fileName)) continue;

      const fullPath = path.join(dirPath, fileName);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= newestMtime) {
          newestMtime = stat.mtimeMs;
          newestPath = fullPath;
        }
      } catch (e) {}
    }

    return newestPath;
  } catch (err) {
    console.error('Failed to resolve newest completed file:', err);
    return '';
  }
}

function resolveFinalDownloadPath(candidatePath, downloadDir, startedAtMs) {
  const cleanPath = (candidatePath || '').trim().replace(/^"|"$/g, '');
  if (cleanPath && !isTemporaryDownloadPath(cleanPath) && fs.existsSync(cleanPath)) {
    return cleanPath;
  }

  return findNewestCompletedFile(downloadDir, startedAtMs) || cleanPath;
}

ipcMain.handle('cancel-download', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await ctx.stopAllBlockingTasks(win, 'user cancelled download');
  return { ok: true };
});

ipcMain.handle('copy-to-clipboard', async (_event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
    return true;
  }
  return false;
});

async function buildVideoDownloadArgs({ url, quality, outPath }) {
  const videoFormat = ctx.settings.videoFormat || 'mp4';
  let formatStr = '';
  let mergeFormat = '';

  if (videoFormat === 'webm') {
    formatStr = `bestvideo[ext=webm][height<=${quality}]+bestaudio[ext=webm]/best[ext=webm]/best`;
    mergeFormat = 'webm';
  } else if (videoFormat === 'mkv') {
    formatStr = `bestvideo[height<=${quality}]+bestaudio/best`;
    mergeFormat = 'mkv';
  } else {
    // Default: mp4 (H.264 + M4A) for After Effects/Premiere Pro compatibility
    formatStr = `bestvideo[vcodec^=avc1][height<=${quality}]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
    mergeFormat = 'mp4';
  }
  
  const args = [
    '-f', formatStr,
    '--merge-output-format', mergeFormat,
    '-o', outPath,
    '--no-mtime',
  ];

  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }

  args.push(url);
  return await ctx.appendYtDlpCookieArgs(args);
}

ipcMain.handle('probe-playlist', async (_event, url) => {
  if (ctx.ytDlpChannelSwitchInProgress) {
    throw new Error('A yt-dlp update or channel switch is currently in progress. Please try again in a moment.');
  }

  if (!url || typeof url !== 'string') {
    return { isPlaylist: false, playlistCount: 0, title: '' };
  }

  const cleanUrl = url.trim();
  const cached = ctx.probePlaylistCache.get(cleanUrl);
  if (cached) {
    return cached;
  }

  const result = await ctx.runYtDlpProcess([
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    url
  ]);

  if (result.code !== 0) {
    const isLikelyPlaylist = /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
    const fallback = { isPlaylist: isLikelyPlaylist, playlistCount: 0, title: '' };
    ctx.probePlaylistCache.set(cleanUrl, fallback);
    return fallback;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const playlistCount = parsed.playlist_count || parsed.n_entries || 0;
    const isPlaylist = parsed._type === 'playlist' || playlistCount > 1;
    const probeRes = {
      isPlaylist,
      playlistCount: isPlaylist ? playlistCount : 0,
      title: parsed.title || parsed.playlist_title || ''
    };
    ctx.probePlaylistCache.set(cleanUrl, probeRes);
    return probeRes;
  } catch {
    const isLikelyPlaylist = /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
    const fallback = { isPlaylist: isLikelyPlaylist, playlistCount: 0, title: '' };
    ctx.probePlaylistCache.set(cleanUrl, fallback);
    return fallback;
  }
});

ipcMain.on('download-video', async (event, { url, quality }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const videoDir = path.join(baseDir, 'yt-videos');
  
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const outPath = path.join(videoDir, '%(title)s.%(ext)s');
  const args = await buildVideoDownloadArgs({ url, quality, outPath });
  const videoFormat = ctx.settings.videoFormat || 'mp4';

  win.webContents.send('download-status', `[VIDEO] Starting download in ${videoFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
    const lines = text.split('\n');
    for (const line of lines) {
      const destMatch = line.match(/Destination:\s*(.+)/);
      if (destMatch) {
        const filePath = destMatch[1].trim();
        if (!filePath.endsWith('.part') && 
            !filePath.endsWith('.ytdl') && 
            !/\.f\d+\.[^.]+$/.test(filePath)) {
          finalPath = filePath;
        }
      }
      const mergeMatch = line.match(/Merging formats into "(.+)"/);
      if (mergeMatch) finalPath = mergeMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'video', url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[VIDEO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-audio', async (event, { url }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const audioDir = path.join(baseDir, 'yt-audios');
  
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const outPath = path.join(audioDir, '%(title)s.%(ext)s');
  
  // Dynamic audio format selection based on settings
  const audioFormat = ctx.settings.audioFormat || 'mp3';
  
  const args = [
    '-f', 'bestaudio',
    '-x',
    '--audio-format', audioFormat,
  ];

  if (audioFormat === 'mp3') {
    // Add VBR quality 0 for highest MP3 compression quality
    args.push('--audio-quality', '0');
  }

  args.push(
    '-o', outPath,
    '--no-mtime'
  );

  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }

  args.push(url);
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[AUDIO] Starting extraction to ${audioFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
    const lines = text.split('\n');
    for (const line of lines) {
      const destMatch = line.match(/Destination:\s*(.+)/);
      if (destMatch) {
        const filePath = destMatch[1].trim();
        if (!filePath.endsWith('.part') && 
            !filePath.endsWith('.ytdl') && 
            !/\.f\d+\.[^.]+$/.test(filePath)) {
          finalPath = filePath;
        }
      }
      const mergeMatch = line.match(/Merging formats into "(.+)"/);
      if (mergeMatch) finalPath = mergeMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, audioDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'audio', url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[AUDIO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-subtitles', async (event, { url, lang }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const subsDir = path.join(baseDir, 'yt-subs');
  
  if (!fs.existsSync(subsDir)) fs.mkdirSync(subsDir, { recursive: true });

  const outPath = path.join(subsDir, '%(title)s.%(ext)s');
  
  const subLang = lang || 'en';
  
  const args = [
    '--write-subs',
    '--write-auto-subs',
  ];

  if (subLang === 'all') {
    args.push('--all-subs');
  } else {
    // Strictly scope subtitles to requested language to avoid 100+ auto-translated sub requests (en-de, etc.) that cause HTTP 429
    args.push('--sub-langs', `${subLang},${subLang}-orig,${subLang}-${subLang},^${subLang}(?:-[A-Za-z]{2})?$`);
  }

  args.push(
    '--skip-download',
    '-o', outPath,
    '--no-mtime',
    '--compat-options', 'no-live-chat',
    '--no-abort-on-error'
  );

  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }

  args.push(url);
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[SUBS] Starting download for ${url}...`);
  
  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
    const lines = text.split('\n');
    for (const line of lines) {
      const subMatch = line.match(/Writing video subtitles to:\s*(.+)/);
      if (subMatch) finalPath = subMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    finalPath = resolveFinalDownloadPath(finalPath, subsDir, downloadStartedAt);
    const hasSubtitleFile = !!(finalPath && fs.existsSync(finalPath));
    if (code === 0 || hasSubtitleFile) {
      win.webContents.send('download-complete', { type: 'subtitles', url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[SUBS] Download failed with code ${code}`);
  });
});

ipcMain.on('download-instagram', async (event, { url, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  url = ctx.normalizeInstagramUrl(url);
  await ctx.syncYtDlpChannel(win, { ensureLocal: true });

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  
  let outPath = '';
  let args = [];
  let subFolder = '';
  
  if (format === 'audio') {
    subFolder = 'ig-audios';
    const audioDir = path.join(baseDir, subFolder);
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    outPath = path.join(audioDir, '%(title)s.%(ext)s');
    
    const audioFormat = ctx.settings.audioFormat || 'mp3';
    args = [
      '-f', 'bestaudio',
      '-x',
      '--audio-format', audioFormat,
    ];
    if (audioFormat === 'mp3') {
      args.push('--audio-quality', '0');
    }
  } else {
    subFolder = 'ig-videos';
    const videoDir = path.join(baseDir, subFolder);
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    outPath = path.join(videoDir, '%(title)s.%(ext)s');
    
    const videoFormat = ctx.settings.videoFormat || 'mp4';
    let formatStr = '';
    let mergeFormat = '';

    if (videoFormat === 'webm') {
      formatStr = `bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best`;
      mergeFormat = 'webm';
    } else if (videoFormat === 'mkv') {
      formatStr = `bestvideo+bestaudio/best`;
      mergeFormat = 'mkv';
    } else {
      // mp4
      formatStr = `bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      mergeFormat = 'mp4';
    }
    
    args = [
      '-f', formatStr,
      '--merge-output-format', mergeFormat,
    ];
  }
  
  args.push(
    '-o', outPath,
    '--no-mtime'
  );
  
  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }
  
  args.push(url);
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);
  
  const label = format === 'audio' ? 'AUDIO' : 'VIDEO';
  win.webContents.send('download-status', `[INSTAGRAM ${label}] Starting download in ${format === 'audio' ? (ctx.settings.audioFormat || 'mp3').toUpperCase() : (ctx.settings.videoFormat || 'mp4').toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';
  let stderrOutput = '';
  
  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
    const lines = text.split('\n');
    for (const line of lines) {
      const destMatch = line.match(/Destination:\s*(.+)/);
      if (destMatch) {
        const filePath = destMatch[1].trim();
        if (!filePath.endsWith('.part') && 
            !filePath.endsWith('.ytdl') && 
            !/\.f\d+\.[^.]+$/.test(filePath)) {
          finalPath = filePath;
        }
      }
      const mergeMatch = line.match(/Merging formats into "(.+)"/);
      if (mergeMatch) finalPath = mergeMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => {
    const text = data.toString();
    stderrOutput += text;
    throttledProgress.push(text);
  });
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      const type = format === 'audio' ? 'ig-audio' : 'ig-video';
      finalPath = resolveFinalDownloadPath(finalPath, path.join(baseDir, subFolder), downloadStartedAt);
      win.webContents.send('download-complete', { type, url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else {
      win.webContents.send('download-error', ctx.formatInstagramDownloadError(code, stderrOutput, label));
    }
  });
});

ipcMain.on('continue-anyway', (event) => {
  ctx.saveSettingsInternal({ firstRunComplete: true });
});

ctx.isTemporaryDownloadPath = isTemporaryDownloadPath;
ctx.findNewestCompletedFile = findNewestCompletedFile;
ctx.resolveFinalDownloadPath = resolveFinalDownloadPath;
ctx.buildVideoDownloadArgs = buildVideoDownloadArgs;
module.exports = { isTemporaryDownloadPath, findNewestCompletedFile, resolveFinalDownloadPath, buildVideoDownloadArgs };
