const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

let fluentFfmpeg = null;
try {
  fluentFfmpeg = require('fluent-ffmpeg');
} catch (e) {}

// ==========================================
// Music Finder Tab Logic
// ==========================================

function secondsToHHMMSS(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) {
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  }
  return [m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function isSameTrack(track1, track2) {
  if (!track1 || !track2) return false;
  
  if (track1.recordingId && track2.recordingId) {
    return track1.recordingId === track2.recordingId;
  }
  
  const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(track1.title) === normalize(track2.title) &&
         normalize(track1.artist) === normalize(track2.artist);
}

function extractTrackInfo(apiResponse) {
  if (apiResponse.status !== 'ok' || !apiResponse.results || apiResponse.results.length === 0) {
    return null;
  }
  
  const results = [...apiResponse.results].sort((a, b) => b.score - a.score);
  
  for (const match of results) {
    if (match.recordings && match.recordings.length > 0) {
      const recording = match.recordings.find(r => r.title && r.artists && r.artists.length > 0) || match.recordings[0];
      const title = recording.title || 'Unknown Title';
      const artist = recording.artists && recording.artists.length > 0
        ? recording.artists.map(a => a.name).join(', ')
        : 'Unknown Artist';
      
      const releaseGroup = recording.releasegroups && recording.releasegroups.length > 0
        ? recording.releasegroups[0]
        : null;
        
      const album = releaseGroup ? releaseGroup.title : '';
      const releaseGroupId = releaseGroup ? releaseGroup.id : '';
      const coverUrl = releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250` : '';
      
      return {
        title,
        artist,
        album,
        coverUrl,
        recordingId: recording.id
      };
    }
  }
  return null;
}

function generateAcrcloudSignature(method, uri, accessKey, accessSecret, dataType, timestamp) {
  const crypto = require('crypto');
  const signatureVersion = "1";
  const stringToSign = `${method}\n${uri}\n${accessKey}\n${dataType}\n${signatureVersion}\n${timestamp}`;
  return crypto
    .createHmac('sha1', accessSecret)
    .update(stringToSign)
    .digest('base64');
}

function extractAcrcloudTrackInfo(apiResponse) {
  if (!apiResponse.status || apiResponse.status.code !== 0 || !apiResponse.metadata || !apiResponse.metadata.music || apiResponse.metadata.music.length === 0) {
    return null;
  }
  
  const musicList = [...apiResponse.metadata.music].sort((a, b) => b.score - a.score);
  const bestMatch = musicList[0];
  
  const title = bestMatch.title || 'Unknown Title';
  const artist = bestMatch.artists && bestMatch.artists.length > 0
    ? bestMatch.artists.map(a => a.name).join(', ')
    : 'Unknown Artist';
  const album = bestMatch.album ? bestMatch.album.name : '';
  
  let coverUrl = '';
  if (bestMatch.external_metadata && bestMatch.external_metadata.spotify && bestMatch.external_metadata.spotify.track && bestMatch.external_metadata.spotify.track.album) {
    const spAlbum = bestMatch.external_metadata.spotify.track.album;
    if (spAlbum.images && spAlbum.images.length > 0) {
      coverUrl = spAlbum.images[0].url;
    }
  }
  
  return {
    title,
    artist,
    album,
    coverUrl,
    recordingId: bestMatch.acrid
  };
}

function runFpcalc(filePath) {
  return new Promise((resolve, reject) => {
    const fpcalcPath = ctx.getFpcalcPath();
    const proc = spawn(fpcalcPath, [filePath]);
    ctx.registerProcess(proc, { isYtDlp: false });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      if (code === 0) {
        const fingerprintMatch = stdout.match(/^FINGERPRINT=(.+)$/m);
        const durationMatch = stdout.match(/^DURATION=(.+)$/m);
        
        if (fingerprintMatch) {
          resolve({
            fingerprint: fingerprintMatch[1].trim(),
            duration: durationMatch ? parseFloat(durationMatch[1].trim()) : 12
          });
        } else {
          reject(new Error('No fingerprint found in fpcalc output'));
        }
      } else {
        reject(new Error(`fpcalc failed with code ${code}: ${stderr}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function cleanupDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        fs.unlinkSync(path.join(dirPath, file));
      }
      fs.rmdirSync(dirPath);
    }
  } catch (err) {
    console.error('Failed to cleanup temp directory:', err);
  }
}

