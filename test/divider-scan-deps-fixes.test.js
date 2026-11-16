'use strict';

// Behavioural tests for the Divider / Music Finder / dependency fixes.
// The main-process modules are loaded against a stubbed `electron`, `child_process.spawn`
// and `https.get`, so no real binaries, windows or network are involved.

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const childProcess = require('node:child_process');
const https = require('node:https');

const rootDir = path.resolve(__dirname, '..');

// ---- stubs ---------------------------------------------------------------------------

const ipcHandlers = { on: {}, handle: {} };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-gui-test-'));

const electronStub = {
  app: { getPath: () => tmpRoot },
  BrowserWindow: { fromWebContents: (wc) => wc.win },
  ipcMain: {
    on: (channel, fn) => { ipcHandlers.on[channel] = fn; },
    handle: (channel, fn) => { ipcHandlers.handle[channel] = fn; }
  },
  dialog: {},
  shell: {}
};

let spawnImpl = () => { throw new Error('spawn stub not configured'); };
const realSpawn = childProcess.spawn;
const realHttpsGet = https.get;
let httpsGetImpl = () => { throw new Error('https.get stub not configured'); };

function makeFakeProc({ stderr = '', stdout = '', code = 0, autoClose = true } = {}) {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => { proc.killed = true; return true; };
  if (autoClose) {
    setImmediate(() => {
      if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', code);
    });
  }
  return proc;
}

const ctx = require('../src/main/ctx');
let divider;
let deps;
let scan;

before(() => {
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return electronStub;
    return origLoad.call(this, request, ...rest);
  };
  childProcess.spawn = (...args) => spawnImpl(...args);
  https.get = (...args) => httpsGetImpl(...args);
  try {
    ctx.settings = { downloadDir: tmpRoot, autoOpenFolder: false };
    ctx.probeMetadataCache = new Map();
    ctx.inFlightProbes = new Map();
    ctx.registerProcess = () => {};
    ctx.registerYtDlpProcess = () => {};
    ctx.wasProcessStopped = () => false;
    ctx.getFfmpegPath = () => 'ffmpeg';
    ctx.localFfmpeg = path.join(tmpRoot, 'no-such-ffmpeg.exe');
    ctx.safeSend = () => {};
    divider = require('../src/main/divider');
    deps = require('../src/main/deps');
    scan = require('../src/main/scan');
  } finally {
    Module._load = origLoad;
  }
});

after(() => {
  childProcess.spawn = realSpawn;
  https.get = realHttpsGet;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
});

// ---- Bug 8: sanitizeFilename ----------------------------------------------------------

