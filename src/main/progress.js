const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// Throttled IPC progress sender to prevent bus saturation and layout thrashing
function createThrottledProgressSender(win, channel = 'download-progress', intervalMs = 60) {
  let lastEmit = 0;
  let pendingData = '';
  let timer = null;

  return {
    push(chunk) {
      pendingData = chunk;
      const now = Date.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        if (win && !win.isDestroyed()) {
          win.webContents.send(channel, pendingData);
        }
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          lastEmit = Date.now();
          if (win && !win.isDestroyed() && pendingData) {
            win.webContents.send(channel, pendingData);
          }
        }, intervalMs);
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (win && !win.isDestroyed() && pendingData) {
        win.webContents.send(channel, pendingData);
      }
    }
  };
}

ctx.createThrottledProgressSender = createThrottledProgressSender;
module.exports = { createThrottledProgressSender };
