const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

function isCommandInPath(command) {
  return new Promise((resolve) => {
    const arg = command === 'ffmpeg' ? '-version' : '--version';
    const proc = spawn(command, [arg]);
    proc.on('error', () => {
      resolve(false);
    });
    proc.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

async function checkDependencies() {
  const ytDlpLocal = fs.existsSync(ctx.localYtDlp);
  const ffmpegLocal = fs.existsSync(ctx.localFfmpeg);
  const fpcalcLocal = fs.existsSync(ctx.localFpcalc);

  let ytDlpGlobal = false;
  let ffmpegGlobal = false;
  let fpcalcGlobal = false;

  if (!ytDlpLocal) {
    ytDlpGlobal = await isCommandInPath('yt-dlp');
  }
  if (!ffmpegLocal) {
    ffmpegGlobal = await isCommandInPath('ffmpeg');
  }
  if (!fpcalcLocal) {
    fpcalcGlobal = await isCommandInPath('fpcalc');
  }

  return {
    ytDlp: {
      local: ytDlpLocal,
      global: ytDlpGlobal,
      available: ytDlpLocal || ytDlpGlobal
    },
    ffmpeg: {
      local: ffmpegLocal,
      global: ffmpegGlobal,
      available: ffmpegLocal || ffmpegGlobal
    },
    fpcalc: {
      local: fpcalcLocal,
      global: fpcalcGlobal,
      available: fpcalcLocal || fpcalcGlobal
    }
  };
}

function getFfmpegDownloadUrl(version = '6.1') {
  const is64 = process.arch === 'x64' || process.arch === 'arm64';
  const cleanVersion = String(version || '6.1').replace(/^v/, '');
  const base = `https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v${cleanVersion}`;
  if (process.platform === 'win32') {
    return is64
      ? `${base}/ffmpeg-${cleanVersion}-win-64.zip`
      : `${base}/ffmpeg-${cleanVersion}-win-32.zip`;
  } else if (process.platform === 'darwin') {
    return `${base}/ffmpeg-${cleanVersion}-macos-64.zip`;
  } else {
    return is64
      ? `${base}/ffmpeg-${cleanVersion}-linux-64.zip`
      : `${base}/ffmpeg-${cleanVersion}-linux-32.zip`;
  }
}

function getDependencyUrls() {
  const urls = {
    ytDlp: '',
    ffmpeg: '',
    fpcalc: ''
  };

  urls.ytDlp = ctx.getYtDlpDownloadUrl(ctx.settings.ytDlpChannel);
  urls.ffmpeg = getFfmpegDownloadUrl('6.1');

  if (process.platform === 'win32') {
    urls.fpcalc = 'https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-windows-x86_64.zip';
  } else if (process.platform === 'darwin') {
    urls.fpcalc = 'https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-macos-universal.tar.gz';
  } else {
    urls.fpcalc = 'https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-linux-x86_64.tar.gz';
  }

  return urls;
}

function downloadFile(url, destPath, win, itemName, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let file = fs.createWriteStream(destPath);
    let redirectsCount = 0;

    const executeDownload = (currentUrl) => {
      let isSettled = false;
      const finishWithError = (err) => {
        if (isSettled) return;
        isSettled = true;
        try { file.close(); } catch (e) {}
        try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (e) {}
        reject(err);
      };

      const options = {
        headers: {
          'User-Agent': ctx.BROWSER_USER_AGENT,
          'Accept': '*/*'
        }
      };

      const request = https.get(currentUrl, options, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          redirectsCount++;
          if (redirectsCount > 10) {
            return finishWithError(new Error('Too many redirects while downloading dependency.'));
          }
          try { file.close(); } catch (e) {}
          file = fs.createWriteStream(destPath);
          return executeDownload(response.headers.location);
        }

        if (response.statusCode !== 200) {
          return finishWithError(new Error(`Server returned status code ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          let progress = 0;
          if (totalBytes > 0) {
            progress = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          }
          if (win && !win.isDestroyed() && win.webContents) {
            try {
              win.webContents.send('dependency-status', {
                type: 'progress',
                item: itemName,
                progress: progress,
                downloadedBytes,
                totalBytes
              });
            } catch (e) {}
          }
          if (typeof onProgress === 'function') {
            try {
              onProgress({ progress, downloadedBytes, totalBytes });
            } catch (e) {}
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          if (isSettled) return;
          isSettled = true;
          file.close(() => {
            resolve();
          });
        });
      });

      request.setTimeout(60000, () => {
        request.destroy(new Error('Download timed out after 60s of inactivity.'));
      });

      request.on('error', (err) => {
        finishWithError(err);
      });

      file.on('error', (err) => {
        finishWithError(err);
      });
    };

    executeDownload(url);
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    let cmd = '';
    if (zipPath.endsWith('.zip')) {
      if (process.platform === 'win32') {
        cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
      } else {
        cmd = `unzip -o "${zipPath}" -d "${destDir}"`;
      }
    } else {
      cmd = `tar -xzf "${zipPath}" -C "${destDir}"`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function makeExecutable(filePath) {
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch (err) {
      console.error(`Failed to chmod ${filePath}:`, err);
    }
  }
}

async function setupDependencies(win) {
  win.webContents.send('dependency-status', { type: 'checking' });

  try {
    const deps = await checkDependencies();
    const urls = getDependencyUrls();

    const needYtDlp = !deps.ytDlp.available;
    const needFfmpeg = !deps.ffmpeg.available;
    const needFpcalc = !deps.fpcalc.available;

    win.webContents.send('dependency-status', {
      type: 'init',
      needYtDlp,
      needFfmpeg,
      needFpcalc
    });

    if (!needYtDlp && !needFfmpeg && !needFpcalc) {
      win.webContents.send('dependency-status', { type: 'all-ready' });
      ctx.saveSettingsInternal({ firstRunComplete: true });
      ctx.checkAndUpdateAllDependencies(win, { silent: false });
      return;
    }

    if (!fs.existsSync(ctx.localBinDir)) {
      fs.mkdirSync(ctx.localBinDir, { recursive: true });
    }

    if (needYtDlp) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'yt-dlp' });
      const tempPath = path.join(ctx.localBinDir, `yt-dlp.tmp_${Date.now()}`);
      await downloadFile(urls.ytDlp, tempPath, win, 'yt-dlp');
      await ctx.replaceLocalBinary(tempPath, ctx.localYtDlp, { minSizeBytes: 1000000 });

      const versionResult = await ctx.runYtDlpProcess(['--version'], false, 15000);
      const version = (versionResult.stdout || '').trim();
      ctx.saveSettingsInternal({
        ytDlpInstalledChannel: ctx.normalizeYtDlpChannel(ctx.settings.ytDlpChannel),
        ytDlpInstalledVersion: version
      });

      win.webContents.send('dependency-status', { type: 'download-complete', item: 'yt-dlp' });
    }

    if (needFfmpeg) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'ffmpeg' });
      const zipPath = path.join(ctx.localBinDir, 'ffmpeg.zip');
      await downloadFile(urls.ffmpeg, zipPath, win, 'ffmpeg');

      win.webContents.send('dependency-status', { type: 'extracting', item: 'ffmpeg' });
      await extractZip(zipPath, ctx.localBinDir);

      try {
        fs.unlinkSync(zipPath);
      } catch (e) {
        console.error('Failed to delete ffmpeg.zip:', e);
      }

      makeExecutable(ctx.localFfmpeg);
      win.webContents.send('dependency-status', { type: 'download-complete', item: 'ffmpeg' });
    }

    if (needFpcalc) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'fpcalc' });
      const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
      const archivePath = path.join(ctx.localBinDir, 'fpcalc' + ext);
      await downloadFile(urls.fpcalc, archivePath, win, 'fpcalc');

      win.webContents.send('dependency-status', { type: 'extracting', item: 'fpcalc' });
      await extractZip(archivePath, ctx.localBinDir);

      try {
        fs.unlinkSync(archivePath);
      } catch (e) {
        console.error('Failed to delete fpcalc archive:', e);
      }

      // Check for nested directory and move binary to localFpcalc
      const platformDir = process.platform === 'win32' 
        ? 'chromaprint-fpcalc-1.6.0-windows-x86_64' 
        : (process.platform === 'darwin' ? 'chromaprint-fpcalc-1.6.0-macos-universal' : 'chromaprint-fpcalc-1.6.0-linux-x86_64');
      
      let foundFpcalc = '';
      const checkAndSet = (p) => {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          foundFpcalc = p;
          return true;
        }
        return false;
      };
      
      const possiblePaths = [
        path.join(ctx.localBinDir, `fpcalc${ctx.exeSuffix}`),
        path.join(ctx.localBinDir, platformDir, `fpcalc${ctx.exeSuffix}`),
        path.join(ctx.localBinDir, platformDir, 'bin', `fpcalc${ctx.exeSuffix}`)
      ];
      
      for (const p of possiblePaths) {
        if (checkAndSet(p)) break;
      }
      
      if (!foundFpcalc) {
        try {
          const entries = fs.readdirSync(ctx.localBinDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const subDirPath = path.join(ctx.localBinDir, entry.name);
              const subEntries = fs.readdirSync(subDirPath);
              for (const subEntry of subEntries) {
                if (subEntry === `fpcalc${ctx.exeSuffix}`) {
                  foundFpcalc = path.join(subDirPath, subEntry);
                  break;
                }
                if (subEntry === 'bin') {
                  const binPath = path.join(subDirPath, 'bin', `fpcalc${ctx.exeSuffix}`);
                  if (fs.existsSync(binPath)) {
                    foundFpcalc = binPath;
                    break;
                  }
                }
              }
            }
            if (foundFpcalc) break;
          }
        } catch (e) {
          console.error('Search for nested fpcalc failed:', e);
        }
      }
      
      if (foundFpcalc && foundFpcalc !== ctx.localFpcalc) {
        if (fs.existsSync(ctx.localFpcalc)) {
          fs.unlinkSync(ctx.localFpcalc);
        }
        fs.renameSync(foundFpcalc, ctx.localFpcalc);
        try {
          let parentDir = path.dirname(foundFpcalc);
          if (path.basename(parentDir) === 'bin') {
            fs.rmdirSync(parentDir);
            parentDir = path.dirname(parentDir);
          }
          fs.rmdirSync(parentDir);
        } catch (e) {}
      }

      makeExecutable(ctx.localFpcalc);
      win.webContents.send('dependency-status', { type: 'download-complete', item: 'fpcalc' });
    }

    win.webContents.send('dependency-status', { type: 'all-ready' });
    ctx.saveSettingsInternal({ firstRunComplete: true });
    ctx.checkAndUpdateAllDependencies(win, { silent: false });

  } catch (error) {
    console.error('Dependency setup failed:', error);
    win.webContents.send('dependency-status', {
      type: 'error',
      message: error.message || 'Unknown error occurred during setup'
    });
  }
}

function fetchLatestReleaseTag(repo) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) YT-DLP-GUI',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 6000
    };
    const req = https.get(`https://api.github.com/repos/${repo}/releases/latest`, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, options, (res2) => {
          let body = '';
          res2.on('data', chunk => body += chunk);
          res2.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(data.tag_name || null);
            } catch { resolve(null); }
          });
        }).on('error', () => resolve(null));
        return;
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.tag_name || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function getFfmpegVersionInfo() {
  const localExists = fs.existsSync(ctx.localFfmpeg);
  const ffmpegPath = ctx.getFfmpegPath();

  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-version']);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish();
    }, 6000);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`;
      const match = output.match(/ffmpeg\s+version\s+([^\s,]+)/i);
      const version = match ? match[1].trim() : '';
      const available = !!version;

      if (available) {
        ctx.saveSettingsInternal({ ffmpegInstalledVersion: version });
      }

      resolve({
        available,
        version,
        local: localExists,
        path: ffmpegPath
      });
    };

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', finish);
    proc.on('error', finish);
  });
}

let activeFfmpegUpdatePromise = null;

async function updateFfmpeg(win, { onProgress, silent = false } = {}) {
  if (activeFfmpegUpdatePromise) {
    return await activeFfmpegUpdatePromise;
  }

  activeFfmpegUpdatePromise = (async () => {
    const latestTag = (await fetchLatestReleaseTag('ffbinaries/ffbinaries-prebuilt')) || 'v6.1';
    const cleanVersion = latestTag.replace(/^v/, '');
    const downloadUrl = getFfmpegDownloadUrl(cleanVersion);

    if (!fs.existsSync(ctx.localBinDir)) {
      fs.mkdirSync(ctx.localBinDir, { recursive: true });
    }

    const zipPath = path.join(ctx.localBinDir, `ffmpeg_update_${Date.now()}.zip`);

    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-log', `[ffmpeg] Downloading FFmpeg v${cleanVersion}...`);
      win.webContents.send('dependency-update-status', {
        phase: 'downloading',
        item: 'ffmpeg',
        message: `Downloading FFmpeg v${cleanVersion}...`
      });
    }

    await downloadFile(downloadUrl, zipPath, win, 'ffmpeg', (progressInfo) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('dependency-update-status', {
          phase: 'progress',
          item: 'ffmpeg',
          progress: progressInfo.progress,
          message: `Downloading FFmpeg: ${progressInfo.progress}%`
        });
      }
      if (typeof onProgress === 'function') onProgress(progressInfo);
    });

    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-log', `[ffmpeg] Extracting FFmpeg binaries...`);
      win.webContents.send('dependency-update-status', {
        phase: 'extracting',
        item: 'ffmpeg',
        message: 'Extracting FFmpeg binaries...'
      });
    }

    await extractZip(zipPath, ctx.localBinDir);

    try {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    } catch (e) {
      console.error('Failed to cleanup ffmpeg zip:', e);
    }

    makeExecutable(ctx.localFfmpeg);

    const info = await getFfmpegVersionInfo();
    if (info.available) {
      ctx.saveSettingsInternal({
        ffmpegInstalledVersion: info.version
      });
    }

    return info;
  })().finally(() => {
    activeFfmpegUpdatePromise = null;
  });

  return await activeFfmpegUpdatePromise;
}

async function checkFfmpegUpdate(win, { force = false, silent = false } = {}) {
  const current = await getFfmpegVersionInfo();
  const previousVersion = current.version || '';

  if (force) {
    try {
      const updated = await updateFfmpeg(win, { silent });
      return {
        item: 'ffmpeg',
        status: 'updated',
        previousVersion,
        version: updated.version,
        local: true,
        message: `FFmpeg updated to ${updated.version || 'v6.1'}`
      };
    } catch (err) {
      return {
        item: 'ffmpeg',
        status: 'error',
        previousVersion,
        version: previousVersion,
        local: current.local,
        message: `FFmpeg update failed: ${err.message}`
      };
    }
  }

  if (!current.available) {
    try {
      const updated = await updateFfmpeg(win, { silent });
      return {
        item: 'ffmpeg',
        status: 'updated',
        previousVersion: '',
        version: updated.version,
        local: true,
        message: `FFmpeg installed (${updated.version || 'v6.1'})`
      };
    } catch (err) {
      return {
        item: 'ffmpeg',
        status: 'error',
        previousVersion: '',
        version: '',
        local: false,
        message: `FFmpeg installation failed: ${err.message}`
      };
    }
  }

  try {
    const latestTag = await fetchLatestReleaseTag('ffbinaries/ffbinaries-prebuilt');
    const targetVersion = (latestTag || 'v6.1').replace(/^v/, '');

    const currentVerNumber = parseFloat(current.version);
    const targetVerNumber = parseFloat(targetVersion);
    const hasNewer = !isNaN(currentVerNumber) && !isNaN(targetVerNumber) && targetVerNumber > currentVerNumber;

    if (hasNewer) {
      const updated = await updateFfmpeg(win, { silent });
      return {
        item: 'ffmpeg',
        status: 'updated',
        previousVersion,
        version: updated.version,
        local: true,
        message: `FFmpeg updated from ${previousVersion} to ${updated.version || targetVersion}`
      };
    }

    return {
      item: 'ffmpeg',
      status: 'up-to-date',
      previousVersion,
      version: current.version,
      local: current.local,
      message: `FFmpeg is up to date (${current.version})`
    };
  } catch (err) {
    return {
      item: 'ffmpeg',
      status: 'up-to-date',
      previousVersion,
      version: current.version,
      local: current.local,
      message: `FFmpeg verified (${current.version})`
    };
  }
}

let activeUpdateCheckPromise = null;

async function checkAndUpdateAllDependencies(win, { silent = false, force = false } = {}) {
  if (activeUpdateCheckPromise) {
    return await activeUpdateCheckPromise;
  }

  activeUpdateCheckPromise = (async () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('dependency-update-status', {
        phase: 'checking',
        message: 'Checking for component updates...'
      });
    }

    let ytDlpResult = null;
    try {
      if (force) {
        const forceRes = await ctx.forceUpdateYtDlp(win, ctx.settings.ytDlpChannel, { silent: false });
        ytDlpResult = {
          item: 'yt-dlp',
          status: forceRes?.ok ? 'updated' : 'error',
          channel: forceRes?.channel || ctx.settings.ytDlpChannel,
          version: forceRes?.version,
          message: forceRes?.message || 'yt-dlp updated'
        };
      } else {
        ytDlpResult = await ctx.checkUpdates(win);
      }
    } catch (err) {
      ytDlpResult = {
        item: 'yt-dlp',
        status: 'error',
        message: `yt-dlp check failed: ${err.message}`
      };
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('dependency-update-status', {
        phase: 'progress',
        item: 'yt-dlp',
        result: ytDlpResult
      });
    }

    let ffmpegResult = null;
    try {
      ffmpegResult = await checkFfmpegUpdate(win, { force, silent });
    } catch (err) {
      ffmpegResult = {
        item: 'ffmpeg',
        status: 'error',
        message: `FFmpeg check failed: ${err.message}`
      };
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send('dependency-update-status', {
        phase: 'progress',
        item: 'ffmpeg',
        result: ffmpegResult
      });
    }

    const nowIso = new Date().toISOString();
    ctx.saveSettingsInternal({ lastUpdateCheck: nowIso });

    const updatedCount = (ytDlpResult?.status === 'updated' ? 1 : 0) + (ffmpegResult?.status === 'updated' ? 1 : 0);
    const hasError = ytDlpResult?.status === 'error' || ffmpegResult?.status === 'error';

    const summary = {
      phase: 'completed',
      timestamp: nowIso,
      updatedCount,
      hasError,
      ytDlp: ytDlpResult,
      ffmpeg: ffmpegResult,
      message: updatedCount > 0
        ? `Updates installed: ${[ytDlpResult?.status === 'updated' ? ytDlpResult.message : null, ffmpegResult?.status === 'updated' ? ffmpegResult.message : null].filter(Boolean).join(' • ')}`
        : (hasError
            ? `Update check completed with warnings.`
            : `All components up to date (${ytDlpResult?.version || 'yt-dlp'} • ${ffmpegResult?.version || 'FFmpeg'}).`)
    };

    if (win && !win.isDestroyed()) {
      win.webContents.send('dependency-update-status', summary);
      win.webContents.send('update-log', `[Update Manager] ${summary.message}`);
    }

    return summary;
  })().finally(() => {
    activeUpdateCheckPromise = null;
  });

  return await activeUpdateCheckPromise;
}

ipcMain.handle('get-ffmpeg-info', async () => {
  return await getFfmpegVersionInfo();
});

ipcMain.handle('update-ffmpeg', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await checkFfmpegUpdate(win, { force: true, silent: false });
});

ipcMain.handle('check-all-updates', async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return await checkAndUpdateAllDependencies(win, { force: !!options?.force, silent: false });
});

ctx.isCommandInPath = isCommandInPath;
ctx.checkDependencies = checkDependencies;
ctx.getDependencyUrls = getDependencyUrls;
ctx.getFfmpegDownloadUrl = getFfmpegDownloadUrl;
ctx.fetchLatestReleaseTag = fetchLatestReleaseTag;
ctx.getFfmpegVersionInfo = getFfmpegVersionInfo;
ctx.downloadFile = downloadFile;
ctx.extractZip = extractZip;
ctx.makeExecutable = makeExecutable;
ctx.setupDependencies = setupDependencies;
ctx.updateFfmpeg = updateFfmpeg;
ctx.checkFfmpegUpdate = checkFfmpegUpdate;
ctx.checkAndUpdateAllDependencies = checkAndUpdateAllDependencies;

module.exports = {
  isCommandInPath,
  checkDependencies,
  getDependencyUrls,
  getFfmpegDownloadUrl,
  fetchLatestReleaseTag,
  getFfmpegVersionInfo,
  downloadFile,
  extractZip,
  makeExecutable,
  setupDependencies,
  updateFfmpeg,
  checkFfmpegUpdate,
  checkAndUpdateAllDependencies
};
