const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');

// Local binary path definitions
const localBinDir = path.join(app.getPath('userData'), 'bin');
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const localYtDlp = path.join(localBinDir, `yt-dlp${exeSuffix}`);
const localFfmpeg = path.join(localBinDir, `ffmpeg${exeSuffix}`);

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

// Settings management variables
let settings = {};
let settingsFilePath = '';

function initSettings() {
  settingsFilePath = path.join(app.getPath('userData'), 'settings.json');
  const defaultSettings = {
    downloadDir: '',
    defaultQuality: '1080',
    defaultSubLang: 'en',
    accentColor: 'default',
    soundEnabled: true,
    autoOpenFolder: false,
    videoFormat: 'mp4',
    audioFormat: 'mp3',
    firstRunComplete: false,
    onboardingComplete: false,
    userName: '',
    weatherCity: '',
    weatherLat: null,
    weatherLon: null,
    tempFormat: 'fahrenheit'
  };
  
  settings = { ...defaultSettings };
  
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readFileSync(settingsFilePath, 'utf8');
      settings = { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

function saveSettingsInternal(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return false;
  }
}

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
    const files = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(dirPath, entry.name);
        const stat = fs.statSync(filePath);
        return { filePath, modifiedAt: stat.mtimeMs };
      })
      .filter((file) => file.modifiedAt >= minModifiedAt && !isTemporaryDownloadPath(file.filePath))
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return files[0]?.filePath || '';
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
  const ytDlpLocal = fs.existsSync(localYtDlp);
  const ffmpegLocal = fs.existsSync(localFfmpeg);

  let ytDlpGlobal = false;
  let ffmpegGlobal = false;

  if (!ytDlpLocal) {
    ytDlpGlobal = await isCommandInPath('yt-dlp');
  }
  if (!ffmpegLocal) {
    ffmpegGlobal = await isCommandInPath('ffmpeg');
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
    }
  };
}

