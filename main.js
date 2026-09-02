const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, protocol, net, nativeImage, session, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const https = require('https');
const os = require('os');
let fluentFfmpeg = null;
try {
  fluentFfmpeg = require('fluent-ffmpeg');
} catch (e) {}

// High-performance LRU Cache for memory-bounded caching
class SimpleLRUCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key) {
    if (!this.cache.has(key)) return null;
    const val = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, val);
    return val;
  }
  set(key, val) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, val);
  }
  has(key) {
    return this.cache.has(key);
  }
  delete(key) {
    return this.cache.delete(key);
  }
  clear() {
    this.cache.clear();
  }
}

// Global LRU Caches to eliminate redundant child process spawns
const probeMetadataCache = new SimpleLRUCache(150);
const probePlaylistCache = new SimpleLRUCache(100);
const videoInfoCache = new SimpleLRUCache(100);
const inFlightProbes = new Map();
const detectedMediaUrlCache = new SimpleLRUCache(300);
const inFlightMediaProbes = new Set();

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

// Local binary path definitions
const localBinDir = path.join(app.getPath('userData'), 'bin');
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const localYtDlp = path.join(localBinDir, `yt-dlp${exeSuffix}`);
const localFfmpeg = path.join(localBinDir, `ffmpeg${exeSuffix}`);
const localFpcalc = path.join(localBinDir, `fpcalc${exeSuffix}`);

function getYtDlpPath() {
  if (fs.existsSync(localYtDlp)) {
    return localYtDlp;
  }
  return 'yt-dlp';
}

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

function isYtDlpSwitchInProgress(win, errorChannel = 'download-error') {
  if (ytDlpChannelSwitchInProgress) {
    if (win) {
      win.webContents.send(errorChannel, 'A yt-dlp update or channel switch is currently in progress. Please wait and try again.');
    }
    return true;
  }
  return false;
}


async function exportSessionCookies() {
  const cookieFile = path.join(app.getPath('userData'), 'app-cookies.txt');
  try {
    const cookies = await session.defaultSession.cookies.get({});
    let fileContent = '# Netscape HTTP Cookie File\n# This file is generated by YT-DLP GUI\n# Do not edit.\n\n';
    for (const cookie of cookies) {
      const domain = cookie.domain || '';
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const cookiePath = cookie.path || '/';
      const isSecure = cookie.secure ? 'TRUE' : 'FALSE';
      const expiration = cookie.expirationDate ? Math.round(cookie.expirationDate) : 0;
      const name = cookie.name || '';
      const value = cookie.value || '';
      
      fileContent += `${domain}\t${includeSubdomains}\t${cookiePath}\t${isSecure}\t${expiration}\t${name}\t${value}\n`;
    }
    fs.writeFileSync(cookieFile, fileContent, 'utf8');
    return cookieFile;
  } catch (err) {
    console.error('Failed to export app session cookies:', err);
    return null;
  }
}

