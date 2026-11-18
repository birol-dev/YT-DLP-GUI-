'use strict';
// Compress tab — main-process backend: IPC, ffmpeg runs, capabilities, queue, preview,
// presets and automation. Pure option/arg logic lives in compressor-helpers.js.
// Contract: docs/compress-spec.md (section 4).

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const ctx = require('./ctx');
const helpers = require('./compressor-helpers');

const WORK_DIR = path.join(os.tmpdir(), 'yt-dlp-gui-compress');
const PREVIEW_DIR = path.join(WORK_DIR, 'previews');
const WATCH_VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.flv', '.ts']);

// ---------------------------------------------------------------------------------------------
// Window messaging
// ---------------------------------------------------------------------------------------------

function sendToAll(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(channel, payload);
    } catch (e) { /* window went away mid-send */ }
  }
}

function log(message) {
  sendToAll('compress-log', String(message));
}

function logCommand(ffmpegPath, args) {
  const quoted = args.map((a) => (/\s/.test(a) && !a.startsWith('-') ? `"${a}"` : a));
  log(`[ffmpeg] ${ffmpegPath} ${quoted.join(' ')}`);
}

// ---------------------------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------------------------

function ffmpegPath() {
  return typeof ctx.getFfmpegPath === 'function' ? ctx.getFfmpegPath() : 'ffmpeg';
}

function spawnFfmpeg(args, { group = 'compress' } = {}) {
  const proc = spawn(ffmpegPath(), args, { windowsHide: true });
  if (typeof ctx.registerProcess === 'function') {
    ctx.registerProcess(proc, { isYtDlp: false, group });
  }
  return proc;
}

// Collects stdout/stderr from a short-lived command with a hard timeout.
function runShortCommand(args, { timeoutMs = 15000, group = 'probe' } = {}) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnFfmpeg(args, { group });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err && err.message), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (typeof ctx.killProcessTree === 'function') ctx.killProcessTree(proc).catch(() => {});
      else try { proc.kill('SIGKILL'); } catch (e) {}
      finish(-1);
    }, timeoutMs);
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      stderr += String(err && err.message);
      finish(-1);
    });
    proc.on('close', (code) => finish(code === null ? -1 : code));
  });
}

// ---------------------------------------------------------------------------------------------
// Capabilities (cached; {refresh:true} re-detects)
// ---------------------------------------------------------------------------------------------

let capabilitiesCache = null;
let capabilitiesInFlight = null;

function summarizeVersion(stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  const m = text.match(/ffmpeg version\s+([^\s]+)/);
  return m ? m[1] : (text.split(/\r?\n/)[0] || '').trim();
}

// A hardware encoder can be listed yet fail to open (no GPU, no driver). Only a real encode counts.
function verifyEncoder(name) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawnFfmpeg([
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30',
        '-t', '0.3', '-pix_fmt', 'yuv420p', '-c:v', name, '-f', 'null', helpers.nullOutputPath()
      ]);
    } catch (e) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      if (typeof ctx.killProcessTree === 'function') ctx.killProcessTree(proc).catch(() => {});
      else try { proc.kill('SIGKILL'); } catch (e) {}
      finish(false);
    }, 6000);
    proc.on('error', () => finish(false));
    proc.on('close', (code) => finish(code === 0));
  });
}

async function detectCapabilities() {
  const [versionRes, encodersRes, filtersRes] = await Promise.all([
    runShortCommand(['-hide_banner', '-version'], { timeoutMs: 15000 }),
    runShortCommand(['-hide_banner', '-encoders'], { timeoutMs: 15000 }),
    runShortCommand(['-hide_banner', '-filters'], { timeoutMs: 15000 })
  ]);

  const encoderNames = new Set(helpers.parseEncodersList(encodersRes.stdout));
  const filterNames = new Set(helpers.parseFiltersList(filtersRes.stdout));

  // Verify every listed hardware candidate in parallel (each with its own 6 s budget).
  const hardwareCandidates = [];
  for (const codec of helpers.CODECS) {
    for (const name of helpers.ENCODER_CANDIDATES[codec]) {
      if (helpers.isHardwareEncoder(name) && encoderNames.has(name)) hardwareCandidates.push(name);
    }
  }
  const verified = new Map();
  await Promise.all(hardwareCandidates.map(async (name) => {
    verified.set(name, await verifyEncoder(name));
  }));

  const codecs = { h264: [], hevc: [], av1: [], vp9: [] };
  for (const codec of helpers.CODECS) {
    const software = [];
    const gpu = [];
    for (const name of helpers.ENCODER_CANDIDATES[codec]) {
      if (!encoderNames.has(name)) continue;
      const hardware = helpers.isHardwareEncoder(name);
      if (hardware && !verified.get(name)) continue;
      const enc = {
        name,
        label: helpers.ENCODER_LABELS[name] || name,
        hardware,
        twoPass: helpers.isTwoPassEncoder(name)
      };
      (hardware ? gpu : software).push(enc);
    }
    codecs[codec] = [...software, ...gpu];
  }

  const autoEncoder = {};
  for (const codec of helpers.CODECS) autoEncoder[codec] = helpers.pickAutoEncoder(codec, { codecs });

  const gpu = {};
  for (const family of helpers.AUTO_GPU_ORDER) {
    gpu[family] = hardwareCandidates.some((name) => verified.get(name) && helpers.gpuFamily(name) === family);
  }

  return {
    ffmpegPath: ffmpegPath(),
    ffmpegVersion: summarizeVersion(versionRes.stdout, versionRes.stderr),
    codecs,
    autoEncoder,
    gpu,
    features: {
      subtitlesBurn: filterNames.has('subtitles') && filterNames.has('ass'),
      loudnorm: filterNames.has('loudnorm'),
      opus: encoderNames.has('libopus'),
      mp3: encoderNames.has('libmp3lame')
    }
  };
}

function getCapabilities({ refresh = false } = {}) {
  if (refresh) {
    capabilitiesCache = null;
    capabilitiesInFlight = null;
  }
  if (capabilitiesCache) return Promise.resolve(capabilitiesCache);
  if (!capabilitiesInFlight) {
    capabilitiesInFlight = detectCapabilities()
      .then((caps) => {
        const found = caps && caps.codecs && Object.values(caps.codecs).some((list) => Array.isArray(list) && list.length > 0);
        capabilitiesCache = found ? caps : null;
        capabilitiesInFlight = null;
        return caps;
      })
      .catch((err) => {
        capabilitiesInFlight = null;
        throw err;
      });
  }
  return capabilitiesInFlight;
}

