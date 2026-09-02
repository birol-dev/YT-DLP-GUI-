const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// Local binary path definitions
const localBinDir = path.join(app.getPath('userData'), 'bin');
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const localYtDlp = path.join(localBinDir, `yt-dlp${exeSuffix}`);
const localFfmpeg = path.join(localBinDir, `ffmpeg${exeSuffix}`);
const localFpcalc = path.join(localBinDir, `fpcalc${exeSuffix}`);

function getYtDlpPath() {
  if (fs.existsSync(localYtDlp)) {
    return localYtDlp;
  }
  return 'yt-dlp';
}

function getFfmpegPath() {
  if (fs.existsSync(localFfmpeg)) {
    return localFfmpeg;
  }
  return 'ffmpeg';
}

function getFpcalcPath() {
  if (fs.existsSync(localFpcalc)) {
    return localFpcalc;
  }
  return 'fpcalc';
}

ctx.localBinDir = localBinDir;
ctx.exeSuffix = exeSuffix;
ctx.localYtDlp = localYtDlp;
ctx.localFfmpeg = localFfmpeg;
ctx.localFpcalc = localFpcalc;
ctx.getYtDlpPath = getYtDlpPath;
ctx.getFfmpegPath = getFfmpegPath;
ctx.getFpcalcPath = getFpcalcPath;
module.exports = { localBinDir, exeSuffix, localYtDlp, localFfmpeg, localFpcalc, getYtDlpPath, getFfmpegPath, getFpcalcPath };