async function appendYtDlpCookieArgs(args, cookieConfig) {
  if (cookieConfig === false) return args;

  let browser = '';
  let profile = '';
  let customCookiesFile = '';
  
  if (cookieConfig && typeof cookieConfig === 'object') {
    browser = cookieConfig.browser || '';
    profile = cookieConfig.profile || '';
    customCookiesFile = cookieConfig.cookiesFile || '';
  } else {
    browser = settings.cookiesFromBrowser || '';
    profile = settings.cookiesBrowserProfile || '';
    customCookiesFile = settings.cookiesFile || '';
  }

  if (!browser) return args;

  if (browser === 'file') {
    if (customCookiesFile && fs.existsSync(customCookiesFile)) {
      return ['--cookies', customCookiesFile, ...args];
    }
    return args;
  }

  if (browser === 'app-browser') {
    const exportedFile = await exportSessionCookies();
    if (exportedFile && fs.existsSync(exportedFile)) {
      return ['--cookies', exportedFile, ...args];
    }
    return args;
  }

  const normalizedProfile = profile.trim().replace(/^["']|["']$/g, '');
  const value = normalizedProfile ? `${browser}:${normalizedProfile}` : browser;
  return ['--cookies-from-browser', value, ...args];
}

const YT_DLP_CHANNELS = ['stable', 'nightly', 'master'];
const YT_DLP_CHANNEL_BASES = {
  stable: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download',
  nightly: 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download',
  master: 'https://github.com/yt-dlp/yt-dlp-master-builds/releases/latest/download'
};

let ytDlpChannelSwitchInProgress = false;

function normalizeYtDlpChannel(channel) {
  const normalized = String(channel || 'master').trim().toLowerCase();
  return YT_DLP_CHANNELS.includes(normalized) ? normalized : 'master';
}

function getYtDlpBinaryFileName() {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}

function getYtDlpDownloadUrl(channel) {
  const normalized = normalizeYtDlpChannel(channel);
  const base = YT_DLP_CHANNEL_BASES[normalized];
  return `${base}/${getYtDlpBinaryFileName()}`;
}

function parseYtDlpChannelFromOutput(output) {
  const text = output || '';
  const match = text.match(/(?:updated yt-dlp to|latest version:|yt-dlp is up to date \()\s*(\w+)@/i);
  return match ? normalizeYtDlpChannel(match[1]) : '';
}

function normalizeInstagramUrl(url) {
  try {
    const parsed = new URL(url.trim());
    if (!parsed.hostname.includes('instagram.com') && parsed.hostname !== 'instagr.am') {
      return url.trim();
    }
    parsed.search = '';
    parsed.hash = '';
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/';
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function formatInstagramDownloadError(code, stderr, label) {
  let msg = `[INSTAGRAM ${label}] Download failed with code ${code}`;
  const combined = (stderr || '').toLowerCase();
  if (
    combined.includes('empty media response') ||
    combined.includes('login required') ||
    combined.includes('rate-limit')
  ) {
    if (!settings.cookiesFromBrowser) {
      msg += '. Instagram may require login cookies — open Settings and configure Browser Cookies (close the browser first).';
    } else {
      msg += '. Close your browser completely and retry, or verify the post opens when logged into Instagram.';
    }
    if (normalizeYtDlpChannel(settings.ytDlpChannel) !== 'master') {
      msg += ' For Instagram without cookies, switch yt-dlp to the Master channel in Settings.';
    }
  }
  return msg;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupOldBinaries(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const file of entries) {
      if (file.includes('.old_') || file.endsWith('.tmp') || file.includes('.tmp_')) {
        const fullPath = path.join(dir, file);
        try {
          fs.unlinkSync(fullPath);
        } catch (e) {
          // File may still be locked by another process
        }
      }
    }
  } catch (e) {}
}

async function replaceLocalBinary(tempPath, destPath, { minSizeBytes = 500000, maxRetries = 6, retryDelayMs = 300 } = {}) {
  if (!fs.existsSync(tempPath)) {
    throw new Error(`Replacement failed: temporary binary not found at ${tempPath}`);
  }

  const stat = fs.statSync(tempPath);
  if (stat.size < minSizeBytes) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
    throw new Error(`Downloaded binary appears incomplete or corrupted (${stat.size} bytes). Expected at least ${minSizeBytes} bytes.`);
  }

  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // If destination binary already exists, handle replacement safely
  let backupPath = null;
  if (fs.existsSync(destPath)) {
    backupPath = path.join(dir, `${path.basename(destPath)}.old_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    let replaced = false;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.renameSync(destPath, backupPath);
        replaced = true;
        break;
      } catch (err) {
        lastError = err;
        if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
          if (process.platform === 'win32' && attempt >= 2) {
            try {
              exec(`taskkill /F /IM ${path.basename(destPath)}`, { windowsHide: true }, () => {});
            } catch (kErr) {}
          }
          try {
            fs.unlinkSync(destPath);
            replaced = true;
            break;
          } catch (delErr) {
            lastError = delErr;
          }
        }
        if (attempt < maxRetries) {
          await sleep(retryDelayMs * attempt);
        }
      }
    }

    if (!replaced && fs.existsSync(destPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
      throw new Error(`Cannot replace binary: ${path.basename(destPath)} is currently locked or in use by a background process. (${lastError?.message || 'File locked'})`);
    }
  }

  try {
    fs.renameSync(tempPath, destPath);
  } catch (renameErr) {
    if (backupPath && fs.existsSync(backupPath) && !fs.existsSync(destPath)) {
      try {
        fs.renameSync(backupPath, destPath);
      } catch (restoreErr) {
        console.error('Failed to restore backup binary:', restoreErr);
      }
    }
    throw new Error(`Failed to place new binary into target destination: ${renameErr.message}`);
  }

  makeExecutable(destPath);

  if (backupPath && fs.existsSync(backupPath)) {
    try {
      fs.unlinkSync(backupPath);
    } catch (e) {}
  }

  cleanupOldBinaries(dir);
  return true;
}

async function getYtDlpVersionInfo() {
  const localExists = fs.existsSync(localYtDlp);
  if (!localExists && !(await isCommandInPath('yt-dlp'))) {
    return {
      available: false,
      version: '',
      channel: normalizeYtDlpChannel(settings.ytDlpChannel),
      installedChannel: '',
      local: false,
      path: getYtDlpPath()
    };
  }

  // To get the actual compiled channel/build and version, execute yt-dlp -v
  const versionResult = await runYtDlpProcess(['-v'], false, 10000);
  const combined = `${versionResult.stdout}\n${versionResult.stderr}`;
  
  let version = '';
  let installedChannel = '';

  // Format example: [debug] yt-dlp version master@2026.07.06.214832 from yt-dlp/yt-dlp-master-builds [b3854cc41] (win_exe)
  // or: [debug] yt-dlp version 2026.01.26 from yt-dlp/yt-dlp [b3854cc41]
  const debugMatch = combined.match(/\[debug\]\s+yt-dlp\s+version\s+(?:(\w+)@)?([^\s\[]+)/i);
  if (debugMatch) {
    if (debugMatch[1]) {
      installedChannel = normalizeYtDlpChannel(debugMatch[1]);
    }
    version = debugMatch[2].trim();
  }

  // If no channel parsed directly from version tag, inspect repo sources in debug lines
  if (!installedChannel) {
    if (/yt-dlp-master-builds/i.test(combined)) {
      installedChannel = 'master';
    } else if (/yt-dlp-nightly-builds/i.test(combined)) {
      installedChannel = 'nightly';
    } else if (/yt-dlp\/yt-dlp/i.test(combined) || /github\.com\/yt-dlp\/yt-dlp/i.test(combined)) {
      installedChannel = 'stable';
    }
  }

  // Fallback to basic version check if -v parsing didn't get version
  if (!version) {
    const fallbackResult = await runYtDlpProcess(['--version'], false, 5000);
    version = (fallbackResult.stdout || '').trim().split('\n')[0].trim();
  }

  // Fallback to saved settings if channel could not be identified from output
  if (!installedChannel) {
    installedChannel = settings.ytDlpInstalledChannel || settings.ytDlpChannel || 'master';
  }

  return {
    available: !!version,
    version,
    channel: normalizeYtDlpChannel(settings.ytDlpChannel),
    installedChannel: normalizeYtDlpChannel(installedChannel),
    local: localExists,
    path: getYtDlpPath()
  };
}

async function downloadYtDlpFromChannel(win, channel, { onProgress } = {}) {
  if (!fs.existsSync(localBinDir)) {
    fs.mkdirSync(localBinDir, { recursive: true });
  }

  const targetChannel = normalizeYtDlpChannel(channel);
  const tempPath = path.join(localBinDir, `yt-dlp.tmp_${Date.now()}`);

  const downloadUrl = getYtDlpDownloadUrl(targetChannel);
  await downloadFile(downloadUrl, tempPath, win, 'yt-dlp', onProgress);

  await replaceLocalBinary(tempPath, localYtDlp, { minSizeBytes: 1000000 });
  return targetChannel;
}

async function switchYtDlpChannel(win, channel, { silent = false, force = true } = {}) {
  const targetChannel = normalizeYtDlpChannel(channel);

  if (force) {
    await stopAllBlockingTasks(win, `switching yt-dlp to ${targetChannel} channel`);
  }

  if (ytDlpChannelSwitchInProgress) {
    return {
      ok: false,
      level: 'warning',
      message: 'A yt-dlp build update or channel switch is already in progress.',
      channel: targetChannel
    };
  }

  ytDlpChannelSwitchInProgress = true;
  const log = (message) => {
    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-log', message);
    }
  };

  try {
    log(`[yt-dlp] Downloading clean ${targetChannel} release build...`);
    await downloadYtDlpFromChannel(win, targetChannel);

    const versionInfo = await getYtDlpVersionInfo();
    if (!versionInfo.available || !versionInfo.version) {
      throw new Error('yt-dlp binary verification failed after channel switch.');
    }

    saveSettingsInternal({
      ytDlpChannel: targetChannel,
      ytDlpInstalledChannel: versionInfo.installedChannel || targetChannel,
      ytDlpInstalledVersion: versionInfo.version
    });

    const message = `yt-dlp is now on the ${versionInfo.installedChannel} channel (${versionInfo.version}).`;
    log(`[yt-dlp] ${message}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('yt-dlp-channel-changed', {
        ok: true,
        channel: versionInfo.installedChannel,
        targetChannel,
        version: versionInfo.version,
        source: 'switch'
      });
    }

    return {
      ok: true,
      level: 'success',
      message,
      channel: versionInfo.installedChannel,
      targetChannel,
      version: versionInfo.version
    };
  } catch (err) {
    console.error('Failed to switch yt-dlp channel:', err);
    const message = `Failed to switch yt-dlp to ${targetChannel}: ${err.message}`;
    log(`[yt-dlp] ${message}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('yt-dlp-channel-changed', {
        ok: false,
        error: message,
        targetChannel
      });
    }
    return {
      ok: false,
      level: 'error',
      message,
      tip: err.message.includes('locked') ? err.message : 'Please check your internet connection and try again.',
      channel: targetChannel
    };
  } finally {
    ytDlpChannelSwitchInProgress = false;
  }
}

async function forceUpdateYtDlp(win, channel, { silent = false, force = true } = {}) {
  const targetChannel = normalizeYtDlpChannel(channel || settings.ytDlpChannel);

  if (force) {
    await stopAllBlockingTasks(win, `force updating yt-dlp on ${targetChannel} channel`);
  }

  if (ytDlpChannelSwitchInProgress) {
    return {
      ok: false,
      level: 'warning',
      message: 'A yt-dlp update or channel switch is already in progress.',
      channel: targetChannel
    };
  }

  ytDlpChannelSwitchInProgress = true;
  const log = (message) => {
    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-log', message);
    }
  };

  try {
    log(`[yt-dlp] Forcefully downloading latest release build for ${targetChannel} channel...`);
    await downloadYtDlpFromChannel(win, targetChannel);

    const versionInfo = await getYtDlpVersionInfo();
    if (!versionInfo.available || !versionInfo.version) {
      throw new Error('yt-dlp binary verification failed after force update.');
    }

    saveSettingsInternal({
      ytDlpChannel: targetChannel,
      ytDlpInstalledChannel: versionInfo.installedChannel || targetChannel,
      ytDlpInstalledVersion: versionInfo.version
    });

    const message = `yt-dlp forcefully updated to latest ${versionInfo.installedChannel} build (${versionInfo.version}).`;
    log(`[yt-dlp] ${message}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('yt-dlp-channel-changed', {
        ok: true,
        channel: versionInfo.installedChannel,
        targetChannel,
        version: versionInfo.version,
        source: 'force-update'
      });
    }

    return {
      ok: true,
      level: 'success',
      message,
      channel: versionInfo.installedChannel,
      targetChannel,
      version: versionInfo.version
    };
  } catch (err) {
    console.error('Failed to force update yt-dlp:', err);
    const message = `Failed to force update yt-dlp (${targetChannel}): ${err.message}`;
    log(`[yt-dlp] ${message}`);
    if (win && !win.isDestroyed()) {
      win.webContents.send('yt-dlp-channel-changed', {
        ok: false,
        error: message,
        targetChannel
      });
    }
    return {
      ok: false,
      level: 'error',
      message,
      tip: err.message.includes('locked') ? err.message : 'Please check your internet connection and try again.',
      channel: targetChannel
    };
  } finally {
    ytDlpChannelSwitchInProgress = false;
  }
}

async function syncYtDlpChannel(win, { ensureLocal = false, silent = false } = {}) {
  const targetChannel = normalizeYtDlpChannel(settings.ytDlpChannel);
  const exists = fs.existsSync(localYtDlp);

  if (ensureLocal && !exists) {
    return switchYtDlpChannel(win, targetChannel, { silent });
  }

  if (!exists) {
    return false;
  }

  const actualInfo = await getYtDlpVersionInfo();
  if (!actualInfo.available) {
    return switchYtDlpChannel(win, targetChannel, { silent });
  }

  saveSettingsInternal({
    ytDlpInstalledChannel: actualInfo.installedChannel,
    ytDlpInstalledVersion: actualInfo.version
  });

  if (actualInfo.installedChannel !== targetChannel) {
    return switchYtDlpChannel(win, targetChannel, { silent });
  }

  return false;
}

async function runYtDlpProcess(args, cookieConfig, timeoutMs = 90000) {
  const cookieArgs = await appendYtDlpCookieArgs(args, cookieConfig);
  return new Promise((resolve) => {
    const proc = spawn(getYtDlpPath(), cookieArgs, {
      windowsHide: true
    });
    registerYtDlpProcess(proc);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
      finish({
        code: -2,
        stdout,
        stderr: `${stderr}\nTimed out after ${Math.round(timeoutMs / 1000)}s. Close the browser and try again.`.trim(),
        timedOut: true
      });
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => finish({ code, stdout, stderr, timedOut: false }));
    proc.on('error', (err) => finish({
      code: -1,
      stdout,
      stderr: err.code === 'ENOENT'
        ? `yt-dlp was not found. Install it or let the app download it from Settings > dependencies.\n${err.message}`
        : err.message,
      timedOut: false
    }));
  });
}

function hasCookieExtractionFailure(output) {
  const lower = (output || '').toLowerCase();
  return (
    (lower.includes('could not copy') && lower.includes('cookie')) ||
    lower.includes('error extracting cookies') ||
    lower.includes('failed to extract cookies') ||
    lower.includes('unsupported browser') ||
    lower.includes('no such browser')
  );
}

function parseYtDlpCookieError(stderr, timedOut = false) {
  if (timedOut) {
    return {
      message: 'Cookie test timed out.',
      tip: 'Close the selected browser completely, then run the test again.'
    };
  }

  const text = (stderr || '').trim();
  const lower = text.toLowerCase();

  if (lower.includes('yt-dlp was not found') || lower.includes('enoent')) {
    return {
      message: 'yt-dlp is not available on this system.',
      tip: 'Open the app setup wizard or install yt-dlp, then try again.'
    };
  }
  if (lower.includes('could not copy') && lower.includes('cookie')) {
    return {
      message: 'Could not read the browser cookie database.',
      tip: 'Close the selected browser completely (all windows), then run the test again. Chromium browsers lock their cookie file while open.'
    };
  }
  if (lower.includes('failed to decrypt') || lower.includes('keyring')) {
    return {
      message: 'Cookies were found but could not be decrypted.',
      tip: 'On Linux, you may need a keyring option. On Windows, close the browser and retry.'
    };
  }
  if (lower.includes('unsupported browser') || lower.includes('no such browser')) {
    return {
      message: 'That browser is not supported or could not be located.',
      tip: 'Pick the browser you actually use and make sure it is installed.'
    };
  }
  if (lower.includes('profile') && (lower.includes('not found') || lower.includes('does not exist'))) {
    return {
      message: 'The browser profile name could not be found.',
      tip: 'Check the exact profile name in your browser settings, or leave the profile blank for default.'
    };
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const errorLines = lines.filter((l) => /error/i.test(l));
  return {
    message: errorLines[errorLines.length - 1] || lines[lines.length - 1] || 'Cookie test failed.',
    tip: 'Close the browser, confirm the profile name, and try again.'
  };
}

function cleanYtDlpError(stderr) {
  const lines = (stderr || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const errorLines = lines.filter((l) => /error/i.test(l));
  return errorLines.join(' ') || lines.slice(-2).join(' ') || 'Unknown yt-dlp error.';
}

async function detectYoutubeLogin(cookieOverride) {
  const probeUrls = [
    'https://www.youtube.com/playlist?list=WL',
    'https://www.youtube.com/feed/subscriptions',
    'https://www.youtube.com/playlist?list=LL'
  ];

  for (const url of probeUrls) {
    const result = await runYtDlpProcess([
      '--flat-playlist',
      '--dump-single-json',
      '--playlist-items', '1',
      '--no-warnings',
      '--ignore-no-formats-error',
      url
    ], cookieOverride, 60000);

    if (result.code !== 0 || hasCookieExtractionFailure(`${result.stderr}\n${result.stdout}`)) {
      continue;
    }

    try {
      const parsed = JSON.parse(result.stdout);
      const title = (parsed.title || '').toLowerCase();
      if (title.includes('sign in') || title.includes('login required')) {
        continue;
      }
      if (
        parsed._type === 'playlist' ||
        parsed.id === 'WL' ||
        parsed.id === 'LL'
      ) {
        return { loggedIn: true, label: parsed.title || 'YouTube account feed' };
      }
    } catch {
      // try next probe
    }
  }

  return { loggedIn: false, label: '' };
}

async function testBrowserCookiesInternal({ browser, profile, cookiesFile, testUrl }) {
  if (!browser) {
    return {
      ok: false,
      level: 'error',
      message: 'Select a browser before testing cookies.',
      tip: 'Choose Chrome, Edge, Firefox, or another supported browser from the dropdown.'
    };
  }

  if (browser === 'file') {
    if (!cookiesFile) {
      return {
        ok: false,
        level: 'error',
        message: 'No cookies file selected.',
        tip: 'Please select a valid Netscape format cookies text file (.txt).'
      };
    }
    if (!fs.existsSync(cookiesFile)) {
      return {
        ok: false,
        level: 'error',
        message: 'The selected cookies file does not exist.',
        tip: 'Verify the file path and make sure the file is at that location.'
      };
    }
  }

  if (browser === 'app-browser') {
    const cookies = await session.defaultSession.cookies.get({});
    if (cookies.length === 0) {
      return {
        ok: false,
        level: 'warning',
        message: 'No cookies found in the In-App Browser.',
        tip: 'Open the "Browser" tab, search/go to YouTube or Instagram, and log in to your account. Then run this test again.'
      };
    }
  }

  const versionCheck = await runYtDlpProcess(['--version'], false, 15000);
  if (versionCheck.code !== 0) {
    return {
      ok: false,
      level: 'error',
      message: 'yt-dlp is not available.',
      tip: cleanYtDlpError(versionCheck.stderr) || 'Install yt-dlp or complete the app dependency setup first.'
    };
  }

  const cookieOverride = {
    browser,
    profile: (profile || '').trim().replace(/^["']|["']$/g, ''),
    cookiesFile
  };

  const extractionTest = await runYtDlpProcess([
    '--simulate',
    '--no-warnings',
    '--ignore-no-formats-error',
    '--print', '%(title)s',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  ], cookieOverride, 60000);

  const extractionOutput = `${extractionTest.stderr}\n${extractionTest.stdout}`;

  if (
    extractionTest.code !== 0 ||
    extractionTest.code === -1 ||
    extractionTest.timedOut ||
    hasCookieExtractionFailure(extractionOutput)
  ) {
    const parsed = parseYtDlpCookieError(extractionOutput, extractionTest.timedOut);
    return {
      ok: false,
      level: 'error',
      message: parsed.message,
      tip: parsed.tip,
      extractionOk: false,
      youtubeLoggedIn: false
    };
  }

  const loginProbe = await detectYoutubeLogin(cookieOverride);
  const youtubeLoggedIn = loginProbe.loggedIn;

  if (testUrl && testUrl.trim()) {
    const urlTest = await runYtDlpProcess([
      '--simulate',
      '--no-warnings',
      '--ignore-no-formats-error',
      '--print', '%(title)s',
      testUrl.trim()
    ], cookieOverride, 90000);

    const urlOutput = `${urlTest.stderr}\n${urlTest.stdout}`;

    if (urlTest.code !== 0 || urlTest.timedOut || hasCookieExtractionFailure(urlOutput)) {
      return {
        ok: false,
        level: 'error',
        message: urlTest.timedOut
          ? 'Cookie test timed out while checking your URL.'
          : 'Cookies load, but your test URL could not be accessed.',
        detail: cleanYtDlpError(urlOutput),
        tip: urlTest.timedOut
          ? 'Close the browser and try again with a shorter or public test clip first.'
          : 'Make sure you are signed in to that site in the selected browser profile.',
        extractionOk: true,
        youtubeLoggedIn
      };
    }

    const title = urlTest.stdout.trim();
    return {
      ok: true,
      level: 'success',
      message: 'Cookies verified — your test URL is accessible.',
      detail: title ? `Reached: ${title}` : 'yt-dlp can access the URL with these cookies.',
      extractionOk: true,
      youtubeLoggedIn
    };
  }

  if (youtubeLoggedIn) {
    return {
      ok: true,
      level: 'success',
      message: 'Cookies working — YouTube account detected in this browser profile.',
      detail: loginProbe.label
        ? `Verified via: ${loginProbe.label}`
        : 'yt-dlp can read cookies and sees an active YouTube session.',
      extractionOk: true,
      youtubeLoggedIn: true
    };
  }

  return {
    ok: true,
    level: 'warning',
    message: 'Cookie extraction works, but no YouTube login was detected.',
    detail: 'Sign in to YouTube in that browser profile, then test again. For private non-YouTube sites, use the optional test URL below.',
    extractionOk: true,
    youtubeLoggedIn: false
  };
}

function getFfmpegPath() {
  if (fs.existsSync(localFfmpeg)) {
    return localFfmpeg;
  }
  return 'ffmpeg';
}

function getFpcalcPath() {
  if (fs.existsSync(localFpcalc)) {
    return localFpcalc;
  }
  return 'fpcalc';
}

// Settings management variables
let settings = {};
let settingsFilePath = '';
let guestBrowserView = null;
let guestBrowserHooksVersion = 0;

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const GUEST_BROWSER_HOOKS_VERSION = 6;

function getGuestPageUrl() {
  if (guestBrowserView && !guestBrowserView.webContents.isDestroyed()) {
    const url = guestBrowserView.webContents.getURL();
    if (url && url.startsWith('http')) return url;
  }
  return '';
}

function buildStreamRequestHeaders(pageUrl) {
  const referer = pageUrl || getGuestPageUrl();
  const headers = [`User-Agent: ${BROWSER_USER_AGENT}`];
  if (referer) {
    try {
      headers.push(`Referer: ${new URL(referer).origin}/`);
    } catch (e) {
      headers.push(`Referer: ${referer}`);
    }
  }
  return headers;
}

function resolveGuestRequestOrigin(details) {
  const pageUrl = getGuestPageUrl();
  if (pageUrl) {
    try {
      return new URL(pageUrl).origin;
    } catch (e) {}
  }
  if (details.referrer && details.referrer.startsWith('http')) {
    try {
      return new URL(details.referrer).origin;
    } catch (e) {}
  }
  return '*';
}

const EMBED_PLAYER_HOST_HINTS = [
  'vidrame.pro', 'vidrame.net', 'vidplay', 'vidmoly', 'moly.to',
  'close.video', 'rapidvid', 'streamtape', 'dood', 'filemoon',
  'embed', 'player.', 'cdn.'
];

const EMBED_PROXY_HOSTS = [
  'vidrame.pro', 'vidrame.net', 'vidmoly.to', 'vidplay',
  'close.video', 'rapidvid', 'streamtape.com', 'doodstream', 'filemoon'
];

function isEmbedPlayerHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return EMBED_PLAYER_HOST_HINTS.some((hint) => host === hint || host.endsWith('.' + hint) || host.includes(hint));
}

function isEmbedProxyHost(hostname) {
  const host = (hostname || '').toLowerCase();
  return EMBED_PROXY_HOSTS.some((hint) => host === hint || host.endsWith('.' + hint));
}

function getHeaderIgnoreCase(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function deleteHeaderIgnoreCase(headers, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

function isNavigationResourceType(resourceType) {
  return resourceType === 'mainFrame' || resourceType === 'subFrame';
}

function refererMatchesParentSite(referer, parentHostname) {
  if (!referer || !referer.startsWith('http')) return false;
  try {
    const refHost = new URL(referer).hostname;
    const parent = parentHostname.replace(/^www\./, '');
    const refBase = refHost.replace(/^www\./, '');
    return refHost === parentHostname || refBase === parent || refHost.endsWith('.' + parent);
  } catch (e) {
    return false;
  }
}

function applyGuestBrowserHeaders(details, requestHeaders) {
  const topUrl = getGuestPageUrl();
  if (!topUrl) return requestHeaders;

  let parsedPage;
  let parsedReq;
  try {
    parsedPage = new URL(topUrl);
    parsedReq = new URL(details.url);
  } catch (e) {
    return requestHeaders;
  }

  const existingReferer = getHeaderIgnoreCase(requestHeaders, 'referer') || '';
  const refererOk = existingReferer && existingReferer.startsWith('http');
  const isCrossOrigin = parsedReq.hostname !== parsedPage.hostname;
  const isNavigation = isNavigationResourceType(details.resourceType);

  if (isNavigation) {
    deleteHeaderIgnoreCase(requestHeaders, 'Origin');
  }

  if (isEmbedProxyHost(parsedReq.hostname)) {
    requestHeaders['Referer'] = topUrl;
  } else if (!refererOk) {
    requestHeaders['Referer'] = topUrl;
  }

  const rt = details.resourceType;
  if (rt === 'subFrame' && isCrossOrigin) {
    requestHeaders['Sec-Fetch-Site'] = 'cross-site';
    requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    requestHeaders['Sec-Fetch-Dest'] = 'iframe';
    requestHeaders['Sec-Fetch-User'] = '?1';
  } else if (rt === 'mainFrame') {
    requestHeaders['Sec-Fetch-Site'] = 'none';
    requestHeaders['Sec-Fetch-Mode'] = 'navigate';
    requestHeaders['Sec-Fetch-Dest'] = 'document';
    requestHeaders['Sec-Fetch-User'] = '?1';
  } else if (isCrossOrigin && (rt === 'media' || rt === 'xhr')) {
    requestHeaders['Sec-Fetch-Site'] = 'cross-site';
    requestHeaders['Sec-Fetch-Mode'] = rt === 'media' ? 'no-cors' : 'cors';
    requestHeaders['Sec-Fetch-Dest'] = rt === 'media' ? 'video' : 'empty';
  }

  if (!isNavigation && isCrossOrigin && !getHeaderIgnoreCase(requestHeaders, 'origin')) {
    requestHeaders['Origin'] = parsedPage.origin;
  }

  requestHeaders['User-Agent'] = BROWSER_USER_AGENT;
  requestHeaders['sec-ch-ua'] = '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"';
  requestHeaders['sec-ch-ua-mobile'] = '?0';
  requestHeaders['sec-ch-ua-platform'] = '"Windows"';
  if (!getHeaderIgnoreCase(requestHeaders, 'accept-language')) {
    requestHeaders['Accept-Language'] = 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7';
  }

  return requestHeaders;
}

function buildEmbedReferer(topUrl) {
  if (!topUrl) return '';
  try {
    return new URL(topUrl).origin + '/';
  } catch (e) {
    return topUrl;
  }
}

function injectEmbedBaseHref(html, targetUrl) {
  try {
    const baseHref = new URL(targetUrl).origin + '/';
    if (!/<base\s/i.test(html)) {
      return html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
    }
  } catch (e) {}
  return html;
}

function buildBrowserProxyUrl(targetUrl, referer) {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  if (referer) params.set('referer', referer);
  return `browser-proxy://fetch?${params.toString()}`;
}

function getEmbedProxyUrlFilters() {
  return ['*://*/*'];
}

function registerGuestEmbedProxy(session) {
  // Do not redirect subFrame navigations to browser-proxy:// — Chromium blocks custom
  // schemes in cross-origin iframes (net::ERR_BLOCKED_BY_CLIENT). Referer injection
  // for embed hosts is handled via CDP Fetch in setupGuestNetworkHooks.
  void session;
}

async function fetchEmbedDocument(targetUrl, referer) {
  const fetchOptions = {};
  if (guestBrowserView && !guestBrowserView.webContents.isDestroyed()) {
    fetchOptions.session = guestBrowserView.webContents.session;
  }

  const target = normalizeEmbedUrl(targetUrl);
  const refererCandidates = [];
  if (referer) {
    refererCandidates.push(referer, buildEmbedReferer(referer));
  }
  refererCandidates.push('');

  for (const ref of refererCandidates) {
    const headers = {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    if (ref) headers['Referer'] = ref;

    try {
      const response = await net.fetch(target, { ...fetchOptions, headers });
      if (!response.ok) continue;
      const html = await response.text();
      if (!html || html.length < 80) continue;
      return injectEmbedBaseHref(html, target);
    } catch (e) {
      continue;
    }
  }
  return null;
}

function getEmbedFetchPatterns() {
  const patterns = [];
  for (const hint of EMBED_PROXY_HOSTS) {
    if (hint.includes('.')) {
      patterns.push({ urlPattern: `*://${hint}/*`, requestStage: 'Request' });
      patterns.push({ urlPattern: `*://*.${hint}/*`, requestStage: 'Request' });
    } else {
      patterns.push({ urlPattern: `*://*${hint}*/*`, requestStage: 'Request' });
    }
  }
  return patterns;
}

function normalizeEmbedUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('vidrame') && !parsed.searchParams.has('ap')) {
      parsed.searchParams.set('ap', '1');
      return parsed.toString();
    }
    return targetUrl;
  } catch (e) {
    return targetUrl;
  }
}

const hydratedIframeUrls = new Set();
const embedIframeFirstSeen = new Map();
const EMBED_SRCDOC_WAIT_MS = 3000;

function startEmbedIframeHydration(webContents) {
  const scan = async () => {
    if (!webContents || webContents.isDestroyed()) return;
    const pageUrl = webContents.getURL();
    if (!pageUrl.startsWith('http')) return;

    let targets = [];
    try {
      targets = await webContents.executeJavaScript(`(() => {
        const embedHints = ['vidrame', 'vidmoly', 'vidplay', 'close.video', 'rapidvid', 'streamtape', 'dood', 'filemoon'];
        const results = [];
        document.querySelectorAll('iframe').forEach((ifr, index) => {
          if (ifr.dataset.ytEmbedHydrated === '1') return;
          const dataSrc = (ifr.getAttribute('data-src') || '').trim();
          const src = (ifr.getAttribute('src') || '').trim();
          const raw = dataSrc || src;
          if (!raw || raw.startsWith('about:') || raw.startsWith('browser-proxy:')) return;
          let absolute = raw;
          try { absolute = new URL(raw, location.href).href; } catch (e) { return; }
          const host = (() => { try { return new URL(absolute).hostname; } catch (e) { return ''; } })();
          if (!embedHints.some((hint) => host.includes(hint))) return;
          const immediate = Boolean(dataSrc && (!src || src.startsWith('about:')));
          results.push({ index, url: absolute, immediate });
        });
        return results;
      })`);
    } catch (e) {
      return;
    }

    const now = Date.now();
    for (const target of targets) {
      const waitKey = `${target.index}:${target.url}`;
      if (!target.immediate) {
        if (!embedIframeFirstSeen.has(waitKey)) {
          embedIframeFirstSeen.set(waitKey, now);
        }
        if (now - embedIframeFirstSeen.get(waitKey) < EMBED_SRCDOC_WAIT_MS) {
          continue;
        }
      }

      if (hydratedIframeUrls.has(target.url)) continue;

      const html = await fetchEmbedDocument(target.url, pageUrl);
      if (!html) continue;

      const htmlJson = JSON.stringify(html);
      try {
        await webContents.executeJavaScript(`(() => {
          const ifr = document.querySelectorAll('iframe')[${target.index}];
          if (!ifr || ifr.dataset.ytEmbedHydrated === '1') return;
          ifr.removeAttribute('src');
          ifr.removeAttribute('data-src');
          ifr.removeAttribute('sandbox');
          ifr.srcdoc = ${htmlJson};
          ifr.dataset.ytEmbedHydrated = '1';
        })`);
        hydratedIframeUrls.add(target.url);
      } catch (e) {}
    }
  };

  const resetHydration = () => {
    hydratedIframeUrls.clear();
    embedIframeFirstSeen.clear();
  };

  let scanTimer = null;
  let remainingScans = 0;

  const triggerScanCycle = (count = 5) => {
    remainingScans = count;
    if (!scanTimer) {
      scan();
      scanTimer = setInterval(() => {
        remainingScans--;
        if (remainingScans <= 0 || !webContents || webContents.isDestroyed()) {
          clearInterval(scanTimer);
          scanTimer = null;
          return;
        }
        scan();
      }, 800);
    }
  };

  webContents.on('did-finish-load', () => {
    resetHydration();
    triggerScanCycle(6);
  });
  webContents.on('did-navigate', resetHydration);
  webContents.on('did-navigate-in-page', () => {
    resetHydration();
    triggerScanCycle(5);
  });

  webContents.once('destroyed', () => {
    if (scanTimer) clearInterval(scanTimer);
  });
  triggerScanCycle(5);
}

function setupGuestNetworkHooks(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const dbg = webContents.debugger;
  let networkEnabled = false;
  let fetchEnabled = false;

  const onFetchPaused = async (event, method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const { requestId, request } = params;
    const referer = getGuestPageUrl();
    if (!referer) {
      try { await dbg.sendCommand('Fetch.continueRequest', { requestId }); } catch (e) {}
      return;
    }
    try {
      const headers = Object.entries({ ...request.headers, Referer: referer })
        .map(([name, value]) => ({ name, value: String(value) }));
      await dbg.sendCommand('Fetch.continueRequest', { requestId, headers });
    } catch (e) {
      try { await dbg.sendCommand('Fetch.continueRequest', { requestId }); } catch (e2) {}
    }
  };

  dbg.on('message', onFetchPaused);

  const syncReferer = async () => {
    const referer = getGuestPageUrl();
    if (!referer) return;
    try {
      if (!dbg.isAttached()) dbg.attach('1.3');
      if (!networkEnabled) {
        await dbg.sendCommand('Network.enable');
        networkEnabled = true;
      }
      if (!fetchEnabled) {
        await dbg.sendCommand('Fetch.enable', { patterns: getEmbedFetchPatterns() });
        fetchEnabled = true;
      }
      await dbg.sendCommand('Network.setExtraHTTPHeaders', {
        headers: {
          Referer: referer,
          'User-Agent': BROWSER_USER_AGENT
        }
      });
    } catch (e) {
      console.error('Guest network referer sync failed:', e.message);
    }
  };

  webContents.on('did-start-navigation', syncReferer);
  webContents.on('did-navigate-in-page', syncReferer);
  webContents.on('did-finish-load', syncReferer);
  webContents.once('destroyed', () => dbg.removeListener('message', onFetchPaused));
  syncReferer();
}

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
  
  settings = { ...defaultSettings };
  
  try {
    if (fs.existsSync(settingsFilePath)) {
      const data = fs.readFileSync(settingsFilePath, 'utf8');
      const parsed = JSON.parse(data);
      settings = { ...defaultSettings, ...parsed };
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
    settings = { ...settings, ...newSettings };
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
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let newestPath = '';
    let newestMtime = minModifiedAt;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.isFile()) continue;
      const fileName = entry.name;
      if (isTemporaryDownloadPath(fileName)) continue;

      const fullPath = path.join(dirPath, fileName);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs >= newestMtime) {
          newestMtime = stat.mtimeMs;
          newestPath = fullPath;
        }
      } catch (e) {}
    }

    return newestPath;
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
  const fpcalcLocal = fs.existsSync(localFpcalc);

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

function getDependencyUrls() {
  const urls = {
    ytDlp: '',
    ffmpeg: '',
    fpcalc: ''
  };

  urls.ytDlp = getYtDlpDownloadUrl(settings.ytDlpChannel);

  const is64 = process.arch === 'x64' || process.arch === 'arm64';
  if (process.platform === 'win32') {
    urls.ffmpeg = is64
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-win-32.zip';
    urls.fpcalc = 'https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-windows-x86_64.zip';
  } else if (process.platform === 'darwin') {
    urls.ffmpeg = 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-macos-64.zip';
    urls.fpcalc = 'https://github.com/acoustid/chromaprint/releases/download/v1.6.0/chromaprint-fpcalc-1.6.0-macos-universal.tar.gz';
  } else {
    urls.ffmpeg = is64
      ? 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-64.zip'
      : 'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffmpeg-6.1-linux-32.zip';
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
          'User-Agent': BROWSER_USER_AGENT,
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
      saveSettingsInternal({ firstRunComplete: true });
      checkUpdates(win);
      return;
    }

    if (!fs.existsSync(localBinDir)) {
      fs.mkdirSync(localBinDir, { recursive: true });
    }

    if (needYtDlp) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'yt-dlp' });
      const tempPath = path.join(localBinDir, `yt-dlp.tmp_${Date.now()}`);
      await downloadFile(urls.ytDlp, tempPath, win, 'yt-dlp');
      await replaceLocalBinary(tempPath, localYtDlp, { minSizeBytes: 1000000 });

      const versionResult = await runYtDlpProcess(['--version'], false, 15000);
      const version = (versionResult.stdout || '').trim();
      saveSettingsInternal({
        ytDlpInstalledChannel: normalizeYtDlpChannel(settings.ytDlpChannel),
        ytDlpInstalledVersion: version
      });

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

    if (needFpcalc) {
      win.webContents.send('dependency-status', { type: 'download-start', item: 'fpcalc' });
      const ext = process.platform === 'win32' ? '.zip' : '.tar.gz';
      const archivePath = path.join(localBinDir, 'fpcalc' + ext);
      await downloadFile(urls.fpcalc, archivePath, win, 'fpcalc');

      win.webContents.send('dependency-status', { type: 'extracting', item: 'fpcalc' });
      await extractZip(archivePath, localBinDir);

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
        path.join(localBinDir, `fpcalc${exeSuffix}`),
        path.join(localBinDir, platformDir, `fpcalc${exeSuffix}`),
        path.join(localBinDir, platformDir, 'bin', `fpcalc${exeSuffix}`)
      ];
      
      for (const p of possiblePaths) {
        if (checkAndSet(p)) break;
      }
      
      if (!foundFpcalc) {
        try {
          const entries = fs.readdirSync(localBinDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const subDirPath = path.join(localBinDir, entry.name);
              const subEntries = fs.readdirSync(subDirPath);
              for (const subEntry of subEntries) {
                if (subEntry === `fpcalc${exeSuffix}`) {
                  foundFpcalc = path.join(subDirPath, subEntry);
                  break;
                }
                if (subEntry === 'bin') {
                  const binPath = path.join(subDirPath, 'bin', `fpcalc${exeSuffix}`);
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
      
      if (foundFpcalc && foundFpcalc !== localFpcalc) {
        if (fs.existsSync(localFpcalc)) {
          fs.unlinkSync(localFpcalc);
        }
        fs.renameSync(foundFpcalc, localFpcalc);
        try {
          let parentDir = path.dirname(foundFpcalc);
          if (path.basename(parentDir) === 'bin') {
            fs.rmdirSync(parentDir);
            parentDir = path.dirname(parentDir);
          }
          fs.rmdirSync(parentDir);
        } catch (e) {}
      }

      makeExecutable(localFpcalc);
      win.webContents.send('dependency-status', { type: 'download-complete', item: 'fpcalc' });
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
  
  win.webContents.once('did-finish-load', async () => {
    if (settings.onboardingComplete) {
      const deps = await checkDependencies();
      const missingDeps = !deps.ytDlp.available || !deps.ffmpeg.available || !deps.fpcalc.available;
      if (!settings.firstRunComplete || missingDeps) {
        setupDependencies(win);
      } else {
        await syncYtDlpChannel(win, { silent: true });
        checkUpdates(win);
      }
    }
  });
}

async function checkUpdates(win, retryCount = 0) {
  const targetChannel = normalizeYtDlpChannel(settings.ytDlpChannel);

  if (activeYtDlpProcesses.size > 0 || ytDlpChannelSwitchInProgress) {
    const activeCommands = Array.from(activeYtDlpProcesses).map(p => {
      const args = p.spawnargs ? p.spawnargs.slice(1).join(' ') : '';
      return `${path.basename(p.spawnfile || 'yt-dlp')} ${args}`;
    });
    const reason = ytDlpChannelSwitchInProgress 
      ? 'channel switch in progress' 
      : `active tasks: ${activeCommands.join(', ')}`;

    if (retryCount < 3) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-log', `[yt-dlp update] Update check postponed (${reason}). Retrying in 5 seconds...`);
      }
      setTimeout(() => {
        checkUpdates(win, retryCount + 1);
      }, 5000);
    } else {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-log', `[yt-dlp update] Update check postponed: yt-dlp is currently busy (${reason}).`);
      }
    }
    return;
  }

  if (win && !win.isDestroyed()) {
    win.webContents.send('update-log', `[yt-dlp update] Checking for updates on the ${targetChannel} channel...`);
  }

  try {
    // 1. Try yt-dlp built-in update check first without passing browser cookies
    const updateResult = await runYtDlpProcess(['--update-to', targetChannel], false, 35000);
    const combined = `${updateResult.stdout}\n${updateResult.stderr}`;

    const updateSucceeded = updateResult.code === 0 ||
      /updated yt-dlp to/i.test(combined) ||
      /is up to date/i.test(combined);

    if (updateSucceeded) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-log', '[yt-dlp update] Update check completed successfully.');
      }
      const info = await getYtDlpVersionInfo();
      if (info.available) {
        saveSettingsInternal({
          ytDlpInstalledChannel: info.installedChannel,
          ytDlpInstalledVersion: info.version
        });
        if (win && !win.isDestroyed()) {
          win.webContents.send('yt-dlp-channel-changed', {
            channel: info.installedChannel,
            targetChannel,
            version: info.version
          });
        }
      }
    } else {
      // 2. Built-in --update-to failed (common on Windows with file locks or GitHub API limitations).
      // Fall back to direct binary download from official GitHub release assets.
      if (win && !win.isDestroyed()) {
        const errorSummary = cleanYtDlpError(combined) || `exit code ${updateResult.code}`;
        win.webContents.send('update-log', `[yt-dlp update] Built-in update check encountered: ${errorSummary}. Downloading latest ${targetChannel} build directly from GitHub Releases...`);
      }

      await downloadYtDlpFromChannel(win, targetChannel);
      const info = await getYtDlpVersionInfo();
      if (info.available && info.version) {
        saveSettingsInternal({
          ytDlpInstalledChannel: info.installedChannel || targetChannel,
          ytDlpInstalledVersion: info.version
        });
        if (win && !win.isDestroyed()) {
          win.webContents.send('update-log', `[yt-dlp update] Auto-update completed successfully: yt-dlp updated to latest ${info.installedChannel || targetChannel} build (${info.version}).`);
          win.webContents.send('yt-dlp-channel-changed', {
            channel: info.installedChannel || targetChannel,
            targetChannel,
            version: info.version
          });
        }
      } else {
        throw new Error('Downloaded binary could not be verified.');
      }
    }
  } catch (err) {
    console.error('Auto update check failed:', err);
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-log', `[yt-dlp update] Auto-update check failed: ${err.message}`);
    }
  }

  // Verify FFmpeg is available
  const ffmpegPath = getFfmpegPath();
  const ffmpegCheck = spawn(ffmpegPath, ['-version']);
  ffmpegCheck.stdout.once('data', (data) => {
    const versionLine = data.toString().split('\n')[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-log', `[ffmpeg check] ${versionLine}`);
    }
  });
  ffmpegCheck.on('error', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update-log', `[ffmpeg error] ffmpeg not found in PATH! Audio extraction and video merging may fail.`);
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
  initSettings();

  // Configure CORS and Referer for YouTube / GoogleVideo streaming in main renderer (e.g. Clipper preview)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.googlevideo.com/*', '*://*.youtube.com/*'] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      requestHeaders['Referer'] = 'https://www.youtube.com/';
      requestHeaders['Origin'] = 'https://www.youtube.com';
      callback({ requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*.googlevideo.com/*', '*://*.youtube.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Headers'] = ['Range, Content-Range, Content-Length, Accept, Origin, Referer, Content-Type, Authorization'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
      responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];
      callback({ responseHeaders });
    }
  );

  protocol.handle('media-preview', async (request) => {
    try {
      const parsed = new URL(request.url);
      const targetUrl = parsed.searchParams.get('url');
      const pageUrl = parsed.searchParams.get('pageUrl') || getGuestPageUrl();
      if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
      }
      const fetchHeaders = { 'User-Agent': BROWSER_USER_AGENT };
      if (pageUrl) fetchHeaders['Referer'] = pageUrl;
      const fetchOptions = { headers: fetchHeaders };
      if (guestBrowserView && !guestBrowserView.webContents.isDestroyed()) {
        fetchOptions.session = guestBrowserView.webContents.session;
      }
      return net.fetch(targetUrl, fetchOptions);
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  });

  protocol.handle('browser-proxy', async (request) => {
    try {
      const parsed = new URL(request.url);
      const targetUrl = parsed.searchParams.get('url');
      const referer = parsed.searchParams.get('referer') || getGuestPageUrl() || '';
      if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
      }
      const fetchUrl = normalizeEmbedUrl(targetUrl);

      const refererCandidates = [];
      if (referer) {
        refererCandidates.push(referer);
        const originReferer = buildEmbedReferer(referer);
        if (originReferer && originReferer !== referer) {
          refererCandidates.push(originReferer);
        }
      }
      if (refererCandidates.length === 0) {
        refererCandidates.push('');
      }

      const fetchOptions = {};
      if (guestBrowserView && !guestBrowserView.webContents.isDestroyed()) {
        fetchOptions.session = guestBrowserView.webContents.session;
      }

      let lastResponse = null;
      for (const ref of refererCandidates) {
        const fetchHeaders = {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept': '*/*',
          'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
          'sec-ch-ua': '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"'
        };
        if (ref) fetchHeaders['Referer'] = ref;

        const response = await net.fetch(fetchUrl, { ...fetchOptions, headers: fetchHeaders });
        if (response.status === 404 && ref !== refererCandidates[refererCandidates.length - 1]) {
          lastResponse = response;
          continue;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) {
          const html = await response.text();
          const body = injectEmbedBaseHref(html, fetchUrl);
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Referrer-Policy': 'unsafe-url'
            }
          });
        }

        if (response.status !== 404) {
          return response;
        }
        lastResponse = response;
      }

      return lastResponse || new Response('Upstream not found', { status: 404 });
    } catch (err) {
      console.error('browser-proxy fetch failed:', err.message);
      return new Response(err.message, { status: 502 });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  flushSettingsSync();
});