// ---------------------------------------------------------------------------------------------
// Probe (cached by path + mtime + size)
// ---------------------------------------------------------------------------------------------

const probeCache = new Map(); // key -> ProbeInfo
const probeInFlight = new Map(); // key -> Promise
const PROBE_CACHE_LIMIT = 200;

function statSignature(filePath) {
  try {
    const st = fs.statSync(filePath);
    return { key: `${filePath}:${st.mtimeMs}:${st.size}`, size: st.size };
  } catch (e) {
    return { key: filePath, size: 0 };
  }
}

function probeFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return Promise.reject(new Error('Invalid input path.'));
  if (!fs.existsSync(filePath)) return Promise.reject(new Error('That file does not exist.'));
  const sig = statSignature(filePath);
  const cached = probeCache.get(sig.key);
  if (cached) return Promise.resolve({ ...cached });
  if (probeInFlight.has(sig.key)) return probeInFlight.get(sig.key);

  const promise = runShortCommand(['-hide_banner', '-i', filePath], { timeoutMs: 10000, group: 'probe' })
    .then((res) => {
      if (res.code !== 0 && !res.stderr) {
        throw new Error('FFmpeg could not read this file.');
      }
      const info = helpers.parseProbeOutput(res.stderr, filePath, sig.size);
      // Only cache when ffmpeg actually reported something useful.
      if (info.duration > 0 || info.hasVideo || info.audioTracks.length > 0 || info.container) {
        probeCache.set(sig.key, info);
        if (probeCache.size > PROBE_CACHE_LIMIT) {
          const oldest = probeCache.keys().next().value;
          if (oldest !== undefined) probeCache.delete(oldest);
        }
      }
      probeInFlight.delete(sig.key);
      return info;
    })
    .catch((err) => {
      probeInFlight.delete(sig.key);
      throw err;
    });
  probeInFlight.set(sig.key, promise);
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Crop detection (cropdetect on short samples spread over the file)
// ---------------------------------------------------------------------------------------------

function parseCropValues(text) {
  const values = [];
  const re = /crop=(\d+):(\d+):(\d+):(\d+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    values.push({ width: Number(m[1]), height: Number(m[2]), x: Number(m[3]), y: Number(m[4]) });
  }
  return values;
}

async function detectCrop(filePath) {
  const probe = await probeFile(filePath);
  const duration = probe.duration || 0;
  const samples = [];
  if (duration > 2) {
    for (let i = 0; i < 5; i++) {
      const t = Math.max(0, Math.min(duration - 1, duration * (0.1 + 0.2 * i)));
      samples.push(t);
    }
  } else {
    samples.push(0);
  }

  const results = await Promise.all(samples.map(async (start) => {
    const args = [
      '-hide_banner', '-loglevel', 'info',
      '-ss', Number(start).toFixed(3), '-i', filePath, '-t', '1',
      '-vf', 'cropdetect=limit=24:round=2', '-f', 'null', helpers.nullOutputPath()
    ];
    const res = await runShortCommand(args, { timeoutMs: 20000, group: 'probe' });
    const values = parseCropValues(res.stderr);
    return values.length > 0 ? values[values.length - 1] : null;
  }));

  const valid = results.filter((c) => c && c.width > 1 && c.height > 1);
  if (valid.length === 0 || !probe.width || !probe.height) {
    return { top: 0, bottom: 0, left: 0, right: 0, width: probe.width || 0, height: probe.height || 0 };
  }

  // Most common crop wins; ties break toward the biggest area.
  const counts = new Map();
  for (const c of valid) {
    const key = `${c.width}:${c.height}:${c.x}:${c.y}`;
    const entry = counts.get(key) || { crop: c, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best = null;
  for (const entry of counts.values()) {
    if (!best) { best = entry; continue; }
    const area = entry.crop.width * entry.crop.height;
    const bestArea = best.crop.width * best.crop.height;
    if (entry.count > best.count || (entry.count === best.count && area > bestArea)) best = entry;
  }

  const c = best.crop;
  const top = Math.max(0, c.y);
  const left = Math.max(0, c.x);
  const bottom = Math.max(0, (probe.height - c.height) - top);
  const right = Math.max(0, (probe.width - c.width) - left);
  return { top, bottom, left, right, width: c.width, height: c.height };
}

// ---------------------------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------------------------

const jobs = [];
const jobState = new Map(); // id -> internal run state
const reservedPaths = new Set();
let jobCounter = 0;
let runningJobId = null;
let pumping = false;
let queueEmitTimer = null;
let lastQueueEmit = 0;

function nextJobId() {
  jobCounter += 1;
  return `cmp_${Date.now()}_${jobCounter}`;
}

// Files this tab wrote (lower-cased absolute paths); the watch folder ignores them whatever their name.
const producedOutputs = new Set();
// Automatic sources (download hook, watch folder) dedupe on path + mtime + size across both.
const autoSeen = new Map();

function autoSignature(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return '';
  }
}

// Internal per-job run state, reset whenever a job (re)starts.
function freshJobState(rawOptions) {
  return {
    rawOptions: rawOptions || {},
    finalPath: null,
    probe: null,
    resolved: null,
    options: null,
    currentProc: null,
    cancelRequested: false,
    passes: 1,
    partialPath: null,
    duration: 0,
    progressOffset: 0,
    videoKbps: 0,
    audioKbps: 0,
    targetBytes: 0,
    passlogfile: null
  };
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    inputPath: job.inputPath,
    filename: job.filename,
    outputPath: job.outputPath || null,
    status: job.status,
    source: job.source,
    presetId: job.presetId || null,
    summary: job.summary || '',
    pass: job.pass || 0,
    passes: job.passes || 1,
    percent: Math.max(0, Math.min(100, Math.round(job.percent || 0))),
    fps: job.fps || 0,
    speed: job.speed || 0,
    etaSeconds: job.etaSeconds || 0,
    inputSize: job.inputSize || 0,
    outputSize: job.outputSize || 0,
    startedAt: job.startedAt || 0,
    finishedAt: job.finishedAt || 0,
    error: job.error || '',
    warnings: Array.isArray(job.warnings) ? job.warnings.slice() : [],
    encoder: job.encoder || '',
    attempt: job.attempt || 1,
    sourceStart: job.sourceStart || 0,
    speedFactor: job.speedFactor || 1
  };
}

function queueSnapshot() {
  return jobs.map((job) => publicJob(job));
}