async function performLocalFileRecognition(inputPath, win) {
  const tempDir = path.join(app.getPath('temp'), `yt-music-finder-${Date.now()}`);
  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`File does not exist: ${inputPath}`);
    }

    // 1. Verify AcoustID API Key
    const clientKey = ctx.settings.acoustidKey || '';
    if (!clientKey || clientKey === 'YOUR_CLIENT_API_KEY' || clientKey === 'YOUR_ACOUSTID_CLIENT_KEY' || clientKey.trim() === '') {
      throw new Error('AcoustID Client API Key is missing. Please go to the Settings tab, obtain a free key from acoustid.org, and save it to enable the Music Finder.');
    }

    // 2. Verify fpcalc utility presence
    const fpcalcPath = ctx.getFpcalcPath();
    if (fpcalcPath === 'fpcalc') {
      const globalFpcalcAvailable = await ctx.isCommandInPath('fpcalc');
      if (!globalFpcalcAvailable) {
        throw new Error('Chromaprint fingerprint utility (fpcalc) is not installed. Please restart the app to trigger environment setup and download the required binary.');
      }
    }

    win.webContents.send('scan-status', 'Probing file duration...');
    win.webContents.send('scan-progress', 5);
    
    const meta = await ctx.probeLocalVideo(inputPath);
    const duration = meta.duration;
    if (!duration || duration <= 0) {
      throw new Error('Could not determine audio/video file duration. The file format may be unsupported.');
    }

    win.webContents.send('scan-status', `File loaded. Duration: ${Math.round(duration)}s. Creating slices...`);
    win.webContents.send('scan-progress', 10);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const service = ctx.settings.musicFinderService || 'acoustid';
    if (service === 'acoustid') {
      if (!ctx.settings.acoustidKey) {
        throw new Error('AcoustID Client API Key is not configured. Please add it in the Settings tab.');
      }
    } else if (service === 'acrcloud') {
      if (!ctx.settings.acrcloudKey || !ctx.settings.acrcloudSecret) {
        throw new Error('ACRCloud credentials are not configured. Please verify your Access Key and Access Secret in the Settings tab.');
      }
    }

    const scanInterval = ctx.settings.acoustidScanInterval || 90;
    const sliceLen = Math.min(30, Math.floor(duration));
    const slicePoints = [];
    for (let t = 0; t + sliceLen <= duration; t += scanInterval) {
      slicePoints.push(t);
    }
    if (slicePoints.length === 0 && duration > 0) {
      slicePoints.push(0);
    }

    win.webContents.send('scan-status', `Scanning at ${slicePoints.length} interval(s) across the track...`);

    const ffmpeg = fluentFfmpeg || require('fluent-ffmpeg');
    ffmpeg.setFfmpegPath(ctx.getFfmpegPath());

    const allResults = [];

    for (let i = 0; i < slicePoints.length; i++) {
      const startTime = slicePoints[i];
      const slicePath = path.join(tempDir, `slice_${i}.wav`);
      
      const percentage = Math.round(10 + (i / slicePoints.length) * 80);
      win.webContents.send('scan-progress', percentage);
      win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Slicing audio at ${secondsToHHMMSS(startTime)}...`);

      try {
        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(inputPath)
            .seekInput(startTime)
            .duration(sliceLen)
            .noVideo()
            .audioChannels(1)
            .audioFrequency(16000)
            .on('start', () => {
              if (cmd && cmd.ffmpegProc) {
                ctx.registerProcess(cmd.ffmpegProc, { isYtDlp: false });
              }
            })
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`FFmpeg slice failed: ${err.message}`)));
          cmd.save(slicePath);
        });
      } catch (err) {
        throw new Error(`Failed to extract audio slice at ${secondsToHHMMSS(startTime)}: ${err.message}`);
      }

      let track = null;

      if (service === 'acoustid') {
        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Fingerprinting clip locally...`);
        let fpData;
        try {
          fpData = await runFpcalc(slicePath);
        } catch (err) {
          throw new Error(`Fingerprinting utility (fpcalc) failed to process clip at ${secondsToHHMMSS(startTime)}: ${err.message}`);
        }

        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Querying AcoustID database...`);
        const clientKey = ctx.settings.acoustidKey;
        let response;
        try {
          response = await fetch(`https://api.acoustid.org/v2/lookup?client=${clientKey}&meta=recordings+releasegroups&duration=${Math.round(duration)}&fingerprint=${encodeURIComponent(fpData.fingerprint)}`);
        } catch (err) {
          throw new Error(`Network error: Failed to connect to AcoustID service. Please check your internet connection and try again.`);
        }

        if (!response.ok) {
          if (response.status === 400 || response.status === 403) {
            throw new Error('Invalid AcoustID API Key. Please verify your Client API Key in the Settings tab.');
          }
          throw new Error(`AcoustID lookup failed with server status ${response.status}.`);
        }

        let apiData;
        try {
          apiData = await response.json();
        } catch (err) {
          throw new Error('Failed to parse AcoustID response metadata.');
        }

        if (apiData.error) {
          if (apiData.error.message && apiData.error.message.includes('invalid client')) {
            throw new Error('Invalid AcoustID API Key. Please verify your Client API Key in the Settings tab.');
          }
          throw new Error(`AcoustID API Error: ${apiData.error.message || 'Unknown error'}`);
        }

        track = extractTrackInfo(apiData);

      } else if (service === 'acrcloud') {
        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Querying ACRCloud database...`);
        const accessKey = ctx.settings.acrcloudKey;
        const accessSecret = ctx.settings.acrcloudSecret;
        const host = ctx.settings.acrcloudHost || 'identify-us-west-2.acrcloud.com';
        
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = generateAcrcloudSignature('POST', '/v1/identify', accessKey, accessSecret, 'audio', timestamp);
        
        let fileBuffer;
        try {
          fileBuffer = fs.readFileSync(slicePath);
        } catch (err) {
          throw new Error(`Failed to read slice audio data: ${err.message}`);
        }
        
        const fileBlob = new Blob([fileBuffer], { type: 'audio/wav' });
        
        const formData = new FormData();
        formData.append('sample', fileBlob, 'slice.wav');
        formData.append('access_key', accessKey);
        formData.append('data_type', 'audio');
        formData.append('signature_version', '1');
        formData.append('timestamp', timestamp);
        formData.append('signature', signature);
        formData.append('sample_bytes', fileBuffer.length.toString());
        
        let response;
        try {
          response = await fetch(`https://${host}/v1/identify`, {
            method: 'POST',
            body: formData
          });
        } catch (err) {
          throw new Error(`Network error: Failed to connect to ACRCloud service. Please check your internet connection and try again.`);
        }
        
        if (!response.ok) {
          throw new Error(`ACRCloud lookup failed with server status ${response.status}.`);
        }
        
        let apiData;
        try {
          apiData = await response.json();
        } catch (err) {
          throw new Error('Failed to parse ACRCloud response metadata.');
        }
        
        if (apiData.status) {
          const code = apiData.status.code;
          if (code === 3001 || code === 3003 || code === 3015) {
            throw new Error(`Invalid ACRCloud Access Key or Access Secret. Please verify your credentials in Settings.`);
          } else if (code !== 0 && code !== 1001) {
            throw new Error(`ACRCloud API Error: ${apiData.status.msg || 'Unknown error'} (Code ${code})`);
          }
        }
        
        track = extractAcrcloudTrackInfo(apiData);
      }

      allResults.push({
        timestamp: startTime,
        timestampStr: secondsToHHMMSS(startTime),
        track: track
      });

      if (i < slicePoints.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    win.webContents.send('scan-status', 'Aggregating results and cleaning up...');
    win.webContents.send('scan-progress', 95);

    const filteredResults = [];
    let lastTrack = null;

    for (const res of allResults) {
      if (res.track) {
        if (!lastTrack || !isSameTrack(lastTrack, res.track)) {
          filteredResults.push(res);
          lastTrack = res.track;
        }
      } else {
        lastTrack = null;
      }
    }

    win.webContents.send('scan-progress', 100);
    win.webContents.send('scan-status', `Scanning complete. Found ${filteredResults.length} song(s).`);
    win.webContents.send('scan-complete', filteredResults);

  } catch (err) {
    console.error('Scan local file error:', err);
    win.webContents.send('scan-error', err.message || 'An error occurred during file scanning.');
  } finally {
    cleanupDirectory(tempDir);
  }
}