app.on('window-all-closed', () => {
  flushSettingsSync();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

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

  const baseDir = settings.downloadDir || app.getPath('downloads');
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
    openDirectoryDirectly(targetDir);
  } catch (err) {
    console.error('Failed to open download folder:', err);
  }
});

ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', async (_event, newSettings) => {
  return saveSettingsInternal(newSettings);
});

ipcMain.handle('get-yt-dlp-info', async () => {
  return getYtDlpVersionInfo();
});

ipcMain.handle('switch-yt-dlp-channel', async (event, channel) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const targetChannel = normalizeYtDlpChannel(channel || settings.ytDlpChannel);
  saveSettingsInternal({ ytDlpChannel: targetChannel });
  return switchYtDlpChannel(win, targetChannel);
});

ipcMain.handle('force-update-yt-dlp', async (event, channel) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const targetChannel = normalizeYtDlpChannel(channel || settings.ytDlpChannel);
  return forceUpdateYtDlp(win, targetChannel);
});

ipcMain.handle('cancel-download', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await stopAllBlockingTasks(win, 'user cancelled download');
  return { ok: true };
});

ipcMain.handle('copy-to-clipboard', async (_event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
    return true;
  }
  return false;
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

ipcMain.handle('check-dependencies', async () => {
  return await checkDependencies();
});

ipcMain.handle('finish-onboarding', (event, onboardingData) => {
  const updated = saveSettingsInternal({
    onboardingComplete: true,
    userName: onboardingData.userName,
    weatherCity: onboardingData.weatherCity,
    weatherLat: onboardingData.weatherLat,
    weatherLon: onboardingData.weatherLon,
    tempFormat: onboardingData.tempFormat,
    musicFinderService: onboardingData.musicFinderService || settings.musicFinderService,
    acoustidKey: onboardingData.acoustidKey !== undefined ? onboardingData.acoustidKey : settings.acoustidKey,
    acrcloudKey: onboardingData.acrcloudKey !== undefined ? onboardingData.acrcloudKey : settings.acrcloudKey,
    acrcloudSecret: onboardingData.acrcloudSecret !== undefined ? onboardingData.acrcloudSecret : settings.acrcloudSecret,
    acrcloudHost: onboardingData.acrcloudHost !== undefined ? onboardingData.acrcloudHost : settings.acrcloudHost
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

ipcMain.handle('select-cookies-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Netscape Cookies Text File', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    title: 'Select Cookies File'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

async function buildVideoDownloadArgs({ url, quality, outPath }) {
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
  return await appendYtDlpCookieArgs(args);
}

ipcMain.handle('probe-playlist', async (_event, url) => {
  if (ytDlpChannelSwitchInProgress) {
    throw new Error('A yt-dlp update or channel switch is currently in progress. Please try again in a moment.');
  }

  if (!url || typeof url !== 'string') {
    return { isPlaylist: false, playlistCount: 0, title: '' };
  }

  const cleanUrl = url.trim();
  const cached = probePlaylistCache.get(cleanUrl);
  if (cached) {
    return cached;
  }

  const result = await runYtDlpProcess([
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    url
  ]);

  if (result.code !== 0) {
    const isLikelyPlaylist = /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
    const fallback = { isPlaylist: isLikelyPlaylist, playlistCount: 0, title: '' };
    probePlaylistCache.set(cleanUrl, fallback);
    return fallback;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const playlistCount = parsed.playlist_count || parsed.n_entries || 0;
    const isPlaylist = parsed._type === 'playlist' || playlistCount > 1;
    const probeRes = {
      isPlaylist,
      playlistCount: isPlaylist ? playlistCount : 0,
      title: parsed.title || parsed.playlist_title || ''
    };
    probePlaylistCache.set(cleanUrl, probeRes);
    return probeRes;
  } catch {
    const isLikelyPlaylist = /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
    const fallback = { isPlaylist: isLikelyPlaylist, playlistCount: 0, title: '' };
    probePlaylistCache.set(cleanUrl, fallback);
    return fallback;
  }
});

ipcMain.handle('test-browser-cookies', async (_event, payload) => {
  if (ytDlpChannelSwitchInProgress) {
    return {
      ok: false,
      level: 'warning',
      message: 'A yt-dlp update or channel switch is currently in progress.',
      tip: 'Please wait for the channel switch to complete.'
    };
  }

  try {
    return await testBrowserCookiesInternal(payload || {});
  } catch (err) {
    console.error('Cookie test failed:', err);
    return {
      ok: false,
      level: 'error',
      message: 'Cookie test could not be completed.',
      tip: err.message || 'Try again after closing the selected browser.'
    };
  }
});

ipcMain.on('download-video', async (event, { url, quality }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = settings.downloadDir || app.getPath('downloads');
  const videoDir = path.join(baseDir, 'yt-videos');
  
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const outPath = path.join(videoDir, '%(title)s.%(ext)s');
  const args = await buildVideoDownloadArgs({ url, quality, outPath });
  const videoFormat = settings.videoFormat || 'mp4';

  win.webContents.send('download-status', `[VIDEO] Starting download in ${videoFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
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
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'video', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[VIDEO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-audio', async (event, { url }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

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
  const finalArgs = await appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[AUDIO] Starting extraction to ${audioFormat.toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
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
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, audioDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: 'audio', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[AUDIO] Download failed with code ${code}`);
  });
});

ipcMain.on('download-subtitles', async (event, { url, lang }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

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
    // Strictly scope subtitles to requested language to avoid 100+ auto-translated sub requests (en-de, etc.) that cause HTTP 429
    args.push('--sub-langs', `${subLang},${subLang}-orig,${subLang}-${subLang},^${subLang}(?:-[A-Za-z]{2})?$`);
  }

  args.push(
    '--skip-download',
    '-o', outPath,
    '--no-mtime',
    '--compat-options', 'no-live-chat',
    '--no-abort-on-error'
  );

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);
  const finalArgs = await appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[SUBS] Starting download for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
    const lines = text.split('\n');
    for (const line of lines) {
      const subMatch = line.match(/Writing video subtitles to:\s*(.+)/);
      if (subMatch) finalPath = subMatch[1].trim();
      const existMatch = line.match(/\[download\]\s+(.+)\s+has already been downloaded/);
      if (existMatch) finalPath = existMatch[1].trim();
    }
  });
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    finalPath = resolveFinalDownloadPath(finalPath, subsDir, downloadStartedAt);
    const hasSubtitleFile = !!(finalPath && fs.existsSync(finalPath));
    if (code === 0 || hasSubtitleFile) {
      win.webContents.send('download-complete', { type: 'subtitles', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[SUBS] Download failed with code ${code}`);
  });
});

ipcMain.on('download-instagram', async (event, { url, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

  url = normalizeInstagramUrl(url);
  await syncYtDlpChannel(win, { ensureLocal: true });

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
  const finalArgs = await appendYtDlpCookieArgs(args);
  
  const label = format === 'audio' ? 'AUDIO' : 'VIDEO';
  win.webContents.send('download-status', `[INSTAGRAM ${label}] Starting download in ${format === 'audio' ? (settings.audioFormat || 'mp3').toUpperCase() : (settings.videoFormat || 'mp4').toUpperCase()} format for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';
  let stderrOutput = '';
  
  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
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
  ytProcess.stderr.on('data', (data) => {
    const text = data.toString();
    stderrOutput += text;
    throttledProgress.push(text);
  });
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      const type = format === 'audio' ? 'ig-audio' : 'ig-video';
      finalPath = resolveFinalDownloadPath(finalPath, path.join(baseDir, subFolder), downloadStartedAt);
      win.webContents.send('download-complete', { type, url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        openFolderOrRevealItem(finalPath);
      }
    }
    else {
      win.webContents.send('download-error', formatInstagramDownloadError(code, stderrOutput, label));
    }
  });
});

ipcMain.on('continue-anyway', (event) => {
  saveSettingsInternal({ firstRunComplete: true });
});

ipcMain.handle('fetch-video-info', async (event, url) => {
  if (ytDlpChannelSwitchInProgress) {
    throw new Error('A yt-dlp update or channel switch is currently in progress. Please try again in a moment.');
  }
  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Invalid URL provided.' };
  }

  const cleanUrl = url.trim();
  const cached = videoInfoCache.get(cleanUrl);
  if (cached) {
    return cached;
  }

  // Support local media files in Clipper preview
  if (fs.existsSync(cleanUrl)) {
    try {
      const meta = await probeLocalVideo(cleanUrl);
      const fileName = path.basename(cleanUrl);
      const localResult = {
        success: true,
        title: fileName,
        duration: meta.duration || 0,
        thumbnail: '',
        streamUrl: pathToFileURL(cleanUrl).href
      };
      videoInfoCache.set(cleanUrl, localResult);
      return localResult;
    } catch (e) {
      // Continue to yt-dlp fallback
    }
  }

  const runYtDlp = (args) => runYtDlpProcess(args);

  // Try with mp4 format filter first and --no-playlist for fast lightweight payload
  let result = await runYtDlp(['--no-playlist', '--dump-json', '-f', '18/best[ext=mp4]', cleanUrl]);
  
  // If it fails (some non-YT sites don't have format 18), fallback to dump full json
  if (result.code !== 0) {
    result = await runYtDlp(['--no-playlist', '--dump-json', cleanUrl]);
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

      const infoResult = {
        success: true,
        title: parsed.title || 'Unknown Video',
        duration: parsed.duration || 0,
        thumbnail: parsed.thumbnail || (parsed.thumbnails && parsed.thumbnails.length > 0 ? parsed.thumbnails[parsed.thumbnails.length - 1].url : ''),
        streamUrl: streamUrl
      };
      videoInfoCache.set(cleanUrl, infoResult);
      return infoResult;
    } catch (e) {
      return { success: false, error: 'JSON parse error: ' + e.message };
    }
  } else {
    return { success: false, error: result.stderr || 'Failed to fetch video information.' };
  }
});