function emitQueue(force = false) {
  const now = Date.now();
  if (force) {
    if (queueEmitTimer) {
      clearTimeout(queueEmitTimer);
      queueEmitTimer = null;
    }
    lastQueueEmit = now;
    sendToAll('compress-queue-update', queueSnapshot());
    return;
  }
  if (queueEmitTimer) return; // already scheduled; the timer sends the latest snapshot
  const wait = Math.max(0, 250 - (now - lastQueueEmit));
  if (wait === 0) {
    lastQueueEmit = now;
    sendToAll('compress-queue-update', queueSnapshot());
    return;
  }
  queueEmitTimer = setTimeout(() => {
    queueEmitTimer = null;
    lastQueueEmit = Date.now();
    sendToAll('compress-queue-update', queueSnapshot());
  }, wait);
}

function emitJobDone(job) {
  sendToAll('compress-job-done', publicJob(job));
}

function findJob(jobId) {
  return jobs.find((job) => job.id === jobId) || null;
}

function releaseOutputPath(job) {
  const state = jobState.get(job.id);
  if (state && state.finalPath) reservedPaths.delete(state.finalPath);
}

function removeJobInternal(job) {
  releaseOutputPath(job);
  jobState.delete(job.id);
  const idx = jobs.indexOf(job);
  if (idx !== -1) jobs.splice(idx, 1);
}

// Remove left-over partial/state files of a job that did not finish. Windows keeps the file
// handle for a moment after a kill, so a failed unlink is retried a few times.
function cleanupArtifacts(state) {
  if (!state) return;
  const targets = [];
  if (state.partialPath) targets.push(state.partialPath);
  if (state.passlogfile) targets.push(state.passlogfile);

  // The partial file is deleted by its exact name only. Pass logs live in the app's own temp
  // folder, so their numbered siblings (-0.log, .mbtree, ...) may be matched by prefix there.
  const filesFor = (file) => {
    if (path.dirname(file) !== WORK_DIR) return fs.existsSync(file) ? [file] : [];
    const out = [];
    const base = path.basename(file);
    try {
      for (const entry of fs.readdirSync(WORK_DIR)) {
        if (entry === base || entry.startsWith(`${base}-`) || entry.startsWith(`${base}.`)) {
          out.push(path.join(WORK_DIR, entry));
        }
      }
    } catch (e) {}
    return out;
  };

  const attempt = (retries) => {
    let remaining = 0;
    for (const target of targets) {
      for (const file of filesFor(target)) {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          if (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES')) remaining += 1;
        }
      }
    }
    if (remaining > 0 && retries > 0) {
      setTimeout(() => attempt(retries - 1), 400);
    }
  };
  attempt(4);
}

// ---------------------------------------------------------------------------------------------
// Job execution
// ---------------------------------------------------------------------------------------------

function resolvePassCount(options, encoder) {
  if (options.mode !== 'size') return 1;
  return helpers.isTwoPassEncoder(encoder) ? 2 : 1;
}

function progressOffsetFor() {
  // Input-side seeks and filter-graph trims both restart the output clock at 0.
  return 0;
}

function runFfmpegOnce(job, state, { pass, args }) {
  return new Promise((resolve, reject) => {
    const proc = spawnFfmpeg(args);
    state.currentProc = proc;
    logCommand(ffmpegPath(), args);

    // Keep the last ~8 KB of stderr for error messages (ffmpeg writes everything there).
    let stderrTail = '';
    proc.stderr.on('data', (data) => {
      stderrTail = (stderrTail + data.toString()).slice(-8000);
    });

    const duration = state.duration || 0;
    const offset = state.progressOffset || 0;
    const passes = state.passes || 1;

    proc.stdout.on('data', (data) => {
      const block = helpers.parseProgressBlock(data.toString());
      if (!block) return;
      if (block.done) return;
      if (block.fps !== null) job.fps = block.fps;
      if (block.speed !== null) job.speed = block.speed;
      if (block.outTime !== null && duration > 0) {
        const position = Math.max(0, block.outTime - offset);
        const ratio = Math.min(1, position / duration);
        let percent;
        if (passes === 2) {
          percent = pass === 1 ? ratio * 35 : 35 + ratio * 65;
        } else {
          percent = ratio * 100;
        }
        job.percent = percent;
        const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0;
        const speed = job.speed || 0;
        if (speed > 0 && ratio > 0.02) {
          const remaining = (duration - position) / speed;
          job.etaSeconds = Math.max(0, Math.round(remaining));
        } else if (percent > 0 && elapsed > 0) {
          job.etaSeconds = Math.max(0, Math.round((elapsed / percent) * (100 - percent)));
        }
        // Progress-only updates are throttled to <= 4/s.
        emitQueue(false);
      }
    });

    const finish = (code, error) => {
      state.currentProc = null;
      if (error) reject(error);
      else resolve(code);
    };

    proc.on('error', (err) => {
      finish(-1, err);
    });

    proc.on('close', (code) => {
      const cancelled = code === null || (typeof ctx.wasProcessStopped === 'function' && ctx.wasProcessStopped(proc));
      if (cancelled) {
        const err = new Error('Cancelled');
        err.cancelled = true;
        finish(code, err);
        return;
      }
      if (code === 0) {
        finish(0);
        return;
      }
      const detail = stderrTail.trim().split(/\r?\n/).slice(-6).join('\n');
      log(`[ffmpeg] exit ${code}${detail ? `\n${detail}` : ''}`);
      finish(code, new Error(`FFmpeg exited with code ${code}${detail ? `\n${detail}` : ''}`));
    });
  });
}

