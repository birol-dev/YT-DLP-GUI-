const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

function getGifOutputPath(inputPath) {
  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  const gifOutputDir = path.join(baseDir, 'gif-exports');
  if (!fs.existsSync(gifOutputDir)) {
    fs.mkdirSync(gifOutputDir, { recursive: true });
  }
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  const timestamp = Date.now();
  return path.join(gifOutputDir, `${sanitized}_${timestamp}.gif`);
}

ipcMain.handle('convert-video-to-gif', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const send = (channel, data) => {
    if (typeof ctx.safeSend === 'function') ctx.safeSend(win, channel, data);
    else if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  };
  const { inputPath, fps, width, startTime, endTime } = payload || {};
  
  try {
    if (!inputPath || typeof inputPath !== 'string') {
      const result = { success: false, error: 'Invalid input path.' };
      send('gif-finished', result);
      return result;
    }
    const duration = Number(endTime) - Number(startTime);
    if (!(duration > 0)) {
      const result = { success: false, error: 'End time must be greater than start time.' };
      send('gif-finished', result);
      return result;
    }
    const outputPath = getGifOutputPath(inputPath);
    let scaleWidth = width;
    if (width === 'Original' || !width) {
      scaleWidth = 'iw';
    }
    
    const ffmpegPath = ctx.getFfmpegPath();
    const args = [
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${scaleWidth}:-1:flags=bicubic,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
      '-threads', '0',
      '-y',
      outputPath
    ];

    console.log(`[GIF Conversion] Spawning: ${ffmpegPath} ${args.join(' ')}`);
    
    return new Promise((resolve) => {
      const proc = spawn(ffmpegPath, args, {
        windowsHide: true
      });
      ctx.registerProcess(proc, { isYtDlp: false });
      
      let stderr = '';
      let lastProgress = -1;
      
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        const progress = ctx.parseFfmpegProgress(text, duration);
        if (progress !== null) {
          const rounded = Math.min(100, Math.max(0, Math.round(progress)));
          if (rounded !== lastProgress) {
            lastProgress = rounded;
            send('gif-progress', rounded);
          }
        }
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          const result = { success: true, outputPath };
          send('gif-finished', result);
          resolve(result);
        } else {
          console.error(`ffmpeg failed with code ${code}. Stderr: ${stderr}`);
          const errorMsg = `FFmpeg process exited with code ${code}. Stderr: ${stderr.slice(-300)}`;
          const result = { success: false, error: errorMsg };
          send('gif-finished', result);
          resolve(result);
        }
      });
      
      proc.on('error', (err) => {
        console.error('ffmpeg spawn error:', err);
        const errorMsg = `Failed to spawn FFmpeg: ${err.message}`;
        const result = { success: false, error: errorMsg };
        send('gif-finished', result);
        resolve(result);
      });
    });
  } catch (err) {
    console.error('GIF conversion error:', err);
    const result = { success: false, error: err.message };
    send('gif-finished', result);
    return result;
  }
});

ctx.getGifOutputPath = getGifOutputPath;
module.exports = { getGifOutputPath };
