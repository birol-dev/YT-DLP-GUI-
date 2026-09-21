const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const ctx = require('./ctx');

const PREVIEW_FORMAT =
  'bv*[vcodec^=avc1][height<=480]+ba[acodec^=mp4a]/bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/bv*[vcodec^=avc1]+ba[acodec^=mp4a]/b[ext=mp4]/best[vcodec^=avc1]/best';


function toPlayablePreviewUrl(filePathOrFileUrl) {
  const href = String(filePathOrFileUrl || '');
  const fileUrl = href.startsWith('file:') ? href : pathToFileURL(href).href;
  return `media-preview://local/?url=${encodeURIComponent(fileUrl)}`;
}

function getClipperPreviewDir() {
  const dir = path.join(app.getPath('userData'), 'clipper-previews');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function previewCacheKey(url) {
  return crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 20);
}

function isChromiumSafeProgressiveFormat(fmt) {
  if (!fmt || !fmt.url || !String(fmt.url).startsWith('http')) return false;
  if (!fmt.vcodec || fmt.vcodec === 'none' || !fmt.acodec || fmt.acodec === 'none') return false;
  const protocol = String(fmt.protocol || '');
  // Dash/HLS multi-protocol URLs cannot be assigned to <video src>
  if (protocol.includes('+') || protocol.includes('dash') || protocol.includes('m3u8') || protocol.includes('hls')) {
    return false;
  }
  const v = String(fmt.vcodec).toLowerCase();
  const a = String(fmt.acodec).toLowerCase();
  const h264 = v.includes('avc') || v.includes('h264');
  const aac = a.includes('mp4a') || a.includes('aac');
  const vp = v.includes('vp8') || v.includes('vp9') || v.includes('vp09');
  const opusLike = a.includes('opus') || a.includes('vorbis');
  return (h264 && aac) || (vp && opusLike);
}

function pickChromiumSafeDirectUrl(parsed) {
  if (!parsed) return '';
  const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
  const candidates = [];
  if (parsed.url && parsed.vcodec && parsed.acodec) {
    candidates.push(parsed);
  }
  candidates.push(...formats);
  const safe = candidates.find(isChromiumSafeProgressiveFormat);
  return safe ? safe.url : '';
}

async function buildRemuxedClipperPreview(cleanUrl) {
  const dir = getClipperPreviewDir();
  const key = previewCacheKey(cleanUrl);
  const outFile = path.join(dir, `${key}.mp4`);
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) {
    return toPlayablePreviewUrl(outFile);
  }

  const tempTemplate = path.join(dir, `${key}.%(ext)s`);
  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', PREVIEW_FORMAT,
    '--merge-output-format', 'mp4',
    '--force-overwrites',
    '--postprocessor-args', 'ffmpeg:-movflags +faststart',
    '-o', tempTemplate,
    cleanUrl
  ];

  const result = await ctx.runYtDlpProcess(args, false, 180000);
  if (result.code !== 0 || !fs.existsSync(outFile)) {
    // yt-dlp may write a different extension; prefer any matching key file
    const fallback = fs.readdirSync(dir).find((name) => name.startsWith(key + '.') && !name.includes('.f'));
    if (fallback) {
      const fallbackPath = path.join(dir, fallback);
      if (fallbackPath !== outFile) {
        try { fs.renameSync(fallbackPath, outFile); } catch { /* keep fallback */ }
      }
      if (fs.existsSync(outFile) || fs.existsSync(fallbackPath)) {
        return toPlayablePreviewUrl(fs.existsSync(outFile) ? outFile : fallbackPath);
      }
    }
    const err = (result.stderr || result.stdout || 'preview remux failed').trim();
    throw new Error(err.slice(0, 500));
  }
  return toPlayablePreviewUrl(outFile);
}