async function prepareJob(job) {
  const state = jobState.get(job.id);
  const probe = await probeFile(job.inputPath);
  state.probe = probe;
  job.inputSize = probe.size || 0;
  job.filename = probe.filename || path.basename(job.inputPath);

  const capabilities = await getCapabilities().catch(() => null);
  const customPresets = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : [];
  const resolved = helpers.resolveOptions(state.rawOptions, { probe, capabilities, customPresets });
  if (!probe.hasVideo && probe.audioTracks.length === 0) {
    throw new Error('This file could not be read as a video. It may be corrupt or unsupported.');
  }
  if (!probe.hasVideo) {
    throw new Error('This is an audio-only file. The Compress tab works on videos.');
  }
  if (resolved.options.mode === 'size' && !(probe.duration > 0)) {
    throw new Error("This file doesn't report its length, so a size target can't be met. Use Quality mode.");
  }
  if (!resolved.encoder && resolved.options.mode !== 'remux') {
    throw new Error(resolved.warnings[0] || 'No usable video encoder for this codec.');
  }
  state.resolved = resolved;
  state.options = resolved.options;
  job.encoder = resolved.encoder;
  job.warnings = resolved.warnings;
  job.presetId = resolved.options.presetId || job.presetId;
  job.summary = helpers.summarizeOptions(resolved.options, resolved.encoder, probe);
  state.passes = resolvePassCount(resolved.options, resolved.encoder);
  job.passes = state.passes;
  job.sourceStart = resolved.options.trim.start || 0;
  job.speedFactor = resolved.options.speedFactor || 1;

  if (!state.finalPath) {
    state.finalPath = helpers.buildOutputPath(job.inputPath, resolved.options, (p) => fs.existsSync(p) || reservedPaths.has(p));
    reservedPaths.add(state.finalPath);
  }
  state.partialPath = `${state.finalPath}.${job.id}.partial`;
  try {
    fs.mkdirSync(path.dirname(state.finalPath), { recursive: true });
  } catch (err) {
    throw new Error(`The output folder ${path.dirname(state.finalPath)} can't be used: ${err.message}`);
  }
  job.outputPath = null; // only exposed once the file really exists

  state.duration = helpers.effectiveDuration(probe, resolved.options);
  state.progressOffset = progressOffsetFor(resolved.options);
  state.audioKbps = helpers.audioBitrateForEstimate(probe, resolved.options);

  // resolveOptions already applied the size-mode guard rails (clamp / 720p cap); here we only
  // need the resulting video bitrate for the encode.
  if (resolved.options.mode === 'size') {
    state.targetBytes = helpers.targetBytesFor(probe, resolved.options);
    state.videoKbps = helpers.computeTargetBitrates({
      targetBytes: state.targetBytes,
      effectiveDuration: state.duration,
      audioKbps: state.audioKbps
    }).videoKbps;
    job.warnings = resolved.warnings;
    job.summary = helpers.summarizeOptions(resolved.options, resolved.encoder, probe);
  }

  state.passlogfile = path.join(WORK_DIR, job.id);
  try { fs.mkdirSync(WORK_DIR, { recursive: true }); } catch (e) {}
}

function argsForPass(job, state, pass, nullOutput) {
  const options = state.options;
  const twoPass = state.passes === 2;
  return helpers.buildFfmpegArgs({
    inputPath: job.inputPath,
    outputPath: state.partialPath,
    options,
    probe: state.probe,
    encoder: state.resolved.encoder,
    pass: twoPass ? pass : null,
    passlogfile: twoPass ? state.passlogfile : null,
    videoKbps: state.videoKbps,
    audioKbps: state.audioKbps,
    nullOutput: !!nullOutput
  });
}

function fileSizeOrZero(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (e) {
    return 0;
  }
}

async function encodeJob(job) {
  const state = jobState.get(job.id);
  const partial = state.partialPath;

  const passes = state.passes;
  if (passes === 2) {
    job.pass = 1;
    job.percent = 0;
    emitQueue(true);
    await runFfmpegOnce(job, state, { pass: 1, args: argsForPass(job, state, 1, true) });
    if (state.cancelRequested) throw cancelledError();
    job.pass = 2;
    job.percent = 35;
    emitQueue(true);
    await runFfmpegOnce(job, state, { pass: 2, args: argsForPass(job, state, 2, false) });
  } else {
    job.pass = 1;
    await runFfmpegOnce(job, state, { pass: null, args: argsForPass(job, state, null, false) });
  }
  if (state.cancelRequested) throw cancelledError();

  // Size mode: retry once with a corrected bitrate when the target is missed. Two-pass encodes
  // can overshoot on short clips; they rerun only pass 2, since the pass-1 stats stay valid.
  while (state.options.mode === 'size' && state.targetBytes > 0 && (job.attempt || 1) <= 2) {
    const size = fileSizeOrZero(partial);
    if (size <= state.targetBytes) break;
    if (state.videoKbps <= 80) break;
    {
      const ratio = state.targetBytes / size;
      state.videoKbps = Math.max(80, Math.floor(state.videoKbps * ratio * 0.95));
      job.attempt = (job.attempt || 1) + 1;
      job.percent = passes === 2 ? 50 : 0;
      emitQueue(true);
      log(`[compress] ${job.filename}: over target (${size} > ${state.targetBytes}); retrying at ${state.videoKbps} kbps.`);
      try { fs.unlinkSync(partial); } catch (e) {}
      if (passes === 2) {
        job.pass = 2;
        await runFfmpegOnce(job, state, { pass: 2, args: argsForPass(job, state, 2, false) });
      } else {
        await runFfmpegOnce(job, state, { pass: null, args: argsForPass(job, state, null, false) });
      }
      if (state.cancelRequested) throw cancelledError();
    }
  }
  if (state.options.mode === 'size' && state.targetBytes > 0 && fileSizeOrZero(partial) > state.targetBytes) {
    job.warnings = (job.warnings || []).concat(`The result is ${(fileSizeOrZero(partial) / 1000000).toFixed(1)} MB, above the target. Try a lower resolution.`);
  }
}

function cancelledError() {
  const err = new Error('Cancelled');
  err.cancelled = true;
  return err;
}

function finalizeJob(job) {
  const state = jobState.get(job.id);
  const partial = state.partialPath;
  let finalPath = state.finalPath;
  try {
    if (fs.existsSync(finalPath)) {
      // Something else took the name while we encoded: pick the next free name, never overwrite.
      releaseOutputPath(job);
      finalPath = helpers.buildOutputPath(job.inputPath, state.options, (p) => fs.existsSync(p) || reservedPaths.has(p));
      state.finalPath = finalPath;
    }
    fs.renameSync(partial, finalPath);
  } catch (err) {
    throw new Error(`Could not finish the output file: ${err.message}`);
  }
  // Pass logs are no longer needed once the output exists.
  cleanupArtifacts({ partialPath: null, passlogfile: state.passlogfile });
  // The watch folder must never pick up a file this tab wrote.
  producedOutputs.add(path.resolve(finalPath).toLowerCase());
  job.outputSize = fileSizeOrZero(finalPath);
  job.outputPath = finalPath;
  job.percent = 100;
  releaseOutputPath(job);
  state.outputDeleted = false;
}