ipcMain.on('download-clip', async (event, { url, quality, startTime, endTime, format }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

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
      formatStr = `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
      mergeFormat = 'mp4';
    }
    
    args = [
      '-f', formatStr,
      '--merge-output-format', mergeFormat,
    ];
  }

  args.push(
    '--download-sections', sectionStr,
    '--force-keyframes-at-cuts',
    '-o', outPath,
    '--no-mtime'
  );

  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }

  args.push(url);
  const finalArgs = await appendYtDlpCookieArgs(args);

  win.webContents.send('download-status', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Starting download for section ${startTime}-${endTime} in ${formatLabel} format...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, finalArgs);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
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
  
  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  
  ytProcess.on('close', (code) => {
    throttledProgress.flush();
    if (code === 0) {
      finalPath = resolveFinalDownloadPath(finalPath, videoDir, downloadStartedAt);
      win.webContents.send('download-complete', { type: isAudio ? 'clip-audio' : 'clip', url, status: 'Success', filePath: finalPath });
      if (settings.autoOpenFolder && finalPath) {
        openFolderOrRevealItem(finalPath);
      }
    }
    else win.webContents.send('download-error', `[CLIP ${isAudio ? 'AUDIO' : 'VIDEO'}] Download failed with code ${code}`);
  });
});

// Video Divider Helpers & Handlers
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

function probeLocalVideo(filePath, headers = null) {
  if (!filePath) {
    return Promise.resolve({
      duration: 0,
      width: 0,
      height: 0,
      vcodec: 'Unknown',
      fps: 0,
      acodec: 'None',
      filename: '',
      size: 0,
      filePath: ''
    });
  }

  const isRemote = filePath.startsWith('http://') || filePath.startsWith('https://');
  let cacheKey = filePath;
  let currentMtime = 0;
  let currentSize = 0;

  if (!isRemote) {
    try {
      const stat = fs.statSync(filePath);
      currentMtime = stat.mtimeMs;
      currentSize = stat.size;
      cacheKey = `${filePath}:${currentMtime}:${currentSize}`;
    } catch (e) {
      cacheKey = filePath;
    }
  }

  // Check LRU cache
  const cached = probeMetadataCache.get(cacheKey);
  if (cached) {
    return Promise.resolve(cached);
  }

  // Check if identical probe is already in-flight
  if (inFlightProbes.has(cacheKey)) {
    return inFlightProbes.get(cacheKey);
  }

  const probePromise = new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const args = [];
    if (headers && headers.length > 0) {
      args.push('-headers', headers.join('\r\n') + '\r\n');
    }
    args.push('-i', filePath);
    const proc = spawn(ffmpegPath, args);
    registerProcess(proc, { isYtDlp: false });

    let settled = false;
    let stderr = '';

    const emptyMeta = () => ({
      duration: 0,
      width: 0,
      height: 0,
      vcodec: 'Unknown',
      fps: 0,
      acodec: 'None',
      filename: path.basename(filePath || ''),
      size: currentSize,
      filePath
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimeout);
      inFlightProbes.delete(cacheKey);
      probeMetadataCache.set(cacheKey, result);
      resolve(result);
    };

    const killTimeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        try { proc.kill(); } catch (e2) {}
      }
      finish(emptyMeta());
    }, 4000);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
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

      let size = currentSize;
      if (!size && !isRemote) {
        try {
          size = fs.statSync(filePath).size;
        } catch (e) {}
      }

      finish({
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
      inFlightProbes.delete(cacheKey);
      if (settled) return;
      settled = true;
      clearTimeout(killTimeout);
      reject(err);
    });
  });

  inFlightProbes.set(cacheKey, probePromise);
  return probePromise;
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
    registerProcess(proc, { isYtDlp: false });
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
  if (isYtDlpSwitchInProgress(win, 'download-error')) return;

  const baseDir = settings.downloadDir || app.getPath('downloads');
  const sourcesDir = path.join(baseDir, 'yt-divided', 'sources');
  
  if (!fs.existsSync(sourcesDir)) {
    fs.mkdirSync(sourcesDir, { recursive: true });
  }

  const outPath = path.join(sourcesDir, '%(title)s.%(ext)s');
  const args = await buildVideoDownloadArgs({ url, quality, outPath });

  win.webContents.send('download-status', `[DIVIDER IMPORT] Starting source download for ${url}...`);
  
  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  const ytProcess = spawn(ytDlpPath, args);
  registerYtDlpProcess(ytProcess);
  const throttledProgress = createThrottledProgressSender(win, 'download-progress', 50);
  let finalPath = '';

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    throttledProgress.push(text);
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

  ytProcess.stderr.on('data', (data) => throttledProgress.push(data.toString()));
  
  ytProcess.on('close', async (code) => {
    throttledProgress.flush();
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
        args: ['-y', '-i', inputPath, '-ss', options.startTimeStr, '-to', options.endTimeStr, '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'aac', outputPath],
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
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:0:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.right) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_right${ext}`);
        jobs.push({
          label: 'Spatial Split: Right',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw/2:ih:iw/2:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.top) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_top${ext}`);
        jobs.push({
          label: 'Spatial Split: Top',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:0', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
          outputPath,
          duration: meta.duration
        });
      }
      if (options.bottom) {
        const outputPath = path.join(outputDir, `${sanitizedBase}_bottom${ext}`);
        jobs.push({
          label: 'Spatial Split: Bottom',
          args: ['-y', '-i', inputPath, '-vf', 'crop=iw:ih/2:0:ih/2', '-c:v', 'libx264', '-preset', 'faster', '-threads', '0', '-crf', '18', '-c:a', 'copy', outputPath],
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
      openFolderOrRevealItem(outputDir);
    }
  } catch (err) {
    console.error('Divide error:', err);
    win.webContents.send('divide-error', err.message || 'An error occurred during division.');
  }
});

// ==========================================
// Music Finder Tab Logic
// ==========================================

function secondsToHHMMSS(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) {
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  }
  return [m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function isSameTrack(track1, track2) {
  if (!track1 || !track2) return false;
  
  if (track1.recordingId && track2.recordingId) {
    return track1.recordingId === track2.recordingId;
  }
  
  const normalize = str => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(track1.title) === normalize(track2.title) &&
         normalize(track1.artist) === normalize(track2.artist);
}

function extractTrackInfo(apiResponse) {
  if (apiResponse.status !== 'ok' || !apiResponse.results || apiResponse.results.length === 0) {
    return null;
  }
  
  const results = [...apiResponse.results].sort((a, b) => b.score - a.score);
  
  for (const match of results) {
    if (match.recordings && match.recordings.length > 0) {
      const recording = match.recordings.find(r => r.title && r.artists && r.artists.length > 0) || match.recordings[0];
      const title = recording.title || 'Unknown Title';
      const artist = recording.artists && recording.artists.length > 0
        ? recording.artists.map(a => a.name).join(', ')
        : 'Unknown Artist';
      
      const releaseGroup = recording.releasegroups && recording.releasegroups.length > 0
        ? recording.releasegroups[0]
        : null;
        
      const album = releaseGroup ? releaseGroup.title : '';
      const releaseGroupId = releaseGroup ? releaseGroup.id : '';
      const coverUrl = releaseGroupId ? `https://coverartarchive.org/release-group/${releaseGroupId}/front-250` : '';
      
      return {
        title,
        artist,
        album,
        coverUrl,
        recordingId: recording.id
      };
    }
  }
  return null;
}

