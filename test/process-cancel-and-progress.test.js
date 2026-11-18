'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');

const { rootDir } = require('./helpers/source');

// The main-process modules destructure electron / spawn helpers at load time. Load them with
// a stubbed electron and a recording child_process so no real process is ever touched.
const execCalls = [];
const spawnSyncCalls = [];
let registry;
let progress;

before(() => {
  const realLoad = Module._load;
  const realChildProcess = require('node:child_process');
  Module._load = function patched(request, ...rest) {
    if (request === 'electron') return {};
    if (request === 'child_process') {
      return {
        ...realChildProcess,
        exec: (cmd, opts, cb) => { execCalls.push(cmd); if (typeof opts === 'function') opts(); else if (cb) cb(); },
        spawnSync: (cmd, args) => { spawnSyncCalls.push([cmd, ...(args || [])]); return { status: 0 }; }
      };
    }
    return realLoad.call(this, request, ...rest);
  };
  try {
    registry = require(path.join(rootDir, 'src/main/process-registry.js'));
    progress = require(path.join(rootDir, 'src/main/progress.js'));
  } finally {
    Module._load = realLoad;
  }
});

class FakeProc extends EventEmitter {
  constructor() {
    super();
    this.killed = false;
  }
  kill() {
    if (this.killed) return;
    this.killed = true;
    this.emit('close', null, 'SIGKILL');
  }
}

function fakeWin() {
  const sent = [];
  return {
    sent,
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push([channel, payload]) }
  };
}

function channels(win) {
  return win.sent.map(([channel]) => channel);
}

function resetRegistry() {
  registry.activeProcesses.clear();
  registry.activeYtDlpProcesses.clear();
  execCalls.length = 0;
  spawnSyncCalls.length = 0;
}

