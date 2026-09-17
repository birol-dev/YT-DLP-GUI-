const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const ctx = require('./src/main/ctx');

require('./src/main/cache');
require('./src/main/progress');
require('./src/main/process-registry');
require('./src/main/paths');
require('./src/main/settings');
require('./src/main/ytdlp');
require('./src/main/deps');
require('./src/main/folders');
require('./src/main/dialogs');
require('./src/main/downloads');
require('./src/main/clipper');
require('./src/main/divider');
require('./src/main/scan');
require('./src/main/gif');
require('./src/main/browser-view');
require('./src/main/onboarding');

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
  
  win.webContents.once('did-finish-load', async () => {
    if (ctx.settings.onboardingComplete) {
      const deps = await ctx.checkDependencies();
      const missingDeps = !deps.ytDlp.available || !deps.ffmpeg.available || !deps.fpcalc.available;
      if (!ctx.settings.firstRunComplete || missingDeps) {
        ctx.setupDependencies(win);
      } else {
        await ctx.syncYtDlpChannel(win, { silent: true });
        if (ctx.settings.autoUpdateDependencies !== false) {
          ctx.checkAndUpdateAllDependencies(win, { silent: false });
        }
      }
    }
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-features', 'ThirdPartyCookiesBlocked');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media-preview',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: 'browser-proxy',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true
    }
  }
]);

app.whenReady().then(() => {
  ctx.initSettings();

  ctx.registerClipperPreviewHeaders();
  ctx.registerMediaProtocols();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  ctx.flushSettingsSync();
});

app.on('window-all-closed', () => {
  ctx.flushSettingsSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