function generateAcrcloudSignature(method, uri, accessKey, accessSecret, dataType, timestamp) {
  const crypto = require('crypto');
  const signatureVersion = "1";
  const stringToSign = `${method}\n${uri}\n${accessKey}\n${dataType}\n${signatureVersion}\n${timestamp}`;
  return crypto
    .createHmac('sha1', accessSecret)
    .update(stringToSign)
    .digest('base64');
}

function extractAcrcloudTrackInfo(apiResponse) {
  if (!apiResponse.status || apiResponse.status.code !== 0 || !apiResponse.metadata || !apiResponse.metadata.music || apiResponse.metadata.music.length === 0) {
    return null;
  }
  
  const musicList = [...apiResponse.metadata.music].sort((a, b) => b.score - a.score);
  const bestMatch = musicList[0];
  
  const title = bestMatch.title || 'Unknown Title';
  const artist = bestMatch.artists && bestMatch.artists.length > 0
    ? bestMatch.artists.map(a => a.name).join(', ')
    : 'Unknown Artist';
  const album = bestMatch.album ? bestMatch.album.name : '';
  
  let coverUrl = '';
  if (bestMatch.external_metadata && bestMatch.external_metadata.spotify && bestMatch.external_metadata.spotify.track && bestMatch.external_metadata.spotify.track.album) {
    const spAlbum = bestMatch.external_metadata.spotify.track.album;
    if (spAlbum.images && spAlbum.images.length > 0) {
      coverUrl = spAlbum.images[0].url;
    }
  }
  
  return {
    title,
    artist,
    album,
    coverUrl,
    recordingId: bestMatch.acrid
  };
}