describe('sanitizeFilename', () => {
  test('keeps ASCII names that were already valid', () => {
    assert.strictEqual(divider.sanitizeFilename('my_video-01'), 'my_video-01');
  });

  test('keeps letters and digits of every script', () => {
    assert.strictEqual(divider.sanitizeFilename('Türkçe şarkı 2'), 'Türkçe şarkı 2');
    assert.strictEqual(divider.sanitizeFilename('日本語のビデオ'), '日本語のビデオ');
    assert.strictEqual(divider.sanitizeFilename('Привет мир'), 'Привет мир');
  });

  test('different non-ASCII titles no longer collide', () => {
    assert.notStrictEqual(divider.sanitizeFilename('日本語'), divider.sanitizeFilename('中文字'));
  });

  test('replaces characters that are invalid in file names', () => {
    assert.strictEqual(divider.sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.strictEqual(divider.sanitizeFilename('a\u0000b\u001fc'), 'a_b_c');
    assert.strictEqual(divider.sanitizeFilename('100%'), '100_');
  });

  test('trims trailing dots and spaces and neutralises leading dots', () => {
    assert.strictEqual(divider.sanitizeFilename('name. . '), 'name');
    assert.strictEqual(divider.sanitizeFilename('..hidden'), '__hidden');
  });

  test('avoids reserved Windows device names', () => {
    assert.strictEqual(divider.sanitizeFilename('CON'), '_CON');
    assert.strictEqual(divider.sanitizeFilename('nul.v2'), '_nul.v2');
    assert.strictEqual(divider.sanitizeFilename('console'), 'console');
  });

  test('caps the length by code points and falls back when empty', () => {
    assert.strictEqual(Array.from(divider.sanitizeFilename('x'.repeat(300))).length, 100);
    assert.strictEqual(Array.from(divider.sanitizeFilename('😀'.repeat(300))).length, 100);
    assert.strictEqual(divider.sanitizeFilename(''), 'untitled');
    assert.strictEqual(divider.sanitizeFilename(null), 'untitled');
    assert.strictEqual(divider.sanitizeFilename('...', 'gif'), 'gif');
  });
});

// ---- Bug 2: re-encode container -------------------------------------------------------

describe('Divider output extensions', () => {
  test('getReencodeExtension keeps only H.264-capable containers', () => {
    for (const ext of ['.mp4', '.mov', '.m4v', '.mkv']) {
      assert.strictEqual(divider.getReencodeExtension(ext), ext);
    }
    assert.strictEqual(divider.getReencodeExtension('.MKV'), '.MKV');
    for (const ext of ['.webm', '.avi', '.flv', '.mpv', '']) {
      assert.strictEqual(divider.getReencodeExtension(ext), '.mp4');
    }
  });

  async function runDivide(inputPath, mode, options, closeCode = 0) {
    const sent = [];
    const spawned = [];
    ctx.safeSend = (win, channel, payload) => sent.push({ channel, payload });
    spawnImpl = (cmd, args) => {
      spawned.push(args);
      return makeFakeProc({ code: closeCode });
    };
    const win = { isDestroyed: () => false, webContents: { send() {} } };
    const event = { sender: { win } };
    await ipcHandlers.on['divide-video'](event, { inputPath, mode, options });
    return { sent, spawned };
  }

  const timeOptions = { startTimeStr: '00:00:01.000', endTimeStr: '00:00:05.000', startTimeSeconds: 1, endTimeSeconds: 5 };

  test('precise cut of a .webm input is written as .mp4', async () => {
    const { sent, spawned } = await runDivide(path.join(tmpRoot, 'clip one.webm'), 'precise', timeOptions);
    const out = spawned[0][spawned[0].length - 1];
    assert.ok(out.endsWith('_precise_cut.mp4'), out);
    const complete = sent.find(s => s.channel === 'divide-complete');
    assert.ok(complete, 'divide-complete must be sent');
    assert.deepStrictEqual(complete.payload.filePaths, [out]);
  });

  test('precise cut of a .mkv input keeps .mkv', async () => {
    const { spawned } = await runDivide(path.join(tmpRoot, 'clip.mkv'), 'precise', timeOptions);
    assert.ok(spawned[0][spawned[0].length - 1].endsWith('_precise_cut.mkv'));
  });

  test('fast (stream copy) cut keeps the original extension', async () => {
    const { spawned } = await runDivide(path.join(tmpRoot, 'clip.webm'), 'fast', timeOptions);
    const args = spawned[0];
    assert.ok(args[args.length - 1].endsWith('_fast_cut.webm'));
    assert.ok(args.includes('copy'));
  });

  test('spatial crops of a .webm input are .mp4 with AAC audio', async () => {
    const { sent, spawned } = await runDivide(path.join(tmpRoot, 'wide.webm'), 'spatial', { left: true, right: true, top: false, bottom: true });
    const jobArgs = spawned.filter(a => a.includes('-vf'));
    assert.strictEqual(jobArgs.length, 3);
    for (const args of jobArgs) {
      assert.ok(args[args.length - 1].endsWith('.mp4'), args[args.length - 1]);
      assert.strictEqual(args[args.indexOf('-c:a') + 1], 'aac');
    }
    const complete = sent.find(s => s.channel === 'divide-complete');
    assert.ok(complete.payload.filePaths.every(f => f.endsWith('.mp4')));
  });

  test('chunk segmentation (stream copy) keeps the original extension', async () => {
    const { spawned } = await runDivide(path.join(tmpRoot, 'long.webm'), 'chunks', { segmentTimeSeconds: 60 });
    const segmentArgs = spawned.find(a => a.includes('segment'));
    assert.ok(segmentArgs[segmentArgs.length - 1].endsWith('part%03d.webm'));
  });

  test('a killed ffmpeg (exit code null) is reported as a clean cancellation', async () => {
    const { sent } = await runDivide(path.join(tmpRoot, 'cancel.mp4'), 'precise', timeOptions, null);
    const err = sent.find(s => s.channel === 'divide-error');
    assert.ok(err, 'divide-error must be sent');
    assert.strictEqual(err.payload, 'Division cancelled.');
    assert.ok(!/code null/.test(err.payload));
  });
});

// ---- Bug 3: probe caching -------------------------------------------------------------

describe('probeLocalVideo caching', () => {
  const GOOD_STDERR = [
    'Input #0, matroska,webm, from \'x\':',
    '  Duration: 00:01:00.50, start: 0.000000, bitrate: 1000 kb/s',
    '  Stream #0:0: Video: vp9, yuv420p, 1920x1080, 30 fps',
    '  Stream #0:1: Audio: opus, 48000 Hz, stereo'
  ].join('\n');

  test('a probe that returns no usable metadata is not cached', async () => {
    let spawns = 0;
    spawnImpl = () => { spawns++; return makeFakeProc({ stderr: 'garbage' }); };
    const file = path.join(tmpRoot, 'missing-a.webm');
    const first = await divider.probeLocalVideo(file);
    assert.strictEqual(first.duration, 0);
    await divider.probeLocalVideo(file);
    assert.strictEqual(spawns, 2, 'empty result must be re-probed');
  });

  test('a timed-out probe is not cached', async () => {
    let spawns = 0;
    let lastProc;
    spawnImpl = () => { spawns++; lastProc = makeFakeProc({ autoClose: false }); return lastProc; };
    const file = path.join(tmpRoot, 'missing-b.webm');
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const pending = divider.probeLocalVideo(file);
      mock.timers.tick(4000);
      const result = await pending;
      assert.strictEqual(result.duration, 0);
      assert.ok(lastProc.killed, 'timed-out probe must be killed');
    } finally {
      mock.timers.reset();
    }
    spawnImpl = () => { spawns++; return makeFakeProc({ stderr: GOOD_STDERR }); };
    const retry = await divider.probeLocalVideo(file);
    assert.strictEqual(spawns, 2, 'timed-out probe must be retried');
    assert.strictEqual(retry.duration, 60.5);
  });

  test('a successful probe is cached', async () => {
    let spawns = 0;
    spawnImpl = () => { spawns++; return makeFakeProc({ stderr: GOOD_STDERR }); };
    const file = path.join(tmpRoot, 'missing-c.webm');
    const first = await divider.probeLocalVideo(file);
    const second = await divider.probeLocalVideo(file);
    assert.strictEqual(spawns, 1);
    assert.strictEqual(first.width, 1920);
    assert.strictEqual(first.vcodec, 'vp9');
    assert.strictEqual(first.acodec, 'opus');
    assert.strictEqual(second, first);
  });
});