describe('process registry groups and selective cancel', () => {
  test('group defaults: yt-dlp -> download, non yt-dlp -> other, explicit group wins', () => {
    resetRegistry();
    const ytDefault = new FakeProc();
    const ffmpegDefault = new FakeProc();
    const probe = new FakeProc();
    registry.registerYtDlpProcess(ytDefault);
    registry.registerProcess(ffmpegDefault, { isYtDlp: false });
    registry.registerYtDlpProcess(probe, { group: 'probe' });
    assert.strictEqual(registry.activeProcesses.size, 3);
    assert.strictEqual(registry.activeYtDlpProcesses.size, 2);

    return registry.stopAllBlockingTasks(fakeWin(), 'test', { groups: ['probe'] }).then(() => {
      assert.ok(probe.killed, 'probe group killed');
      assert.ok(!ytDefault.killed, 'download group untouched');
      assert.ok(!ffmpegDefault.killed, 'other group untouched');
    });
  });

  test('user cancel kills only download/divide groups, skips the global taskkill, leaves scan/gif/probe alone', async () => {
    resetRegistry();
    const dl = new FakeProc();
    const divide = new FakeProc();
    const scan = new FakeProc();
    const gif = new FakeProc();
    const probe = new FakeProc();
    const other = new FakeProc();
    registry.registerYtDlpProcess(dl, { group: 'download' });
    registry.registerProcess(divide, { isYtDlp: false, group: 'divide' });
    registry.registerYtDlpProcess(scan, { group: 'scan' });
    registry.registerProcess(gif, { isYtDlp: false, group: 'gif' });
    registry.registerYtDlpProcess(probe, { group: 'probe' });
    registry.registerProcess(other, { isYtDlp: false });

    const win = fakeWin();
    await registry.stopAllBlockingTasks(win, 'user cancelled download', {
      groups: registry.DOWNLOAD_CANCEL_GROUPS,
      alwaysNotify: ['download']
    });

    assert.deepStrictEqual(registry.DOWNLOAD_CANCEL_GROUPS, ['download', 'divide']);
    assert.ok(dl.killed && divide.killed);
    assert.ok(!scan.killed && !gif.killed && !probe.killed && !other.killed);
    assert.ok(!execCalls.some((cmd) => /\/IM yt-dlp\.exe/.test(cmd)), 'no system-wide taskkill on user cancel');
    const sent = channels(win);
    assert.ok(sent.includes('download-error'));
    assert.ok(sent.includes('divide-error'));
    assert.ok(!sent.includes('scan-error'));
    assert.ok(!sent.includes('gif-finished'));
    assert.ok(registry.wasProcessStopped(dl));
    assert.ok(!registry.wasProcessStopped(scan));
  });

  test('user cancel with nothing running still resets the download UI but nothing else', async () => {
    resetRegistry();
    const win = fakeWin();
    await registry.stopAllBlockingTasks(win, 'user cancelled download', {
      groups: ['download', 'divide'],
      alwaysNotify: ['download']
    });
    assert.deepStrictEqual(channels(win), ['download-error']);
  });

  test('two-argument call (channel switch / force update) kills every yt-dlp process plus same-task helpers', async () => {
    resetRegistry();
    const dl = new FakeProc();
    const scanYt = new FakeProc();
    const scanFfmpeg = new FakeProc();
    const probe = new FakeProc();
    const unrelatedFfmpeg = new FakeProc();
    const gifFfmpeg = new FakeProc();
    registry.registerYtDlpProcess(dl);
    registry.registerYtDlpProcess(scanYt, { group: 'scan' });
    registry.registerProcess(scanFfmpeg, { isYtDlp: false, group: 'scan' });
    registry.registerYtDlpProcess(probe, { group: 'probe' });
    registry.registerProcess(unrelatedFfmpeg, { isYtDlp: false });
    registry.registerProcess(gifFfmpeg, { isYtDlp: false, group: 'gif' });

    const win = fakeWin();
    await registry.stopAllBlockingTasks(win, 'switching yt-dlp to nightly channel');

    assert.ok(dl.killed && scanYt.killed && scanFfmpeg.killed && probe.killed);
    assert.ok(!unrelatedFfmpeg.killed, 'unrelated ffmpeg survives');
    assert.ok(!gifFfmpeg.killed, 'gif ffmpeg survives (no yt-dlp process in its group)');
    if (process.platform === 'win32') {
      assert.ok(execCalls.some((cmd) => /taskkill \/F \/IM yt-dlp\.exe/.test(cmd)), 'default path keeps stray yt-dlp.exe cleanup');
    }
    const sent = channels(win);
    assert.ok(sent.includes('download-error'));
    assert.ok(sent.includes('scan-error'));
    assert.ok(!sent.includes('divide-error'));
    assert.ok(!sent.includes('gif-finished'));
  });

  test('default path sends nothing when nothing was running', async () => {
    resetRegistry();
    const win = fakeWin();
    await registry.stopAllBlockingTasks(win, 'force updating yt-dlp');
    assert.deepStrictEqual(channels(win), []);
  });

  test('killAllRegisteredProcessesSync stops every registered child once and never uses /IM', () => {
    resetRegistry();
    const a = new FakeProc();
    const b = new FakeProc();
    registry.registerYtDlpProcess(a);
    registry.registerProcess(b, { isYtDlp: false, group: 'gif' });
    registry.killAllRegisteredProcessesSync();
    registry.killAllRegisteredProcessesSync();
    assert.ok(a.killed && b.killed);
    assert.ok(registry.wasProcessStopped(a));
    assert.ok(!spawnSyncCalls.some((call) => call.includes('/IM')));
    assert.ok(!execCalls.some((cmd) => /\/IM/.test(cmd)));
  });
});

