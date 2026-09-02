const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// Native file drag-out (Recents → Explorer / Premiere Pro)
// Docs: https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop
// webContents.startDrag requires a non-empty icon (empty NativeImage no-ops on
// Windows and is invalid on macOS). Video/audio paths cannot be used as icons.
const FILE_DRAG_ICON_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let cachedFileDragIconPath = '';

let detectedLinuxFileManager = undefined;

function getLinuxFileManager() {
  if (detectedLinuxFileManager !== undefined) return detectedLinuxFileManager;
  if (process.platform !== 'linux') {
    detectedLinuxFileManager = null;
    return null;
  }
  const fileManagers = [
    { name: 'nautilus', selectFlag: '--select' },
    { name: 'dolphin', selectFlag: '--select' },
    { name: 'nemo', selectFlag: null },
    { name: 'thunar', selectFlag: null },
    { name: 'pcmanfm', selectFlag: null }
  ];
  for (const fm of fileManagers) {
    try {
      const check = spawnSync('which', [fm.name]);
      if (check.status === 0) {
        detectedLinuxFileManager = fm;
        return detectedLinuxFileManager;
      }
    } catch (e) {}
  }
  detectedLinuxFileManager = null;
  return null;
}

function openDirectoryDirectly(dirPath) {
  if (!dirPath) return;
  const fm = getLinuxFileManager();
  if (fm) {
    try {
      spawn(fm.name, [dirPath], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch (e) {}
  }
  shell.openPath(dirPath).catch((err) => {
    console.error('shell.openPath failed for directory:', dirPath, err);
  });
}

function openFolderOrRevealItem(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return;
  const rawPath = targetPath.trim().replace(/^["']+|["']+$/g, '');
  if (!rawPath) return;
  const normalized = path.normalize(rawPath);

  if (fs.existsSync(normalized)) {
    try {
      const isDir = fs.statSync(normalized).isDirectory();
      if (isDir) {
        openDirectoryDirectly(normalized);
        return;
      }

      if (process.platform === 'win32' || process.platform === 'darwin') {
        shell.showItemInFolder(normalized);
        return;
      }

      // Linux handling
      const fm = getLinuxFileManager();
      if (fm && fm.selectFlag) {
        spawn(fm.name, [fm.selectFlag, normalized], { detached: true, stdio: 'ignore' }).unref();
        return;
      } else if (fm) {
        spawn(fm.name, [normalized], { detached: true, stdio: 'ignore' }).unref();
        return;
      }

      // If no dedicated file manager is installed on Linux:
      // DO NOT call shell.showItemInFolder(normalized) because Chromium's fallback
      // will pass the URI or directory to xdg-open which frequently defaults to $HOME.
      // Instead, open the containing directory directly!
      const parentDir = path.dirname(normalized);
      openDirectoryDirectly(parentDir);
      return;
    } catch (err) {
      console.error('Failed to open/reveal item:', err);
    }
  }

  // Fallback if target does not exist
  const parentDir = path.dirname(normalized);
  if (fs.existsSync(parentDir)) {
    openDirectoryDirectly(parentDir);
    return;
  }

  const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
  if (fs.existsSync(baseDir)) {
    openDirectoryDirectly(baseDir);
  }
}

function normalizeExistingFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const normalized = path.normalize(filePath.trim().replace(/^["']+|["']+$/g, ''));
  return fs.existsSync(normalized) ? normalized : '';
}

function getFileDragIconPath() {
  if (cachedFileDragIconPath && fs.existsSync(cachedFileDragIconPath)) {
    return cachedFileDragIconPath;
  }

  const dest = path.join(app.getPath('temp'), 'ytdlp-gui-drag-icon.png');
  const sources = [
    path.join(__dirname, 'website', 'assets', 'favicon-32.png'),
    path.join(__dirname, 'website', 'assets', 'icon.png'),
  ];

  for (const src of sources) {
    try {
      if (!fs.existsSync(src)) continue;
      const image = nativeImage.createFromBuffer(fs.readFileSync(src));
      if (image.isEmpty()) continue;
      fs.writeFileSync(dest, image.resize({ width: 32, height: 32 }).toPNG());
      cachedFileDragIconPath = dest;
      return dest;
    } catch (err) {
      console.error('Failed to prepare drag icon from', src, err);
    }
  }

  const fallback = nativeImage.createFromDataURL(FILE_DRAG_ICON_PNG).resize({ width: 32, height: 32 });
  fs.writeFileSync(dest, fallback.toPNG());
  cachedFileDragIconPath = dest;
  return dest;
}

// IPC Handlers
ipcMain.on('start-file-drag', (event, filePath) => {
  const resolved = normalizeExistingFilePath(filePath);
  if (!resolved) return;

  try {
    event.sender.startDrag({
      file: resolved,
      icon: getFileDragIconPath(),
    });
  } catch (err) {
    console.error('startDrag failed:', err);
  }
});

ipcMain.on('open-external-url', (_event, url) => {
  if (url && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.on('open-folder', (event, filePath) => {
  openFolderOrRevealItem(filePath);
});

ipcMain.on('open-file', (_event, filePath) => {
  const resolved = normalizeExistingFilePath(filePath);
  if (!resolved) return;
  shell.openPath(resolved).catch((err) => {
    console.error('Failed to open file:', err);
  });
});

ipcMain.on('open-download-folder', (event, type) => {
  try {
    const baseDir = ctx.settings.downloadDir || app.getPath('downloads');
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
    openDirectoryDirectly(targetDir);
  } catch (err) {
    console.error('Failed to open download folder:', err);
  }
});

ctx.FILE_DRAG_ICON_PNG = FILE_DRAG_ICON_PNG;
ctx.cachedFileDragIconPath = cachedFileDragIconPath;
ctx.detectedLinuxFileManager = detectedLinuxFileManager;
ctx.getLinuxFileManager = getLinuxFileManager;
ctx.openDirectoryDirectly = openDirectoryDirectly;
ctx.openFolderOrRevealItem = openFolderOrRevealItem;
ctx.normalizeExistingFilePath = normalizeExistingFilePath;
ctx.getFileDragIconPath = getFileDragIconPath;
module.exports = { FILE_DRAG_ICON_PNG, cachedFileDragIconPath, detectedLinuxFileManager, getLinuxFileManager, openDirectoryDirectly, openFolderOrRevealItem, normalizeExistingFilePath, getFileDragIconPath };