function getDependencyUrls() {
  const urls = {
    ytDlp: '',
    ffmpeg: ''
  };

  if (process.platform === 'win32') {
    urls.ytDlp = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (process.platform === 'darwin') {
    urls.ytDlp = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  } else {
    urls.ytDlp = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
  }

  const is64 = process.arch === 'x64' || process.arch === 'arm64';
  if (process.platform === 'win32') {
    urls.ffmpeg = is64
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-32.zip';
  } else if (process.platform === 'darwin') {
    urls.ffmpeg = 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-macos-64.zip';
  } else {
    urls.ffmpeg = is64
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-32.zip';
  }

  return urls;
}

function downloadFile(url, destPath, win, itemName) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        return downloadFile(response.headers.location, destPath, win, itemName).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Server returned status code ${response.statusCode}`));
      }

      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;

      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const progress = Math.round((downloadedBytes / totalBytes) * 100);
          win.webContents.send('dependency-status', {
            type: 'progress',
            item: itemName,
            progress: progress
          });
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });

    file.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    let cmd = '';
    if (process.platform === 'win32') {
      cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
    } else {
      cmd = `unzip -o "${zipPath}" -d "${destDir}"`;
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

    win.webContents.send('dependency-status', {
      type: 'init',
      needYtDlp,
      needFfmpeg
    });

    if (!needYtDlp && !needFfmpeg) {
      win.webContents.send('dependency-status', { type: 'all-ready' });
      saveSettingsInternal({ firstRunComplete: true });
      checkUpdates(win);
      return;
    }

    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }

    if (needYtDlp) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'yt-dlp' });
      const tempPath = localYtDlp + '.tmp';
      await downloadFile(urls.ytDlp, tempPath, win, 'yt-dlp');
      
      if (fs.existsSync(localYtDlp)) {
        fs.unlinkSync(localYtDlp);
      }
      fs.renameSync(tempPath, localYtDlp);
      makeExecutable(localYtDlp);
      
      win.webContents.send('dependency-status', { type: 'download-complete', item: 'yt-dlp' });
    }

    if (needFfmpeg) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'ffmpeg' });
      const zipPath = path.join(localBinDir, 'ffmpeg.zip');
      await downloadFile(urls.ffmpeg, zipPath, win, 'ffmpeg');

      win.webContents.send('dependency-status', { type: 'extracting', item: 'ffmpeg' });
      await extractZip(zipPath, localBinDir);

      try {
        fs.unlinkSync(zipPath);
      } catch (e) {
        console.error('Failed to delete ffmpeg.zip:', e);
      }

      makeExecutable(localFfmpeg);
      win.webContents.send('dependency-status', { type: 'download-complete', item: 'ffmpeg' });
    }

    win.webContents.send('dependency-status', { type: 'all-ready' });
    saveSettingsInternal({ firstRunComplete: true });
    checkUpdates(win);

  } catch (error) {
    console.error('Dependency setup failed:', error);
    win.webContents.send('dependency-status', {
      type: 'error',
      message: error.message || 'Unknown error occurred during setup'
    });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 950,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#121212'
  });

  win.loadFile('index.html');
  
  win.webContents.once('did-finish-load', () => {
    if (settings.onboardingComplete) {
      if (!settings.firstRunComplete) {
        setupDependencies(win);
      } else {
        checkUpdates(win);
      }
    }
  });
}

function checkUpdates(win) {
  // Check yt-dlp update
  const ytDlpPath = getYtDlpPath();
  const ytUpdate = spawn(ytDlpPath, ['-U']);
  ytUpdate.stdout.on('data', (data) => {
    win.webContents.send('update-log', `[yt-dlp update] ${data.toString()}`);
  });
  ytUpdate.stderr.on('data', (data) => {
    win.webContents.send('update-log', `[yt-dlp stderr] ${data.toString()}`);
  });
  ytUpdate.on('error', () => {
    win.webContents.send('update-log', `[yt-dlp error] yt-dlp might not be installed or not in PATH.`);
  });
  
  // Verify FFmpeg is available
  const ffmpegPath = getFfmpegPath();
  const ffmpegCheck = spawn(ffmpegPath, ['-version']);
  ffmpegCheck.stdout.once('data', (data) => {
    const versionLine = data.toString().split('\n')[0];
    win.webContents.send('update-log', `[ffmpeg check] ${versionLine}`);
  });
  ffmpegCheck.on('error', () => {
    win.webContents.send('update-log', `[ffmpeg error] ffmpeg not found in PATH! Audio extraction and video merging may fail.`);
  });
}

app.whenReady().then(() => {
  initSettings();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('open-folder', (event, filePath) => {
  if (filePath) {
    try {
      if (fs.existsSync(filePath)) {
        shell.showItemInFolder(filePath);
      } else {
        // Fallback if file itself was moved or deleted - try opening containing folder
        const dirPath = path.dirname(filePath);
        if (fs.existsSync(dirPath)) {
          shell.openPath(dirPath);
        }
      }
    } catch (err) {
      console.error('Failed to open item in folder:', err);
    }
  }
});

ipcMain.on('open-download-folder', (event, type) => {
  try {
    const baseDir = settings.downloadDir || app.getPath('downloads');
    let subFolder = 'yt-videos';
    if (type === 'video') subFolder = 'yt-videos';
    else if (type === 'audio') subFolder = 'yt-audios';
    else if (type === 'ig-video') subFolder = 'ig-videos';
    else if (type === 'ig-audio') subFolder = 'ig-audios';
    else if (type === 'instagram') subFolder = 'ig-videos';
    
    const targetDir = path.join(baseDir, subFolder);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    shell.openPath(targetDir);
  } catch (err) {
    console.error('Failed to open download folder:', err);
  }
});

ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  return saveSettingsInternal(newSettings);
});

ipcMain.handle('get-system-info', () => {
  try {
    return {
      username: os.userInfo().username || os.hostname() || 'user'
    };
  } catch (e) {
    return { username: 'user' };
  }
});

ipcMain.handle('finish-onboarding', (event, onboardingData) => {
  const updated = saveSettingsInternal({
    onboardingComplete: true,
    userName: onboardingData.userName,
    weatherCity: onboardingData.weatherCity,
    weatherLat: onboardingData.weatherLat,
    weatherLon: onboardingData.weatherLon,
    tempFormat: onboardingData.tempFormat
  });
  
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (!settings.firstRunComplete) {
      setupDependencies(win);
    } else {
      checkUpdates(win);
    }
  }
  return updated;
});

ipcMain.handle('select-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select Download Folder'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

function buildVideoDownloadArgs({ url, quality, outPath }) {
  const videoFormat = settings.videoFormat || 'mp4';
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

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);
  return args;
}

ipcMain.on('download-video', (event, { url, quality }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const videoDir = path.join(baseDir, 'yt-videos');
  
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const outPath = path.join(videoDir, '%(title)s.%(ext)s');
  const args = buildVideoDownloadArgs({ url, quality, outPath });
  const videoFormat = settings.videoFormat || 'mp4';

  win.webContents.send('download-status', `[VIDEO] Starting download in ${videoFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
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
  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  ytProcess.on('close', (code) => {
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'video', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        shell.showItemInFolder(finalPath);
      }
    }
    else win.webContents.send('download-error', `[VIDEO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-audio', (event, { url }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const audioDir = path.join(baseDir, 'yt-audios');
  
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

  const outPath = path.join(audioDir, '%(title)s.%(ext)s');
  
  // Dynamic audio format selection based on settings
  const audioFormat = settings.audioFormat || 'mp3';
  
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

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);

  win.webContents.send('download-status', `[AUDIO] Starting extraction to ${audioFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
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
  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  ytProcess.on('close', (code) => {
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, audioDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'audio', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        shell.showItemInFolder(finalPath);
      }
    }
    else win.webContents.send('download-error', `[AUDIO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-subtitles', (event, { url, lang }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
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
    args.push('--sub-langs', `${subLang}.*`);
  }

  args.push(
    '--skip-download',
    '-o', outPath,
    '--no-mtime'
  );

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);

  win.webContents.send('download-status', `[SUBS] Starting download for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
    const lines = text.split('\n');
    for (const line of lines) {
      const subMatch = line.match(/Writing video subtitles to:\s*(.+)/);
      if (subMatch) finalPath = subMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  ytProcess.on('close', (code) => {
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, subsDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'subtitles', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        shell.showItemInFolder(finalPath);
      }
    }
    else win.webContents.send('download-error', `[SUBS] Download failed with code ${code}`);
  });
});

ipcMain.on('download-instagram', (event, { url, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
  
  let outPath = '';
  let args = [];
  let subFolder = '';
  
  if (format === 'audio') {
    subFolder = 'ig-audios';
    const audioDir = path.join(baseDir, subFolder);
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    outPath = path.join(audioDir, '%(title)s.%(ext)s');
    
    const audioFormat = settings.audioFormat || 'mp3';
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
    
    const videoFormat = settings.videoFormat || 'mp4';
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
  
  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }
  
  args.push(url);
  
  const label = format === 'audio' ? 'AUDIO' : 'VIDEO';
  win.webContents.send('download-status', `[INSTAGRAM ${label}] Starting download in ${format === 'audio' ? (settings.audioFormat || 'mp3').toUpperCase() : (settings.videoFormat || 'mp4').toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';
  
  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
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
  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  ytProcess.on('close', (code) => {
    if (code === 0) {
      const type = format === 'audio' ? 'ig-audio' : 'ig-video';
      finalPath = resolveFinalDownloadPath(finalPath, path.join(baseDir, subFolder), downloadStartedAt);
      win.webContents.send('download-complete', { type, url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        shell.showItemInFolder(finalPath);
      }
    }
    else win.webContents.send('download-error', `[INSTAGRAM ${label}] Download failed with code ${code}`);
  });
});

ipcMain.on('continue-anyway', (event) => {
  saveSettingsInternal({ firstRunComplete: true });
});

ipcMain.handle('fetch-video-info', async (event, url) => {
  const ytDlpPath = getYtDlpPath();
  
  const runYtDlp = (args) => {
    return new Promise((resolve) => {
      const proc = spawn(ytDlpPath, args);
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => stdout += d.toString());
      proc.stderr.on('data', (d) => stderr += d.toString());
      proc.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
      proc.on('error', (err) => {
        resolve({ code: -1, stdout: '', stderr: err.message });
      });
    });
  };

  // Try with mp4 format filter first for small info payload and direct stream URL
  let result = await runYtDlp(['--dump-json', '-f', '18/best[ext=mp4]', url]);
  
  // If it fails (some non-YT sites don't have format 18), fallback to dump full json
  if (result.code !== 0) {
    result = await runYtDlp(['--dump-json', url]);
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

      return {
        success: true,
        title: parsed.title || 'Unknown Video',
        duration: parsed.duration || 0,
        thumbnail: parsed.thumbnail || (parsed.thumbnails && parsed.thumbnails.length > 0 ? parsed.thumbnails[parsed.thumbnails.length - 1].url : ''),
        streamUrl: streamUrl
      };
    } catch (e) {
      return { success: false, error: 'JSON parse error: ' + e.message };
    }
  } else {
    return { success: false, error: result.stderr || 'Failed to fetch video information.' };
  }
});

ipcMain.on('download-clip', (event, { url, quality, startTime, endTime, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const isAudio = format === 'audio';
  const subDir = isAudio ? 'yt-audios' : 'yt-videos';
  const videoDir = path.join(baseDir, subDir);
  
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const outPath = path.join(videoDir, '%(title)s_clip_%(section_start)s_%(section_end)s.%(ext)s');
  const sectionStr = `*${startTime}-${endTime}`;
  
  let args = [];
  let formatLabel = '';

  if (isAudio) {
    const audioFormat = settings.audioFormat || 'mp3';
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
    const videoFormat = settings.videoFormat || 'mp4';
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
      formatStr = `bestvideo[vcodec^=avc1][height<=${quality}]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
      mergeFormat = 'mp4';
    }
    
    args = [
      '-f', formatStr,
      '--merge-output-format', mergeFormat,
    ];
  }

  args.push(
    '--download-sections', sectionStr,
    '-o', outPath,
    '--no-mtime'
  );

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);

  win.webContents.send('download-status', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Starting download for section ${startTime}-${endTime} in ${formatLabel} format...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
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
  
  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  
  ytProcess.on('close', (code) => {
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: isAudio ? 'clip-audio' : 'clip', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        shell.showItemInFolder(finalPath);
      }
    }
    else win.webContents.send('download-error', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Download failed with code ${code}`);
  });
});

// Video Divider Helpers & Handlers
const { pathToFileURL } = require('url');

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function buildDivideOutputDir(inputPath) {
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const sanitizedName = sanitizeFilename(baseName);
  const outputDir = path.join(baseDir, 'yt-divided', sanitizedName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

function probeLocalVideo(filePath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const proc = spawn(ffmpegPath, ['-i', filePath]);
    let stderr = '';
    proc.stderr.on('data', (d) => stderr += d.toString());
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

      let size = 0;
      try {
        size = fs.statSync(filePath).size;
      } catch(e) {}
      
      resolve({
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
      reject(err);
    });
  });
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
    const ffmpegPath = getFfmpegPath();
    const args = job.args;
    
    win.webContents.send('divide-status', `[FFmpeg] Spawning: ${ffmpegPath} ${args.join(' ')}`);
    const proc = spawn(ffmpegPath, args);
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
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const sourcesDir = path.join(baseDir, 'yt-divided', 'sources');
  
  if (!fs.existsSync(sourcesDir)) {
    fs.mkdirSync(sourcesDir, { recursive: true });
  }

  const outPath = path.join(sourcesDir, '%(title)s.%(ext)s');
  const args = buildVideoDownloadArgs({ url, quality, outPath });

  win.webContents.send('download-status', `[DIVIDER IMPORT] Starting source download for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    win.webContents.send('download-progress', text);
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

  ytProcess.stderr.on('data', (data) => win.webContents.send('download-progress', data.toString()));
  
  ytProcess.on('close', async (code) => {
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, sourcesDir, downloadStartedAt);
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
        args: ['-y', '-i', inputPath, '-ss', options.startTimeStr, '-to', options.endTimeStr, '-c:v', 'libx264', '-crf', '18', '-c:a', 'aac', outputPath],
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
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:0:0', '-c:v', 'libx264', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.right) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_right${ext}`);
        jobs.push({
          label: 'Spatial Split: Right',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:iw/2:0', '-c:v', 'libx264', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.top) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_top${ext}`);
        jobs.push({
          label: 'Spatial Split: Top',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:0', '-c:v', 'libx264', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.bottom) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_bottom${ext}`);
        jobs.push({
          label: 'Spatial Split: Bottom',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:ih/2', '-c:v', 'libx264', '-crf', '18', '-c:a', 'copy', outputPath],
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
    
    if (settings.autoOpenFolder) {
      shell.openPath(outputDir);
    }
  } catch (err) {
    console.error('Divide error:', err);
    win.webContents.send('divide-error', err.message || 'An error occurred during division.');
  }
});
