'use strict';

// Tests for src/main/compressor-helpers.js — pure helpers only, no Electron, no real encodes.
// The last describe block is an integration test that skips itself when ffmpeg is unavailable.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helpers = require('../src/main/compressor-helpers');
const { rootDir } = require('./helpers/source');

const PROBE = {
  filePath: 'C:/in/movie.mp4',
  filename: 'movie.mp4',
  size: 100 * helpers.MB,
  duration: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  vcodec: 'h264',
  videoKbps: 12000,
  bitrateKbps: 13500,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  rotation: 0,
  hasVideo: true,
  audioTracks: [{ index: 0, codec: 'aac', channels: 2, lang: 'eng', title: '', kbps: 128 }],
  subtitleTracks: [{ index: 0, codec: 'subrip', lang: 'eng', title: '', text: true }]
};

const CAPABILITIES = {
  codecs: {
    h264: [{ name: 'libx264' }, { name: 'h264_nvenc' }, { name: 'h264_qsv' }],
    hevc: [{ name: 'libx265' }, { name: 'hevc_nvenc' }],
    av1: [{ name: 'libsvtav1' }, { name: 'libaom-av1' }, { name: 'av1_nvenc' }],
    vp9: [{ name: 'libvpx-vp9' }]
  }
};

// Builds args the way compressor.js does for a finished job.
function argsFor(optionsInput, extras = {}) {
  const resolved = helpers.resolveOptions(optionsInput, {
    probe: extras.probe === null ? null : (extras.probe || PROBE),
    capabilities: extras.capabilities === undefined ? null : extras.capabilities
  });
  return {
    resolved,
    args: helpers.buildFfmpegArgs({
      inputPath: extras.inputPath || 'C:/in/movie.mp4',
      outputPath: extras.outputPath || 'C:/out/movie.mp4',
      options: resolved.options,
      probe: extras.probe === null ? null : (extras.probe || PROBE),
      encoder: extras.encoder === undefined ? resolved.encoder : extras.encoder,
      pass: extras.pass === undefined ? null : extras.pass,
      passlogfile: extras.passlogfile === undefined ? null : extras.passlogfile,
      videoKbps: extras.videoKbps === undefined ? 900 : extras.videoKbps,
      audioKbps: 128,
      nullOutput: !!extras.nullOutput,
      platform: extras.platform
    })
  };
}

function joined(optionsInput, extras) {
  return argsFor(optionsInput, extras).args.join(' ');
}