// ---- Bug 4: version flag --------------------------------------------------------------

describe('isCommandInPath', () => {
  test('uses -version for ffmpeg, ffprobe and fpcalc and --version for yt-dlp', async () => {
    const seen = {};
    spawnImpl = (cmd, args) => { seen[cmd] = args[0]; return makeFakeProc({ code: 0 }); };
    for (const cmd of ['ffmpeg', 'ffprobe', 'fpcalc', 'yt-dlp']) {
      assert.strictEqual(await deps.isCommandInPath(cmd), true);
    }
    assert.deepStrictEqual(seen, {
      ffmpeg: '-version',
      ffprobe: '-version',
      fpcalc: '-version',
      'yt-dlp': '--version'
    });
  });

  test('a missing binary resolves false', async () => {
    spawnImpl = () => {
      const proc = makeFakeProc({ autoClose: false });
      setImmediate(() => proc.emit('error', new Error('ENOENT')));
      return proc;
    };
    assert.strictEqual(await deps.isCommandInPath('fpcalc'), false);
  });

  test('a non-zero exit resolves false', async () => {
    spawnImpl = () => makeFakeProc({ code: 2 });
    assert.strictEqual(await deps.isCommandInPath('fpcalc'), false);
  });
});

// ---- Bug 5: FFmpeg version parsing / downgrade protection -----------------------------

