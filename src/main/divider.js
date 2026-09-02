const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// Video Divider Helpers & Handlers
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function buildDivideOutputDir(inputPath) {
  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const sanitizedName = sanitizeFilename(baseName);
  const outputDir = path.join(baseDir, 'yt-divided', sanitizedName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

function probeLocalVideo(filePath, headers = null) {
  if (!filePath) {
    return Promise.resolve({
      duration: 0,
      width: 0,
      height: 0,
      vcodec: 'Unknown',
      fps: 0,
      acodec: 'None',
      filename: '',
      size: 0,
      filePath: ''
    });
  }

  const isRemote = filePath.startsWith('http://') || filePath.startsWith('https://');
  let cacheKey = filePath;
  let currentMtime = 0;
  let currentSize = 0;

  if (!isRemote) {
    try {
      const stat = fs.statSync(filePath);
      currentMtime = stat.mtimeMs;
      currentSize = stat.size;
      cacheKey = `${filePath}:${currentMtime}:${currentSize}`;
    } catch (e) {
      cacheKey = filePath;
    }
  }

  // Check LRU cache
  const cached = ctx.probeMetadataCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  // Check if identical probe is already in-flight
  if (ctx.inFlightProbes.has(cacheKey)) {
    return ctx.inFlightProbes.get(cacheKey);
  }

  const probePromise = new Promise((resolve, reject) => {
    const ffmpegPath = ctx.getFfmpegPath();
    const args = [];
    if (headers && headers.length > 0) {
      args.push('-headers', headers.join('\r\n') + '\r\n');
    }
    args.push('-i', filePath);
    const proc = spawn(ffmpegPath, args);
    ctx.registerProcess(proc, { isYtDlp: false });

    let settled = false;
    let stderr = '';

    const emptyMeta = () => ({
      duration: 0,
      width: 0,
      height: 0,
      vcodec: 'Unknown',
      fps: 0,
      acodec: 'None',
      filename: path.basename(filePath || ''),
      size: currentSize,
      filePath
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimeout);
      ctx.inFlightProbes.delete(cacheKey);
      ctx.probeMetadataCache.set(cacheKey, result);
      resolve(result);
    };

    const killTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        try { proc.kill(); } catch (e2) {}
      }
      finish(emptyMeta());
    }, 4000);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', () => {
      const durationMatch = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
      let duration = 0;
      if (durationMatch) {
        const hours = parseInt(durationMatch[1], 10);
        const minutes = parseInt(durationMatch[2], 10);
        const seconds = parseInt(durationMatch[3], 10);
        let ms = 0;
        if (durationMatch[4]) {
          const fraction = durationMatch[4];
          ms = parseInt(fraction, 10) / Math.pow(10, fraction.length);
        }
        duration = hours * 3600 + minutes * 60 + seconds + ms;
      }

      const videoLine = stderr.split('\n').find(line => line.includes('Video:'));
      let width = 0;
      let height = 0;
      let vcodec = 'Unknown';
      let fps = 0;
      if (videoLine) {
        const resMatch = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
        if (resMatch) {
          width = parseInt(resMatch[1], 10);
          height = parseInt(resMatch[2], 10);
        }
        const codecMatch = videoLine.match(/Video:\s*([a-zA-Z0-9_-]+)/);
        if (codecMatch) {
          vcodec = codecMatch[1];
        }
        const fpsMatch = videoLine.match(/\b([0-9.]+)\s*fps\b/);
        if (fpsMatch) {
          fps = parseFloat(fpsMatch[1]);
        }
      }

      const audioLine = stderr.split('\n').find(line => line.includes('Audio:'));
      let acodec = 'None';
      if (audioLine) {
        const audioMatch = audioLine.match(/Audio:\s*([a-zA-Z0-9_-]+)/);
        if (audioMatch) {
          acodec = audioMatch[1];
        }
      }

      let size = currentSize;
      if (!size && !isRemote) {
        try {
          size = fs.statSync(filePath).size;
        } catch (e) {}
      }

      finish({
        duration,
        width,
        height,
        filename: path.basename(filePath),
        size,
        vcodec,
        fps,
        acodec,
        filePath
      });
    });
    proc.on('error', (err) => {
      ctx.inFlightProbes.delete(cacheKey);
      if (settled) return;
      settled = true;
      clearTimeout(killTimeout);
      reject(err);
    });
  });

  ctx.inFlightProbes.set(cacheKey, probePromise);
  return probePromise;
}