async function runJob(job) {
  const state = jobState.get(job.id);
  runningJobId = job.id;
  job.status = 'running';
  job.startedAt = Date.now();
  job.attempt = 1;
  job.percent = 0;
  emitQueue(true);
  log(`[compress] Start ${job.filename}`);

  try {
    await prepareJob(job);
    if (state.cancelRequested) throw cancelledError();
    await encodeJob(job);
    finalizeJob(job);
    job.status = 'done';
    job.finishedAt = Date.now();
    job.etaSeconds = 0;
    log(`[compress] Done ${job.filename} — ${job.outputSize} bytes`);
    emitQueue(true);
    emitJobDone(job);
  } catch (err) {
    const cancelled = (err && err.cancelled) || state.cancelRequested;
    cleanupArtifacts(state);
    if (!cancelled) {
      job.error = (err && err.message) || 'Compression failed.';
      job.status = 'failed';
      log(`[compress] Failed ${job.filename}: ${job.error}`);
    } else {
      job.status = 'cancelled';
      job.percent = 0;
      log(`[compress] Cancelled ${job.filename}`);
    }
    job.finishedAt = Date.now();
    job.etaSeconds = 0;
    job.outputPath = null;
    releaseOutputPath(job);
    emitQueue(true);
    emitJobDone(job);
  } finally {
    runningJobId = null;
    state.currentProc = null;
    pumpQueue();
  }
}

function pumpQueue() {
  if (pumping || runningJobId) return;
  const next = jobs.find((job) => job.status === 'queued');
  if (!next) {
    emitQueue(true);
    return;
  }
  pumping = true;
  const state = jobState.get(next.id);
  if (state) state.cancelRequested = false;
  runJob(next).finally(() => {
    pumping = false;
    pumpQueue();
  });
}

// ---------------------------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------------------------

function enqueue(requests) {
  const list = Array.isArray(requests) ? requests : [requests];
  const jobIds = [];
  for (const request of list) {
    if (!request || !request.inputPath || typeof request.inputPath !== 'string') {
      log('[compress] Skipped a request without a file path.');
      continue;
    }
    const inputPath = request.inputPath;
    if (!fs.existsSync(inputPath)) {
      log(`[compress] Skipped ${path.basename(inputPath)}: the file no longer exists.`);
      continue;
    }
    if (request.source === 'auto' || request.source === 'watch') {
      const key = path.resolve(inputPath).toLowerCase();
      const signature = autoSignature(inputPath);
      if (producedOutputs.has(key)) continue;
      if (signature && autoSeen.get(key) === signature) continue;
      if (jobs.some((j) => path.resolve(j.inputPath).toLowerCase() === key && (j.status === 'queued' || j.status === 'running'))) continue;
      if (signature) autoSeen.set(key, signature);
      if (autoSeen.size > 1000) autoSeen.delete(autoSeen.keys().next().value);
    }
    const id = nextJobId();
    const job = {
      id,
      inputPath,
      filename: path.basename(inputPath),
      outputPath: null,
      status: 'queued',
      source: request.source === 'auto' || request.source === 'watch' || request.source === 'card' ? request.source : 'manual',
      presetId: (request.options && request.options.presetId) || null,
      summary: '',
      pass: 0,
      passes: 1,
      percent: 0,
      fps: 0,
      speed: 0,
      etaSeconds: 0,
      inputSize: 0,
      outputSize: 0,
      startedAt: 0,
      finishedAt: 0,
      error: '',
      warnings: [],
      encoder: '',
      attempt: 1
    };
    // A provisional summary so queued rows already say what they will do; the encoder is
    // resolved (and the summary refreshed) when the job starts.
    try {
      const provisional = helpers.resolveOptions(request.options || {}, {
        probe: null,
        capabilities: null,
        customPresets: Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : []
      });
      job.summary = helpers.summarizeOptions(provisional.options, '', null);
    } catch (e) {}
    jobState.set(id, freshJobState(request.options || {}));
    jobs.push(job);
    jobIds.push(id);
  }
  emitQueue(true);
  pumpQueue();
  return jobIds;
}

async function cancelJob(jobId) {
  if (jobId === 'all') {
    const queued = jobs.filter((job) => job.status === 'queued');
    for (const job of queued) {
      removeJobInternal(job);
    }
    const running = jobs.find((job) => job.status === 'running');
    if (running) await cancelJob(running.id);
    const preview = previewState.current;
    if (preview) await cancelPreview();
    emitQueue(true);
    return { ok: true };
  }
  const job = findJob(jobId);
  if (!job) return { ok: false };
  const state = jobState.get(job.id);
  if (job.status === 'queued') {
    removeJobInternal(job);
    emitQueue(true);
    return { ok: true };
  }
  if (job.status === 'running' && state) {
    state.cancelRequested = true;
    const proc = state.currentProc;
    if (proc && typeof ctx.killProcessTree === 'function') {
      await ctx.killProcessTree(proc);
    } else if (proc) {
      try { proc.kill('SIGKILL'); } catch (e) {}
    }
    return { ok: true };
  }
  return { ok: false };
}

function removeJob(jobId) {
  const job = findJob(jobId);
  if (!job) return { ok: false };
  if (job.status === 'running') return { ok: false };
  removeJobInternal(job);
  emitQueue(true);
  return { ok: true };
}

function retryJob(jobId) {
  const job = findJob(jobId);
  if (!job) return { jobId: null };
  if (job.status === 'running' || job.status === 'queued') return { jobId: job.id };
  if (!fs.existsSync(job.inputPath)) {
    job.status = 'failed';
    job.error = 'The input file no longer exists.';
    emitQueue(true);
    return { jobId: job.id };
  }
  const state = jobState.get(job.id);
  const rawOptions = state ? state.rawOptions : (job.presetId ? { presetId: job.presetId } : {});
  job.status = 'queued';
  job.error = '';
  job.percent = 0;
  job.pass = 0;
  job.outputSize = 0;
  job.outputPath = null;
  job.finishedAt = 0;
  job.attempt = 1;
  job.passes = 1;
  job.etaSeconds = 0;
  job.fps = 0;
  job.speed = 0;
  jobState.set(job.id, freshJobState(rawOptions));
  emitQueue(true);
  pumpQueue();
  return { jobId: job.id };
}

function clearFinished() {
  for (const job of [...jobs]) {
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') removeJobInternal(job);
  }
  emitQueue(true);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Preview (one at a time; a new call or cancel kills the old one)
// ---------------------------------------------------------------------------------------------

const previewState = { current: null, files: [] };

function cleanPreviewDir() {
  try {
    fs.rmSync(PREVIEW_DIR, { recursive: true, force: true });
  } catch (e) {}
  previewState.files = [];
}

function tryUnlink(filePath, retries = 3) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    if (retries > 0 && e && (e.code === 'EBUSY' || e.code === 'EPERM')) {
      setTimeout(() => tryUnlink(filePath, retries - 1), 300);
    }
    return false;
  }
}