describe('throttled progress sender', () => {
  function makeSender(intervalMs = 30) {
    const win = fakeWin();
    const sender = progress.createThrottledProgressSender(win, 'download-progress', intervalMs);
    const got = () => win.sent.map(([, payload]) => payload);
    return { sender, got };
  }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  test('push + flush delivers a chunk exactly once', () => {
    const { sender, got } = makeSender();
    sender.push('[download]  10.0% of 5MiB');
    sender.flush();
    sender.flush();
    assert.deepStrictEqual(got(), ['[download]  10.0% of 5MiB']);
  });

  test('a burst of progress lines coalesces to the latest, with no duplicates', async () => {
    const { sender, got } = makeSender();
    for (let i = 1; i <= 4; i++) sender.push(`[download]  ${i}.0% of 5MiB`);
    sender.flush();
    await wait(80);
    assert.deepStrictEqual(got(), ['[download]  1.0% of 5MiB', '[download]  4.0% of 5MiB']);
  });

  test('non-progress lines inside the throttle window are delivered in order', async () => {
    const { sender, got } = makeSender();
    sender.push('[download]  1.0% of 5MiB');
    sender.push('[download]  2.0% of 5MiB');
    sender.push('WARNING: something odd');
    sender.push('[download] Destination: C:\\videos\\a.mp4');
    sender.push('[download]  3.0% of 5MiB');
    sender.push('[download]  4.0% of 5MiB');
    sender.push('ERROR: Unable to download');
    sender.flush();
    await wait(80);
    assert.deepStrictEqual(got(), [
      '[download]  1.0% of 5MiB',
      '[download]  2.0% of 5MiB',
      'WARNING: something odd',
      '[download] Destination: C:\\videos\\a.mp4',
      '[download]  4.0% of 5MiB',
      'ERROR: Unable to download'
    ]);
  });

  test('pending output is sent by the timer once, and flush afterwards is a no-op', async () => {
    const { sender, got } = makeSender();
    sender.push('[download]  1.0% of 5MiB');
    sender.push('Deleting original file x');
    await wait(80);
    sender.flush();
    assert.deepStrictEqual(got(), ['[download]  1.0% of 5MiB', 'Deleting original file x']);
  });

  test('isPureProgressChunk only matches percentage updates', () => {
    assert.ok(progress.isPureProgressChunk('[download]  45.2% of ~  85.40MiB at 4.25MiB/s ETA 00:11'));
    assert.ok(progress.isPureProgressChunk('[download]   1.0% of 5MiB\r[download]   2.0% of 5MiB'));
    assert.ok(!progress.isPureProgressChunk('[download] Destination: a.mp4'));
    assert.ok(!progress.isPureProgressChunk('[download]  1.0% of 5MiB\nERROR: boom'));
    assert.ok(!progress.isPureProgressChunk('[Merger] Merging formats into "a.mp4"'));
    assert.ok(!progress.isPureProgressChunk(''));
  });
});

describe('cancel / quit / renderer source contracts', () => {
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

  test('cancel-download passes the cancel groups and always resets the download UI', () => {
    const src = read('src/main/downloads.js');
    assert.match(src, /DOWNLOAD_CANCEL_GROUPS\s*=\s*\['download',\s*'divide'\]/);
    assert.match(src, /stopAllBlockingTasks\(win,\s*'user cancelled download',\s*\{[\s\S]*?groups:\s*DOWNLOAD_CANCEL_GROUPS[\s\S]*?alwaysNotify:\s*\['download'\]/);
  });

  test('close handlers no longer report "failed with code null" for killed children', () => {
    const downloads = read('src/main/downloads.js');
    const clipper = read('src/main/clipper.js');
    assert.doesNotMatch(downloads, /safeSend\(win,\s*'download-error',\s*`\[(VIDEO|AUDIO|SUBS)\] Download failed with code/);
    assert.match(downloads, /function reportAbnormalDownloadExit/);
    assert.match(clipper, /reportAbnormalDownloadExit/);
  });

  test('main.js kills registered children on quit', () => {
    const src = read('main.js');
    assert.match(src, /killAllRegisteredProcessesSync/);
    assert.match(src, /app\.on\('before-quit'[\s\S]*?stopChildProcessesOnQuit/);
    assert.match(src, /app\.on\('will-quit'/);
    assert.match(src, /app\.on\('window-all-closed'[\s\S]*?stopChildProcessesOnQuit/);
  });

  test('renderer: beginMediaDownload claims the slot before awaiting, stray download-error is ignored', () => {
    const src = read('renderer/download.js');
    const fn = src.match(/export async function beginMediaDownload[\s\S]*?\r?\n\}\r?\n/);
    assert.ok(fn, 'beginMediaDownload not found');
    const body = fn[0];
    assert.ok(body.indexOf('state.isDownloading = true') > -1);
    assert.ok(body.indexOf('state.isDownloading = true') < body.indexOf('await window.electronAPI.probePlaylist'),
      'slot must be claimed before the first await');
    assert.match(src, /onDownloadError\(\(error\) => \{[\s\S]*?if \(!state\.isDownloading\)[\s\S]*?return;/);
    assert.match(src, /\$\{escapeHtml\(error\)\}/);
    assert.doesNotMatch(src, /\$\{error\}/);
  });

  test('renderer: thumbnail bindings are abortable and recents escape external text', () => {
    const src = read('renderer/recents.js');
    assert.match(src, /new WeakMap\(\)/);
    assert.match(src, /new AbortController\(\)/);
    const listeners = src.match(/dragEl\.addEventListener\([\s\S]*?\{ signal \}\);/g) || [];
    assert.strictEqual(listeners.length, 4, 'all four thumbnail listeners must use the abort signal');
    assert.match(src, /escapeHtml\(itemUrl\)/);
    assert.doesNotMatch(src, /\$\{item\.(url|type|date)/);
  });
});