function runFpcalc(filePath) {
  return new Promise((resolve, reject) => {
    const fpcalcPath = getFpcalcPath();
    const proc = spawn(fpcalcPath, [filePath]);
    registerProcess(proc, { isYtDlp: false });
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());
    
    proc.on('close', (code) => {
      if (code === 0) {
        const fingerprintMatch = stdout.match(/^FINGERPRINT=(.+)$/m);
        const durationMatch = stdout.match(/^DURATION=(.+)$/m);
        
        if (fingerprintMatch) {
          resolve({
            fingerprint: fingerprintMatch[1].trim(),
            duration: durationMatch ? parseFloat(durationMatch[1].trim()) : 12
          });
        } else {
          reject(new Error('No fingerprint found in fpcalc output'));
        }
      } else {
        reject(new Error(`fpcalc failed with code ${code}: ${stderr}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

function cleanupDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        fs.unlinkSync(path.join(dirPath, file));
      }
      fs.rmdirSync(dirPath);
    }
  } catch (err) {
    console.error('Failed to cleanup temp directory:', err);
  }
}

async function performLocalFileRecognition(inputPath, win) {
  const tempDir = path.join(app.getPath('temp'), `yt-music-finder-${Date.now()}`);
  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`File does not exist: ${inputPath}`);
    }

    // 1. Verify AcoustID API Key
    const clientKey = settings.acoustidKey || '';
    if (!clientKey || clientKey === 'YOUR_CLIENT_API_KEY' || clientKey === 'YOUR_ACOUSTID_CLIENT_KEY' || clientKey.trim() === '') {
      throw new Error('AcoustID Client API Key is missing. Please go to the Settings tab, obtain a free key from acoustid.org, and save it to enable the Music Finder.');
    }

    // 2. Verify fpcalc utility presence
    const fpcalcPath = getFpcalcPath();
    if (fpcalcPath === 'fpcalc') {
      const globalFpcalcAvailable = await isCommandInPath('fpcalc');
      if (!globalFpcalcAvailable) {
        throw new Error('Chromaprint fingerprint utility (fpcalc) is not installed. Please restart the app to trigger environment setup and download the required binary.');
      }
    }

    win.webContents.send('scan-status', 'Probing file duration...');
    win.webContents.send('scan-progress', 5);
    
    const meta = await probeLocalVideo(inputPath);
    const duration = meta.duration;
    if (!duration || duration <= 0) {
      throw new Error('Could not determine audio/video file duration. The file format may be unsupported.');
    }

    win.webContents.send('scan-status', `File loaded. Duration: ${Math.round(duration)}s. Creating slices...`);
    win.webContents.send('scan-progress', 10);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const service = settings.musicFinderService || 'acoustid';
    if (service === 'acoustid') {
      if (!settings.acoustidKey) {
        throw new Error('AcoustID Client API Key is not configured. Please add it in the Settings tab.');
      }
    } else if (service === 'acrcloud') {
      if (!settings.acrcloudKey || !settings.acrcloudSecret) {
        throw new Error('ACRCloud credentials are not configured. Please verify your Access Key and Access Secret in the Settings tab.');
      }
    }

    const scanInterval = settings.acoustidScanInterval || 90;
    const sliceLen = Math.min(30, Math.floor(duration));
    const slicePoints = [];
    for (let t = 0; t + sliceLen <= duration; t += scanInterval) {
      slicePoints.push(t);
    }
    if (slicePoints.length === 0 && duration > 0) {
      slicePoints.push(0);
    }

    win.webContents.send('scan-status', `Scanning at ${slicePoints.length} interval(s) across the track...`);

    const ffmpeg = fluentFfmpeg || require('fluent-ffmpeg');
    ffmpeg.setFfmpegPath(getFfmpegPath());

    const allResults = [];

    for (let i = 0; i < slicePoints.length; i++) {
      const startTime = slicePoints[i];
      const slicePath = path.join(tempDir, `slice_${i}.wav`);
      
      const percentage = Math.round(10 + (i / slicePoints.length) * 80);
      win.webContents.send('scan-progress', percentage);
      win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Slicing audio at ${secondsToHHMMSS(startTime)}...`);

      try {
        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(inputPath)
            .seekInput(startTime)
            .duration(sliceLen)
            .noVideo()
            .audioChannels(1)
            .audioFrequency(16000)
            .on('start', () => {
              if (cmd && cmd.ffmpegProc) {
                registerProcess(cmd.ffmpegProc, { isYtDlp: false });
              }
            })
            .on('end', () => resolve())
            .on('error', (err) => reject(new Error(`FFmpeg slice failed: ${err.message}`)));
          cmd.save(slicePath);
        });
      } catch (err) {
        throw new Error(`Failed to extract audio slice at ${secondsToHHMMSS(startTime)}: ${err.message}`);
      }

      let track = null;

      if (service === 'acoustid') {
        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Fingerprinting clip locally...`);
        let fpData;
        try {
          fpData = await runFpcalc(slicePath);
        } catch (err) {
          throw new Error(`Fingerprinting utility (fpcalc) failed to process clip at ${secondsToHHMMSS(startTime)}: ${err.message}`);
        }

        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Querying AcoustID database...`);
        const clientKey = settings.acoustidKey;
        let response;
        try {
          response = await fetch(`https://api.acoustid.org/v2/lookup?client=${clientKey}&meta=recordings+releasegroups&duration=${Math.round(duration)}&fingerprint=${encodeURIComponent(fpData.fingerprint)}`);
        } catch (err) {
          throw new Error(`Network error: Failed to connect to AcoustID service. Please check your internet connection and try again.`);
        }

        if (!response.ok) {
          if (response.status === 400 || response.status === 403) {
            throw new Error('Invalid AcoustID API Key. Please verify your Client API Key in the Settings tab.');
          }
          throw new Error(`AcoustID lookup failed with server status ${response.status}.`);
        }

        let apiData;
        try {
          apiData = await response.json();
        } catch (err) {
          throw new Error('Failed to parse AcoustID response metadata.');
        }

        if (apiData.error) {
          if (apiData.error.message && apiData.error.message.includes('invalid client')) {
            throw new Error('Invalid AcoustID API Key. Please verify your Client API Key in the Settings tab.');
          }
          throw new Error(`AcoustID API Error: ${apiData.error.message || 'Unknown error'}`);
        }

        track = extractTrackInfo(apiData);

      } else if (service === 'acrcloud') {
        win.webContents.send('scan-status', `[${i+1}/${slicePoints.length}] Querying ACRCloud database...`);
        const accessKey = settings.acrcloudKey;
        const accessSecret = settings.acrcloudSecret;
        const host = settings.acrcloudHost || 'identify-us-west-2.acrcloud.com';
        
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signature = generateAcrcloudSignature('POST', '/v1/identify', accessKey, accessSecret, 'audio', timestamp);
        
        let fileBuffer;
        try {
          fileBuffer = fs.readFileSync(slicePath);
        } catch (err) {
          throw new Error(`Failed to read slice audio data: ${err.message}`);
        }
        
        const fileBlob = new Blob([fileBuffer], { type: 'audio/wav' });
        
        const formData = new FormData();
        formData.append('sample', fileBlob, 'slice.wav');
        formData.append('access_key', accessKey);
        formData.append('data_type', 'audio');
        formData.append('signature_version', '1');
        formData.append('timestamp', timestamp);
        formData.append('signature', signature);
        formData.append('sample_bytes', fileBuffer.length.toString());
        
        let response;
        try {
          response = await fetch(`https://${host}/v1/identify`, {
            method: 'POST',
            body: formData
          });
        } catch (err) {
          throw new Error(`Network error: Failed to connect to ACRCloud service. Please check your internet connection and try again.`);
        }
        
        if (!response.ok) {
          throw new Error(`ACRCloud lookup failed with server status ${response.status}.`);
        }
        
        let apiData;
        try {
          apiData = await response.json();
        } catch (err) {
          throw new Error('Failed to parse ACRCloud response metadata.');
        }
        
        if (apiData.status) {
          const code = apiData.status.code;
          if (code === 3001 || code === 3003 || code === 3015) {
            throw new Error(`Invalid ACRCloud Access Key or Access Secret. Please verify your credentials in Settings.`);
          } else if (code !== 0 && code !== 1001) {
            throw new Error(`ACRCloud API Error: ${apiData.status.msg || 'Unknown error'} (Code ${code})`);
          }
        }
        
        track = extractAcrcloudTrackInfo(apiData);
      }

      allResults.push({
        timestamp: startTime,
        timestampStr: secondsToHHMMSS(startTime),
        track: track
      });

      if (i < slicePoints.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }

    win.webContents.send('scan-status', 'Aggregating results and cleaning up...');
    win.webContents.send('scan-progress', 95);

    const filteredResults = [];
    let lastTrack = null;

    for (const res of allResults) {
      if (res.track) {
        if (!lastTrack || !isSameTrack(lastTrack, res.track)) {
          filteredResults.push(res);
          lastTrack = res.track;
        }
      } else {
        lastTrack = null;
      }
    }

    win.webContents.send('scan-progress', 100);
    win.webContents.send('scan-status', `Scanning complete. Found ${filteredResults.length} song(s).`);
    win.webContents.send('scan-complete', filteredResults);

  } catch (err) {
    console.error('Scan local file error:', err);
    win.webContents.send('scan-error', err.message || 'An error occurred during file scanning.');
  } finally {
    cleanupDirectory(tempDir);
  }
}

ipcMain.handle('select-audio-video-file', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Audio/Video Files', extensions: ['mp3', 'wav', 'm4a', 'flac', 'mp4', 'mkv', 'mov'] }
    ],
    title: 'Select Audio or Video File'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.on('scan-local-file', async (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await performLocalFileRecognition(filePath, win);
});

ipcMain.on('scan-youtube-url', async (event, url) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (isYtDlpSwitchInProgress(win, 'scan-error')) return;

  win.webContents.send('scan-status', 'Downloading audio track from YouTube...');
  win.webContents.send('scan-progress', 2);
  
  const cacheDir = path.join(app.getPath('temp'), 'yt-music-finder-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  
  const tempOutPattern = path.join(cacheDir, `temp_scan_${Date.now()}.%(ext)s`);
  const args = [
    '-f', 'bestaudio',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '-o', tempOutPattern,
    '--no-mtime'
  ];
  if (fs.existsSync(localFfmpeg)) {
    args.push('--ffmpeg-location', localBinDir);
  }
  args.push(url);
  const finalArgs = await appendYtDlpCookieArgs(args);

  const ytDlpPath = getYtDlpPath();
  const downloadStartedAt = Date.now();
  
  const ytProcess = spawn(ytDlpPath, finalArgs);
  registerYtDlpProcess(ytProcess);
  let finalPath = '';
  let stderrData = '';
  let hasSentError = false;

  ytProcess.on('error', (err) => {
    if (hasSentError) return;
    hasSentError = true;
    win.webContents.send('scan-error', `Failed to start YouTube audio downloader: ${err.message}`);
  });

  ytProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  ytProcess.stdout.on('data', (data) => {
    const text = data.toString();
    const percentMatch = text.match(/\[download\]\s+([0-9.]+)%/);
    if (percentMatch) {
      const percentage = parseFloat(percentMatch[1]);
      const scaled = Math.round(2 + (percentage / 100) * 8); // Scaled from 2% to 10%
      win.webContents.send('scan-progress', scaled);
    }
  });

  ytProcess.on('close', async (code) => {
    if (hasSentError) return;
    if (code === 0) {
      finalPath = resolveFinalDownloadPath('', cacheDir, downloadStartedAt);
      if (finalPath && fs.existsSync(finalPath)) {
        win.webContents.send('scan-status', 'Audio download completed. Commencing recognition loop...');
        await performLocalFileRecognition(finalPath, win);
        try {
          fs.unlinkSync(finalPath);
        } catch (e) {
          console.error('Failed to delete cached audio file:', e);
        }
      } else {
        hasSentError = true;
        win.webContents.send('scan-error', 'Failed to locate the downloaded audio file.');
      }
    } else {
      hasSentError = true;
      const errMsg = stderrData.trim();
      const lines = errMsg.split('\n').map(l => l.trim()).filter(Boolean);
      const errorLines = lines.filter(l => l.toLowerCase().includes('error:'));
      const cleanMsg = errorLines.length > 0 ? errorLines.join('\n') : (lines.slice(-2).join('\n') || `Exit code ${code}`);
      win.webContents.send('scan-error', `Audio download failed: ${cleanMsg}`);
    }
  });
});

const MEDIA_EXTENSIONS = ['.mp4', '.mkv', '.mp3', '.aac', '.m3u8', '.mpd', '.webm', '.wav', '.ogg'];
const MEDIA_MIME_TYPES = ['video/', 'audio/', 'application/x-mpegurl', 'application/vnd.apple.mpegurl', 'application/dash+xml'];

function isMedia(urlStr, contentType) {
  if (!urlStr) return false;
  
  const qIdx = urlStr.indexOf('?');
  const hIdx = urlStr.indexOf('#');
  let endIdx = urlStr.length;
  if (qIdx !== -1) endIdx = qIdx;
  if (hIdx !== -1 && hIdx < endIdx) endIdx = hIdx;
  const cleanUrl = urlStr.slice(0, endIdx).toLowerCase();

  if (cleanUrl.endsWith('.ts') || cleanUrl.endsWith('.ts/')) {
    return false;
  }
  
  for (let i = 0; i < MEDIA_EXTENSIONS.length; i++) {
    if (cleanUrl.endsWith(MEDIA_EXTENSIONS[i])) return true;
  }
  
  if (contentType) {
    const cType = contentType.toLowerCase();
    if (cType.includes('video/mp2t')) {
      return false;
    }
    for (let i = 0; i < MEDIA_MIME_TYPES.length; i++) {
      if (cType.includes(MEDIA_MIME_TYPES[i])) return true;
    }
  }
  
  return false;
}

ipcMain.on('browser-view-init', (event, bounds) => {
  const win = BrowserWindow.fromWebContents(event.sender);

  if (guestBrowserView && guestBrowserHooksVersion < GUEST_BROWSER_HOOKS_VERSION) {
    try {
      win.contentView.removeChildView(guestBrowserView);
      guestBrowserView.webContents.close();
    } catch (e) {}
    guestBrowserView = null;
  }

  if (!guestBrowserView) {
    guestBrowserView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        allowRunningInsecureContent: true,
        autoplayPolicy: 'no-user-gesture-required'
      }
    });
    
    guestBrowserView.webContents.setUserAgent(BROWSER_USER_AGENT);
    guestBrowserView.webContents.session.setUserAgent(BROWSER_USER_AGENT);
    
    win.contentView.addChildView(guestBrowserView);
    
    // Set permission request handler for media and fullscreen support
    guestBrowserView.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowed = ['media', 'geolocation', 'notifications', 'fullscreen', 'pointerLock'];
      callback(allowed.includes(permission));
    });
    
    // Handle target="_blank" and window.open links by navigating in the same view
    guestBrowserView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        guestBrowserView.webContents.loadURL(url);
      }
      return { action: 'deny' };
    });
    
    guestBrowserView.webContents.loadURL('https://www.google.com');
    
    const sendNav = (url) => {
      if (!win.isDestroyed()) {
        win.webContents.send('browser-navigate', url);
      }
    };
    guestBrowserView.webContents.on('did-navigate', (e, url) => sendNav(url));
    guestBrowserView.webContents.on('did-navigate-in-page', (e, url) => sendNav(url));
    
    const session = guestBrowserView.webContents.session;

    registerGuestEmbedProxy(session);
    setupGuestNetworkHooks(guestBrowserView.webContents);
    startEmbedIframeHydration(guestBrowserView.webContents);
    
    session.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
      const requestHeaders = applyGuestBrowserHeaders(details, { ...details.requestHeaders });
      callback({ requestHeaders });
    });

    session.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      
      // Remove blocking headers to allow embeds and standard playback
      const headersToRemove = [
        'x-frame-options',
        'content-security-policy',
        'cross-origin-resource-policy',
        'cross-origin-embedder-policy',
        'cross-origin-opener-policy'
      ];
      for (const key of Object.keys(responseHeaders)) {
        if (headersToRemove.includes(key.toLowerCase())) {
          delete responseHeaders[key];
        }
      }

      // Let cross-origin embed iframes send a full Referer (Chromium default strips it).
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        responseHeaders['Referrer-Policy'] = ['unsafe-url'];
      }

      // Determine requesting origin for CORS dynamically to avoid credentials/wildcard conflicts
      const requestOrigin = resolveGuestRequestOrigin(details);

      responseHeaders['Access-Control-Allow-Origin'] = [requestOrigin];
      responseHeaders['Access-Control-Allow-Headers'] = ['Range, Content-Range, Content-Length, Accept, Origin, Referer, Content-Type, Authorization'];
      responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
      if (requestOrigin !== '*') {
        responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
      }
      responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length, Content-Range, Accept-Ranges'];

      // Inspect content-type for sniffer
      let contentType = '';
      for (const key of Object.keys(responseHeaders)) {
        if (key.toLowerCase() === 'content-type') {
          contentType = responseHeaders[key][0];
          break;
        }
      }

      const url = details.url;
      if (isMedia(url, contentType)) {
        const cleanBaseUrl = url.split('?')[0];
        if (!detectedMediaUrlCache.has(cleanBaseUrl)) {
          detectedMediaUrlCache.set(cleanBaseUrl, true);
          if (!win.isDestroyed()) {
            // Send immediately to UI
            const pageUrl = getGuestPageUrl();
            win.webContents.send('media-detected', {
              url: url,
              title: guestBrowserView.webContents.getTitle() || 'Media Stream',
              contentType: contentType,
              pageUrl: pageUrl
            });

            if (!inFlightMediaProbes.has(cleanBaseUrl)) {
              inFlightMediaProbes.add(cleanBaseUrl);
              const headers = buildStreamRequestHeaders(pageUrl);

              probeLocalVideo(url, headers).then(meta => {
                inFlightMediaProbes.delete(cleanBaseUrl);
                if (!win.isDestroyed()) {
                  win.webContents.send('media-probed', {
                    url: url,
                    width: meta.width || 0,
                    height: meta.height || 0,
                    duration: meta.duration || 0,
                    vcodec: meta.vcodec || 'Unknown',
                    fps: meta.fps || 0
                  });
                }
              }).catch(err => {
                inFlightMediaProbes.delete(cleanBaseUrl);
                console.log('Background stream probe failed:', err.message);
              });
            }
          }
        }
      }
      callback({ cancel: false, responseHeaders: responseHeaders });
    });

    guestBrowserHooksVersion = GUEST_BROWSER_HOOKS_VERSION;
  }

  guestBrowserView.setBounds(bounds);
});

