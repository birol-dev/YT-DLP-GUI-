'use strict';
// Pure helpers for the Compress tab (no Electron import) so tests can require this under plain Node.
// See docs/compress-spec.md sections 3, 3.1 and 4.1.

const path = require('path');
const fs = require('fs');

// Decimal MB: "10 MB" targets must stay under the real upload limits of Discord / WhatsApp / email.
const MB = 1000000;

const CODECS = ['h264', 'hevc', 'av1', 'vp9'];
const CONTAINERS = ['mp4', 'mkv', 'webm', 'mov'];
const SPEEDS = ['fast', 'balanced', 'slow'];
const DENOISE_LEVELS = ['off', 'light', 'medium', 'strong'];
const AUDIO_CODECS = ['aac', 'opus', 'mp3'];

const CODEC_LABELS = { h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9' };
const CONTAINER_MUXER = { mp4: 'mp4', mkv: 'matroska', webm: 'webm', mov: 'mov' };
const CONTAINER_EXT = { mp4: '.mp4', mkv: '.mkv', webm: '.webm', mov: '.mov' };

// Candidate encoders per codec in the order the spec lists them. compressor.js verifies the
// hardware ones with a tiny real encode before trusting them.
const ENCODER_CANDIDATES = {
  h264: ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'],
  hevc: ['libx265', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox'],
  av1: ['libsvtav1', 'libaom-av1', 'av1_nvenc', 'av1_qsv', 'av1_amf'],
  vp9: ['libvpx-vp9', 'vp9_qsv']
};

const SOFTWARE_NAMES = ['libx264', 'libx265', 'libsvtav1', 'libaom-av1', 'libvpx-vp9'];
// SVT-AV1 has no usable two-pass mode through ffmpeg, so it runs like a one-pass encoder.
const NO_TWO_PASS = ['libsvtav1', 'libx265'];
// Automatic GPU preference order, then the software preference per codec.
const AUTO_GPU_ORDER = ['nvenc', 'qsv', 'amf', 'videotoolbox'];
const SOFTWARE_PREFERENCE = { h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', vp9: 'libvpx-vp9' };

const ENCODER_LABELS = {
  libx264: 'x264 (CPU)',
  libx265: 'x265 (CPU)',
  libsvtav1: 'SVT-AV1 (CPU)',
  'libaom-av1': 'libaom AV1 (CPU)',
  'libvpx-vp9': 'libvpx VP9 (CPU)',
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC',
  av1_nvenc: 'NVIDIA NVENC AV1',
  h264_qsv: 'Intel Quick Sync H.264',
  hevc_qsv: 'Intel Quick Sync HEVC',
  av1_qsv: 'Intel Quick Sync AV1',
  vp9_qsv: 'Intel Quick Sync VP9',
  h264_amf: 'AMD AMF H.264',
  hevc_amf: 'AMD AMF HEVC',
  av1_amf: 'AMD AMF AV1',
  h264_videotoolbox: 'Apple VideoToolbox H.264',
  hevc_videotoolbox: 'Apple VideoToolbox HEVC'
};

// ---------------------------------------------------------------------------------------------
// Presets and defaults (spec 1.8 and section 3)
// ---------------------------------------------------------------------------------------------

function builtInPreset(id, label, description, options) {
  return { id, label, builtIn: true, description, options };
}

const BUILT_IN_PRESETS = [
  builtInPreset('discord', 'Discord (10 MB)', 'H.264 at 720p/30fps, AAC 96k, under 10 MB', {
    mode: 'size', targetSizeMB: 10, codec: 'h264', maxHeight: 720, maxFps: 30,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 96 }, container: 'mp4'
  }),
  builtInPreset('discord-nitro', 'Discord Nitro (500 MB)', 'H.264 at 1080p, AAC 128k, under 500 MB', {
    mode: 'size', targetSizeMB: 500, codec: 'h264', maxHeight: 1080,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('whatsapp', 'WhatsApp (16 MB)', 'H.264 at 720p/30fps, AAC 96k, under 16 MB', {
    mode: 'size', targetSizeMB: 16, codec: 'h264', maxHeight: 720, maxFps: 30,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 96 }, container: 'mp4'
  }),
  builtInPreset('email', 'Email (25 MB)', 'H.264 at 720p, AAC 96k, under 25 MB', {
    mode: 'size', targetSizeMB: 25, codec: 'h264', maxHeight: 720,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 96 }, container: 'mp4'
  }),
  builtInPreset('telegram', 'Telegram', 'H.264 at 1080p, quality 65, AAC 128k', {
    mode: 'quality', quality: 65, codec: 'h264', maxHeight: 1080,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('x', 'X / Twitter', 'H.264 at 1080p/60fps, quality 70, AAC 128k', {
    mode: 'quality', quality: 70, codec: 'h264', maxHeight: 1080, maxFps: 60,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('reels', 'Instagram Reels', 'H.264 at 1080p/30fps, quality 72, AAC 128k', {
    mode: 'quality', quality: 72, codec: 'h264', maxHeight: 1080, maxFps: 30,
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('youtube', 'YouTube upload', 'H.264 at source resolution, quality 88, AAC 192k', {
    mode: 'quality', quality: 88, codec: 'h264',
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 192 }, container: 'mp4'
  }),
  builtInPreset('half', 'Half the size', 'H.264 at the same resolution, 50% of the original size', {
    mode: 'size', targetSizePercent: 50, codec: 'h264',
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('hevc-archive', 'Smaller (HEVC)', 'HEVC at quality 70, AAC 128k, hvc1 tag', {
    mode: 'quality', quality: 70, codec: 'hevc',
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 128 }, container: 'mp4'
  }),
  builtInPreset('av1-smallest', 'Smallest (AV1)', 'AV1 at quality 55, 96k audio', {
    mode: 'quality', quality: 55, codec: 'av1',
    audio: { mode: 'encode', codec: 'aac', bitrateKbps: 96 }, container: 'mp4'
  }),
  builtInPreset('remux-mp4', 'Convert to MP4', 'Lossless stream copy into MP4, no filters', {
    mode: 'remux', container: 'mp4'
  })
];

const DEFAULT_OPTIONS = {
  presetId: null,
  mode: 'quality',
  targetSizeMB: 10,
  targetSizePercent: null,
  quality: 70,
  codec: 'h264',
  encoder: 'auto',
  speed: 'balanced',
  container: 'mp4',
  maxHeight: null,
  maxFps: null,
  trim: { start: null, end: null },
  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
  deinterlace: false,
  denoise: 'off',
  speedFactor: 1,
  audio: {
    mode: 'encode',
    codec: 'aac',
    bitrateKbps: 128,
    channels: 'source',
    trackIndex: null,
    normalize: false,
    volumeDb: 0
  },
  subtitles: {
    burn: { kind: 'none', trackIndex: null, filePath: null },
    keepSoft: false
  },
  stripMetadata: false,
  output: { dir: null, suffix: ' (compressed)' }
};

// ---------------------------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------------------------

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampNumber(value, min, max, fallback) {
  const n = toNumber(value);
  if (n === null) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeSpeedFactor(value) {
  return clampNumber(value, 0.25, 4, 1);
}

// Same rules as divider.js: unicode-safe, no Windows-reserved names, bounded length.
function sanitizeFilename(name, fallback = 'untitled') {
  let result = String(name === null || name === undefined ? '' : name)
    .normalize('NFC')
    .replace(/[<>:"/\\|?*%\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (result.length > 100) result = Array.from(result).slice(0, 100).join('');
  result = result.replace(/[. ]+$/, '').replace(/^\.+/, (dots) => '_'.repeat(dots.length));
  if (!result) return fallback;
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(result)) result = `_${result}`;
  return result;
}

function isHardwareEncoder(name) {
  return typeof name === 'string' && /_(nvenc|qsv|amf|videotoolbox)$/.test(name);
}

function gpuFamily(name) {
  if (!isHardwareEncoder(name)) return null;
  const m = String(name).match(/_(nvenc|qsv|amf|videotoolbox)$/);
  return m ? m[1] : null;
}

function encoderInfo(name) {
  return {
    name: name || null,
    label: ENCODER_LABELS[name] || (name || 'Unknown encoder'),
    hardware: isHardwareEncoder(name),
    twoPass: !!name && !isHardwareEncoder(name) && !NO_TWO_PASS.includes(name)
  };
}

function isTwoPassEncoder(name) {
  return encoderInfo(name).twoPass;
}

function cloneOptions(options) {
  return {
    ...options,
    trim: { ...options.trim },
    audio: { ...options.audio },
    subtitles: { burn: { ...options.subtitles.burn }, keepSoft: options.subtitles.keepSoft },
    output: { ...options.output },
    crop: options.crop ? { ...options.crop } : null
  };
}

function findPreset(id, customPresets) {
  if (!id) return null;
  const builtIn = BUILT_IN_PRESETS.find((p) => p.id === id);
  if (builtIn) return builtIn;
  return (customPresets || []).find((p) => p && p.id === id) || null;
}

function resolvePresetList(customPresets) {
  const builtIn = BUILT_IN_PRESETS.map((p) => ({ ...p, options: { ...p.options } }));
  const custom = (customPresets || [])
    .filter((p) => p && typeof p === 'object' && p.id)
    .map((p) => ({
      id: p.id,
      label: p.label || p.id,
      builtIn: false,
      description: p.description || '',
      options: p.options && typeof p.options === 'object' ? { ...p.options } : {}
    }));
  return { builtIn, custom };
}

// Apply a (possibly partial) options object on top of already resolved options.
// `undefined` means "not provided"; `null` is meaningful for the fields that allow it.
function applyOptions(target, source) {
  if (!source || typeof source !== 'object') return target;
  if (source.mode !== undefined) target.mode = oneOf(source.mode, ['size', 'quality', 'remux'], target.mode);
  if (source.targetSizeMB !== undefined) {
    const n = toNumber(source.targetSizeMB);
    if (n !== null && n > 0) target.targetSizeMB = n;
  }
  if (source.targetSizePercent !== undefined) {
    const n = toNumber(source.targetSizePercent);
    target.targetSizePercent = n === null ? null : Math.min(99, Math.max(1, n));
  }
  if (source.quality !== undefined) target.quality = Math.round(clampNumber(source.quality, 0, 100, target.quality));
  if (source.codec !== undefined) target.codec = oneOf(source.codec, CODECS, target.codec);
  if (source.encoder !== undefined && source.encoder !== null && source.encoder !== '') {
    target.encoder = typeof source.encoder === 'string' ? source.encoder : target.encoder;
  }
  if (source.speed !== undefined) target.speed = oneOf(source.speed, SPEEDS, target.speed);
  if (source.container !== undefined) target.container = oneOf(source.container, CONTAINERS, target.container);
  if (source.maxHeight !== undefined) {
    const n = toNumber(source.maxHeight);
    target.maxHeight = n === null ? null : oneOf(n, [2160, 1440, 1080, 720, 480, 360], null);
  }
  if (source.maxFps !== undefined) {
    const n = toNumber(source.maxFps);
    target.maxFps = n === null ? null : oneOf(n, [60, 30, 24, 15], null);
  }
  if (source.trim !== undefined && source.trim !== null) {
    const start = toNumber(source.trim.start);
    const end = toNumber(source.trim.end);
    target.trim = {
      start: start !== null && start > 0 ? start : null,
      end: end !== null && end > 0 ? end : null
    };
  }
  if (source.crop !== undefined) {
    if (source.crop === null) {
      target.crop = null;
    } else {
      const crop = {
        top: Math.max(0, Math.round(toNumber(source.crop.top) || 0)),
        bottom: Math.max(0, Math.round(toNumber(source.crop.bottom) || 0)),
        left: Math.max(0, Math.round(toNumber(source.crop.left) || 0)),
        right: Math.max(0, Math.round(toNumber(source.crop.right) || 0))
      };
      target.crop = (crop.top || crop.bottom || crop.left || crop.right) ? crop : null;
    }
  }
  if (source.rotate !== undefined) target.rotate = oneOf(toNumber(source.rotate), [0, 90, 180, 270], target.rotate);
  if (source.flipH !== undefined) target.flipH = !!source.flipH;
  if (source.flipV !== undefined) target.flipV = !!source.flipV;
  if (source.deinterlace !== undefined) target.deinterlace = !!source.deinterlace;
  if (source.denoise !== undefined) target.denoise = oneOf(source.denoise, DENOISE_LEVELS, target.denoise);
  if (source.speedFactor !== undefined) target.speedFactor = normalizeSpeedFactor(source.speedFactor);
  if (source.audio !== undefined && source.audio !== null) {
    const a = source.audio;
    if (a.mode !== undefined) target.audio.mode = oneOf(a.mode, ['copy', 'encode', 'none'], target.audio.mode);
    if (a.codec !== undefined) target.audio.codec = oneOf(a.codec, AUDIO_CODECS, target.audio.codec);
    if (a.bitrateKbps !== undefined) target.audio.bitrateKbps = clampNumber(a.bitrateKbps, 48, 320, target.audio.bitrateKbps);
    if (a.channels !== undefined) {
      const n = toNumber(a.channels);
      target.audio.channels = n === 1 || n === 2 ? n : 'source';
    }
    if (a.trackIndex !== undefined) {
      const n = toNumber(a.trackIndex);
      target.audio.trackIndex = n !== null && n >= 0 ? Math.floor(n) : null;
    }
    if (a.normalize !== undefined) target.audio.normalize = !!a.normalize;
    if (a.volumeDb !== undefined) target.audio.volumeDb = clampNumber(a.volumeDb, -30, 30, 0);
  }
  if (source.subtitles !== undefined && source.subtitles !== null) {
    const s = source.subtitles;
    if (s.burn !== undefined && s.burn !== null) {
      const kind = oneOf(s.burn.kind, ['none', 'track', 'file'], 'none');
      const trackIndex = toNumber(s.burn.trackIndex);
      target.subtitles.burn = {
        kind,
        trackIndex: trackIndex !== null && trackIndex >= 0 ? Math.floor(trackIndex) : null,
        filePath: typeof s.burn.filePath === 'string' && s.burn.filePath ? s.burn.filePath : null
      };
      if (kind === 'file' && !target.subtitles.burn.filePath) target.subtitles.burn.kind = 'none';
      // kind 'track' with no index means "first track"; it is resolved against the probe later.
    }
    if (s.keepSoft !== undefined) target.subtitles.keepSoft = !!s.keepSoft;
  }
  if (source.stripMetadata !== undefined) target.stripMetadata = !!source.stripMetadata;
  if (source.output !== undefined && source.output !== null) {
    if (source.output.dir !== undefined) {
      target.output.dir = typeof source.output.dir === 'string' && source.output.dir.trim() ? source.output.dir.trim() : null;
    }
    if (source.output.suffix !== undefined) {
      target.output.suffix = typeof source.output.suffix === 'string' ? sanitizeSuffix(source.output.suffix) : target.output.suffix;
    }
  }
  return target;
}

// The suffix is appended to a file name, so it may not carry folders, traversal or characters
// that are invalid in Windows/macOS/Linux file names.
function sanitizeSuffix(value) {
  return String(value)
    .replace(/[<>:"/\\|?*%\u0000-\u001f\u007f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------------------------
// Encoder resolution (spec 1.3)
// ---------------------------------------------------------------------------------------------

function verifiedEncoders(codec, capabilities) {
  const list = ((capabilities && capabilities.codecs) || {})[codec];
  if (!Array.isArray(list)) return [];
  return list
    .map((e) => (typeof e === 'string' ? encoderInfo(e) : (e && e.name ? { ...encoderInfo(e.name), ...e } : null)))
    .filter((e) => e && e.name);
}

// Auto pick: first verified GPU in the spec's preference order, else software (SVT-AV1 first for AV1).
function pickAutoEncoder(codec, capabilities) {
  const encoders = verifiedEncoders(codec, capabilities);
  if (encoders.length === 0) return null;
  for (const family of AUTO_GPU_ORDER) {
    const gpu = encoders.find((e) => e.hardware && gpuFamily(e.name) === family);
    if (gpu) return gpu.name;
  }
  const software = encoders.find((e) => !e.hardware);
  return software ? software.name : encoders[0].name;
}

function resolveEncoder(options, capabilities, warnings) {
  const codec = options.codec;
  const requested = options.encoder && options.encoder !== 'auto' ? options.encoder : null;
  if (!requested) {
    const picked = pickAutoEncoder(codec, capabilities) || SOFTWARE_PREFERENCE[codec];
    if (!picked) {
      warnings.push(`This FFmpeg build cannot encode ${CODEC_LABELS[codec] || codec}. Choose another codec.`);
      return '';
    }
    return picked;
  }
  const verified = verifiedEncoders(codec, capabilities);
  if (verified.length === 0) return requested; // no capability list yet: trust the request
  if (verified.some((e) => e.name === requested)) return requested;
  const fallback = pickAutoEncoder(codec, capabilities) || SOFTWARE_PREFERENCE[codec] || '';
  warnings.push(`${requested} is not available for ${CODEC_LABELS[codec] || codec} here; using ${fallback || 'no encoder'}.`);
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Container compatibility and audio copy fallback (spec 3.1)
// ---------------------------------------------------------------------------------------------

function applyContainerCompatibility(options, probe, notes) {
  if (options.container === 'mov' && (options.codec === 'av1' || options.codec === 'vp9')) {
    const next = options.codec === 'av1' ? 'mp4' : 'mkv';
    notes.push(`MOV cannot hold ${CODEC_LABELS[options.codec] || options.codec}; saving as ${next.toUpperCase()} instead.`);
    options.container = next;
  }
  const container = options.container;
  const audio = options.audio;

  if (options.subtitles.keepSoft && normalizeSpeedFactor(options.speedFactor) !== 1) {
    notes.push('Soft subtitles cannot follow a playback-speed change, so they are left out. Burn them in instead.');
    options.subtitles.keepSoft = false;
  }
  if (options.subtitles.keepSoft && options.subtitles.burn.kind !== 'none') {
    notes.push('Subtitles are burned in, so the soft subtitle tracks are left out.');
    options.subtitles.keepSoft = false;
  }

  if (container === 'webm') {
    if (options.codec !== 'vp9' && options.codec !== 'av1') {
      notes.push(`${CODEC_LABELS[options.codec] || options.codec} cannot live in WebM; switched to VP9.`);
      options.codec = 'vp9';
    }
    const tracks = probe && Array.isArray(probe.audioTracks) ? probe.audioTracks : [];
    const sourceTrack = tracks[audio.trackIndex !== null && audio.trackIndex !== undefined ? audio.trackIndex : 0];
    const sourceIsOpus = !!(sourceTrack && String(sourceTrack.codec).toLowerCase() === 'opus');
    if (audio.mode === 'copy' && sourceIsOpus) {
      // Already Opus: copy it as-is.
    } else if (audio.mode !== 'none' && audio.codec !== 'opus') {
      if (audio.mode === 'copy') notes.push('WebM needs Opus audio, so the audio is re-encoded.');
      else notes.push(`${String(audio.codec).toUpperCase()} audio is not supported in WebM; using Opus.`);
      audio.mode = 'encode';
      audio.codec = 'opus';
    }
    if (options.subtitles.keepSoft) {
      notes.push('WebM cannot store soft subtitles, so they are left out. Burn them in instead.');
      options.subtitles.keepSoft = false;
    }
  } else if (container === 'mp4' || container === 'mov') {
    if (audio.mode !== 'none' && audio.codec === 'opus') {
      notes.push('Opus audio is not supported in MP4/MOV; using AAC.');
      audio.codec = 'aac';
    }
    if (audio.mode === 'copy') {
      const source = String(((probe && probe.audioTracks && probe.audioTracks[0]) || {}).codec || '').toLowerCase();
      if (source && !['aac', 'mp3', 'alac', 'ac3', 'eac3'].includes(source)) {
        notes.push(`The original audio (${source}) does not fit ${container.toUpperCase()}; the audio is re-encoded.`);
        audio.mode = 'encode';
        audio.codec = 'aac';
      }
    }
  }
  return options;
}

// `copy` survives only when nothing else transforms the audio stream.
function applyAudioCopyFallback(options, notes) {
  const audio = options.audio;
  if (audio.mode !== 'copy') return;
  const reasons = [];
  if (options.speedFactor !== 1) reasons.push('the playback speed is changed');
  if (audio.normalize) reasons.push('loudness normalization is on');
  if (toNumber(audio.volumeDb) !== 0) reasons.push('the volume is adjusted');
  if (audio.channels !== 'source') reasons.push('the channel layout is changed');
  if (audio.trackIndex !== null) reasons.push('a specific track is picked');
  if (options.subtitles.burn.kind !== 'none' && (options.trim.start !== null || options.trim.end !== null)) {
    reasons.push('the trim is applied together with burned subtitles');
  }
  if (reasons.length > 0) {
    notes.push(`Audio is re-encoded because ${reasons.join(', ')}.`);
    audio.mode = 'encode';
    audio.codec = options.container === 'webm' ? 'opus' : 'aac';
    if (options.container === 'webm') audio.bitrateKbps = Math.min(audio.bitrateKbps || 96, 128);
  }
}

function enabledFilters(options) {
  const filters = [];
  if (options.deinterlace) filters.push('deinterlace');
  if (options.crop) filters.push('crop');
  if (options.maxHeight) filters.push('resolution cap');
  if (options.maxFps) filters.push('frame-rate cap');
  if (options.rotate) filters.push(`rotate ${options.rotate}°`);
  if (options.flipH) filters.push('flip H');
  if (options.flipV) filters.push('flip V');
  if (options.denoise && options.denoise !== 'off') filters.push('denoise');
  if (options.subtitles.burn && options.subtitles.burn.kind !== 'none') filters.push('burned subtitles');
  if (options.speedFactor !== 1) filters.push('playback speed');
  return filters;
}

// Convert only never re-encodes: every filter is ignored with a visible warning.
function applyRemuxRules(options, warnings) {
  const ignored = enabledFilters(options);
  if (ignored.length > 0) {
    warnings.push(`Convert only keeps filters off: ignored ${ignored.join(', ')}.`);
  }
  options.deinterlace = false;
  options.crop = null;
  options.rotate = 0;
  options.flipH = false;
  options.flipV = false;
  options.denoise = 'off';
  options.speedFactor = 1;
  options.maxFps = null;
  options.maxHeight = null;
  options.subtitles = { burn: { kind: 'none', trackIndex: null, filePath: null }, keepSoft: options.subtitles.keepSoft };
  // Convert only copies the audio as-is (the Audio section is disabled in this mode); the container
  // rules may still force a plain re-encode. Hidden audio filters never apply here.
  options.audio.mode = 'copy';
  options.audio.normalize = false;
  options.audio.volumeDb = 0;
  options.audio.channels = 'source';
  return options;
}

// Which codecs a muxer can take as-is. Matroska accepts anything. VP9 stays out of MP4/MOV on
// purpose: ffmpeg can write it, but QuickTime, Safari and most phones cannot play it.
const REMUX_VIDEO_SUPPORT = {
  mp4: ['h264', 'hevc', 'av1', 'mpeg4', 'mpeg2video', 'mjpeg'],
  mov: ['h264', 'hevc', 'mpeg4', 'mjpeg', 'prores'],
  webm: ['vp8', 'vp9', 'av1'],
  mkv: null
};
const REMUX_AUDIO_SUPPORT = {
  mp4: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'mp2', 'opus', 'pcm_s16le'],
  mov: ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'mp2', 'pcm_s16le'],
  webm: ['opus', 'vorbis'],
  mkv: null
};

// Remux can only copy what the target muxer accepts; otherwise the container (video) or the
// audio encoding has to give way, with a note explaining it.
const VIDEO_LABELS = { h264: 'H.264', hevc: 'H.265', vp9: 'VP9', av1: 'AV1', vp8: 'VP8', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', mjpeg: 'Motion JPEG', prores: 'ProRes' };

function applyRemuxContainerRules(options, probe, notes, warnings) {
  const vcodec = String((probe && probe.vcodec) || '').toLowerCase();
  const supported = REMUX_VIDEO_SUPPORT[options.container];
  if (vcodec && supported && !supported.includes(vcodec)) {
    const label = VIDEO_LABELS[vcodec] || vcodec.toUpperCase();
    warnings.push(`Convert only cannot store ${label} video in a ${options.container.toUpperCase()} file, so the output is Matroska (.mkv) instead.`);
    options.container = 'mkv';
  }
  const audio = options.audio;
  if (audio.mode !== 'none') {
    const audioSupported = REMUX_AUDIO_SUPPORT[options.container];
    const source = String(((probe && probe.audioTracks && probe.audioTracks[0]) || {}).codec || '').toLowerCase();
    if (source && audioSupported && !audioSupported.includes(source)) {
      notes.push(`The original ${source} audio does not fit ${options.container.toUpperCase()}, so the audio is re-encoded.`);
      audio.mode = 'encode';
      audio.codec = options.container === 'webm' ? 'opus' : 'aac';
    }
  }
  return options;
}

/**
 * Size-mode guard rails shared by resolveOptions/estimate/prepareJob:
 * warn when the target is impossible (bitrate clamped to 80 kbps) and cap at 720p when the
 * computed bitrate is too low to look good at a higher resolution.
 * @returns {object} the target bitrate result for the resolved options
 */
function applyLowBitrateCap(options, probe, notes, warnings) {
  if (probe && probe.hasVideo !== false && !(probe.duration > 0)) {
    warnings.push("This file doesn't report its length, so a size target can't be met. Use Quality mode.");
    return null;
  }
  const duration = effectiveDuration(probe, options);
  if (!(duration > 0)) return null; // no usable duration yet: nothing to judge
  const kept = keptSourceBytes(probe, options);
  const percent = toNumber(options.targetSizePercent);
  if (!(percent > 0) && kept > 0 && (toNumber(options.targetSizeMB) || 10) * MB > kept) {
    notes.push('This video is already under the target size, so it is encoded at about its current size.');
  }
  const bits = computeTargetBitrates({
    targetBytes: targetBytesFor(probe, options),
    effectiveDuration: duration,
    audioKbps: audioBitrateForEstimate(probe, options)
  });
  if (bits.clamped) {
    warnings.push('Target too small for this length - the video bitrate is clamped to 80 kbps.');
  }
  if (bits.suggestLowerResolution && probe && probe.height > 720) {
    if (!options.maxHeight) {
      options.maxHeight = 720;
      notes.push('The bitrate is low for this resolution, so the output is capped at 720p.');
    } else if (options.maxHeight > 720) {
      warnings.push('The bitrate is low for this resolution - consider capping at 720p.');
    }
  }
  return bits;
}

/**
 * Resolves a raw renderer options object into a complete, validated options object.
 * Order: defaults -> preset -> explicit fields -> container corrections -> copy fallback.
 * @param {object} rawOptions options from the renderer (see spec section 3)
 * @param {{ probe?: object, capabilities?: object, customPresets?: object[] }} context
 * @returns {{ options: object, encoder: string, warnings: string[], notes: string[] }}
 */
function resolveOptions(rawOptions, context = {}) {
  const raw = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const capabilities = context.capabilities || null;
  const probe = context.probe || null;
  const warnings = [];
  const notes = [];

  const options = cloneOptions(DEFAULT_OPTIONS);
  const preset = raw.presetId ? findPreset(raw.presetId, context.customPresets || []) : null;
  if (preset) {
    options.presetId = preset.id;
    applyOptions(options, preset.options || {});
  }
  const explicit = { ...raw };
  delete explicit.presetId;
  applyOptions(options, explicit);

  const burn = options.subtitles.burn;
  if (burn.kind === 'track' && burn.trackIndex === null) {
    const tracks = (probe && Array.isArray(probe.subtitleTracks)) ? probe.subtitleTracks : null;
    const firstText = tracks ? tracks.find((t) => t && t.text) : null;
    if (firstText) {
      burn.trackIndex = firstText.index;
    } else if (tracks) {
      warnings.push(tracks.length
        ? 'Only image-based subtitle tracks were found; they cannot be burned in from here.'
        : 'This video has no subtitle track to burn in.');
      options.subtitles.burn = { kind: 'none', trackIndex: null, filePath: null };
    } else {
      burn.trackIndex = 0; // no probe yet (queued job); resolved again when the job starts
    }
  }
  if (probe && Array.isArray(probe.audioTracks) && probe.audioTracks.length === 0 && options.audio.mode !== 'none') {
    options.audio.mode = 'none';
  }

  if (options.mode === 'remux') {
    applyRemuxRules(options, warnings);
    applyRemuxContainerRules(options, probe, notes, warnings);
  } else {
    applyContainerCompatibility(options, probe, notes);
    applyAudioCopyFallback(options, notes);
  }

  if (options.mode === 'size') {
    if (options.targetSizePercent !== null && options.targetSizePercent >= 100) options.targetSizePercent = 99;
    if (options.targetSizePercent === null && !(options.targetSizeMB > 0)) options.targetSizeMB = 10;
  }
  if (options.trim.end !== null && options.trim.start !== null && options.trim.end <= options.trim.start) {
    warnings.push('The trim end is before the trim start; trim ignored.');
    options.trim = { start: null, end: null };
  }
  if (probe && probe.duration > 0) {
    if (options.trim.end !== null && options.trim.end > probe.duration) options.trim.end = probe.duration;
    if (options.trim.start !== null && options.trim.start >= probe.duration) {
      warnings.push('The trim start is past the end of the file; trim ignored.');
      options.trim.start = null;
    }
  }

  // Runs last so the duration used for the guard rails is the final, validated one.
  if (options.mode === 'size') applyLowBitrateCap(options, probe, notes, warnings);

  const encoder = options.mode === 'remux' ? '' : resolveEncoder(options, capabilities, warnings);
  if (encoder && encoder !== options.encoder) {
    notes.push(`Using ${encoderInfo(encoder).label}${isHardwareEncoder(encoder) ? ' (GPU)' : ''}.`);
  }
  return { options, encoder, warnings, notes };
}

// ---------------------------------------------------------------------------------------------
// Duration and bitrate math (spec 3.1)
// ---------------------------------------------------------------------------------------------

function effectiveDuration(probe, options) {
  const total = probe && Number.isFinite(probe.duration) ? probe.duration : 0;
  const start = toNumber(options && options.trim && options.trim.start) || 0;
  const end = toNumber(options && options.trim && options.trim.end);
  const stop = end !== null && end > start ? (total ? Math.min(end, total) : end) : total;
  const raw = Math.max(0, stop - start);
  return raw / normalizeSpeedFactor(options && options.speedFactor);
}

/**
 * Size-mode math: 4% container overhead margin, audio first, video gets the rest.
 * @returns {{ totalKbps, audioKbps, videoKbps, clamped, suggestLowerResolution, totalBytes }}
 */
function computeTargetBitrates({ targetBytes, effectiveDuration: duration, audioKbps: audio = 0 }) {
  const seconds = Math.max(0, toNumber(duration) || 0);
  const bytes = Math.max(0, toNumber(targetBytes) || 0);
  const audioOut = Math.max(0, toNumber(audio) || 0);
  if (seconds <= 0) {
    return { totalKbps: 0, audioKbps: audioOut, videoKbps: 0, clamped: true, suggestLowerResolution: false, totalBytes: bytes };
  }
  const totalKbps = Math.floor((bytes * 8 * 0.96) / seconds / 1000);
  let videoKbps = Math.floor(totalKbps - audioOut);
  const clamped = videoKbps < 80;
  const suggestLowerResolution = !clamped && videoKbps < 400;
  if (clamped) videoKbps = 80;
  return { totalKbps, audioKbps: audioOut, videoKbps, clamped, suggestLowerResolution, totalBytes: bytes };
}

// ---------------------------------------------------------------------------------------------
// Rate control and speed presets (spec 3.1)
// ---------------------------------------------------------------------------------------------

function x264Crf(quality) {
  return Math.round(34 - clampNumber(quality, 0, 100, 70) * 0.18);
}

function x265Crf(quality) {
  return Math.round(36 - clampNumber(quality, 0, 100, 70) * 0.18);
}

/**
 * Quality -> rate-control args for one encoder.
 * @returns {string[]} ffmpeg args
 */
function qualityToRateControl(encoderName, quality) {
  const q = clampNumber(quality, 0, 100, 70);
  const name = String(encoderName || 'libx264');
  if (name === 'libx265') return ['-crf', String(x265Crf(q))];
  if (name === 'libx264') return ['-crf', String(x264Crf(q))];
  // AV1 encoders share the 0-63 CRF scale in ffmpeg.
  if (name === 'libaom-av1' || name === 'libsvtav1') return ['-crf', String(Math.round(52 - q * 0.3))];
  if (name === 'libvpx-vp9') return ['-crf', String(Math.round(50 - q * 0.3)), '-b:v', '0'];
  if (name.includes('_nvenc')) return ['-rc', 'vbr', '-cq', String(x264Crf(q)), '-b:v', '0'];
  if (name.includes('_qsv')) return ['-global_quality', String(x264Crf(q))];
  if (name.includes('_amf')) {
    const qp = String(Math.round(34 - q * 0.18));
    return ['-rc', 'cqp', '-qp_i', qp, '-qp_p', qp];
  }
  if (name.includes('_videotoolbox')) return ['-q:v', String(Math.round(30 + q * 0.5))];
  return ['-crf', String(x264Crf(q))];
}

/**
 * Speed -> encoder preset args (fast / balanced / slow).
 * @returns {string[]}
 */
function speedToPresetArgs(encoderName, speed) {
  const idx = SPEEDS.indexOf(SPEEDS.includes(speed) ? speed : 'balanced');
  const name = String(encoderName || 'libx264');
  if (name === 'libx264' || name === 'libx265') return ['-preset', ['veryfast', 'medium', 'slow'][idx]];
  if (name.includes('_nvenc')) return ['-preset', ['p2', 'p5', 'p7'][idx], '-tune', 'hq'];
  if (name.includes('_qsv')) return ['-preset', ['veryfast', 'medium', 'slow'][idx]];
  if (name.includes('_amf')) return ['-quality', ['speed', 'balanced', 'quality'][idx]];
  if (name === 'libaom-av1') return ['-cpu-used', ['8', '6', '4'][idx], '-row-mt', '1'];
  if (name === 'libsvtav1') return ['-preset', ['10', '8', '6'][idx]];
  if (name === 'libvpx-vp9') return ['-deadline', 'good', '-cpu-used', ['5', '3', '1'][idx], '-row-mt', '1'];
  return [];
}

// ---------------------------------------------------------------------------------------------
// Filters (spec 3.1 order: deinterlace -> crop -> scale -> fps -> rotate/flip -> denoise ->
// subtitle burn -> setpts)
// ---------------------------------------------------------------------------------------------

function computeOutputSize(probe, options) {
  const srcW = (probe && probe.width) || 0;
  const srcH = (probe && probe.height) || 0;
  const cap = options && options.maxHeight;
  if (!srcW || !srcH) return { width: cap || 0, height: cap || 0 };
  let height = srcH;
  if (cap && cap < srcH) height = cap;
  let width = Math.round((srcW * height) / srcH);
  if (width % 2 !== 0) width -= 1;
  if (height % 2 !== 0) height -= 1;
  return { width: Math.max(2, width), height: Math.max(2, height) };
}

// "min(ih,H)" keeps the aspect ratio and never upscales; -2 keeps the width even.
function scaleFilter(options) {
  const cap = options.maxHeight;
  if (!cap) return null;
  return `scale=-2:'trunc(min(ih,${cap})/2)*2':flags=bicubic`;
}

function cropFilter(options) {
  const crop = options && options.crop;
  if (!crop) return null;
  const top = Math.max(0, Math.round(Number(crop.top) || 0));
  const bottom = Math.max(0, Math.round(Number(crop.bottom) || 0));
  const left = Math.max(0, Math.round(Number(crop.left) || 0));
  const right = Math.max(0, Math.round(Number(crop.right) || 0));
  if (!top && !bottom && !left && !right) return null;
  return `crop=iw-${left + right}:ih-${top + bottom}:${left}:${top}`;
}

function fpsFilter(options, probe) {
  const cap = options && options.maxFps;
  if (!cap) return null;
  const sourceFps = (probe && probe.fps) || 0;
  if (sourceFps && sourceFps <= cap) return null; // never increases the frame rate
  return `fps=${cap}`;
}

function rotateFlipFilters(options) {
  const out = [];
  const rotate = Number(options && options.rotate) || 0;
  if (rotate === 90) out.push('transpose=1');
  else if (rotate === 180) out.push('transpose=1,transpose=1');
  else if (rotate === 270) out.push('transpose=2');
  if (options && options.flipH) out.push('hflip');
  if (options && options.flipV) out.push('vflip');
  return out;
}

function denoiseFilter(options) {
  const level = options && options.denoise;
  if (!level || level === 'off') return null;
  const strength = { light: '1.5:1.5:4:4', medium: '2.5:2.5:6:6', strong: '4:4:9:9' }[level];
  return strength ? `hqdn3d=${strength}` : null;
}

/**
 * Escapes a path for the ffmpeg `subtitles=` filter. A Windows drive colon must be escaped
 * (C:/dir/file.srt -> C\:/dir/file.srt), as must `'`, `\`, `[`, `]` and `,`.
 */
function escapeFilterPath(p) {
  const value = String(p === null || p === undefined ? '' : p)
    .replace(/\\/g, '/')
    .replace(/\r?\n/g, ' ');
  // Level 1: the filter option value (\\ ' and : are special).
  const optionLevel = value.replace(/[\\':]/g, (ch) => `\\${ch}`);
  // Level 2: the filtergraph (\\ ' [ ] , ; are special).
  return optionLevel.replace(/[\\'[\],;]/g, (ch) => `\\${ch}`);
}

function subtitleFilter(options, probe) {
  const burn = options && options.subtitles && options.subtitles.burn;
  if (!burn || burn.kind === 'none') return null;
  if (burn.kind === 'file' && burn.filePath) {
    return `subtitles=filename=${escapeFilterPath(burn.filePath)}`;
  }
  if (burn.kind === 'track' && probe && probe.filePath) {
    const index = Number.isFinite(burn.trackIndex) ? burn.trackIndex : 0;
    return `subtitles=filename=${escapeFilterPath(probe.filePath)}:si=${index}`;
  }
  return null;
}

/**
 * Verbose video filter chain for the active options, or '' when nothing is set.
 * Order: deinterlace -> crop -> scale -> fps -> rotate/flip -> denoise -> subtitle burn -> setpts.
 */
function buildVideoFilters(options, probe, encoder) {
  const opts = options || DEFAULT_OPTIONS;
  if (opts.mode === 'remux') return '';
  const chain = [];
  if (opts.deinterlace) chain.push('bwdif');
  const crop = cropFilter(opts);
  if (crop) chain.push(crop);
  const scale = scaleFilter(opts);
  // 4:2:0 encoders reject odd frame sizes; a crop or an odd source can produce one.
  const oddSource = probe && ((probe.width % 2) || (probe.height % 2));
  if (!scale && (crop || oddSource)) chain.push('crop=trunc(iw/2)*2:trunc(ih/2)*2');
  if (scale) chain.push(scale);
  const fps = fpsFilter(opts, probe);
  if (fps) chain.push(fps);
  chain.push(...rotateFlipFilters(opts));
  const denoise = denoiseFilter(opts);
  if (denoise) chain.push(denoise);
  const subs = subtitleFilter(opts, probe);
  if (subs) chain.push(subs);
  const filterTrim = filterTrimRange(opts);
  if (filterTrim) chain.push(`trim=${filterTrim},setpts=PTS-STARTPTS`);
  const factor = normalizeSpeedFactor(opts.speedFactor);
  if (factor !== 1) chain.push(`setpts=${(1 / factor).toFixed(4)}*PTS`);
  // yuv420p keeps H.264/HEVC output playable everywhere; hardware encoders handle it themselves.
  if (chain.length > 0 && !isHardwareEncoder(encoder) && (opts.codec === 'h264' || opts.codec === 'hevc')) {
    chain.push('format=yuv420p');
  }
  return chain.join(',');
}

// With burned subtitles the frames keep their source timestamps until after the subtitles filter,
// so the trim runs in the filter graph ("start=..:end=..") instead of as an input seek.
function filterTrimRange(options) {
  if (!options || options.mode === 'remux') return '';
  const burn = options.subtitles && options.subtitles.burn;
  if (!burn || burn.kind === 'none') return '';
  const trim = options.trim || {};
  const start = trim.start === undefined ? null : trim.start;
  const end = trim.end === undefined ? null : trim.end;
  if (start === null && end === null) return '';
  const parts = [];
  if (start !== null) parts.push(`start=${timeArg(start)}`);
  if (end !== null) parts.push(`end=${timeArg(end)}`);
  return parts.join(':');
}

// atempo accepts 0.5-2.0 per instance, so larger factors are chained.
function splitAtempo(factor) {
  const f = clampNumber(factor, 0.25, 4, 1);
  if (f === 1) return [];
  const out = [];
  let remaining = f;
  while (remaining > 2.0001) {
    out.push(2);
    remaining /= 2;
  }
  while (remaining < 0.4999) {
    out.push(0.5);
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.0001) out.push(Number(remaining.toFixed(4)));
  return out;
}

// Order: atempo -> loudnorm -> volume.
function buildAudioFilters(options) {
  const opts = options || DEFAULT_OPTIONS;
  const chain = [];
  const filterTrim = filterTrimRange(opts);
  if (filterTrim) chain.push(`atrim=${filterTrim},asetpts=PTS-STARTPTS`);
  const factor = normalizeSpeedFactor(opts.speedFactor);
  if (factor !== 1) {
    for (const part of splitAtempo(factor)) chain.push(`atempo=${part}`);
  }
  if (opts.audio && opts.audio.normalize) chain.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  const volume = toNumber(opts.audio && opts.audio.volumeDb);
  if (volume !== null && volume !== 0) chain.push(`volume=${volume}dB`);
  return chain.join(',');
}

// ---------------------------------------------------------------------------------------------
// Output paths (spec 1.7)
// ---------------------------------------------------------------------------------------------

function containerExtension(container) {
  return CONTAINER_EXT[container] || '.mp4';
}

function defaultExists(p) {
  try {
    return fs.existsSync(p);
  } catch (e) {
    return false;
  }
}

/**
 * Final output path with a collision counter. Never returns the input path and never returns a
 * path that already exists (according to `existsFn`).
 */
function buildOutputPath(inputPath, options, existsFn = defaultExists) {
  const opts = options || DEFAULT_OPTIONS;
  const outDir = (opts.output && opts.output.dir) || path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = sanitizeFilename(path.basename(inputPath, ext));
  const suffix = (opts.output && typeof opts.output.suffix === 'string') ? opts.output.suffix : ' (compressed)';
  const targetExt = containerExtension(opts.container);
  const normalize = (p) => path.resolve(p).replace(/[\\/]/g, '/').toLowerCase();
  const inputKey = normalize(inputPath);
  let counter = 1;
  let candidate = path.join(outDir, `${base}${suffix}${targetExt}`);
  while (existsFn(candidate) || normalize(candidate) === inputKey) {
    counter += 1;
    candidate = path.join(outDir, `${base}${suffix} ${counter}${targetExt}`);
  }
  return candidate;
}

function partialPath(finalPath) {
  return `${finalPath}.partial`;
}

function nullOutputPath(platform = process.platform) {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

// ---------------------------------------------------------------------------------------------
// ffmpeg argument building
// ---------------------------------------------------------------------------------------------

function timeArg(seconds) {
  return Number(seconds).toFixed(3);
}

function audioCodecName(codec) {
  if (codec === 'opus') return 'libopus';
  if (codec === 'mp3') return 'libmp3lame';
  return 'aac';
}

function audioMapIndex(options) {
  const idx = options.audio && options.audio.trackIndex;
  return Number.isFinite(idx) && idx >= 0 ? idx : 0;
}

function videoCodecArgs(options, encoder, pass, passlogfile, videoKbps) {
  const args = ['-c:v', encoder];
  if (options.mode === 'quality') {
    args.push(...qualityToRateControl(encoder, options.quality));
    args.push(...speedToPresetArgs(encoder, options.speed));
  } else {
    const kbps = Math.max(80, Math.round(toNumber(videoKbps) || 0));
    args.push('-b:v', `${kbps}k`);
    const passNumber = Number(pass);
    if (isTwoPassEncoder(encoder) && (passNumber === 1 || passNumber === 2)) {
      args.push('-pass', String(passNumber));
      if (passlogfile) args.push('-passlogfile', passlogfile);
    } else {
      // GPU encoders and SVT-AV1: capped VBR in a single pass.
      args.push('-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${Math.round(kbps * 2)}k`);
    }
    args.push(...speedToPresetArgs(encoder, options.speed));
  }
  if (options.codec === 'h264' || options.codec === 'hevc') args.push('-pix_fmt', 'yuv420p');
  if (options.codec === 'hevc' && (options.container === 'mp4' || options.container === 'mov')) {
    args.push('-tag:v', 'hvc1');
  }
  return args;
}

/**
 * Builds the ffmpeg arguments for one run (pass 1, pass 2, single pass, remux or preview sample).
 * @param {{ inputPath, outputPath, options, probe, encoder, pass, passlogfile, videoKbps,
 *           audioKbps, nullOutput, sample }} job
 * @returns {string[]}
 */
function buildFfmpegArgs(job) {
  const {
    inputPath, outputPath, options, probe, encoder, pass = null, passlogfile = null,
    videoKbps, audioKbps, nullOutput = false
  } = job;
  const opts = options || DEFAULT_OPTIONS;
  const remux = opts.mode === 'remux';
  const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1'];
  const isPass1 = !remux && isTwoPassEncoder(encoder) && opts.mode === 'size' && Number(pass) === 1;
  const trimStart = opts.trim.start;
  // Input-side -ss/-t bound the SOURCE range, so a speed change cannot stretch the cut. With
  // burned subtitles the trim runs inside the filter graph instead (see filterTrimRange).
  const inputTrim = !filterTrimRange(opts);
  if (inputTrim) {
    if (trimStart !== null) args.push('-ss', timeArg(trimStart));
    if (opts.trim.end !== null) {
      const from = trimStart !== null ? trimStart : 0;
      args.push('-t', timeArg(Math.max(0, opts.trim.end - from)));
    }
  }
  args.push('-i', inputPath);

  // ----- stream mapping -----
  const hasVideo = !(probe && probe.hasVideo === false);
  if (hasVideo) args.push('-map', '0:v:0');
  const hasAudio = !(probe && Array.isArray(probe.audioTracks) && probe.audioTracks.length === 0);
  const wantsAudio = opts.audio.mode !== 'none' && hasAudio;
  if (wantsAudio && !isPass1) args.push('-map', `0:a:${audioMapIndex(opts)}?`);
  if (opts.subtitles.keepSoft && opts.container !== 'webm' && !isPass1) {
    const tracks = probe && Array.isArray(probe.subtitleTracks) ? probe.subtitleTracks : null;
    if (!tracks) {
      args.push('-map', '0:s?');
    } else if (opts.container === 'mkv') {
      if (tracks.length) args.push('-map', '0:s?');
    } else {
      for (const t of tracks) if (t && t.text) args.push('-map', `0:s:${t.index}`);
    }
  }

  // ----- video -----
  if (hasVideo) {
    if (remux) {
      args.push('-c:v', 'copy');
      const sourceCodec = String((probe && probe.vcodec) || '').toLowerCase();
      if ((sourceCodec === 'hevc' || sourceCodec === 'h265') && (opts.container === 'mp4' || opts.container === 'mov')) {
        args.push('-tag:v', 'hvc1');
      }
    } else {
      const filters = buildVideoFilters(opts, probe, encoder);
      if (filters) args.push('-vf', filters);
      args.push(...videoCodecArgs(opts, encoder, pass, passlogfile, videoKbps));
    }
  }

  // ----- audio -----
  if (wantsAudio && !isPass1) {
    if (opts.audio.mode === 'copy') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', audioCodecName(opts.audio.codec));
      args.push('-b:a', `${Math.round(toNumber(opts.audio.bitrateKbps) || 128)}k`);
      if (opts.audio.channels === 2) args.push('-ac', '2');
      else if (opts.audio.channels === 1) args.push('-ac', '1');
      const audioFilters = [
        buildAudioFilters(opts),
        opts.audio.codec === 'opus' ? 'aformat=channel_layouts=mono|stereo|quad|5.1|7.1' : ''
      ].filter(Boolean).join(',');
      if (audioFilters) args.push('-af', audioFilters);
    }
  }

  // ----- subtitles -----
  const hasTextSubs = !(probe && Array.isArray(probe.subtitleTracks)) || probe.subtitleTracks.some((t) => t && t.text);
  if (opts.subtitles.keepSoft && opts.container !== 'webm' && !isPass1) {
    if (opts.container === 'mp4' || opts.container === 'mov') { if (hasTextSubs) args.push('-c:s', 'mov_text'); }
    else if (opts.container === 'mkv') args.push('-c:s', 'copy');
  }

  if (isPass1) args.push('-an');
  if (opts.stripMetadata) args.push('-map_metadata', '-1', '-map_chapters', '-1');

  // ----- output -----
  if (nullOutput || isPass1) {
    args.push('-f', 'null', nullOutputPath(job.platform));
  } else {
    if (opts.container === 'mp4' || opts.container === 'mov') args.push('-movflags', '+faststart');
    args.push('-f', CONTAINER_MUXER[opts.container] || 'mp4');
    args.push(outputPath);
  }
  return args;
}

function audioBitrateForEstimate(probe, options) {
  if (options.audio.mode === 'none') return 0;
  if (probe && Array.isArray(probe.audioTracks) && probe.audioTracks.length === 0) return 0;
  if (options.audio.mode === 'copy') {
    const track = probe && probe.audioTracks && probe.audioTracks[0];
    if (track && Number.isFinite(track.kbps) && track.kbps > 0) return track.kbps;
    return 128;
  }
  return toNumber(options.audio.bitrateKbps) || 128;
}

// ---------------------------------------------------------------------------------------------
// ffmpeg -progress parsing
// ---------------------------------------------------------------------------------------------

/**
 * Parses `-progress pipe:1` output (one key=value per line). Returns the last complete block's
 * numbers, or null when the text holds no progress keys.
 * @returns {{ outTime, fps, speed, done, totalSize, frame } | null}
 */
function parseProgressBlock(text) {
  if (typeof text !== 'string' || !text) return null;
  let result = null;
  const fresh = () => ({ outTime: null, fps: null, speed: null, done: false, totalSize: null, frame: null });
  let block = fresh();
  const flush = () => {
    if (block.outTime === null && block.fps === null && block.speed === null) return;
    result = { ...block };
    block = fresh(); // the next block starts clean, so the trailing flush cannot clobber this one
  };
  const lines = text.split(/\r\n|\n|\r/);
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // Both keys carry microseconds in ffmpeg (out_time_ms is misnamed).
      const us = Number(value);
      if (Number.isFinite(us)) block.outTime = us / 1000000;
    } else if (key === 'out_time') {
      const m = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m && block.outTime === null) {
        block.outTime = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      }
    } else if (key === 'fps') {
      const n = Number(value);
      if (Number.isFinite(n)) block.fps = n;
    } else if (key === 'speed') {
      const n = Number(String(value).replace(/x$/, ''));
      if (Number.isFinite(n)) block.speed = n;
    } else if (key === 'total_size') {
      const n = Number(value);
      if (Number.isFinite(n)) block.totalSize = n;
    } else if (key === 'frame') {
      const n = Number(value);
      if (Number.isFinite(n)) block.frame = n;
    } else if (key === 'progress') {
      if (value === 'end') block.done = true;
      flush();
    }
  }
  // Text without a trailing progress= line still carries the latest values.
  flush();
  return result;
}

// ---------------------------------------------------------------------------------------------
// ffmpeg -i output parsing (ProbeInfo, spec 4.1)
// ---------------------------------------------------------------------------------------------

const TEXT_SUBTITLE_CODECS = ['subrip', 'ass', 'ssa', 'webvtt', 'mov_text'];

function parseDuration(text) {
  const m = String(text).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function parseChannels(line) {
  const text = String(line || '');
  if (/\bmono\b/i.test(text)) return 1;
  if (/\b5\.1\b/i.test(text)) return 6;
  if (/\bstereo\b/i.test(text)) return 2;
  const m = text.match(/(\d+)\s*channels?\b/i);
  return m ? Number(m[1]) : 0;
}

// A metadata line "title : Main mix". The \b keeps "Subtitle:" from matching.
function parseTitle(line) {
  const m = line.match(/\btitle\s*:\s*(.+)$/i);
  return m ? m[1].trim() : '';
}

/**
 * Parses `ffmpeg -hide_banner -i file` stderr into ProbeInfo.
 * @param {string} stderr
 * @param {string} filePath
 * @param {number} size
 * @returns {object} ProbeInfo
 */
function parseProbeOutput(stderr, filePath, size = 0) {
  const text = String(stderr || '');
  const lines = text.split(/\r?\n/);

  const probe = {
    filePath: filePath || '',
    filename: path.basename(filePath || ''),
    size: Number(size) || 0,
    duration: parseDuration(text),
    width: 0,
    height: 0,
    fps: 0,
    vcodec: '',
    videoKbps: 0,
    bitrateKbps: 0,
    container: '',
    rotation: 0,
    hasVideo: false,
    audioTracks: [],
    subtitleTracks: []
  };

  // "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'file':" — the format list itself contains commas.
  const containerMatch = text.match(/Input #0,\s*(.+?),\s*from\b/);
  if (containerMatch) probe.container = containerMatch[1].trim();
  const overallBitrate = text.match(/bitrate:\s*(\d+)\s*kb\/s/);
  if (overallBitrate) probe.bitrateKbps = Number(overallBitrate[1]);

  const rotationMatch = text.match(/displaymatrix:\s*rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/);
  if (rotationMatch) {
    const deg = Math.round(Number(rotationMatch[1]));
    probe.rotation = ((deg % 360) + 360) % 360;
  }

  // Stream #0:0[0x1](und): Video: h264 ...   (type-relative indices per kind)
  const streamRe = /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Data|Attachment):/;
  const resRe = /(\d{2,5})x(\d{2,5})/;

  let audioCount = 0;
  let subtitleCount = 0;
  let pendingTrack = null;

  for (const line of lines) {
    const m = line.match(streamRe);
    if (!m) {
      // A stream's own "title" lives in the Metadata block that follows its line.
      const titleMatch = line.match(/^\s{4,}title\s*:\s*(.+)$/i);
      if (pendingTrack && titleMatch && !pendingTrack.title) pendingTrack.title = titleMatch[1].trim();
      continue;
    }
    const type = m[3];
    const lang = (m[2] || '').trim() || null;
    pendingTrack = null;

    if (type === 'Video') {
      const codecMatch = line.match(/Video:\s*([a-zA-Z0-9_-]+)/);
      const codec = codecMatch ? codecMatch[1] : '';
      const isCover = /attached pic/i.test(line);
      const res = line.match(resRe);
      const fps = line.match(/([0-9.]+)\s*fps\b/);
      const kbps = line.match(/(\d+)\s*kb\/s\b/);
      if (!probe.hasVideo && !isCover) {
        probe.hasVideo = true;
        probe.vcodec = codec;
        if (res) { probe.width = Number(res[1]); probe.height = Number(res[2]); }
        if (fps) probe.fps = parseFloat(fps[1]);
        if (kbps) probe.videoKbps = Number(kbps[1]);
      }
    } else if (type === 'Audio') {
      const codecMatch = line.match(/Audio:\s*([a-zA-Z0-9_-]+)/);
      const kbps = line.match(/(\d+)\s*kb\/s\b/);
      const track = {
        index: audioCount,
        codec: codecMatch ? codecMatch[1] : '',
        channels: parseChannels(line),
        lang,
        title: parseTitle(line),
        kbps: kbps ? Number(kbps[1]) : 0
      };
      probe.audioTracks.push(track);
      pendingTrack = track;
      audioCount += 1;
    } else if (type === 'Subtitle') {
      const codecMatch = line.match(/Subtitle:\s*([a-zA-Z0-9_-]+)/);
      const codec = codecMatch ? codecMatch[1] : '';
      const track = {
        index: subtitleCount,
        codec,
        lang,
        title: parseTitle(line),
        text: TEXT_SUBTITLE_CODECS.includes(codec)
      };
      probe.subtitleTracks.push(track);
      pendingTrack = track;
      subtitleCount += 1;
    }
  }

  // Some builds put resolution/fps on a continuation line of the video stream.
  if (probe.hasVideo && (!probe.width || !probe.height || !probe.fps)) {
    const blockStart = text.indexOf('Video:');
    if (blockStart !== -1) {
      const next = text.indexOf('Stream #0:', blockStart + 1);
      const block = text.slice(blockStart, next === -1 ? undefined : next);
      if (!probe.width || !probe.height) {
        const res = block.match(resRe);
        if (res) { probe.width = Number(res[1]); probe.height = Number(res[2]); }
      }
      if (!probe.fps) {
        const fps = block.match(/([0-9.]+)\s*fps\b/);
        if (fps) probe.fps = parseFloat(fps[1]);
      }
    }
  }
  // ffmpeg autorotates before any filter runs, and the player shows the rotated picture, so crop,
  // scale and estimates all work in displayed dimensions. The coded size is kept for reference.
  if ((probe.rotation === 90 || probe.rotation === 270) && probe.width && probe.height) {
    probe.codedWidth = probe.width;
    probe.codedHeight = probe.height;
    const w = probe.width;
    probe.width = probe.height;
    probe.height = w;
  }
  return probe;
}

/**
 * Parses `ffmpeg -hide_banner -encoders` stdout into encoder names.
 * @returns {string[]}
 */
function parseEncodersList(stdout) {
  const names = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    // " V....D libx264   libx264 H.264 / AVC ..."
    const m = line.match(/^\s*[VAS][A-Z.]{5}\s+([a-zA-Z0-9_.-]+)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Parses `ffmpeg -hide_banner -filters` stdout into filter names.
 * @returns {string[]}
 */
function parseFiltersList(stdout) {
  const names = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    // " TSC aap    AA->A  Apply Affine ..."
    const m = line.match(/^\s*[A-Z.|]{3}\s+([a-zA-Z0-9_]+)\s+[A-Z0-9]+->[A-Z0-9]+/);
    if (m) names.push(m[1]);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Estimate (spec 4.1)
// ---------------------------------------------------------------------------------------------

// Bits per pixel per frame, by codec family and quality band. Only used to project a quality-mode
// size before a real encode (marked estimateKind 'heuristic').
const BPP_TABLE = {
  h264: { low: 0.045, mid: 0.075, high: 0.13 },
  hevc: { low: 0.03, mid: 0.05, high: 0.09 },
  av1: { low: 0.022, mid: 0.038, high: 0.068 },
  vp9: { low: 0.028, mid: 0.046, high: 0.082 }
};

function bppFor(codec, quality) {
  const table = BPP_TABLE[codec] || BPP_TABLE.h264;
  const q = clampNumber(quality, 0, 100, 70);
  if (q <= 30) {
    const t = q / 30;
    return table.low + (table.mid - table.low) * t;
  }
  if (q <= 70) {
    const t = (q - 30) / 40;
    return table.mid + (table.high - table.mid) * t;
  }
  const t = (q - 70) / 30;
  return table.high + table.high * 0.6 * t;
}

function formatMB(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / MB;
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

// Size-mode target bytes: percent wins over MB; percent is taken from the input file size.
// Both are scaled to the part of the video that is kept (trim, speed), and a target is capped at
// what that part weighs in the source, so "compressing" never makes a file bigger.
function keptSourceBytes(probe, options) {
  const inputSize = (probe && probe.size) || 0;
  const total = (probe && probe.duration) || 0;
  if (inputSize <= 0 || total <= 0) return 0;
  const fraction = Math.min(1, effectiveDuration(probe, options) / total);
  return Math.round(inputSize * fraction);
}

function targetBytesFor(probe, options) {
  const kept = keptSourceBytes(probe, options);
  const percent = toNumber(options.targetSizePercent);
  if (percent !== null && percent > 0 && kept > 0) {
    return Math.round(kept * (Math.min(99, percent) / 100));
  }
  const requested = Math.round((toNumber(options.targetSizeMB) || 10) * MB);
  return kept > 0 ? Math.min(requested, kept) : requested;
}

/**
 * Projects the output of the current options. Size mode is exact (it drives the encode), quality
 * mode is a heuristic, remux is the input size minus container overhead.
 * @returns {object} Estimate (spec 4.1)
 */
function estimate({ probe, options, capabilities, customPresets } = {}) {
  const resolved = resolveOptions(options || {}, { probe, capabilities, customPresets });
  const opts = resolved.options;
  const warnings = resolved.warnings.slice();
  const notes = resolved.notes.slice();
  const duration = effectiveDuration(probe, opts);
  let outSize = computeOutputSize(probe, opts);
  let audioKbps = audioBitrateForEstimate(probe, opts);

  let videoKbps = 0;
  let estimatedBytes = null;
  let estimateKind = 'heuristic';

  if (opts.mode === 'remux') {
    estimateKind = 'remux';
    const inputSize = (probe && probe.size) || 0;
    estimatedBytes = inputSize > 0 ? Math.round(inputSize * 0.99) : null;
    videoKbps = (probe && probe.videoKbps) || 0;
  } else if (opts.mode === 'size') {
    estimateKind = 'exact-target';
    const bits = computeTargetBitrates({ targetBytes: targetBytesFor(probe, opts), effectiveDuration: duration, audioKbps });
    videoKbps = bits.videoKbps;
    // The encode is driven to land on the target; a clamped bitrate is the only case where the
    // real result can come out larger than requested. resolveOptions already added the warnings.
    estimatedBytes = bits.clamped
      ? Math.round(((bits.videoKbps + audioKbps) * 1000 / 8) * duration)
      : Math.round(targetBytesFor(probe, opts));
    outSize = computeOutputSize(probe, opts);
  } else {
    // Quality mode: bpp heuristic by codec & quality, scaled to fps and the output resolution.
    const fps = opts.maxFps ? Math.min(opts.maxFps, (probe && probe.fps) || opts.maxFps) : ((probe && probe.fps) || 30);
    const width = outSize.width || 1920;
    const height = outSize.height || 1080;
    const bpp = bppFor(opts.codec, opts.quality);
    videoKbps = Math.round((bpp * width * height * fps) / 1000);
    estimatedBytes = Math.round(((videoKbps + audioKbps) * 1000 / 8) * duration * 1.02);
  }

  return {
    mode: opts.mode,
    videoKbps,
    audioKbps,
    estimatedBytes,
    estimateKind,
    resolvedOptions: opts,
    encoder: resolved.encoder,
    outputWidth: outSize.width,
    outputHeight: outSize.height,
    effectiveDuration: duration,
    warnings,
    notes
  };
}

/**
 * Short human summary of the resolved settings, e.g. "H.264 \u00b7 720p \u00b7 10 MB target".
 */
function summarizeOptions(options, encoder, probe) {
  const opts = options || DEFAULT_OPTIONS;
  const parts = [CODEC_LABELS[opts.codec] || 'H.264'];
  if (isHardwareEncoder(encoder)) parts[0] += ' (GPU)';
  if (opts.mode === 'remux') {
    parts.push(`convert to ${String(opts.container).toUpperCase()}`);
    return parts.join(' \u00b7 ');
  }
  const size = computeOutputSize(probe, opts);
  if (opts.maxHeight) parts.push(`${opts.maxHeight}p`);
  else if (size.height) parts.push(`${size.height}p`);
  if (opts.mode === 'size') {
    if (opts.targetSizePercent !== null) parts.push(`${opts.targetSizePercent}% of original`);
    else parts.push(`${formatMB((toNumber(opts.targetSizeMB) || 10) * MB)} target`);
  } else {
    parts.push(`quality ${opts.quality}`);
  }
  parts.push(String(opts.container).toUpperCase());
  return parts.join(' \u00b7 ');
}

module.exports = {
  MB,
  CODECS,
  CONTAINERS,
  SPEEDS,
  DENOISE_LEVELS,
  CODEC_LABELS,
  CONTAINER_MUXER,
  CONTAINER_EXT,
  ENCODER_CANDIDATES,
  SOFTWARE_NAMES,
  NO_TWO_PASS,
  AUTO_GPU_ORDER,
  SOFTWARE_PREFERENCE,
  ENCODER_LABELS,
  BUILT_IN_PRESETS,
  DEFAULT_OPTIONS,
  cloneOptions,
  findPreset,
  resolvePresetList,
  applyOptions,
  resolveOptions,
  encoderInfo,
  isHardwareEncoder,
  isTwoPassEncoder,
  gpuFamily,
  pickAutoEncoder,
  effectiveDuration,
  computeTargetBitrates,
  targetBytesFor,
  qualityToRateControl,
  speedToPresetArgs,
  x264Crf,
  x265Crf,
  computeOutputSize,
  buildVideoFilters,
  buildAudioFilters,
  splitAtempo,
  escapeFilterPath,
  buildOutputPath,
  partialPath,
  nullOutputPath,
  buildFfmpegArgs,
  parseProgressBlock,
  parseProbeOutput,
  parseEncodersList,
  parseFiltersList,
  estimate,
  summarizeOptions,
  formatMB,
  sanitizeFilename,
  audioBitrateForEstimate,
  audioCodecName,
  applyLowBitrateCap
};