function parseFfmpegProgress(stderrLine, totalDuration) {
  if (!totalDuration || totalDuration <= 0) return null;
  const match = stderrLine.match(/time=\s*(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    let ms = 0;
    if (match[4]) {
      const fraction = match[4];
      ms = parseInt(fraction, 10) / Math.pow(10, fraction.length);
    }
    const currentSeconds = hours * 3600 + minutes * 60 + seconds + ms;
    const progress = Math.min(100, Math.max(0, (currentSeconds / totalDuration) * 100));
    return progress;
  }
  return null;
}

function runSingleFfmpegJob(job, win, jobIndex, totalJobs) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ctx.getFfmpegPath();
    const args = job.args;
    
    win.webContents.send('divide-status', `[FFmpeg] Spawning: ${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
    ctx.registerProcess(proc, { isYtDlp: false });
    let stderr = '';
    
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      
      if (job.duration) {
        const progress = parseFfmpegProgress(text, job.duration);
        if (progress !== null) {
          const overallProgress = (jobIndex / totalJobs) * 100 + (progress / totalJobs);
          win.webContents.send('divide-progress', Math.round(overallProgress));
        }
      }
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        if (job.isSegment) {
          const dir = path.dirname(job.outputPattern);
          const ext = path.extname(job.outputPattern);
          const files = fs.readdirSync(dir)
            .filter(f => /^part\d+\./.test(f) && f.endsWith(ext))
            .map(f => path.join(dir, f));
          resolve(files);
        } else {
          resolve(job.outputPath);
        }
      } else {
        reject(new Error(`FFmpeg exited with code ${code}\nStderr: ${stderr}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function runFfmpegQueue(jobs, win) {
  const filePaths = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    win.webContents.send('divide-status', `[Job ${i+1}/${jobs.length}] Running: ${job.label}`);
    
    try {
      const outputFilePath = await runSingleFfmpegJob(job, win, i, jobs.length);
      if (outputFilePath) {
        if (Array.isArray(outputFilePath)) {
          filePaths.push(...outputFilePath);
        } else {
          filePaths.push(outputFilePath);
        }
      }
    } catch (err) {
      throw new Error(`Job ${i+1} failed: ${err.message}`);
    }
  }
  return filePaths;
}

// IPC Handlers
ipcMain.handle('select-video-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'mpv', 'flv'] }
    ],
    title: 'Select Video File'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-file-url', (event, filePath) => {
  return pathToFileURL(filePath).href;
});

ipcMain.handle('probe-local-video', async (event, filePath) => {
  try {
    return await probeLocalVideo(filePath);
  } catch (err) {
    console.error('Probe failed:', err);
    throw err;
  }
});

ipcMain.on('divider-import-url', async (event, { url, quality }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (ctx.isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const sourcesDir = path.join(baseDir, 'yt-divided', 'sources');
  
  if (!fs.existsSync(sourcesDir)) {
    fs.mkdirSync(sourcesDir, { recursive: true });
  }

  const outPath = path.join(sourcesDir, '%(title)s.%(ext)s');
  const args = await ctx.buildVideoDownloadArgs({ url, quality, outPath });

  win.webContents.send('download-status', `[DIVIDER IMPORT] Starting source download for ${url}...`);
  
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
  
  ytProcess.on('close', async (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = ctx.resolveFinalDownloadPath(finalPath, sourcesDir, downloadStartedAt);
      if (finalPath && fs.existsSync(finalPath)) {
        try {
          const meta = await probeLocalVideo(finalPath);
          win.webContents.send('divider-import-complete', {
            filePath: finalPath,
            title: meta.filename,
            duration: meta.duration
          });
          win.webContents.send('download-complete', { type: 'divider-import', url, status: 'Success', filePath: finalPath });
        } catch (err) {
          win.webContents.send('download-error', `[DIVIDER IMPORT] Probe failed for downloaded file: ${err.message}`);
        }
      } else {
        win.webContents.send('download-error', `[DIVIDER IMPORT] Could not find completed download file.`);
      }
    } else {
      win.webContents.send('download-error', `[DIVIDER IMPORT] yt-dlp failed with code ${code}`);
    }
  });
});