describe('FFmpeg version parsing and downgrade protection', () => {
  test('parseVersionParts handles release, tag and nightly strings', () => {
    assert.deepStrictEqual(deps.parseVersionParts('7.1'), [7, 1]);
    assert.deepStrictEqual(deps.parseVersionParts('n7.1'), [7, 1]);
    assert.deepStrictEqual(deps.parseVersionParts('N7.1.2'), [7, 1, 2]);
    assert.deepStrictEqual(deps.parseVersionParts('v6.1.1'), [6, 1, 1]);
    assert.deepStrictEqual(deps.parseVersionParts('6.1-full_build'), [6, 1]);
    assert.deepStrictEqual(deps.parseVersionParts('N-118193-gabcdef'), []);
    assert.deepStrictEqual(deps.parseVersionParts(''), []);
    assert.deepStrictEqual(deps.parseVersionParts(null), []);
  });

  test('compareVersions understands tag-style versions', () => {
    assert.strictEqual(deps.compareVersions('n7.1', '6.1'), 1);
    assert.strictEqual(deps.compareVersions('v6.1.1', '6.1'), 1);
    assert.strictEqual(deps.compareVersions('6.1-full_build', 'v6.1'), 0);
    assert.strictEqual(deps.compareVersions('n6.0', '6.1'), -1);
  });

  test('isComparableVersion is false for nightly builds', () => {
    assert.strictEqual(deps.isComparableVersion('N-118193-gabcdef'), false);
    assert.strictEqual(deps.isComparableVersion(''), false);
    assert.strictEqual(deps.isComparableVersion('n7.1'), true);
  });

  function installFfmpegVersionOutput(versionLine) {
    const downloads = [];
    spawnImpl = () => makeFakeProc({ stdout: `ffmpeg version ${versionLine} Copyright (c) 2000-2025 the FFmpeg developers\n` });
    httpsGetImpl = (url) => {
      downloads.push(String(url));
      const req = new EventEmitter();
      req.destroy = () => {};
      setImmediate(() => req.emit('error', new Error('offline')));
      return req;
    };
    return downloads;
  }

  test('a nightly (unparseable) installed build is kept and never replaced', async () => {
    const requests = installFfmpegVersionOutput('N-118193-gabcdef1234');
    const res = await deps.checkFfmpegUpdate(null, { force: false, silent: true });
    assert.strictEqual(res.status, 'up-to-date');
    assert.strictEqual(res.version, 'N-118193-gabcdef1234');
    assert.ok(requests.every(u => u.includes('api.github.com')), `unexpected download: ${requests}`);
  });

  test('a newer installed release is kept', async () => {
    const requests = installFfmpegVersionOutput('n7.1');
    const res = await deps.checkFfmpegUpdate(null, { force: false, silent: true });
    assert.strictEqual(res.status, 'up-to-date');
    assert.ok(requests.every(u => u.includes('api.github.com')), `unexpected download: ${requests}`);
  });
});

// ---- Bug 1: Music Finder per-service validation --------------------------------------