ipcMain.on('browser-view-load', (event, url) => {
  if (guestBrowserView) {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
    guestBrowserView.webContents.loadURL(targetUrl).catch(err => {
      console.error('Failed to load url:', err);
    });
  }
});

ipcMain.handle('browser-clear-data', async () => {
  if (guestBrowserView) {
    try {
      const ses = guestBrowserView.webContents.session;
      await ses.clearStorageData();
      await ses.clearCache();
      return true;
    } catch (err) {
      console.error('Failed to clear browser storage/cache data:', err);
      return false;
    }
  }
  return false;
});

function getGifOutputPath(inputPath) {
  const baseDir = settings.downloadDir || app.getPath('downloads');
  const gifOutputDir = path.join(baseDir, 'gif-exports');
  if (!fs.existsSync(gifOutputDir)) {
    fs.mkdirSync(gifOutputDir, { recursive: true });
  }
  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  const timestamp = Date.now();
  return path.join(gifOutputDir, `${sanitized}_${timestamp}.gif`);
}

ipcMain.handle('convert-video-to-gif', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { inputPath, fps, width, startTime, endTime } = payload;
  
  try {
    const outputPath = getGifOutputPath(inputPath);
    const duration = endTime - startTime;
    let scaleWidth = width;
    if (width === 'Original' || !width) {
      scaleWidth = 'iw';
    }
    
    const ffmpegPath = getFfmpegPath();
    const args = [
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${scaleWidth}:-1:flags=bicubic,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
      '-threads', '0',
      '-y',
      outputPath
    ];

    console.log(`[GIF Conversion] Spawning: ${ffmpegPath} ${args.join(' ')}`);
    
    return new Promise((resolve) => {
      const proc = spawn(ffmpegPath, args, {
        windowsHide: true
      });
      registerProcess(proc, { isYtDlp: false });
      
      let stderr = '';
      let lastProgress = -1;
      
      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        
        const progress = parseFfmpegProgress(text, duration);
        if (progress !== null) {
          const rounded = Math.min(100, Math.max(0, Math.round(progress)));
          if (rounded !== lastProgress) {
            lastProgress = rounded;
            win.webContents.send('gif-progress', rounded);
          }
        }
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          const result = { success: true, outputPath };
          win.webContents.send('gif-finished', result);
          resolve(result);
        } else {
          console.error(`ffmpeg failed with code ${code}. Stderr: ${stderr}`);
          const errorMsg = `FFmpeg process exited with code ${code}. Stderr: ${stderr.slice(-300)}`;
          const result = { success: false, error: errorMsg };
          win.webContents.send('gif-finished', result);
          resolve(result);
        }
      });
      
      proc.on('error', (err) => {
        console.error('ffmpeg spawn error:', err);
        const errorMsg = `Failed to spawn FFmpeg: ${err.message}`;
        const result = { success: false, error: errorMsg };
        win.webContents.send('gif-finished', result);
        resolve(result);
      });
    });
  } catch (err) {
    console.error('GIF conversion error:', err);
    const result = { success: false, error: err.message };
    win.webContents.send('gif-finished', result);
    return result;
  }
});