ipcMain.on('divide-video', async (event, { inputPath, mode, options }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win.webContents.send('divide-status', `[DIVIDER] Initializing video divider in ${mode.toUpperCase()} mode...`);
  
  try {
    const jobs = [];
    const ext = path.extname(inputPath);
    const baseName = path.basename(inputPath, ext);
    const sanitizedBase = sanitizeFilename(baseName);
    const outputDir = buildDivideOutputDir(inputPath);
    
    if (mode === 'fast') {
      const outputPath = path.join(outputDir, `${sanitizedBase}_fast_cut${ext}`);
      const duration = options.endTimeSeconds - options.startTimeSeconds;
      jobs.push({
        label: 'Fast Split',
        args: ['-y', '-ss', options.startTimeStr, '-i', inputPath, '-t', duration.toFixed(3), '-c', 'copy', outputPath],
        outputPath,
        duration: duration
      });
    } else if (mode === 'precise') {
      const outputPath = path.join(outputDir, `${sanitizedBase}_precise_cut${ext}`);
      const duration = options.endTimeSeconds - options.startTimeSeconds;
      jobs.push({
        label: 'Precise Split (Re-encode)',
        args: ['-y', '-i', inputPath, '-ss', options.startTimeStr, '-to', options.endTimeStr, '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'aac', outputPath],
        outputPath,
        duration: duration
      });
    } else if (mode === 'chunks') {
      const outputPattern = path.join(outputDir, `part%03d${ext}`);
      if (fs.existsSync(outputDir)) {
        const existing = fs.readdirSync(outputDir);
        for (const f of existing) {
          if (/^part\d+/.test(f) && f.endsWith(ext)) {
            try { fs.unlinkSync(path.join(outputDir, f)); } catch(e){}
          }
        }
      }
      
      const meta = await probeLocalVideo(inputPath);
      jobs.push({
        label: 'Equal Chunks Segmentation',
        args: ['-y', '-i', inputPath, '-c', 'copy', '-f', 'segment', '-segment_time', options.segmentTimeSeconds.toString(), '-reset_timestamps', '1', outputPattern],
        isSegment: true,
        outputPattern,
        duration: meta.duration
      });
    } else if (mode === 'spatial') {
      if (fs.existsSync(outputDir)) {
        const existing = fs.readdirSync(outputDir);
        for (const f of existing) {
          if ((f.endsWith(`_left${ext}`) || f.endsWith(`_right${ext}`) || f.endsWith(`_top${ext}`) || f.endsWith(`_bottom${ext}`))) {
            try { fs.unlinkSync(path.join(outputDir, f)); } catch(e){}
          }
        }
      }
      
      const meta = await probeLocalVideo(inputPath);
      if (options.left) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_left${ext}`);
        jobs.push({
          label: 'Spatial Split: Left',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:0:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.right) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_right${ext}`);
        jobs.push({
          label: 'Spatial Split: Right',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:iw/2:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.top) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_top${ext}`);
        jobs.push({
          label: 'Spatial Split: Top',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.bottom) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_bottom${ext}`);
        jobs.push({
          label: 'Spatial Split: Bottom',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:ih/2', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
    }
    
    if (jobs.length === 0) {
      throw new Error('No crop regions selected. Please select at least one region for spatial crop.');
    }
    
    const filePaths = await runFfmpegQueue(jobs, win);
    win.webContents.send('divide-status', `All splitting jobs completed successfully! Saved to: ${outputDir}`);
    win.webContents.send('divide-complete', { filePaths, outputDir });
    
    if (ctx.settings.autoOpenFolder) {
      ctx.openFolderOrRevealItem(outputDir);
    }
  } catch (err) {
    console.error('Divide error:', err);
    win.webContents.send('divide-error', err.message || 'An error occurred during division.');
  }
});

ctx.sanitizeFilename = sanitizeFilename;
ctx.buildDivideOutputDir = buildDivideOutputDir;
ctx.probeLocalVideo = probeLocalVideo;
ctx.parseFfmpegProgress = parseFfmpegProgress;
ctx.runSingleFfmpegJob = runSingleFfmpegJob;
ctx.runFfmpegQueue = runFfmpegQueue;
module.exports = { sanitizeFilename, buildDivideOutputDir, probeLocalVideo, parseFfmpegProgress, runSingleFfmpegJob, runFfmpegQueue };
