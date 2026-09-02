const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
const ctx = require('./ctx');

const activeProcesses = new Set();
const activeYtDlpProcesses = new Set();

function registerProcess(proc, meta = {}) {
  if (!proc) return;
  activeProcesses.add(proc);
  if (meta.isYtDlp !== false) {
    activeYtDlpProcesses.add(proc);
  }
  const cleanUp = () => {
    activeProcesses.delete(proc);
    activeYtDlpProcesses.delete(proc);
  };
  proc.on('close', cleanUp);
  proc.on('exit', cleanUp);
  proc.on('error', cleanUp);
}

function registerYtDlpProcess(proc) {
  registerProcess(proc, { isYtDlp: true });
}

async function killProcessTree(proc) {
  if (!proc) return;
  const pid = proc.pid;
  if (!pid) {
    try { proc.kill('SIGKILL'); } catch (e) { try { proc.kill(); } catch (e2) {} }
    return;
  }

  if (process.platform === 'win32') {
    try {
      await new Promise((resolve) => {
        exec(`taskkill /F /T /PID ${pid}`, { windowsHide: true }, () => resolve());
      });
    } catch (e) {}
  }

  try {
    proc.kill('SIGKILL');
  } catch (e) {
    try { proc.kill(); } catch (e2) {}
  }
}

async function stopAllBlockingTasks(win, reason = 'yt-dlp channel switch') {
  const allProcs = Array.from(new Set([...activeProcesses, ...activeYtDlpProcesses]));
  for (const proc of allProcs) {
    await killProcessTree(proc);
  }
  activeProcesses.clear();
  activeYtDlpProcesses.clear();

  if (process.platform === 'win32') {
    try {
      await new Promise((resolve) => {
        exec('taskkill /F /IM yt-dlp.exe', { windowsHide: true }, () => resolve());
      });
    } catch (e) {}
  }

  // Grace period for OS file system handles to unlock
  await sleep(150);

  if (win && !win.isDestroyed()) {
    win.webContents.send('download-error', `Operation stopped: ${reason}.`);
    win.webContents.send('scan-error', `Scan stopped: ${reason}.`);
    win.webContents.send('divide-error', `Task stopped: ${reason}.`);
    win.webContents.send('gif-finished', { success: false, error: `Task stopped: ${reason}.` });
    win.webContents.send('update-log', `[yt-dlp] Forcefully stopped all active tasks (${reason}).`);
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

ctx.activeProcesses = activeProcesses;
ctx.activeYtDlpProcesses = activeYtDlpProcesses;
ctx.registerProcess = registerProcess;
ctx.registerYtDlpProcess = registerYtDlpProcess;
ctx.killProcessTree = killProcessTree;
ctx.stopAllBlockingTasks = stopAllBlockingTasks;
ctx.sleep = sleep;
module.exports = { activeProcesses, activeYtDlpProcesses, registerProcess, registerYtDlpProcess, killProcessTree, stopAllBlockingTasks, sleep };