ipcMain.on('browser-view-control', (event, action) => {
  if (guestBrowserView) {
    if (action === 'back' && guestBrowserView.webContents.canGoBack()) {
      guestBrowserView.webContents.goBack();
    } else if (action === 'forward' && guestBrowserView.webContents.canGoForward()) {
      guestBrowserView.webContents.goForward();
    } else if (action === 'reload') {
      guestBrowserView.webContents.reload();
    }
  }
});

ipcMain.on('browser-view-resize', (event, bounds) => {
  if (guestBrowserView) {
    guestBrowserView.setBounds(bounds);
  }
});

ipcMain.on('browser-view-hide', () => {
  if (guestBrowserView) {
    guestBrowserView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
});

ipcMain.on('download-media-stream', async (event, { url, title, contentType, pageUrl }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const baseDir = settings.downloadDir || app.getPath('downloads');
  
  const isAudioOnly = contentType && contentType.toLowerCase().startsWith('audio/');
  const subFolder = isAudioOnly ? 'yt-audios' : 'yt-videos';
  const targetDir = path.join(baseDir, subFolder);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let cleanTitle = sanitizeFilename(title || 'stream_download');
  let ext = isAudioOnly ? '.mp3' : '.mp4';
  
  if (url.includes('.m3u8')) {
    ext = isAudioOnly ? '.mp3' : '.mp4';
  } else {
    const cleanUrlPath = url.split('?')[0].split('#')[0];
    const urlExt = path.extname(cleanUrlPath);
    if (urlExt && urlExt.length <= 5) {
      ext = urlExt;
    }
  }
  
  let baseOut = path.join(targetDir, cleanTitle);
  let count = 0;
  let outputPath = `${baseOut}${ext}`;
  while (fs.existsSync(outputPath)) {
    count++;
    outputPath = `${baseOut}_${count}${ext}`;
  }

  win.webContents.send('download-status', `[STREAM] Starting direct FFmpeg download...`);
  
  const ffmpegPath = getFfmpegPath();
  
  const headers = buildStreamRequestHeaders(pageUrl);

  const args = [
    '-y',
    '-headers', headers.join('\r\n') + '\r\n',
    '-i', url,
    '-c', 'copy',
    outputPath
  ];
  
  const downloadStartedAt = Date.now();
  
  let totalDuration = 0;
  try {
    const meta = await probeLocalVideo(url, headers);
    totalDuration = meta.duration || 0;
  } catch (err) {
    console.log('Stream probe failed (normal for live/some hosts):', err.message);
  }

  let proc;
  try {
    proc = spawn(ffmpegPath, args);
    registerProcess(proc, { isYtDlp: false });
  } catch (err) {
    win.webContents.send('download-error', `[STREAM] FFmpeg failed to start: ${err.message}`);
    return;
  }
  
  let stderr = '';
  
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    
    if (totalDuration > 0) {
      const progress = parseFfmpegProgress(text, totalDuration);
      if (progress !== null) {
        win.webContents.send('download-progress', `[download]  ${Math.round(progress)}% of stream`);
      }
    } else {
      const match = text.match(/time=\s*(\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        win.webContents.send('download-progress', `[download]  Copied ${match[1]}:${match[2]}:${match[3]} of media`);
      }
    }
  });

  proc.on('close', (code) => {
    if (code === 0) {
      win.webContents.send('download-complete', {
        type: isAudioOnly ? 'stream-audio' : 'stream-video',
        url: url,
        status: 'Success',
        filePath: outputPath
      });
      if (settings.autoOpenFolder) {
        openFolderOrRevealItem(outputPath);
      }
    } else {
      win.webContents.send('download-error', `[STREAM] FFmpeg copy failed with code ${code}.\nStderr: ${stderr.slice(-200)}`);
    }
  });

  proc.on('error', (err) => {
    win.webContents.send('download-error', `[STREAM] FFmpeg failed to start: ${err.message}`);
  });
});

