const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

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
    tempFormat: 'fahrenheit',
    acoustidKey: '',
    acrcloudKey: '',
    acrcloudSecret: '',
    acrcloudHost: 'identify-us-west-2.acrcloud.com',
    musicFinderService: 'acoustid',
    acoustidScanInterval: 90,
    cookiesFromBrowser: '',
    cookiesBrowserProfile: '',
    cookiesFile: '',
    ytDlpChannel: 'master',
    ytDlpInstalledChannel: '',
    ytDlpInstalledVersion: '',
    dismissedYtDlpChannelHint: false
  };
  
  Object.keys(settings).forEach((k) => { delete settings[k]; });
  Object.assign(settings, defaultSettings);
  
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readFileSync(settingsFilePath, 'utf8');
      const parsed = JSON.parse(data);
      Object.keys(settings).forEach((k) => { delete settings[k]; });
      Object.assign(settings, defaultSettings, parsed);
      if (!Object.prototype.hasOwnProperty.call(parsed, 'ytDlpChannel')) {
        settings.ytDlpChannel = 'stable';
      }
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

let pendingSettingsTimer = null;

async function flushSettingsToDisk() {
  if (pendingSettingsTimer) {
    clearTimeout(pendingSettingsTimer);
    pendingSettingsTimer = null;
  }
  if (!settingsFilePath) return;
  try {
    const data = JSON.stringify(settings, null, 2);
    await fs.promises.writeFile(settingsFilePath, data, 'utf8');
  } catch (err) {
    console.error('Failed to write settings to disk:', err);
  }
}

function flushSettingsSync() {
  if (pendingSettingsTimer) {
    clearTimeout(pendingSettingsTimer);
    pendingSettingsTimer = null;
  }
  if (!settingsFilePath) return;
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {}
}

function saveSettingsInternal(newSettings) {
  try {
    Object.assign(settings, newSettings);
    if (pendingSettingsTimer) {
      clearTimeout(pendingSettingsTimer);
    }
    pendingSettingsTimer = setTimeout(() => {
      pendingSettingsTimer = null;
      flushSettingsToDisk();
    }, 120);
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return false;
  }
}

ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', async (_event, newSettings) => {
  return saveSettingsInternal(newSettings);
});


ctx.settings = settings;
ctx.settingsFilePath = settingsFilePath;
ctx.initSettings = initSettings;
ctx.pendingSettingsTimer = pendingSettingsTimer;
ctx.flushSettingsToDisk = flushSettingsToDisk;
ctx.flushSettingsSync = flushSettingsSync;
ctx.saveSettingsInternal = saveSettingsInternal;
module.exports = { settings, settingsFilePath, initSettings, pendingSettingsTimer, flushSettingsToDisk, flushSettingsSync, saveSettingsInternal };