ipcMain.handle('select-audio-video-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio/Video Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'mp4', 'mkv', 'mov'] }
    ],
    title: 'Select Audio or Video File'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('scan-local-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await performLocalFileRecognition(filePath, win);
});

ipcMain.on('scan-youtube-url', async (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'scan-error')) return;

  win.webContents.send('scan-status', 'Downloading audio track from YouTube...');
  win.webContents.send('scan-progress', 2);
  
  const cacheDir = path.join(app.getPath('temp'), 'yt-music-finder-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const tempOutPattern = path.join(cacheDir, `temp_scan_${Date.now()}.%(ext)s`);
  const args = [
    '-f', 'bestaudio',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', tempOutPattern,
    '--no-mtime'
  ];
  if (fs.existsSync(ctx.localFfmpeg)) {
    args.push('--ffmpeg-location', ctx.localBinDir);
  }
  args.push(url);
  const finalArgs = await ctx.appendYtDlpCookieArgs(args);

  const ytDlpPath = ctx.getYtDlpPath();
  const downloadStartedAt = Date.now();
  
  const ytProcess = spawn(ytDlpPath, finalArgs);
  ctx.registerYtDlpProcess(ytProcess);
  let finalPath = '';
  let stderrData = '';
  let hasSentError = false;

  ytProcess.on('error', (err) => {
    if (hasSentError) return;
    hasSentError = true;
    if (win && !win.isDestroyed()) {
      win.webContents.send('scan-error', `Failed to start YouTube audio downloader: ${err.message}`);
    }
  });

  ytProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const percentMatch = text.match(/\[download\]\s+([0-9.]+)%/);
    if (percentMatch) {
      const percentage = parseFloat(percentMatch[1]);
      const scaled = Math.round(2 + (percentage / 100) * 8); // Scaled from 2% to 10%
      win.webContents.send('scan-progress', scaled);
    }
  });

  ytProcess.on('close', async (code) => {
    if (hasSentError) return;
    if (code === 0) {
      finalPath = ctx.resolveFinalDownloadPath('', cacheDir, downloadStartedAt);
      if (finalPath && fs.existsSync(finalPath)) {
        win.webContents.send('scan-status', 'Audio download completed. Commencing recognition loop...');
        await performLocalFileRecognition(finalPath, win);
        try {
          fs.unlinkSync(finalPath);
        } catch (e) {
          console.error('Failed to delete cached audio file:', e);
        }
      } else {
        hasSentError = true;
        win.webContents.send('scan-error', 'Failed to locate the downloaded audio file.');
      }
    } else {
      hasSentError = true;
      const errMsg = stderrData.trim();
      const lines = errMsg.split('\n').map(l => l.trim()).filter(Boolean);
      const errorLines = lines.filter(l => l.toLowerCase().includes('error:'));
      const cleanMsg = errorLines.length > 0 ? errorLines.join('\n') : (lines.slice(-2).join('\n') || `Exit code ${code}`);
      win.webContents.send('scan-error', `Audio download failed: ${cleanMsg}`);
    }
  });
});

ctx.fluentFfmpeg = fluentFfmpeg;
ctx.secondsToHHMMSS = secondsToHHMMSS;
ctx.isSameTrack = isSameTrack;
ctx.extractTrackInfo = extractTrackInfo;
ctx.generateAcrcloudSignature = generateAcrcloudSignature;
ctx.extractAcrcloudTrackInfo = extractAcrcloudTrackInfo;
ctx.runFpcalc = runFpcalc;
ctx.cleanupDirectory = cleanupDirectory;
ctx.performLocalFileRecognition = performLocalFileRecognition;
module.exports = { fluentFfmpeg, secondsToHHMMSS, isSameTrack, extractTrackInfo, generateAcrcloudSignature, extractAcrcloudTrackInfo, runFpcalc, cleanupDirectory, performLocalFileRecognition };