describe('compressor helpers: module shape', () => {
  test('helper module never imports Electron, so plain Node can require it', () => {
    const code = fs.readFileSync(path.join(rootDir, 'src/main/compressor-helpers.js'), 'utf8');
    assert.ok(!/require\(\s*['"]electron['"]\s*\)/.test(code), 'helpers must not require electron');
    assert.ok(!/\bremote\b/.test(code), 'helpers must not touch the remote module');
  });

  test('exposes the documented public surface', () => {
    const expected = [
      'BUILT_IN_PRESETS', 'DEFAULT_OPTIONS', 'resolveOptions', 'computeTargetBitrates',
      'effectiveDuration', 'targetBytesFor', 'qualityToRateControl', 'speedToPresetArgs',
      'buildVideoFilters', 'buildAudioFilters', 'splitAtempo', 'buildFfmpegArgs',
      'buildOutputPath', 'partialPath', 'nullOutputPath', 'parseProgressBlock', 'parseProbeOutput',
      'parseEncodersList', 'parseFiltersList', 'estimate', 'summarizeOptions', 'escapeFilterPath',
      'sanitizeFilename', 'pickAutoEncoder', 'isTwoPassEncoder', 'isHardwareEncoder'
    ];
    for (const name of expected) {
      assert.ok(typeof helpers[name] !== 'undefined', `missing export: ${name}`);
    }
  });
});

describe('compressor helpers: presets and defaults', () => {
  test('built-in presets have unique ids and a label', () => {
    const ids = new Set();
    for (const preset of helpers.BUILT_IN_PRESETS) {
      assert.ok(preset.id && !ids.has(preset.id), `duplicate or empty id: ${preset.id}`);
      ids.add(preset.id);
      assert.ok(preset.label, `${preset.id} needs a label`);
      assert.strictEqual(preset.builtIn, true);
    }
  });

  test('defaults match the spec', () => {
    const o = helpers.DEFAULT_OPTIONS;
    assert.strictEqual(o.mode, 'quality');
    assert.strictEqual(o.quality, 70);
    assert.strictEqual(o.codec, 'h264');
    assert.strictEqual(o.encoder, 'auto');
    assert.strictEqual(o.speed, 'balanced');
    assert.strictEqual(o.container, 'mp4');
    assert.strictEqual(o.maxHeight, null);
    assert.strictEqual(o.maxFps, null);
    assert.deepStrictEqual(o.trim, { start: null, end: null });
    assert.strictEqual(o.crop, null);
    assert.strictEqual(o.audio.mode, 'encode');
    assert.strictEqual(o.audio.codec, 'aac');
    assert.strictEqual(o.audio.bitrateKbps, 128);
    assert.strictEqual(o.audio.channels, 'source');
    assert.strictEqual(o.audio.normalize, false);
    assert.strictEqual(o.audio.volumeDb, 0);
    assert.strictEqual(o.subtitles.burn.kind, 'none');
    assert.strictEqual(o.subtitles.keepSoft, false);
    assert.strictEqual(o.stripMetadata, false);
    assert.strictEqual(o.output.suffix, ' (compressed)');
  });

  test('resolveOptions with no input returns the defaults', () => {
    const resolved = helpers.resolveOptions({});
    assert.strictEqual(resolved.options.mode, 'quality');
    assert.strictEqual(resolved.options.presetId, null);
    assert.deepStrictEqual(resolved.warnings, []);
  });

  test('resolvePresetList merges built-ins with custom presets', () => {
    const list = helpers.resolvePresetList([{ id: 'custom_1', label: 'Mine', options: { quality: 50 } }]);
    assert.ok(list.builtIn.length === helpers.BUILT_IN_PRESETS.length);
    assert.ok(list.builtIn.every((p) => p.builtIn === true));
    assert.strictEqual(list.custom.length, 1);
    assert.strictEqual(list.custom[0].builtIn, false);
    assert.strictEqual(list.custom[0].label, 'Mine');
  });

  test('resolvePresetList tolerates junk entries', () => {
    const list = helpers.resolvePresetList([null, {}, 'nope', { id: 'ok' }]);
    assert.strictEqual(list.custom.length, 1);
    assert.strictEqual(list.custom[0].label, 'ok');
    assert.deepStrictEqual(list.custom[0].options, {});
  });

  test('a preset fills the options, explicit fields win over the preset', () => {
    const presetOnly = helpers.resolveOptions({ presetId: 'discord' });
    assert.strictEqual(presetOnly.options.mode, 'size');
    assert.strictEqual(presetOnly.options.targetSizeMB, 10);
    assert.strictEqual(presetOnly.options.maxHeight, 720);
    assert.strictEqual(presetOnly.options.maxFps, 30);
    assert.strictEqual(presetOnly.options.audio.bitrateKbps, 96);

    const overridden = helpers.resolveOptions({ presetId: 'discord', maxHeight: 1080, audio: { bitrateKbps: 160 } });
    assert.strictEqual(overridden.options.maxHeight, 1080);
    assert.strictEqual(overridden.options.audio.bitrateKbps, 160);
    assert.strictEqual(overridden.options.targetSizeMB, 10, 'untouched preset fields stay');
    assert.strictEqual(overridden.options.presetId, 'discord');
  });

  test('unknown preset ids fall back to defaults', () => {
    const resolved = helpers.resolveOptions({ presetId: 'does-not-exist' });
    assert.strictEqual(resolved.options.mode, 'quality');
  });

  test('custom presets are honoured when passed in the context', () => {
    const resolved = helpers.resolveOptions({ presetId: 'custom_x' }, {
      customPresets: [{ id: 'custom_x', label: 'X', options: { mode: 'size', targetSizeMB: 42 } }]
    });
    assert.strictEqual(resolved.options.targetSizeMB, 42);
  });

  test('out-of-range values are clamped or replaced', () => {
    const resolved = helpers.resolveOptions({
      quality: 500, speed: 'turbo', container: 'avi', codec: 'mpeg2', maxHeight: 999,
      maxFps: 12, speedFactor: 99, rotate: 45, denoise: 'insane',
      audio: { bitrateKbps: 5000, channels: 7, volumeDb: -400 }
    });
    assert.strictEqual(resolved.options.quality, 100);
    assert.strictEqual(resolved.options.speed, 'balanced');
    assert.strictEqual(resolved.options.container, 'mp4');
    assert.strictEqual(resolved.options.codec, 'h264');
    assert.strictEqual(resolved.options.maxHeight, null);
    assert.strictEqual(resolved.options.maxFps, null);
    assert.strictEqual(resolved.options.speedFactor, 4);
    assert.strictEqual(resolved.options.rotate, 0);
    assert.strictEqual(resolved.options.denoise, 'off');
    assert.strictEqual(resolved.options.audio.bitrateKbps, 320);
    assert.strictEqual(resolved.options.audio.channels, 'source');
    assert.strictEqual(resolved.options.audio.volumeDb, -30);
  });

  test('trim end before trim start is dropped with a warning', () => {
    const resolved = helpers.resolveOptions({ trim: { start: 20, end: 10 } });
    assert.deepStrictEqual(resolved.options.trim, { start: null, end: null });
    assert.ok(resolved.warnings.some((w) => /trim/i.test(w)));
  });

  test('trim is clamped to the probe duration', () => {
    const resolved = helpers.resolveOptions({ trim: { start: 10, end: 999 } }, { probe: PROBE });
    assert.strictEqual(resolved.options.trim.end, 60);
    const pastEnd = helpers.resolveOptions({ trim: { start: 120, end: 180 } }, { probe: PROBE });
    assert.strictEqual(pastEnd.options.trim.start, null);
    assert.ok(pastEnd.warnings.some((w) => /past the end/i.test(w)));
  });

  test('a subtitle kind without the data it needs degrades to none', () => {
    const file = helpers.resolveOptions({ subtitles: { burn: { kind: 'file' } } });
    assert.strictEqual(file.options.subtitles.burn.kind, 'none');
    const noTracks = helpers.resolveOptions({ subtitles: { burn: { kind: 'track' } } }, { probe: { ...PROBE, subtitleTracks: [] } });
    assert.strictEqual(noTracks.options.subtitles.burn.kind, 'none');
    assert.ok(noTracks.warnings.some((w) => /no subtitle track/i.test(w)));
  });

  test('"first track" for burn-in resolves to the first text subtitle track', () => {
    const probe = { ...PROBE, subtitleTracks: [{ index: 0, codec: 'hdmv_pgs_subtitle', text: false }, { index: 1, codec: 'subrip', text: true }] };
    const resolved = helpers.resolveOptions({ subtitles: { burn: { kind: 'track', trackIndex: null } } }, { probe });
    assert.strictEqual(resolved.options.subtitles.burn.kind, 'track');
    assert.strictEqual(resolved.options.subtitles.burn.trackIndex, 1);
  });

  test('the output suffix cannot carry folders or traversal', () => {
    const resolved = helpers.resolveOptions({ output: { suffix: ' (x)/../..\\evil' } });
    assert.ok(!/[\\/]/.test(resolved.options.output.suffix), resolved.options.output.suffix);
    assert.ok(!resolved.options.output.suffix.includes('..'));
    const out = helpers.buildOutputPath('C:/v/a.mp4', resolved.options, () => false);
    assert.strictEqual(path.dirname(out).replace(/\\/g, '/'), 'C:/v');
  });

  test('MOV cannot hold AV1 or VP9, so the container changes with a note', () => {
    const av1 = helpers.resolveOptions({ codec: 'av1', container: 'mov' });
    assert.strictEqual(av1.options.container, 'mp4');
    const vp9 = helpers.resolveOptions({ codec: 'vp9', container: 'mov' });
    assert.strictEqual(vp9.options.container, 'mkv');
    assert.ok(vp9.notes.some((n) => /MOV/.test(n)));
  });

  test('a silent source reserves no audio bitrate', () => {
    const silent = { ...PROBE, audioTracks: [] };
    const resolved = helpers.resolveOptions({ mode: 'size', targetSizeMB: 5 }, { probe: silent });
    assert.strictEqual(helpers.audioBitrateForEstimate(silent, resolved.options), 0);
  });

  test('soft subtitles are dropped when the speed changes', () => {
    const resolved = helpers.resolveOptions({ container: 'mkv', speedFactor: 2, subtitles: { keepSoft: true } });
    assert.strictEqual(resolved.options.subtitles.keepSoft, false);
  });
});

describe('compressor helpers: container compatibility', () => {
  test('WebM switches H.264 to VP9 and AAC to Opus with notes', () => {
    const resolved = helpers.resolveOptions({ container: 'webm' });
    assert.strictEqual(resolved.options.codec, 'vp9');
    assert.strictEqual(resolved.options.audio.mode, 'encode');
    assert.strictEqual(resolved.options.audio.codec, 'opus');
    assert.ok(resolved.notes.some((n) => /VP9/.test(n)));
    assert.ok(resolved.notes.some((n) => /Opus/.test(n)));
  });

  test('WebM keeps AV1 footage as AV1', () => {
    const resolved = helpers.resolveOptions({ container: 'webm', codec: 'av1' });
    assert.strictEqual(resolved.options.codec, 'av1');
  });

  test('mp3 audio in WebM becomes Opus', () => {
    const resolved = helpers.resolveOptions({ container: 'webm', codec: 'vp9', audio: { mode: 'encode', codec: 'mp3' } });
    assert.strictEqual(resolved.options.audio.codec, 'opus');
    assert.ok(resolved.notes.some((n) => /MP3|Opus/.test(n)));
  });

  test('Opus audio in MP4 becomes AAC', () => {
    const resolved = helpers.resolveOptions({ container: 'mp4', audio: { mode: 'encode', codec: 'opus' } });
    assert.strictEqual(resolved.options.audio.codec, 'aac');
    assert.ok(resolved.notes.some((n) => /Opus/.test(n)));
  });

  test('a WebM audio copy is re-encoded', () => {
    const resolved = helpers.resolveOptions({ container: 'webm', codec: 'vp9', audio: { mode: 'copy' } }, { probe: PROBE });
    assert.strictEqual(resolved.options.audio.mode, 'encode');
    assert.strictEqual(resolved.options.audio.codec, 'opus');
  });

  test('audio copy falls back to encode when the source codec does not fit MP4', () => {
    const probe = { ...PROBE, audioTracks: [{ index: 0, codec: 'opus', channels: 2 }] };
    const resolved = helpers.resolveOptions({ container: 'mp4', audio: { mode: 'copy' } }, { probe });
    assert.strictEqual(resolved.options.audio.mode, 'encode');
    assert.strictEqual(resolved.options.audio.codec, 'aac');
    assert.ok(resolved.notes.some((n) => /re-encoded/.test(n)));
  });

  test('audio copy survives in MP4 for compatible source codecs', () => {
    const resolved = helpers.resolveOptions({ container: 'mp4', audio: { mode: 'copy' } }, { probe: PROBE });
    assert.strictEqual(resolved.options.audio.mode, 'copy');
  });

  test('audio copy falls back when the stream is transformed', () => {
    const cases = [
      [{ audio: { mode: 'copy' }, speedFactor: 2 }, /playback speed/],
      [{ audio: { mode: 'copy', normalize: true } }, /normalization/],
      [{ audio: { mode: 'copy', volumeDb: -6 } }, /volume/],
      [{ audio: { mode: 'copy', channels: 1 } }, /channel layout/],
      [{ audio: { mode: 'copy', trackIndex: 1 } }, /specific track/]
    ];
    for (const [input, pattern] of cases) {
      const resolved = helpers.resolveOptions(input, { probe: PROBE });
      assert.strictEqual(resolved.options.audio.mode, 'encode', `expected fallback for ${JSON.stringify(input)}`);
      assert.ok(resolved.notes.some((n) => pattern.test(n)), `missing note ${pattern}`);
    }
  });
});

describe('compressor helpers: convert-only (remux)', () => {
  test('remux clears every filter and warns about the ones that were set', () => {
    const resolved = helpers.resolveOptions({
      mode: 'remux', maxHeight: 720, maxFps: 30, rotate: 90, flipH: true, deinterlace: true,
      denoise: 'strong', speedFactor: 2, crop: { top: 8, bottom: 8, left: 0, right: 0 },
      subtitles: { burn: { kind: 'file', filePath: 'C:/subs.srt' } }
    }, { probe: PROBE });
    assert.strictEqual(resolved.encoder, '');
    const o = resolved.options;
    assert.strictEqual(o.maxHeight, null);
    assert.strictEqual(o.maxFps, null);
    assert.strictEqual(o.rotate, 0);
    assert.strictEqual(o.flipH, false);
    assert.strictEqual(o.deinterlace, false);
    assert.strictEqual(o.denoise, 'off');
    assert.strictEqual(o.speedFactor, 1);
    assert.strictEqual(o.crop, null);
    assert.strictEqual(o.subtitles.burn.kind, 'none');
    assert.ok(resolved.warnings.some((w) => /Convert only/.test(w)));
  });

  test('a plain remux produces no warning and copies both streams', () => {
    const { resolved, args } = argsFor({ mode: 'remux' });
    assert.deepStrictEqual(resolved.warnings, []);
    assert.ok(args.includes('copy'));
    assert.ok(!args.includes('-vf'));
  });

  test('remux always copies the audio instead of re-encoding it', () => {
    const resolved = helpers.resolveOptions({ mode: 'remux', container: 'mp4' }, { probe: PROBE });
    assert.strictEqual(resolved.options.audio.mode, 'copy');
    assert.ok(joined({ mode: 'remux', container: 'mp4' }).includes('-c:a copy'));
  });

  test('remux always keeps the audio (hidden audio settings never apply)', () => {
    const resolved = helpers.resolveOptions({ mode: 'remux', audio: { mode: 'none', normalize: true } }, { probe: PROBE });
    assert.strictEqual(resolved.options.audio.mode, 'copy');
    assert.strictEqual(resolved.options.audio.normalize, false);
    const cmd = joined({ mode: 'remux', audio: { mode: 'none' } });
    assert.ok(cmd.includes('-map 0:a'));
    assert.ok(!cmd.includes('loudnorm'));
  });

  test('a video codec the target container cannot hold falls back to Matroska', () => {
    const webm = helpers.resolveOptions({ mode: 'remux', container: 'webm' }, { probe: PROBE });
    assert.strictEqual(webm.options.container, 'mkv');
    assert.ok(webm.warnings.some((w) => /Matroska/.test(w)));

    const vp9 = helpers.resolveOptions({ mode: 'remux', container: 'mp4' }, { probe: { ...PROBE, vcodec: 'vp9' } });
    assert.strictEqual(vp9.options.container, 'mkv');
    assert.ok(vp9.warnings.some((w) => /VP9/.test(w)));
  });

  test('compatible codecs stay in the requested container', () => {
    assert.strictEqual(helpers.resolveOptions({ mode: 'remux', container: 'mp4' }, { probe: PROBE }).options.container, 'mp4');
    assert.strictEqual(helpers.resolveOptions({ mode: 'remux', container: 'mov' }, { probe: PROBE }).options.container, 'mov');
    assert.strictEqual(helpers.resolveOptions({ mode: 'remux', container: 'webm' }, { probe: { ...PROBE, vcodec: 'vp9' } }).options.container, 'webm');
  });

  test('remux re-encodes audio the target container cannot hold', () => {
    const probe = { ...PROBE, audioTracks: [{ index: 0, codec: 'flac', channels: 2 }] };
    const resolved = helpers.resolveOptions({ mode: 'remux', container: 'mp4' }, { probe });
    assert.strictEqual(resolved.options.audio.mode, 'encode');
    assert.strictEqual(resolved.options.audio.codec, 'aac');
    assert.ok(resolved.notes.some((n) => /re-encoded/.test(n)));
  });
});

describe('compressor helpers: encoder selection', () => {
  test('auto prefers NVENC before QSV', () => {
    assert.strictEqual(helpers.pickAutoEncoder('h264', CAPABILITIES), 'h264_nvenc');
  });

  test('auto falls back to software when no GPU encoder is verified', () => {
    const caps = { codecs: { h264: [{ name: 'libx264' }] } };
    assert.strictEqual(helpers.pickAutoEncoder('h264', caps), 'libx264');
  });

  test('auto prefers SVT-AV1 over libaom for AV1', () => {
    assert.strictEqual(helpers.pickAutoEncoder('av1', CAPABILITIES), 'av1_nvenc');
    const caps = { codecs: { av1: [{ name: 'libaom-av1' }, { name: 'libsvtav1' }] } };
    assert.strictEqual(helpers.pickAutoEncoder('av1', caps), 'libaom-av1', 'list order wins among software');
  });

  test('auto returns null for a codec the build cannot encode', () => {
    assert.strictEqual(helpers.pickAutoEncoder('vp9', { codecs: { h264: [{ name: 'libx264' }] } }), null);
  });

  test('a requested encoder that is verified is kept', () => {
    const resolved = helpers.resolveOptions({ encoder: 'libx265', codec: 'hevc' }, { capabilities: CAPABILITIES });
    assert.strictEqual(resolved.encoder, 'libx265');
    assert.deepStrictEqual(resolved.warnings, []);
  });

  test('a requested encoder that is missing falls back with a warning', () => {
    const caps = { codecs: { h264: [{ name: 'libx264' }] } };
    const resolved = helpers.resolveOptions({ encoder: 'h264_nvenc' }, { capabilities: caps });
    assert.strictEqual(resolved.encoder, 'libx264');
    assert.ok(resolved.warnings.some((w) => /not available/.test(w)));
  });

  test('hardware encoders and SVT-AV1 are one-pass, the rest are two-pass', () => {
    assert.strictEqual(helpers.isTwoPassEncoder('libx264'), true);
    // libx265 ignores ffmpeg's generic -pass/-passlogfile, so it runs one-pass with the retry.
    assert.strictEqual(helpers.isTwoPassEncoder('libx265'), false);
    assert.strictEqual(helpers.isTwoPassEncoder('libaom-av1'), true);
    assert.strictEqual(helpers.isTwoPassEncoder('libvpx-vp9'), true);
    assert.strictEqual(helpers.isTwoPassEncoder('libsvtav1'), false);
    assert.strictEqual(helpers.isTwoPassEncoder('h264_nvenc'), false);
    assert.strictEqual(helpers.isTwoPassEncoder('hevc_qsv'), false);
    assert.strictEqual(helpers.isTwoPassEncoder('h264_amf'), false);
    assert.strictEqual(helpers.isTwoPassEncoder('h264_videotoolbox'), false);
    assert.strictEqual(helpers.isTwoPassEncoder(''), false);
  });

  test('encoderInfo labels hardware encoders', () => {
    assert.strictEqual(helpers.isHardwareEncoder('h264_nvenc'), true);
    assert.strictEqual(helpers.isHardwareEncoder('libx264'), false);
    assert.strictEqual(helpers.encoderInfo('h264_nvenc').label, 'NVIDIA NVENC H.264');
    assert.strictEqual(helpers.gpuFamily('av1_qsv'), 'qsv');
    assert.strictEqual(helpers.gpuFamily('libx264'), null);
  });
});

describe('compressor helpers: bitrate math', () => {
  test('effective duration applies trim then speed', () => {
    assert.strictEqual(helpers.effectiveDuration({ duration: 100 }, { trim: { start: null, end: null }, speedFactor: 1 }), 100);
    assert.strictEqual(helpers.effectiveDuration({ duration: 100 }, { trim: { start: 10, end: 50 }, speedFactor: 1 }), 40);
    assert.strictEqual(helpers.effectiveDuration({ duration: 100 }, { trim: { start: 10, end: 50 }, speedFactor: 2 }), 20);
    assert.strictEqual(helpers.effectiveDuration({ duration: 100 }, { trim: { start: null, end: null }, speedFactor: 0.5 }), 200);
    assert.strictEqual(helpers.effectiveDuration({ duration: 100 }, { trim: { start: null, end: 500 } }), 100, 'end clamps to duration');
    assert.strictEqual(helpers.effectiveDuration({ duration: 0 }, {}), 0);
  });

  test('target bitrates keep a 4% container margin and subtract audio', () => {
    const bits = helpers.computeTargetBitrates({ targetBytes: 10 * helpers.MB, effectiveDuration: 60, audioKbps: 128 });
    const expectedTotal = Math.floor((10 * helpers.MB * 8 * 0.96) / 60 / 1000);
    assert.strictEqual(bits.totalKbps, expectedTotal);
    assert.strictEqual(bits.audioKbps, 128);
    assert.strictEqual(bits.videoKbps, expectedTotal - 128);
    assert.strictEqual(bits.clamped, false);
  });

  test('tiny targets clamp the video bitrate to 80 kbps', () => {
    const bits = helpers.computeTargetBitrates({ targetBytes: helpers.MB, effectiveDuration: 3600, audioKbps: 128 });
    assert.strictEqual(bits.clamped, true);
    assert.strictEqual(bits.videoKbps, 80);
  });

  test('a low bitrate at a high resolution suggests a 720p cap', () => {
    const bits = helpers.computeTargetBitrates({ targetBytes: 2 * helpers.MB, effectiveDuration: 60, audioKbps: 128 });
    assert.strictEqual(bits.clamped, false);
    assert.strictEqual(bits.suggestLowerResolution, true);

    const high = helpers.computeTargetBitrates({ targetBytes: 40 * helpers.MB, effectiveDuration: 60, audioKbps: 128 });
    assert.strictEqual(high.suggestLowerResolution, false);

    const noAudio = helpers.computeTargetBitrates({ targetBytes: 2 * helpers.MB, effectiveDuration: 60, audioKbps: 0 });
    assert.strictEqual(noAudio.videoKbps, noAudio.totalKbps);
  });

  test('zero or negative durations clamp instead of dividing by zero', () => {
    const bits = helpers.computeTargetBitrates({ targetBytes: 5 * helpers.MB, effectiveDuration: 0, audioKbps: 128 });
    assert.strictEqual(bits.totalKbps, 0);
    assert.strictEqual(bits.clamped, true);
    assert.ok(Number.isFinite(bits.videoKbps));
  });

  test('size targets come from MB, or from a percentage of the input', () => {
    assert.strictEqual(helpers.targetBytesFor(PROBE, { targetSizeMB: 10, targetSizePercent: null }), 10 * helpers.MB);
    assert.strictEqual(helpers.targetBytesFor(PROBE, { targetSizeMB: 10, targetSizePercent: 50 }), 50 * helpers.MB);
    assert.strictEqual(helpers.targetBytesFor({ size: 0 }, { targetSizeMB: 12, targetSizePercent: 50 }), 12 * helpers.MB);
    assert.strictEqual(helpers.targetBytesFor(PROBE, { targetSizePercent: 150 }), 99 * helpers.MB, 'percent caps at 99');
  });

  test('estimate in size mode is exact and marks a clamped target', () => {
    const exact = helpers.estimate({ probe: PROBE, options: { mode: 'size', targetSizeMB: 10, encoder: 'libx264' } });
    assert.strictEqual(exact.estimateKind, 'exact-target');
    assert.strictEqual(exact.estimatedBytes, 10 * helpers.MB);
    assert.ok(exact.videoKbps > 0);
    assert.ok(exact.warnings.every((w) => !/clamped/.test(w)));

    const clamped = helpers.estimate({ probe: PROBE, options: { mode: 'size', targetSizeMB: 1 } });
    assert.ok(clamped.warnings.some((w) => /clamped/i.test(w)));
    assert.ok(clamped.estimatedBytes > helpers.MB, 'a clamped target cannot reach the request');
  });

  test('estimate in quality mode is a heuristic and remux uses the input size', () => {
    const quality = helpers.estimate({ probe: PROBE, options: { mode: 'quality', quality: 70 } });
    assert.strictEqual(quality.estimateKind, 'heuristic');
    assert.ok(quality.videoKbps > 0);
    assert.ok(quality.estimatedBytes > 0);

    const remux = helpers.estimate({ probe: PROBE, options: { mode: 'remux' } });
    assert.strictEqual(remux.estimateKind, 'remux');
    assert.strictEqual(remux.estimatedBytes, Math.round(PROBE.size * 0.99));
  });

  test('estimate reports the output size and auto-caps a low bitrate at 720p', () => {
    const resolved = helpers.resolveOptions({ mode: 'size', targetSizeMB: 3 }, { probe: PROBE });
    assert.strictEqual(resolved.options.maxHeight, 720);
    assert.ok(resolved.notes.some((n) => /720p/.test(n)));
    const est = helpers.estimate({ probe: PROBE, options: { mode: 'size', targetSizeMB: 3 } });
    assert.strictEqual(est.outputHeight, 720);
    assert.strictEqual(est.outputWidth, 1280);
  });

  test('bigger quality values estimate a bigger file', () => {
    const low = helpers.estimate({ probe: PROBE, options: { mode: 'quality', quality: 20 } });
    const high = helpers.estimate({ probe: PROBE, options: { mode: 'quality', quality: 95 } });
    assert.ok(high.videoKbps > low.videoKbps);
  });
});

describe('compressor helpers: rate control and speed', () => {
  test('x264 and x265 CRF follow round(34|36 - q*0.18)', () => {
    assert.strictEqual(helpers.x264Crf(0), 34);
    assert.strictEqual(helpers.x264Crf(100), 16);
    assert.strictEqual(helpers.x264Crf(70), 21);
    assert.strictEqual(helpers.x265Crf(0), 36);
    assert.strictEqual(helpers.x265Crf(100), 18);
  });

  test('quality maps to the right args for every encoder family', () => {
    assert.deepStrictEqual(helpers.qualityToRateControl('libx264', 70), ['-crf', '21']);
    assert.deepStrictEqual(helpers.qualityToRateControl('libx265', 70), ['-crf', '23']);
    assert.deepStrictEqual(helpers.qualityToRateControl('libaom-av1', 70), ['-crf', '31']);
    assert.deepStrictEqual(helpers.qualityToRateControl('libsvtav1', 70), ['-crf', '31']);
    assert.deepStrictEqual(helpers.qualityToRateControl('libvpx-vp9', 70), ['-crf', '29', '-b:v', '0']);
    assert.deepStrictEqual(helpers.qualityToRateControl('h264_nvenc', 70), ['-rc', 'vbr', '-cq', '21', '-b:v', '0']);
    assert.deepStrictEqual(helpers.qualityToRateControl('av1_qsv', 70), ['-global_quality', '21']);
    assert.deepStrictEqual(helpers.qualityToRateControl('h264_amf', 70), ['-rc', 'cqp', '-qp_i', '21', '-qp_p', '21']);
    assert.deepStrictEqual(helpers.qualityToRateControl('h264_videotoolbox', 70), ['-q:v', '65']);
  });

  test('quality is clamped before it reaches the encoder', () => {
    assert.deepStrictEqual(helpers.qualityToRateControl('libx264', -50), helpers.qualityToRateControl('libx264', 0));
    assert.deepStrictEqual(helpers.qualityToRateControl('libx264', 900), helpers.qualityToRateControl('libx264', 100));
  });

  test('speed maps to per-encoder preset args', () => {
    assert.deepStrictEqual(helpers.speedToPresetArgs('libx264', 'fast'), ['-preset', 'veryfast']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('libx264', 'balanced'), ['-preset', 'medium']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('libx265', 'slow'), ['-preset', 'slow']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('h264_nvenc', 'slow'), ['-preset', 'p7', '-tune', 'hq']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('h264_qsv', 'fast'), ['-preset', 'veryfast']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('hevc_amf', 'slow'), ['-quality', 'quality']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('libaom-av1', 'fast'), ['-cpu-used', '8', '-row-mt', '1']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('libsvtav1', 'balanced'), ['-preset', '8']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('libvpx-vp9', 'slow'), ['-deadline', 'good', '-cpu-used', '1', '-row-mt', '1']);
    assert.deepStrictEqual(helpers.speedToPresetArgs('unknown_encoder', 'fast'), []);
  });

  test('an unknown speed behaves like balanced', () => {
    assert.deepStrictEqual(helpers.speedToPresetArgs('libx264', 'turbo'), ['-preset', 'medium']);
  });
});

describe('compressor helpers: filters', () => {
  test('filter chain order is deinterlace, crop, scale, fps, rotate/flip, denoise, subs, setpts', () => {
    const chain = helpers.buildVideoFilters({
      mode: 'quality',
      deinterlace: true,
      crop: { top: 10, bottom: 10, left: 0, right: 0 },
      maxHeight: 480,
      maxFps: 30,
      rotate: 90,
      flipH: true,
      flipV: true,
      denoise: 'medium',
      speedFactor: 2,
      codec: 'h264',
      subtitles: { burn: { kind: 'file', filePath: 'C:/subs.srt' } }
    }, { width: 1920, height: 1080, fps: 60 }, 'libx264');
    const parts = chain.split(',');
    const order = ['bwdif', 'crop=', 'scale=', 'fps=', 'transpose=', 'hflip', 'vflip', 'hqdn3d=', 'subtitles=', 'setpts='];
    let cursor = -1;
    for (const tag of order) {
      const idx = parts.findIndex((p, i) => i > cursor && p.startsWith(tag));
      assert.ok(idx > cursor, `filter ${tag} is missing or out of order in ${chain}`);
      cursor = idx;
    }
  });

  test('the scale filter keeps the aspect ratio and never upscales', () => {
    const chain = helpers.buildVideoFilters({ mode: 'quality', maxHeight: 720, codec: 'h264' }, PROBE, 'libx264');
    assert.ok(chain.includes("scale=-2:'trunc(min(ih,720)/2)*2':flags=bicubic"), chain);
    assert.ok(chain.endsWith(',format=yuv420p'));
  });

  test('the fps filter is skipped when the source is already slower', () => {
    const chain = helpers.buildVideoFilters({ mode: 'quality', maxFps: 60, codec: 'h264' }, PROBE, 'libx264');
    assert.ok(!chain.includes('fps='), 'must not raise the frame rate');
    const slowSource = helpers.buildVideoFilters({ mode: 'quality', maxFps: 30, codec: 'h264' }, { ...PROBE, fps: 60 }, 'libx264');
    assert.ok(slowSource.includes('fps=30'));
  });

  test('rotation maps to transpose, 180 is two flips', () => {
    assert.strictEqual(helpers.buildVideoFilters({ rotate: 90, codec: 'vp9' }, PROBE, 'libvpx-vp9'), 'transpose=1');
    assert.strictEqual(helpers.buildVideoFilters({ rotate: 180, codec: 'vp9' }, PROBE, 'libvpx-vp9'), 'transpose=1,transpose=1');
    assert.strictEqual(helpers.buildVideoFilters({ rotate: 270, codec: 'vp9' }, PROBE, 'libvpx-vp9'), 'transpose=2');
  });

  test('yuv420p is added for software H.264/HEVC only', () => {
    const software = helpers.buildVideoFilters({ mode: 'quality', maxHeight: 720, codec: 'h264' }, PROBE, 'libx264');
    assert.ok(software.includes('format=yuv420p'));
    const hardware = helpers.buildVideoFilters({ mode: 'quality', maxHeight: 720, codec: 'h264' }, PROBE, 'h264_nvenc');
    assert.ok(!hardware.includes('format=yuv420p'));
    const vp9 = helpers.buildVideoFilters({ mode: 'quality', maxHeight: 720, codec: 'vp9' }, PROBE, 'libvpx-vp9');
    assert.ok(!vp9.includes('format=yuv420p'));
  });

  test('an empty option set builds no filter chain', () => {
    assert.strictEqual(helpers.buildVideoFilters({ mode: 'quality', codec: 'vc1' }, PROBE, 'libx264'), '');
    assert.strictEqual(helpers.buildAudioFilters({ speedFactor: 1, audio: { normalize: false, volumeDb: 0 } }), '');
  });

  test('atempo splits factors outside 0.5-2.0', () => {
    assert.deepStrictEqual(helpers.splitAtempo(1), []);
    assert.deepStrictEqual(helpers.splitAtempo(2), [2]);
    assert.deepStrictEqual(helpers.splitAtempo(4), [2, 2]);
    assert.deepStrictEqual(helpers.splitAtempo(0.25), [0.5, 0.5]);
    assert.deepStrictEqual(helpers.splitAtempo(3), [2, 1.5]);
    assert.deepStrictEqual(helpers.splitAtempo(0.3), [0.5, 0.6]);
    for (const factor of [0.25, 0.5, 1.5, 2, 3, 4]) {
      const parts = helpers.splitAtempo(factor);
      const product = parts.reduce((a, b) => a * b, 1);
      assert.ok(Math.abs(product - factor) < 0.001, `${factor} split into ${parts} = ${product}`);
    }
  });

  test('audio filters run atempo, then loudnorm, then volume', () => {
    const chain = helpers.buildAudioFilters({ speedFactor: 2, audio: { normalize: true, volumeDb: -3 } });
    assert.strictEqual(chain, 'atempo=2,loudnorm=I=-16:TP=-1.5:LRA=11,volume=-3dB');
  });

  test('filter paths are escaped for the subtitles filter', () => {
    // Two levels: the option value (\\ ' :) and then the filtergraph (\\ ' [ ] , ;).
    assert.strictEqual(helpers.escapeFilterPath('C:\\subs\\file.srt'), 'C\\\\:/subs/file.srt');
    assert.strictEqual(helpers.escapeFilterPath("D:/a[1],b'c.srt"), "D\\\\:/a\\[1\\]\\,b\\\\\\'c.srt");
    assert.strictEqual(helpers.escapeFilterPath(null), '');
  });
});

describe('compressor helpers: output paths', () => {
  test('the default output sits next to the input with the suffix', () => {
    const out = helpers.buildOutputPath('C:/in/movie.mp4', { container: 'mp4', output: { dir: null, suffix: ' (compressed)' } }, () => false);
    assert.strictEqual(path.basename(out), 'movie (compressed).mp4');
  });

  test('the container picks the extension', () => {
    for (const container of ['mp4', 'mkv', 'webm', 'mov']) {
      const out = helpers.buildOutputPath('C:/in/movie.mkv', { container, output: { suffix: '' } }, () => false);
      assert.strictEqual(path.extname(out), helpers.CONTAINER_EXT[container], container);
    }
  });

  test('an explicit directory is used', () => {
    const out = helpers.buildOutputPath('C:/in/movie.mp4', { container: 'mp4', output: { dir: 'C:/out', suffix: ' (small)' } }, () => false);
    assert.strictEqual(path.normalize(out), path.normalize(path.join('C:/out', 'movie (small).mp4')));
  });

  test('collisions get an increasing counter and never overwrite an input', () => {
    let calls = 0;
    // Only the first candidate exists on disk, so the second name is taken.
    const out = helpers.buildOutputPath('C:/in/movie.mp4', { container: 'mp4', output: { suffix: '' } }, () => {
      calls += 1;
      return calls === 1;
    });
    assert.strictEqual(path.basename(out), 'movie 2.mp4');

    let existing = new Set(['movie.mp4', 'movie 2.mp4', 'movie 3.mp4']);
    const third = helpers.buildOutputPath('C:/in/movie.mp4', { container: 'mp4', output: { suffix: '' } },
      (p) => existing.has(path.basename(p)));
    assert.strictEqual(path.basename(third), 'movie 4.mp4');

    // A suffix-less mkv -> mkv build would equal the input: it must bump instead.
    const sameExt = helpers.buildOutputPath('C:/in/movie.mkv', { container: 'mkv', output: { suffix: '' } }, () => false);
    assert.strictEqual(path.basename(sameExt), 'movie 2.mkv');
  });

  test('partial and null outputs follow the spec', () => {
    assert.strictEqual(helpers.partialPath('C:/out/x.mp4'), 'C:/out/x.mp4.partial');
    assert.strictEqual(helpers.nullOutputPath('win32'), 'NUL');
    assert.strictEqual(helpers.nullOutputPath('darwin'), '/dev/null');
    assert.strictEqual(helpers.nullOutputPath('linux'), '/dev/null');
  });

  test('filenames are sanitized', () => {
    assert.strictEqual(helpers.sanitizeFilename('a<b>c:d.mp4'), 'a_b_c_d.mp4');
    assert.strictEqual(helpers.sanitizeFilename('  spaced   out  '), 'spaced out');
    assert.strictEqual(helpers.sanitizeFilename(''), 'untitled');
    assert.strictEqual(helpers.sanitizeFilename('CON'), '_CON');
    assert.strictEqual(helpers.sanitizeFilename('.hidden'), '_hidden');
  });
});

describe('compressor helpers: ffmpeg arguments', () => {
  test('every run starts with the progress flags and hides the banner', () => {
    const { args } = argsFor({});
    assert.deepStrictEqual(args.slice(0, 6), ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', '-i']);
  });

  test('quality mode: single pass with CRF and preset', () => {
    const cmd = joined({ quality: 70, encoder: 'libx264' });
    assert.ok(cmd.includes('-c:v libx264 -crf 21 -preset medium'));
    assert.ok(cmd.includes('-c:a aac -b:a 128k'));
    assert.ok(cmd.includes('-movflags +faststart'));
    assert.ok(cmd.includes('-f mp4'));
    assert.ok(!cmd.includes('-pass '));
  });

  test('size mode pass 1 writes to null with -an, pass 2 to the real file', () => {
    const { args: pass1 } = argsFor({ mode: 'size', targetSizeMB: 10, encoder: 'libx264', speed: 'fast' },
      { pass: 1, passlogfile: 'C:/tmp/job1', nullOutput: true });
    const text = pass1.join(' ');
    assert.ok(text.includes('-b:v 900k'));
    assert.ok(text.includes('-pass 1 -passlogfile C:/tmp/job1'));
    assert.ok(text.includes('-an'));
    assert.ok(text.endsWith('-f null NUL'), text);
    assert.ok(!text.includes('-c:a'));

    const { args: pass2 } = argsFor({ mode: 'size', targetSizeMB: 10, encoder: 'libx264', speed: 'fast' },
      { pass: 2, passlogfile: 'C:/tmp/job1' });
    const text2 = pass2.join(' ');
    assert.ok(text2.includes('-pass 2'));
    assert.ok(text2.includes('-c:a aac'));
    assert.ok(text2.endsWith('-f mp4 C:/out/movie.mp4'), text2);
  });

  test('size mode keeps a floor of 80 kbps', () => {
    const cmd = joined({ mode: 'size', encoder: 'libx264' }, { videoKbps: 12 });
    assert.ok(cmd.includes('-b:v 80k'));
  });

  test('GPU and SVT-AV1 size mode is a single capped VBR pass', () => {
    const gpu = joined({ mode: 'size', encoder: 'h264_nvenc' }, { videoKbps: 900 });
    assert.ok(gpu.includes('-b:v 900k -maxrate 1350k -bufsize 1800k'));
    assert.ok(!gpu.includes('-pass '));

    const svt = joined({ mode: 'size', encoder: 'libsvtav1', codec: 'av1' }, { videoKbps: 900 });
    assert.ok(svt.includes('-maxrate 1350k'));
    assert.ok(!svt.includes('-pass '));
  });

  test('HEVC in MP4 gets the hvc1 tag, MKV does not', () => {
    assert.ok(joined({ codec: 'hevc', container: 'mp4', encoder: 'libx265' }).includes('-tag:v hvc1'));
    assert.ok(!joined({ codec: 'hevc', container: 'mkv', encoder: 'libx265' }).includes('-tag:v hvc1'));
  });

  test('faststart is MP4/MOV only', () => {
    assert.ok(joined({ container: 'mp4' }).includes('-movflags +faststart'));
    assert.ok(joined({ container: 'mov' }).includes('-movflags +faststart'));
    assert.ok(!joined({ container: 'mkv' }).includes('-movflags'));
    assert.ok(!joined({ container: 'webm' }).includes('-movflags'));
  });

  test('containers map to the right muxers', () => {
    assert.ok(joined({ container: 'mp4' }).endsWith('-f mp4 C:/out/movie.mp4'));
    assert.ok(joined({ container: 'mkv' }).endsWith('-f matroska C:/out/movie.mp4'));
    assert.ok(joined({ container: 'webm', codec: 'vp9' }).endsWith('-f webm C:/out/movie.mp4'));
    assert.ok(joined({ container: 'mov' }).endsWith('-f mov C:/out/movie.mp4'));
  });

  test('audio copy, none and a specific track', () => {
    assert.ok(joined({ audio: { mode: 'copy' } }).includes('-c:a copy'));
    assert.ok(!joined({ audio: { mode: 'none' } }).includes('-map 0:a'));
    assert.ok(!joined({ audio: { mode: 'none' } }).includes('-c:a'));
    assert.ok(joined({ audio: { mode: 'encode', trackIndex: 1 } }).includes('-map 0:a:1?'));
    assert.ok(joined({ audio: { mode: 'encode', channels: 2 } }).includes('-ac 2'));
    assert.ok(joined({ audio: { mode: 'encode', channels: 1 } }).includes('-ac 1'));
  });

  test('audio encoders map to ffmpeg names', () => {
    assert.ok(joined({ container: 'webm', codec: 'vp9', audio: { codec: 'opus' } }).includes('-c:a libopus'));
    assert.ok(joined({ container: 'mkv', audio: { codec: 'mp3' } }).includes('-c:a libmp3lame'));
    assert.ok(joined({ container: 'mp4', audio: { codec: 'aac' } }).includes('-c:a aac'));
    assert.strictEqual(helpers.audioCodecName('opus'), 'libopus');
    assert.strictEqual(helpers.audioCodecName('mp3'), 'libmp3lame');
    assert.strictEqual(helpers.audioCodecName('anything'), 'aac');
  });

  test('soft subtitles are mapped and converted per container', () => {
    const mp4 = joined({ subtitles: { keepSoft: true } });
    assert.ok(mp4.includes('-map 0:s:0'), mp4);
    assert.ok(mp4.includes('-c:s mov_text'));
    assert.ok(joined({ subtitles: { keepSoft: true }, container: 'mkv' }).includes('-c:s copy'));
    assert.ok(!joined({ subtitles: { keepSoft: true }, container: 'webm', codec: 'vp9' }).includes('-map 0:s?'));
  });

  test('image-based subtitle tracks are left out of MP4 (mov_text cannot hold them)', () => {
    const probe = { ...PROBE, subtitleTracks: [{ index: 0, codec: 'hdmv_pgs_subtitle', text: false }, { index: 1, codec: 'subrip', text: true }] };
    const args = helpers.buildFfmpegArgs({ inputPath: 'in.mp4', outputPath: 'out.mp4', options: helpers.resolveOptions({ subtitles: { keepSoft: true } }, { probe }).options, probe, encoder: 'libx264' }).join(' ');
    assert.ok(args.includes('-map 0:s:1') && !args.includes('-map 0:s:0'), args);
  });

  test('Opus audio always gets a channel layout libopus accepts', () => {
    const resolved = helpers.resolveOptions({ container: 'webm', codec: 'vp9' }, { probe: PROBE });
    const args = helpers.buildFfmpegArgs({ inputPath: 'in.mp4', outputPath: 'out.webm', options: resolved.options, probe: PROBE, encoder: 'libvpx-vp9' }).join(' ');
    assert.ok(args.includes('aformat=channel_layouts=mono|stereo|quad|5.1|7.1'), args);
  });

  test('HEVC copied into MP4 is tagged hvc1', () => {
    const probe = { ...PROBE, vcodec: 'hevc' };
    const resolved = helpers.resolveOptions({ mode: 'remux', container: 'mp4' }, { probe });
    const args = helpers.buildFfmpegArgs({ inputPath: 'in.mkv', outputPath: 'out.mp4', options: resolved.options, probe, encoder: null }).join(' ');
    assert.ok(args.includes('-tag:v hvc1'), args);
  });

  test('burned subtitles go through -vf with an escaped path', () => {
    const cmd = joined({ subtitles: { burn: { kind: 'file', filePath: 'C:\\my vids\\sub.srt' } } });
    assert.ok(cmd.includes('-vf subtitles=filename=C\\\\:/my vids/sub.srt,format=yuv420p'), cmd);
  });

  test('trim uses input-side -ss unless subtitles are burned', () => {
    // -t is an INPUT option, so it bounds the source range even when the speed changes.
    const plain = joined({ trim: { start: 5, end: 20 }, speedFactor: 2 }, { inputPath: 'in.mp4' });
    assert.ok(plain.includes('-ss 5.000 -t 15.000 -i in.mp4'), plain);

    // Burned subtitles need source timestamps, so the trim moves into the filter graph.
    const burn = joined({ trim: { start: 5, end: 20 }, subtitles: { burn: { kind: 'file', filePath: 'C:/s.srt' } } }, { inputPath: 'in.mp4' });
    assert.ok(!burn.includes('-ss '), burn);
    assert.ok(burn.includes('trim=start=5.000:end=20.000,setpts=PTS-STARTPTS'), burn);
    assert.ok(burn.includes('atrim=start=5.000:end=20.000,asetpts=PTS-STARTPTS'), burn);
  });

  test('strip metadata removes chapters too', () => {
    assert.ok(joined({ stripMetadata: true }).includes('-map_metadata -1 -map_chapters -1'));
  });

  test('remux copies video and audio without filters', () => {
    const cmd = joined({ mode: 'remux', container: 'mkv' });
    assert.ok(cmd.includes('-c:v copy -c:a copy'));
    assert.ok(!cmd.includes('-vf'));
  });

  test('a probe without audio skips the audio map', () => {
    const probe = { ...PROBE, audioTracks: [] };
    const cmd = joined({}, { probe });
    assert.ok(!cmd.includes('-map 0:a'));
  });

  test('progress flag is always present, never as a muxer flag', () => {
    assert.ok(joined({ mode: 'remux' }).includes('-progress pipe:1'));
    assert.ok(joined({ mode: 'remux' }).indexOf('-progress pipe:1') < joined({ mode: 'remux' }).indexOf('-i '));
  });
});

describe('compressor helpers: progress parsing', () => {
  test('parses a full progress block', () => {
    const text = [
      'frame=100',
      'fps=42.5',
      'out_time_us=2500000',
      'total_size=1024',
      'speed=2.4x',
      'progress=continue',
      ''
    ].join('\n');
    const parsed = helpers.parseProgressBlock(text);
    assert.strictEqual(parsed.outTime, 2.5);
    assert.strictEqual(parsed.fps, 42.5);
    assert.strictEqual(parsed.speed, 2.4);
    assert.strictEqual(parsed.totalSize, 1024);
    assert.strictEqual(parsed.frame, 100);
    assert.strictEqual(parsed.done, false);
  });

  test('returns the last complete block only', () => {
    const text = 'out_time_us=1000000\nspeed=1x\nprogress=continue\nout_time_us=9000000\nspeed=3x\nprogress=end\n';
    const parsed = helpers.parseProgressBlock(text);
    assert.strictEqual(parsed.outTime, 9);
    assert.strictEqual(parsed.speed, 3);
    assert.strictEqual(parsed.done, true);
  });

  test('out_time_ms is treated as microseconds (ffmpeg mislabels it)', () => {
    const parsed = helpers.parseProgressBlock('out_time_ms=1500000\nprogress=continue\n');
    assert.strictEqual(parsed.outTime, 1.5);
  });

  test('falls back to the HH:MM:SS out_time line', () => {
    const parsed = helpers.parseProgressBlock('out_time=00:01:02.500000\nprogress=continue\n');
    assert.strictEqual(parsed.outTime, 62.5);
  });

  test('text without progress keys returns null', () => {
    assert.strictEqual(helpers.parseProgressBlock(''), null);
    assert.strictEqual(helpers.parseProgressBlock('hello world'), null);
    assert.strictEqual(helpers.parseProgressBlock(null), null);
    assert.strictEqual(helpers.parseProgressBlock(undefined), null);
  });

  test('a partial trailing block still reports its values', () => {
    const parsed = helpers.parseProgressBlock('frame=7\nfps=28\nout_time_us=8000000');
    assert.strictEqual(parsed.outTime, 8);
    assert.strictEqual(parsed.fps, 28);
  });
});

describe('compressor helpers: probe parsing', () => {
  const STDERR = [
    'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'C:\\in\\movie.mp4\':',
    '  Metadata:',
    '    major_brand     : isom',
    '  Duration: 00:01:02.50, start: 0.000000, bitrate: 13500 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 12000 kb/s, 29.97 fps, 29.97 tbr',
    '  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp, 128 kb/s (default)',
    '    Metadata:',
    '      title           : Main mix',
    '  Stream #0:2(ger): Subtitle: subrip (srt)',
    '  Stream #0:3: Video: mjpeg (Baseline), yuvj420p(pc), 640x360, 90k tbr (attached pic)'
  ].join('\n');

  test('parses the main fields', () => {
    const probe = helpers.parseProbeOutput(STDERR, 'C:/in/movie.mp4', 12345);
    assert.strictEqual(probe.filePath, 'C:/in/movie.mp4');
    assert.strictEqual(probe.filename, 'movie.mp4');
    assert.strictEqual(probe.size, 12345);
    assert.strictEqual(probe.duration, 62.5);
    assert.strictEqual(probe.width, 1920);
    assert.strictEqual(probe.height, 1080);
    assert.strictEqual(probe.fps, 29.97);
    assert.strictEqual(probe.vcodec, 'h264');
    assert.strictEqual(probe.videoKbps, 12000);
    assert.strictEqual(probe.bitrateKbps, 13500);
    assert.strictEqual(probe.container, 'mov,mp4,m4a,3gp,3g2,mj2');
    assert.strictEqual(probe.hasVideo, true);
  });

  test('audio and subtitle tracks are indexed per type', () => {
    const probe = helpers.parseProbeOutput(STDERR, 'x.mp4', 0);
    assert.strictEqual(probe.audioTracks.length, 1);
    assert.deepStrictEqual(probe.audioTracks[0], {
      index: 0, codec: 'aac', channels: 2, lang: 'eng', title: 'Main mix', kbps: 128
    });
    assert.strictEqual(probe.subtitleTracks.length, 1);
    assert.deepStrictEqual(probe.subtitleTracks[0], {
      index: 0, codec: 'subrip', lang: 'ger', title: '', text: true
    });
  });

  test('cover art does not become the main video track', () => {
    const onlyCover = [
      'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'audio.mp4\':',
      '  Duration: 00:03:00.00, start: 0.000000, bitrate: 128 kb/s',
      '  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 96 kb/s',
      '  Stream #0:1: Video: png, rgba(pc), 500x500, 90k tbr (attached pic)'
    ].join('\n');
    const probe = helpers.parseProbeOutput(onlyCover, 'audio.mp4', 1000);
    assert.strictEqual(probe.hasVideo, false);
    assert.strictEqual(probe.audioTracks.length, 1);
    assert.strictEqual(probe.audioTracks[0].channels, 1);
  });

  test('rotation comes from the display matrix', () => {
    const text = `${STDERR}\n  Side data:\n    displaymatrix: rotation of -90.00 degrees`;
    assert.strictEqual(helpers.parseProbeOutput(text, 'x.mp4').rotation, 270);
  });

  test('garbage input yields a safe empty probe', () => {
    const probe = helpers.parseProbeOutput('not ffmpeg output', 'x.mp4');
    assert.strictEqual(probe.duration, 0);
    assert.strictEqual(probe.hasVideo, false);
    assert.deepStrictEqual(probe.audioTracks, []);
    assert.deepStrictEqual(probe.subtitleTracks, []);
  });

  test('empty stderr is handled', () => {
    const probe = helpers.parseProbeOutput('', '', 0);
    assert.strictEqual(probe.filePath, '');
    assert.strictEqual(probe.filename, '');
  });
});

describe('compressor helpers: encoder and filter lists', () => {
  const ENCODERS = [
    'Encoders:',
    ' V..... = Video',
    ' A..... = Audio',
    ' ------',
    ' V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
    ' V....D libx265              libx265 H.265 / HEVC',
    ' V....D libsvtav1            SVT-AV1 (codec av1)',
    ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder',
    ' A....D aac                  AAC (Advanced Audio Coding)',
    ' A....D libopus              libopus Opus'
  ].join('\n');

  test('extracts encoder names', () => {
    const names = helpers.parseEncodersList(ENCODERS);
    assert.deepStrictEqual(names, ['libx264', 'libx265', 'libsvtav1', 'h264_nvenc', 'aac', 'libopus']);
  });

  test('a header-only encoder list is empty', () => {
    assert.deepStrictEqual(helpers.parseEncodersList('Encoders:\n V..... = Video\n'), []);
    assert.deepStrictEqual(helpers.parseEncodersList(null), []);
  });

  const FILTERS = [
    'Filters:',
    ' TSC aap            AA->A       Apply Affine',
    ' T.. scale          V->V        Scale the input video size',
    ' TSC subtitles      V->V        Render text subtitles onto input video',
    ' ... loudnorm       A->A        EBU R128 loudness normalization',
    ' ... bwdif          V->V        Deinterlace'
  ].join('\n');

  test('extracts filter names', () => {
    const names = helpers.parseFiltersList(FILTERS);
    assert.deepStrictEqual(names, ['aap', 'scale', 'subtitles', 'loudnorm', 'bwdif']);
    assert.deepStrictEqual(helpers.parseFiltersList('Filters:\n'), []);
  });
});

describe('compressor helpers: summaries', () => {
  test('size and quality summaries read like the spec examples', () => {
    assert.strictEqual(
      helpers.summarizeOptions({ codec: 'h264', mode: 'size', targetSizeMB: 10, targetSizePercent: null, maxHeight: 720, container: 'mp4' }, 'libx264', PROBE),
      'H.264 · 720p · 10.0 MB target · MP4'
    );
    assert.strictEqual(
      helpers.summarizeOptions({ codec: 'h264', mode: 'quality', quality: 70, maxHeight: null, container: 'mp4', targetSizePercent: null }, 'libx264', PROBE),
      'H.264 · 1080p · quality 70 · MP4'
    );
  });

  test('GPU encoders and percentages are labelled', () => {
    assert.ok(helpers.summarizeOptions({ codec: 'h264', mode: 'size', targetSizeMB: 10, targetSizePercent: 50, maxHeight: null, container: 'mp4' }, 'h264_nvenc', PROBE).includes('H.264 (GPU)'));
    assert.ok(helpers.summarizeOptions({ codec: 'h264', mode: 'size', targetSizeMB: 10, targetSizePercent: 50, maxHeight: null, container: 'mp4' }, 'libx264', PROBE).includes('50% of original'));
  });

  test('remux summary mentions the target container', () => {
    assert.strictEqual(helpers.summarizeOptions({ mode: 'remux', container: 'mkv', codec: 'h264' }, '', PROBE), 'H.264 · convert to MKV');
  });

  test('formatMB keeps the decimal MB scale', () => {
    assert.strictEqual(helpers.formatMB(10 * helpers.MB), '10.0 MB');
    assert.strictEqual(helpers.formatMB(0.5 * helpers.MB), '0.50 MB');
    assert.strictEqual(helpers.formatMB(500 * helpers.MB), '500 MB');
    assert.strictEqual(helpers.MB, 1000000, 'MB is decimal, not binary');
  });
});

describe('compressor helpers: integration (real ffmpeg)', () => {
  const ffmpegOk = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;

  test('size mode lands within 5% of the target', { skip: ffmpegOk ? false : 'ffmpeg is not installed' }, () => {
    const dir = path.join(os.tmpdir(), `yt-dlp-gui-compress-test-${process.pid}`);
    const inputPath = path.join(dir, 'in.mp4');
    const outputPath = path.join(dir, 'out.mp4');
    const passlog = path.join(dir, 'passlog');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const targetBytes = 0.2 * helpers.MB;

    const source = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inputPath
    ], { encoding: 'utf8' });
    assert.strictEqual(source.status, 0, `could not build the sample: ${source.stderr}`);

    const probe = helpers.parseProbeOutput(
      spawnSync('ffmpeg', ['-hide_banner', '-i', inputPath], { encoding: 'utf8' }).stderr || '',
      inputPath,
      fs.statSync(inputPath).size
    );
    assert.ok(probe.duration > 0 && probe.hasVideo, 'sample probe failed');

    const resolved = helpers.resolveOptions(
      { mode: 'size', targetSizeMB: 0.2, encoder: 'libx264', speed: 'fast', audio: { mode: 'none' } },
      { probe }
    );
    assert.strictEqual(resolved.options.audio.mode, 'none', 'the sample has no audio');

    const bits = helpers.computeTargetBitrates({
      targetBytes,
      effectiveDuration: helpers.effectiveDuration(probe, resolved.options),
      audioKbps: 0
    });

    for (const pass of [1, 2]) {
      const args = helpers.buildFfmpegArgs({
        inputPath,
        outputPath,
        options: resolved.options,
        probe,
        encoder: 'libx264',
        pass,
        passlogfile: passlog,
        videoKbps: bits.videoKbps,
        audioKbps: 0,
        nullOutput: pass === 1
      });
      const run = spawnSync('ffmpeg', args, { encoding: 'utf8' });
      assert.strictEqual(run.status, 0, `ffmpeg pass ${pass} failed: ${run.stderr}`);
    }

    const size = fs.statSync(outputPath).size;
    assert.ok(size > 0, 'no output file');
    assert.ok(
      size <= targetBytes * 1.05,
      `output ${size} bytes exceeds target ${targetBytes} x 1.05 (${Math.round(targetBytes * 1.05)})`
    );
    assert.ok(
      size >= targetBytes * 0.3,
      `output ${size} bytes is suspiciously small for target ${targetBytes}`,
      `If this fires the bitrate math is broken, not the encode.`
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Size targets follow the kept part of the source', () => {
  const probe = { size: 100 * helpers.MB, duration: 600, hasVideo: true, audioTracks: [{ index: 0, codec: 'aac' }] };
  test('a target larger than the video is capped at its current size', () => {
    const options = helpers.resolveOptions({ mode: 'size', targetSizeMB: 500 }, { probe }).options;
    assert.strictEqual(helpers.targetBytesFor(probe, options), 100 * helpers.MB);
  });
  test('percent targets scale with the trimmed length', () => {
    const options = helpers.resolveOptions({ mode: 'size', targetSizePercent: 50, trim: { start: 0, end: 60 } }, { probe }).options;
    assert.strictEqual(helpers.targetBytesFor(probe, options), 5 * helpers.MB);
  });
  test('an unknown length warns that a size target cannot be met', () => {
    const resolved = helpers.resolveOptions({ mode: 'size', targetSizeMB: 10 }, { probe: { ...probe, duration: 0 } });
    assert.ok(resolved.warnings.some((w) => /length/.test(w)), resolved.warnings.join(' | '));
  });
});
