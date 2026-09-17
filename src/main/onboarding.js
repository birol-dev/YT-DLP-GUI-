const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

ipcMain.handle('get-system-info', () => {
  try {
    return {
      username: os.userInfo().username || os.hostname() || 'user'
    };
  } catch (e) {
    return { username: 'user' };
  }
});

ipcMain.handle('check-dependencies', async () => {
  return await ctx.checkDependencies();
});

ipcMain.handle('finish-onboarding', (event, onboardingData) => {
  const updated = ctx.saveSettingsInternal({
    onboardingComplete: true,
    userName: onboardingData.userName,
    weatherCity: onboardingData.weatherCity,
    weatherLat: onboardingData.weatherLat,
    weatherLon: onboardingData.weatherLon,
    tempFormat: onboardingData.tempFormat,
    musicFinderService: onboardingData.musicFinderService || ctx.settings.musicFinderService,
    acoustidKey: onboardingData.acoustidKey !== undefined ? onboardingData.acoustidKey : ctx.settings.acoustidKey,
    acrcloudKey: onboardingData.acrcloudKey !== undefined ? onboardingData.acrcloudKey : ctx.settings.acrcloudKey,
    acrcloudSecret: onboardingData.acrcloudSecret !== undefined ? onboardingData.acrcloudSecret : ctx.settings.acrcloudSecret,
    acrcloudHost: onboardingData.acrcloudHost !== undefined ? onboardingData.acrcloudHost : ctx.settings.acrcloudHost
  });
  
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (!ctx.settings.firstRunComplete) {
      ctx.setupDependencies(win);
    } else {
      ctx.checkAndUpdateAllDependencies(win, { silent: false });
    }
  }
  return updated;
});


module.exports = {  };
