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

// Task groups a registered process can belong to. They let a user cancel stop only the work the
// shared Cancel button represents, instead of every child process in the app.
const PROCESS_GROUPS = ['download', 'divide', 'scan', 'gif', 'probe', 'other'];
// Non-yt-dlp helpers (ffmpeg/fpcalc) in these groups belong to the same task as the yt-dlp process
// of that group, so a yt-dlp-wide stop (channel switch / force update) also stops them.
const TASK_LINKED_GROUPS = new Set(['scan', 'divide', 'gif']);
// Groups the shared Cancel button (#btn-cancel-download) governs: Downloader, Clipper, Twitch,
// Browser sniffer downloads and Divider import all run in 'download'; Divider's divide job runs in 'divide'.
const DOWNLOAD_CANCEL_GROUPS = ['download', 'divide'];

const processMeta = new Map(); // proc -> { group, isYtDlp }
const stoppedProcesses = new WeakSet(); // procs this registry killed on purpose

function resolveGroup(meta) {
  if (meta && PROCESS_GROUPS.includes(meta.group)) return meta.group;
  return meta && meta.isYtDlp === false ? 'other' : 'download';
}

function registerProcess(proc, meta = {}) {
  if (!proc) return;
  const isYtDlp = !meta || meta.isYtDlp !== false;
  activeProcesses.add(proc);
  processMeta.set(proc, { group: resolveGroup(meta), isYtDlp });
  if (isYtDlp) {
    activeYtDlpProcesses.add(proc);
  }
  const cleanUp = () => {
    activeProcesses.delete(proc);
    activeYtDlpProcesses.delete(proc);
    processMeta.delete(proc);
  };
  proc.on('close', cleanUp);
  proc.on('exit', cleanUp);
  proc.on('error', cleanUp);
}

function registerYtDlpProcess(proc, meta = {}) {
  registerProcess(proc, { ...meta, isYtDlp: true });
}

function wasProcessStopped(proc) {
  return !!proc && stoppedProcesses.has(proc);
}

async function killProcessTree(proc) {
  if (!proc) return;
  stoppedProcesses.add(proc);
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

// Synchronous best-effort kill of every registered child, used while the app is quitting so no
// yt-dlp/ffmpeg process outlives the window. Never touches processes this app did not spawn.
function killAllRegisteredProcessesSync() {
  for (const proc of Array.from(activeProcesses)) {
    if (!proc || stoppedProcesses.has(proc)) continue;
    stoppedProcesses.add(proc);
    const pid = proc.pid;
    if (pid && process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 3000 });
      } catch (e) {}
    }
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
}

/**
 * Stops registered child processes and notifies the renderer about the groups that were affected.
 *
 * stopAllBlockingTasks(win, reason)            yt-dlp is about to be replaced (channel switch / force update):
 *                                              kills every registered yt-dlp process (any group) plus helper
 *                                              processes of the same task (scan/divide/gif groups), and runs the
 *                                              stray `taskkill /IM yt-dlp.exe` because the exe is being overwritten.
 * stopAllBlockingTasks(win, reason, options)   options.groups: kill only processes in these groups and do NOT run the
 *                                              system-wide taskkill (user cancel).
 *                                              options.alwaysNotify: groups whose renderer event is sent even when
 *                                              nothing was killed (so the UI can never stay stuck).
 * A renderer event is sent only for a group that had at least one process killed (or is in alwaysNotify).
 */
async function stopAllBlockingTasks(win, reason = 'yt-dlp channel switch', options = {}) {
  const opts = options || {};
  const groupFilter = Array.isArray(opts.groups) ? new Set(opts.groups) : null;
  const alwaysNotify = Array.isArray(opts.alwaysNotify) ? opts.alwaysNotify : [];

  const targets = [];
  if (groupFilter) {
    for (const proc of activeProcesses) {
      const meta = processMeta.get(proc);
      if (meta && groupFilter.has(meta.group)) targets.push(proc);
    }
  } else {
    const linkedGroups = new Set();
    for (const proc of activeYtDlpProcesses) {
      const meta = processMeta.get(proc);
      if (meta && TASK_LINKED_GROUPS.has(meta.group)) linkedGroups.add(meta.group);
    }
    for (const proc of activeProcesses) {
      const meta = processMeta.get(proc);
      if (activeYtDlpProcesses.has(proc) || (meta && linkedGroups.has(meta.group))) targets.push(proc);
    }
  }

  const killedGroups = new Set();
  for (const proc of targets) {
    const meta = processMeta.get(proc);
    killedGroups.add(meta ? meta.group : 'other');
    await killProcessTree(proc);
    activeProcesses.delete(proc);
    activeYtDlpProcesses.delete(proc);
    processMeta.delete(proc);
  }

  if (!groupFilter && process.platform === 'win32') {
    try {
      await new Promise((resolve) => {
        exec('taskkill /F /IM yt-dlp.exe', { windowsHide: true }, () => resolve());
      });
    } catch (e) {}
  }

  // Grace period for OS file system handles to unlock
  if (!groupFilter || targets.length > 0) await sleep(150);

  if (win && !win.isDestroyed()) {
    const notify = (group) => killedGroups.has(group) || alwaysNotify.includes(group);
    if (notify('download')) win.webContents.send('download-error', `Operation stopped: ${reason}.`);
    if (notify('scan')) win.webContents.send('scan-error', `Scan stopped: ${reason}.`);
    if (notify('divide')) win.webContents.send('divide-error', `Task stopped: ${reason}.`);
    if (notify('gif')) win.webContents.send('gif-finished', { success: false, error: `Task stopped: ${reason}.` });
    if (targets.length > 0) {
      win.webContents.send('update-log', `[yt-dlp] Forcefully stopped all active tasks (${reason}).`);
    }
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
ctx.killAllRegisteredProcessesSync = killAllRegisteredProcessesSync;
ctx.wasProcessStopped = wasProcessStopped;
ctx.stopAllBlockingTasks = stopAllBlockingTasks;
ctx.sleep = sleep;
module.exports = { activeProcesses, activeYtDlpProcesses, registerProcess, registerYtDlpProcess, killProcessTree, killAllRegisteredProcessesSync, wasProcessStopped, stopAllBlockingTasks, sleep, PROCESS_GROUPS, DOWNLOAD_CANCEL_GROUPS };