function removePreviewFile(filePath) {
  if (!filePath) return;
  tryUnlink(filePath);
  previewState.files = previewState.files.filter((f) => f !== filePath);
}

// The renderer may still be playing an older sample, so keep the last few and sweep the rest.
const PREVIEW_KEEP = 4;

function trimPreviewFiles() {
  while (previewState.files.length > PREVIEW_KEEP) {
    removePreviewFile(previewState.files[0]);
  }
}

// Leftovers from earlier app sessions are not tracked in previewState.files, so sweep the folder
// itself and keep only the newest few samples.
function sweepPreviewDir() {
  let entries = [];
  try {
    entries = fs.readdirSync(PREVIEW_DIR);
  } catch (e) {
    return;
  }
  const stats = [];
  for (const entry of entries) {
    const full = path.join(PREVIEW_DIR, entry);
    try {
      stats.push({ full, mtime: fs.statSync(full).mtimeMs });
    } catch (e) { /* vanished */ }
  }
  stats.sort((a, b) => b.mtime - a.mtime);
  for (const entry of stats.slice(PREVIEW_KEEP)) {
    if (!previewState.files.includes(entry.full)) tryUnlink(entry.full);
  }
}

function cancelPreview() {
  const current = previewState.current;
  if (!current) return Promise.resolve({ ok: true });
  current.cancelled = true;
  const proc = current.proc;
  if (proc && typeof ctx.killProcessTree === 'function') return ctx.killProcessTree(proc).then(() => ({ ok: true })).catch(() => ({ ok: true }));
  if (proc) {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }
  return Promise.resolve({ ok: true });
}

// Always browser-playable: VP9/AV1 go to WebM, everything else to MP4. Convert-only previews
// follow the source codec, since there is nothing to re-encode.
function previewContainer(options, probe) {
  const codec = options.mode === 'remux'
    ? String((probe && probe.vcodec) || '').toLowerCase()
    : options.codec;
  return codec === 'vp9' || codec === 'av1' ? 'webm' : 'mp4';
}

function buildPreviewOutputPath(inputPath, container) {
  try { fs.mkdirSync(PREVIEW_DIR, { recursive: true }); } catch (e) {}
  const base = helpers.sanitizeFilename(path.basename(inputPath, path.extname(inputPath)), 'preview');
  const ext = helpers.CONTAINER_EXT[container] || '.mp4';
  return path.join(PREVIEW_DIR, `${base}-preview-${Date.now()}${ext}`);
}

async function runPreview(payload) {
  const { inputPath, options, startSeconds, durationSeconds } = payload || {};
  if (!inputPath || typeof inputPath !== 'string') throw new Error('Invalid input path.');

  await cancelPreview();
  const token = { cancelled: false, proc: null };
  previewState.current = token;
  const superseded = () => {
    if (token.cancelled || previewState.current !== token) {
      const err = new Error('Preview cancelled.');
      err.cancelled = true;
      throw err;
    }
  };
  sweepPreviewDir();

  let probe;
  let capabilities;
  try {
    probe = await probeFile(inputPath);
    capabilities = await getCapabilities().catch(() => null);
    superseded();
  } catch (err) {
    if (previewState.current === token) previewState.current = null;
    throw err;
  }
  const customPresets = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : [];
  const resolved = helpers.resolveOptions(options || {}, { probe, capabilities, customPresets });
  const previewOptions = helpers.cloneOptions(resolved.options);

  const totalDuration = probe.duration || Number(durationSeconds) || 10;
  const requestedDuration = Number(durationSeconds);
  const sampleDuration = Math.max(
    0.5,
    Math.min(totalDuration, Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : 10)
  );
  const start = Math.max(0, Math.min(Math.max(0, totalDuration - 0.05), Number(startSeconds) || 0));

  // Single pass with the finished job's settings. Size mode reuses the full-file bitrate so the
  // sample looks like the real result; quality mode just uses the same CRF.
  const container = previewContainer(previewOptions, probe);
  previewOptions.container = container;
  if (container === 'webm' && previewOptions.audio.mode !== 'none') {
    previewOptions.audio.mode = 'encode';
    previewOptions.audio.codec = 'opus';
  }
  previewOptions.trim = { start, end: Math.min(totalDuration, start + sampleDuration) };

  const audioKbps = helpers.audioBitrateForEstimate(probe, previewOptions);
  let videoKbps = 0;
  if (previewOptions.mode === 'size') {
    videoKbps = helpers.computeTargetBitrates({
      targetBytes: helpers.targetBytesFor(probe, previewOptions),
      effectiveDuration: helpers.effectiveDuration(probe, resolved.options),
      audioKbps
    }).videoKbps;
  }

  const previewPath = buildPreviewOutputPath(inputPath, container);
  previewState.files.push(previewPath);
  trimPreviewFiles();
  const args = helpers.buildFfmpegArgs({
    inputPath,
    outputPath: previewPath,
    options: previewOptions,
    probe,
    encoder: resolved.encoder,
    pass: null,
    passlogfile: null,
    videoKbps,
    audioKbps
  });

  try {
    superseded();
    await new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawnFfmpeg(args);
      } catch (err) {
        reject(err);
        return;
      }
      token.proc = proc;
      logCommand(ffmpegPath(), args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-6000); });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        token.proc = null;
        if (token.cancelled) {
          const err = new Error('Preview cancelled.');
          err.cancelled = true;
          reject(err);
          return;
        }
        if (code === null || (typeof ctx.wasProcessStopped === 'function' && ctx.wasProcessStopped(proc))) {
          const err = new Error('Preview cancelled.');
          err.cancelled = true;
          reject(err);
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim().split(/\r?\n/).slice(-4).join('\n');
          log(`[ffmpeg] preview exit ${code}${detail ? `\n${detail}` : ''}`);
          reject(new Error(`Preview failed (ffmpeg exit ${code}).${detail ? `\n${detail}` : ''}`));
          return;
        }
        resolve();
      });
    });
  } catch (err) {
    // A half-written sample is useless: drop it so the temp folder only holds finished previews.
    removePreviewFile(previewPath);
    log(`[compress] Preview failed for ${path.basename(inputPath)}: ${(err && err.message) || err}`);
    throw err;
  } finally {
    if (previewState.current === token) previewState.current = null;
  }

  const sampleBytes = fileSizeOrZero(previewPath);
  const sampleEffective = helpers.effectiveDuration(probe, previewOptions);
  let projectedBytes = sampleBytes;
  if (previewOptions.mode === 'size') {
    projectedBytes = helpers.targetBytesFor(probe, previewOptions);
  } else if (previewOptions.mode === 'remux') {
    projectedBytes = probe.size || sampleBytes;
  } else if (sampleEffective > 0) {
    const fullDuration = helpers.effectiveDuration(probe, resolved.options);
    projectedBytes = Math.round(sampleBytes * (fullDuration / sampleEffective));
  }

  return {
    previewPath,
    sourceStart: start,
    duration: sampleEffective,
    sampleBytes,
    projectedBytes,
    encoder: resolved.encoder,
    warnings: resolved.warnings.concat(resolved.notes)
  };
}

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------