describe('Music Finder service prerequisites', () => {
  async function recognise(settings, { fpcalcInPath = false } = {}) {
    const sent = [];
    const win = { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } };
    ctx.settings = { downloadDir: tmpRoot, ...settings };
    ctx.getFpcalcPath = () => 'fpcalc';
    ctx.isCommandInPath = async () => fpcalcInPath;
    // Stop right after validation: an unreadable duration is a distinct, later error.
    ctx.probeLocalVideo = async () => ({ duration: 0 });
    await scan.performLocalFileRecognition(__filename, win);
    const err = sent.find(s => s.channel === 'scan-error');
    return err ? String(err.payload) : '';
  }

  test('ACRCloud works without an AcoustID key or fpcalc', async () => {
    const msg = await recognise({ musicFinderService: 'acrcloud', acrcloudKey: 'k', acrcloudSecret: 's', acoustidKey: '' });
    assert.match(msg, /Could not determine audio\/video file duration/);
    assert.doesNotMatch(msg, /AcoustID|fpcalc/);
  });

  test('ACRCloud without credentials reports only ACRCloud', async () => {
    const msg = await recognise({ musicFinderService: 'acrcloud', acrcloudKey: '', acrcloudSecret: '' });
    assert.match(msg, /ACRCloud credentials are not configured/);
    assert.doesNotMatch(msg, /AcoustID/);
  });

  test('AcoustID still requires its API key', async () => {
    const msg = await recognise({ musicFinderService: 'acoustid', acoustidKey: '  ' });
    assert.match(msg, /AcoustID Client API Key is missing/);
  });

  test('AcoustID still requires fpcalc', async () => {
    const msg = await recognise({ musicFinderService: 'acoustid', acoustidKey: 'abc123' }, { fpcalcInPath: false });
    assert.match(msg, /fpcalc/);
  });

  test('AcoustID with key and fpcalc passes validation', async () => {
    const msg = await recognise({ musicFinderService: 'acoustid', acoustidKey: 'abc123' }, { fpcalcInPath: true });
    assert.match(msg, /Could not determine audio\/video file duration/);
  });

  test('AcoustID lookup URL encodes every query value', () => {
    const url = scan.buildAcoustidLookupUrl('key&x=1 #', 29.6, 'AQAA+/=_-');
    assert.ok(url.startsWith('https://api.acoustid.org/v2/lookup?'));
    const query = url.split('?')[1];
    assert.strictEqual(query.split('&').length, 4, 'no value may inject extra parameters');
    assert.match(query, /client=key%26x%3D1%20%23&/);
    assert.match(query, /&meta=recordings\+releasegroups&/);
    assert.match(query, /&duration=29\.6&/);
    assert.match(query, /fingerprint=AQAA%2B%2F%3D_-$/);
  });
});

// ---- Source-level checks for the renderer side (ES modules cannot be required here) ----

describe('renderer hardening', () => {
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

  test('scan.js ignores scan-error while no scan is running', () => {
    const src = read('renderer/scan.js');
    assert.match(src, /onScanError\(\(error\) => \{\s*(?:\/\/[^\n]*\n\s*)*if \(!isScanningMusic\) return;/);
  });

  test('divider.js ignores divide-error while idle but still resets when dividing or importing', () => {
    const src = read('renderer/divider.js');
    assert.match(src, /onDivideError\(\(error\) => \{[\s\S]*?if \(!isDividing && !\(isDividerImporting && state\.isDownloading\)\) return;/);
  });

  test('external text is escaped before it reaches innerHTML', () => {
    const scanSrc = read('renderer/scan.js');
    const dividerSrc = read('renderer/divider.js');
    assert.match(scanSrc, /import \{ escapeHtml, safeHttpUrl \} from '\.\/html\.js'/);
    for (const field of ['title', 'artist', 'album']) {
      assert.match(scanSrc, new RegExp(`\\$\\{escapeHtml\\(track\\.${field}\\)\\}`));
      assert.doesNotMatch(scanSrc, new RegExp(`\\$\\{track\\.${field}\\}`));
    }
    assert.doesNotMatch(scanSrc, /src="\$\{track\.coverUrl\}"/);
    assert.match(scanSrc, /safeHttpUrl\(track\.coverUrl\)/);
    assert.match(dividerSrc, /\$\{escapeHtml\(error\)\}/);
    assert.doesNotMatch(dividerSrc, /\$\{error\}/);
  });

  test('Music Finder no-match text follows the selected service', () => {
    const src = read('renderer/scan.js');
    assert.match(src, /getActiveServiceLabel\(\)/);
    assert.doesNotMatch(src, /AcoustID database did not find matches/);
  });
});

// ---- Bug 7: process group tags --------------------------------------------------------

describe('process group tags', () => {
  const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

  test('divider, scan and gif tag their processes', () => {
    const dividerSrc = read('src/main/divider.js');
    assert.match(dividerSrc, /isYtDlp: false, group: 'probe'/);
    assert.match(dividerSrc, /isYtDlp: false, group: 'divide'/);
    assert.match(dividerSrc, /registerYtDlpProcess\(ytProcess, \{ group: 'divide' \}\)/);
    const scanSrc = read('src/main/scan.js');
    assert.strictEqual((scanSrc.match(/isYtDlp: false, group: 'scan'/g) || []).length, 2);
    assert.match(scanSrc, /registerYtDlpProcess\(ytProcess, \{ group: 'scan' \}\)/);
    assert.match(read('src/main/gif.js'), /isYtDlp: false, group: 'gif'/);
  });
});
