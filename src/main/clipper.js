const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

ipcMain.handle('fetch-video-info', async (event, url) => {
  if (ctx.ytDlpChannelSwitchInProgress) {
    throw new Error('A yt-dlp update or channel switch is currently in progress. Please try again in a moment.');
  }
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }

  const cleanUrl = url.trim();
  const cached = ctx.videoInfoCache.get(cleanUrl);
  if (cached) {
    return cached;
  }

  // Support local media files in Clipper preview
  if (fs.existsSync(cleanUrl)) {
    try {
      const meta = await ctx.probeLocalVideo(cleanUrl);
      const fileName = path.basename(cleanUrl);
      const localResult = {
        success: true,
        title: fileName,
        duration: meta.duration || 0,
        thumbnail: '',
        streamUrl: pathToFileURL(cleanUrl).href
      };
      ctx.videoInfoCache.set(cleanUrl, localResult);
      return localResult;
    } catch (e) {
      // Continue to yt-dlp fallback
    }
  }

  const runYtDlp = (args) => ctx.runYtDlpProcess(args);

  // Try with mp4 format filter first and --no-playlist for fast lightweight payload
  let result = await runYtDlp(['--no-playlist', '--dump-json', '-f', '18/best[ext=mp4]', cleanUrl]);
  
  // If it fails (some non-YT sites don't have format 18), fallback to dump full json
  if (result.code !== 0) {
    result = await runYtDlp(['--no-playlist', '--dump-json', cleanUrl]);
  }

  if (result.code === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      let streamUrl = '';
      
      if (parsed.url) {
        streamUrl = parsed.url;
      } else if (parsed.formats) {
        // Look for playable mp4 combined stream
        const mp4Format = parsed.formats.find(f => 
          f.ext === 'mp4' && 
          f.vcodec !== 'none' && 
          f.acodec !== 'none' && 
          f.url && 
          f.url.startsWith('http')
        );
        if (mp4Format) {
          streamUrl = mp4Format.url;
        } else {
          // Look for any combined stream that is playable
          const combined = parsed.formats.find(f => 
            f.vcodec !== 'none' && 
            f.acodec !== 'none' && 
            f.url && 
            f.url.startsWith('http')
          );
          if (combined) streamUrl = combined.url;
        }
      }

      const infoResult = {
        success: true,
        title: parsed.title || 'Unknown Video',
        duration: parsed.duration || 0,
        thumbnail: parsed.thumbnail || (parsed.thumbnails && parsed.thumbnails.length > 0 ? parsed.thumbnails[parsed.thumbnails.length - 1].url : ''),
        streamUrl: streamUrl
      };
      ctx.videoInfoCache.set(cleanUrl, infoResult);
      return infoResult;
    } catch (e) {
      return { success: false, error: 'JSON parse error: ' + e.message };
    }
  } else {
    return { success: false, error: result.stderr || 'Failed to fetch video information.' };
  }
});

ipcMain.on('download-clip', async (event, { url, quality, startTime, endTime, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const isAudio = format === 'audio';
  const subDir = isAudio ? 'yt-audios' : 'yt-videos';
  const videoDir = path.join(baseDir, subDir);
  
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const outPath = path.join(videoDir, '%(title)s_clip_%(section_start)s_%(section_end)s.%(ext)s');
  const sectionStr = `*${startTime}-${endTime}`;
  
  let args = [];
  let formatLabel = '';

  if (isAudio) {
    const audioFormat = ctx.settings.audioFormat || 'mp3';
    formatLabel = audioFormat.toUpperCase();
    args = [
      '-f', 'bestaudio',
      '-x',
      '--audio-format', audioFormat,
    ];
    if (audioFormat === 'mp3') {
      args.push('--audio-quality', '0');
    }
  } else {
    const videoFormat = ctx.settings.videoFormat || 'mp4';
    formatLabel = videoFormat.toUpperCase();
    let formatStr = '';
    let mergeFormat = '';

    if (videoFormat === 'webm') {
      formatStr = `bestvideo[ext=webm][height<=${quality}]+bestaudio[ext=webm]/best[ext=webm]/best`;
      mergeFormat = 'webm';
    } else if (videoFormat === 'mkv') {
      formatStr = `bestvideo[height<=${quality}]+bestaudio/best`;
      mergeFormat = 'mkv';
    } else {
      formatStr = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
      mergeFormat = 'mp4';
    }
    
    args = [
      '-f', formatStr,
      '--merge-output-format', mergeFormat,
    ];
  }

  args.push(
    '--download-sections', sectionStr,
    '--force-keyframes-at-cuts',
    '-o', outPath,
    '--no-mtime'
  );

  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }

  args.push(url);
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Starting download for section ${startTime}-${endTime} in ${formatLabel} format...`);
  
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
      finalPath = ctx.resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: isAudio ? 'clip-audio' : 'clip', url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Download failed with code ${code}`);
  });
});

function registerClipperPreviewHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.googlevideo.com/*', '*://*.youtube.com/*'] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      requestHeaders['Referer'] = 'https://www.youtube.com/';
      requestHeaders['Origin'] = 'https://www.youtube.com';
      callback({ requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.googlevideo.com/*', '*://*.youtube.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Headers'] = ['Range, Content-Range, Content-Length, Accept, Origin, Referer, Content-Type, Authorization'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
      responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];
      callback({ responseHeaders });
    }
  );
}


ctx.registerClipperPreviewHeaders = registerClipperPreviewHeaders;
module.exports = { registerClipperPreviewHeaders };