function listPresets() {
  const custom = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : [];
  return helpers.resolvePresetList(custom);
}

// Trim, crop, output folder and a subtitle file belong to one video, not to a reusable preset.
function stripPerFileOptions(options) {
  const out = options && typeof options === 'object' ? JSON.parse(JSON.stringify(options)) : {};
  delete out.presetId;
  delete out.trim;
  delete out.crop;
  if (out.output && typeof out.output === 'object') delete out.output.dir;
  if (out.subtitles && typeof out.subtitles === 'object') delete out.subtitles.burn;
  if (out.audio && typeof out.audio === 'object') delete out.audio.trackIndex;
  return out;
}

function savePreset(preset) {
  if (!preset || typeof preset !== 'object' || !preset.label) throw new Error('A preset needs a label.');
  const custom = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets.slice() : [];
  const id = typeof preset.id === 'string' && preset.id.startsWith('custom_') ? preset.id : `custom_${Date.now()}`;
  const entry = {
    id,
    label: String(preset.label).slice(0, 60),
    builtIn: false,
    description: typeof preset.description === 'string' ? preset.description : '',
    options: stripPerFileOptions(preset.options)
  };
  const index = custom.findIndex((p) => p && p.id === id);
  if (index >= 0) custom[index] = entry;
  else custom.push(entry);
  if (typeof ctx.saveSettingsInternal === 'function') ctx.saveSettingsInternal({ compressCustomPresets: custom });
  return entry;
}

function deletePreset(id) {
  const custom = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : [];
  const next = custom.filter((p) => p && p.id !== id);
  if (next.length === custom.length) return { ok: false };
  const patch = { compressCustomPresets: next };
  if (ctx.settings.compressAutoPresetId === id) patch.compressAutoPresetId = 'discord';
  if (ctx.settings.compressWatchPresetId === id) patch.compressWatchPresetId = 'half';
  if (typeof ctx.saveSettingsInternal === 'function') ctx.saveSettingsInternal(patch);
  if (patch.compressAutoPresetId || patch.compressWatchPresetId) broadcastAutomation();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Automation and watch folder
// ---------------------------------------------------------------------------------------------

let watchHandle = null;
let watchDir = '';
let watchError = '';
const watchPending = new Map(); // path -> { size, timer }
const watchSeen = new Map(); // path -> mtime signature already queued/processed
let watchStartTimer = null;

function automationState() {
  const settings = ctx.settings || {};
  return {
    autoAfterDownload: !!settings.compressAutoAfterDownload,
    autoPresetId: settings.compressAutoPresetId || 'discord',
    watchEnabled: !!settings.compressWatchEnabled,
    watchDir: settings.compressWatchDir || '',
    watchPresetId: settings.compressWatchPresetId || 'half',
    watchActive: !!watchHandle,
    watchError: watchError || ''
  };
}

function isIgnoredWatchFile(filePath) {
  if (producedOutputs.has(path.resolve(filePath).toLowerCase())) return true;
  const name = path.basename(filePath);
  const lower = name.toLowerCase();
  if (lower.endsWith('.partial') || lower.endsWith('.part') || lower.endsWith('.ytdl')) return true;
  if (/\.f\d+\.[a-z0-9]+$/.test(lower)) return true;
  if (lower.includes('(compressed')) return true;
  if (!WATCH_VIDEO_EXTS.has(path.extname(lower))) return true;
  return false;
}

function signatureFor(filePath) {
  try {
    const st = fs.statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) {
    return '';
  }
}

// Queue a file that sat at the same size for 3 s, skipping duplicates of the same mtime/size.
function queueWatchFile(filePath) {
  const signature = signatureFor(filePath);
  if (!signature || watchSeen.get(filePath) === signature) return;
  const alreadyQueued = jobs.some((job) => job.inputPath === filePath && (job.status === 'queued' || job.status === 'running'));
  if (alreadyQueued) return;
  watchSeen.set(filePath, signature);
  if (watchSeen.size > 500) {
    // Bounded memory for long-running sessions: forget the oldest entries first.
    watchSeen.delete(watchSeen.keys().next().value);
  }
  log(`[compress] Watch folder: queueing ${path.basename(filePath)}`);
  enqueue([{ inputPath: filePath, options: { presetId: ctx.settings.compressWatchPresetId || 'half' }, source: 'watch' }]);
}

// A file still being copied keeps growing, so each growth restarts the 3 s stability window.
function scheduleWatchJob(filePath, size) {
  const existing = watchPending.get(filePath);
  if (existing && existing.timer) clearTimeout(existing.timer);
  const entry = { size, timer: null };
  watchPending.set(filePath, entry);
  entry.timer = setTimeout(() => {
    if (watchPending.get(filePath) !== entry) return;
    let current = 0;
    try { current = fs.statSync(filePath).size; } catch (e) { watchPending.delete(filePath); return; }
    if (current !== entry.size) {
      scheduleWatchJob(filePath, current);
      return;
    }
    watchPending.delete(filePath);
    queueWatchFile(filePath);
  }, 3000);
}

// Pushes the current automation state so the renderer notices watcher changes it did not ask for
// (folder deleted, watch error) without waiting for the user to touch a control.
function broadcastAutomation() {
  sendToAll('compress-automation-update', automationState());
}

function stopWatcher() {
  if (watchHandle) {
    try { watchHandle.close(); } catch (e) {}
    watchHandle = null;
  }
  for (const entry of watchPending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  watchPending.clear();
}

function startWatcher() {
  stopWatcher();
  watchError = '';
  const settings = ctx.settings || {};
  if (!settings.compressWatchEnabled) return;
  const dir = settings.compressWatchDir;
  if (!dir) {
    watchError = 'Choose a folder to watch.';
    return;
  }
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) {
      watchError = 'The watch folder is not a folder.';
      return;
    }
  } catch (e) {
    watchError = 'The watch folder does not exist.';
    return;
  }

  watchDir = dir;
  try {
    watchHandle = fs.watch(dir, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      const full = path.join(dir, String(filename));
      if (isIgnoredWatchFile(full)) return;
      let size = 0;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) return;
        size = st.size;
      } catch (e) {
        return;
      }
      if (size <= 0) return;
      scheduleWatchJob(full, size);
    });
    watchHandle.on('error', (err) => {
      watchError = err && err.message ? err.message : 'Watch folder error.';
      log(`[compress] Watch folder error: ${watchError}`);
      // A watcher that errored delivers no more events; drop it so watchActive reports the truth.
      try { watchHandle.close(); } catch (e) {}
      watchHandle = null;
      broadcastAutomation();
    });
  } catch (err) {
    watchHandle = null;
    watchError = err && err.message ? err.message : 'Could not watch that folder.';
  }
}

