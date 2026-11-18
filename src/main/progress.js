const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

// A chunk is "pure progress" when every non-empty line is a yt-dlp download percentage update
// (e.g. "[download]  12.3% of ~ 85.40MiB at 4.25MiB/s ETA 00:11"). Only such chunks may be
// coalesced; anything else (errors, warnings, "Destination:", merger lines...) must be delivered.
const PROGRESS_LINE_RE = /^\s*\[download\]\s+\d+(?:\.\d+)?%/;

function isPureProgressChunk(chunk) {
  if (typeof chunk !== 'string') return false;
  const lines = chunk.split(/\r\n|\n|\r/).filter((line) => line.trim() !== '');
  return lines.length > 0 && lines.every((line) => PROGRESS_LINE_RE.test(line));
}

// Throttled IPC progress sender to prevent bus saturation and layout thrashing.
// - Consecutive pure-progress chunks inside a throttle window collapse into the latest one.
// - Every other chunk is queued and delivered in order, never dropped.
// - A chunk is sent exactly once; flush() only sends what is still unsent.
function createThrottledProgressSender(win, channel = 'download-progress', intervalMs = 60) {
  let lastEmit = 0;
  let queue = []; // { chunk, progress }
  let timer = null;

  const drain = () => {
    const items = queue;
    queue = [];
    lastEmit = Date.now();
    if (!win || win.isDestroyed()) return;
    for (const item of items) {
      win.webContents.send(channel, item.chunk);
    }
  };

  return {
    push(chunk) {
      if (chunk === undefined || chunk === null || chunk === '') return;
      const progress = isPureProgressChunk(chunk);
      const last = queue[queue.length - 1];
      if (progress && last && last.progress) {
        last.chunk = chunk;
      } else {
        queue.push({ chunk, progress });
      }

      const sinceLast = Date.now() - lastEmit;
      if (sinceLast >= intervalMs) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        drain();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          drain();
        }, intervalMs - sinceLast);
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (queue.length > 0) drain();
    }
  };
}

ctx.createThrottledProgressSender = createThrottledProgressSender;
ctx.isPureProgressChunk = isPureProgressChunk;
module.exports = { createThrottledProgressSender, isPureProgressChunk };