function extractStreamUrls(parsed) {
  let streamUrl = '';
  let audioUrl = '';

  if (!parsed) return { streamUrl, audioUrl };

  // 1. Direct url on parsed object (if combined)
  if (parsed.url && parsed.vcodec && parsed.vcodec !== 'none' && parsed.acodec && parsed.acodec !== 'none') {
    return { streamUrl: parsed.url, audioUrl: '' };
  }

  const formats = (parsed.formats || []).filter(f => f && f.url && f.url.startsWith('http') && f.protocol !== 'm3u8_native');

  // 2. Combined video + audio formats (e.g. non-YT sites or legacy YT format 18)
  const combined = formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
  if (combined.length > 0) {
    const preferredCombined = combined.find(f => f.format_id === '18') ||
      combined.find(f => f.ext === 'mp4' && f.height <= 720 && f.height >= 360) ||
      combined.find(f => f.ext === 'mp4') ||
      combined[0];
    return { streamUrl: preferredCombined.url, audioUrl: '' };
  }

  // 3. Separate video and audio streams (modern YouTube DASH streams)
  const videoOnly = formats.filter(f => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'));
  if (videoOnly.length > 0) {
    // Prefer 360p or 480p or 720p H.264/avc1 mp4 for smooth, fast preview scrubbing in Chromium
    const preferredVideo =
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height === 360) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height === 480) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1') && f.height <= 720 && f.height >= 360) ||
      videoOnly.find(f => f.ext === 'mp4' && typeof f.vcodec === 'string' && f.vcodec.startsWith('avc1')) ||
      videoOnly.find(f => f.ext === 'mp4' && f.height <= 720) ||
      videoOnly.find(f => f.ext === 'mp4') ||
      videoOnly.find(f => typeof f.vcodec === 'string' && (f.vcodec.startsWith('vp9') || f.vcodec.startsWith('vp09'))) ||
      videoOnly[0];

    if (preferredVideo) {
      streamUrl = preferredVideo.url;
    }
  }

  const audioOnly = formats.filter(f => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none');
  if (audioOnly.length > 0) {
    // Prefer m4a (AAC) which plays natively in Chromium with minimal overhead
    const preferredAudio =
      audioOnly.find(f => f.ext === 'm4a' && typeof f.acodec === 'string' && f.acodec.startsWith('mp4a')) ||
      audioOnly.find(f => f.ext === 'm4a') ||
      audioOnly.find(f => typeof f.acodec === 'string' && f.acodec.startsWith('mp4a')) ||
      audioOnly.find(f => f.ext === 'webm') ||
      audioOnly[0];

    if (preferredAudio) {
      audioUrl = preferredAudio.url;
    }
  }

  if (!streamUrl && parsed.url) {
    streamUrl = parsed.url;
  }

  return { streamUrl, audioUrl };
}

if (ipcMain) {
  ipcMain.handle('fetch-video-info', async (event, url) => {
    if (ctx.ytDlpChannelSwitchInProgress) {
      throw new Error('A yt-dlp update or channel switch is currently in progress. Please try again in a moment.');
    }
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Invalid URL provided.' };
    }

    const cleanUrl = url.trim();
    const cached = ctx.videoInfoCache.get(cleanUrl);
    if (cached && cached.streamUrl) {
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
          streamUrl: toPlayablePreviewUrl(cleanUrl),
          previewMode: 'local'
        };
        ctx.videoInfoCache.set(cleanUrl, localResult);
        return localResult;
      } catch (e) {
        // Continue to yt-dlp fallback
      }
    }

    const runYtDlp = (args) => ctx.runYtDlpProcess(args);

    // Fetch video metadata & available formats
    let result = await runYtDlp(['--no-playlist', '--dump-json', cleanUrl]);
    
    if (result.code !== 0) {
      result = await runYtDlp(['--dump-json', cleanUrl]);
    }

    if (result.code !== 0) {
      return { success: false, error: result.stderr || 'Failed to fetch video information.' };
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      return { success: false, error: 'JSON parse error: ' + e.message };
    }

    const { streamUrl, audioUrl } = extractStreamUrls(parsed);
    let finalStreamUrl = streamUrl;
    let previewMode = finalStreamUrl ? 'direct' : 'none';

    // Hybrid fallback: remux H.264+AAC locally if direct stream was not extracted
    if (!finalStreamUrl) {
      try {
        finalStreamUrl = await buildRemuxedClipperPreview(cleanUrl);
        previewMode = 'remux';
      } catch (remuxErr) {
        finalStreamUrl = '';
        previewMode = 'unavailable';
        console.error('Clipper preview remux failed:', remuxErr.message);
      }
    }

    const infoResult = {
      success: true,
      title: parsed.title || 'Unknown Video',
      duration: parsed.duration || 0,
      thumbnail: parsed.thumbnail || (parsed.thumbnails && parsed.thumbnails.length > 0 ? parsed.thumbnails[parsed.thumbnails.length - 1].url : ''),
      streamUrl: finalStreamUrl,
      audioUrl: audioUrl || '',
      previewMode
    };

    if (finalStreamUrl) {
      ctx.videoInfoCache.set(cleanUrl, infoResult);
    }
    return infoResult;
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

  const send = (channel, payload) => {
    if (typeof ctx.safeSend === 'function') ctx.safeSend(win, channel, payload);
    else if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  send('download-status', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Starting download for section ${startTime}-${endTime} in ${formatLabel} format...`);
  
  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  ctx.registerYtDlpProcess(ytProcess);
  const throttledProgress = ctx.createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.on('error', (err) => {
    throttledProgress.flush();
    send('download-error', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Failed to start yt-dlp: ${err.message}`);
  });
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
      send('download-complete', { type: isAudio ? 'clip-audio' : 'clip', url, status: 'Success', filePath: finalPath });
      if (ctx.settings.autoOpenFolder && finalPath) {
        ctx.openFolderOrRevealItem(finalPath);
      }
    }
    else send('download-error', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Download failed with code ${code}`);
  });
});
}


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
ctx.extractStreamUrls = extractStreamUrls;
module.exports = { registerClipperPreviewHeaders, extractStreamUrls };