function scheduleWatcherStart() {
  if (watchStartTimer) clearTimeout(watchStartTimer);
  watchStartTimer = setTimeout(() => {
    watchStartTimer = null;
    // Settings are filled by initSettings() before windows open; a lazy start avoids a race.
    startWatcher();
    broadcastAutomation();
  }, 150);
}

// ---------------------------------------------------------------------------------------------
// IPC handlers (one per channel in preload.js)
// ---------------------------------------------------------------------------------------------

ipcMain.handle('compress-get-capabilities', async (_event, options) => {
  return getCapabilities(options && typeof options === 'object' ? options : {});
});

ipcMain.handle('compress-probe', async (_event, filePath) => {
  return probeFile(filePath);
});

ipcMain.handle('compress-detect-crop', async (_event, filePath) => {
  return detectCrop(filePath);
});

ipcMain.handle('compress-estimate', async (_event, payload) => {
  const probe = (payload && payload.probe) || null;
  const capabilities = await getCapabilities().catch(() => null);
  const customPresets = Array.isArray(ctx.settings.compressCustomPresets) ? ctx.settings.compressCustomPresets : [];
  return helpers.estimate({
    probe,
    options: (payload && payload.options) || {},
    capabilities,
    customPresets
  });
});

ipcMain.handle('compress-enqueue', async (_event, payload) => {
  const list = (payload && Array.isArray(payload.jobs)) ? payload.jobs : [];
  return { jobIds: enqueue(list) };
});

ipcMain.handle('compress-cancel', async (_event, jobId) => {
  return cancelJob(typeof jobId === 'string' ? jobId : 'all');
});

ipcMain.handle('compress-remove', async (_event, jobId) => {
  return removeJob(jobId);
});

ipcMain.handle('compress-retry', async (_event, jobId) => {
  return retryJob(jobId);
});

ipcMain.handle('compress-clear-finished', async () => {
  return clearFinished();
});

ipcMain.handle('compress-get-queue', async () => {
  return queueSnapshot();
});

ipcMain.handle('compress-preview', async (_event, payload) => {
  return runPreview(payload || {});
});

ipcMain.handle('compress-cancel-preview', async () => {
  return cancelPreview();
});

ipcMain.handle('compress-select-files', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Video Files',
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'flv', 'ts'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('compress-select-subtitle', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    title: 'Select Subtitle File',
    filters: [{ name: 'Subtitle Files', extensions: ['srt', 'ass', 'ssa', 'vtt'] }]
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('compress-list-presets', async () => {
  return listPresets();
});

ipcMain.handle('compress-save-preset', async (_event, preset) => {
  const saved = savePreset(preset);
  sendToAll('compress-presets-update', listPresets());
  return saved;
});

ipcMain.handle('compress-delete-preset', async (_event, id) => {
  const result = deletePreset(id);
  sendToAll('compress-presets-update', listPresets());
  return result;
});

ipcMain.handle('compress-get-automation', async () => {
  return automationState();
});

ipcMain.handle('compress-set-automation', async (_event, partial) => {
  const patch = {};
  if (partial && typeof partial === 'object') {
    if (partial.autoAfterDownload !== undefined) patch.compressAutoAfterDownload = !!partial.autoAfterDownload;
    if (partial.autoPresetId !== undefined) patch.compressAutoPresetId = String(partial.autoPresetId || 'discord');
    if (partial.watchEnabled !== undefined) patch.compressWatchEnabled = !!partial.watchEnabled;
    if (partial.watchDir !== undefined) patch.compressWatchDir = String(partial.watchDir || '');
    if (partial.watchPresetId !== undefined) patch.compressWatchPresetId = String(partial.watchPresetId || 'half');
  }
  const before = `${!!ctx.settings.compressWatchEnabled}|${ctx.settings.compressWatchDir || ''}`;
  if (Object.keys(patch).length > 0 && typeof ctx.saveSettingsInternal === 'function') {
    ctx.saveSettingsInternal(patch);
  }
  const after = `${!!ctx.settings.compressWatchEnabled}|${ctx.settings.compressWatchDir || ''}`;
  // A preset change keeps the running watcher and its pending files.
  if (before !== after || (ctx.settings.compressWatchEnabled && !watchHandle)) startWatcher();
  broadcastAutomation();
  return automationState();
});

// ---------------------------------------------------------------------------------------------
// Public wiring
// ---------------------------------------------------------------------------------------------

ctx.compressEnqueue = enqueue;
ctx.compressGetCapabilities = getCapabilities;
ctx.compressDetectCrop = detectCrop;
ctx.compressPreview = runPreview;

// Start the watcher once settings exist (they are loaded in app.whenReady, before windows open).
function ensureWatcherStarted(attempt = 0) {
  if (!ctx.settings || ctx.settings.compressWatchEnabled === undefined) {
    if (attempt < 40) setTimeout(() => ensureWatcherStarted(attempt + 1), 250);
    return;
  }
  scheduleWatcherStart();
}

if (app && typeof app.whenReady === 'function') {
  const ready = app.whenReady();
  if (ready && typeof ready.then === 'function') {
    Promise.resolve(ready).then(() => { ensureWatcherStarted(); }).catch(() => {});
  }
}
if (app && typeof app.on === 'function') {
  app.on('will-quit', () => {
    stopWatcher();
    cleanPreviewDir();
    for (const job of jobs) {
      if (job.status !== 'running') continue;
      const state = jobState.get(job.id);
      try { cleanupArtifacts(state); } catch (e) {}
    }
  });
}

module.exports = {
  enqueue,
  runPreview,
  getCapabilities,
  detectCapabilities,
  probeFile,
  detectCrop,
  listPresets,
  savePreset,
  deletePreset,
  automationState,
  startWatcher,
  stopWatcher,
  cleanPreviewDir,
  parseCropValues
};

