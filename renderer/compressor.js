// Compress tab workspace (Builder B).
// Markup lives in index.html between COMPRESS-TAB:BEGIN / END, styles in styles/compress.css.
// Contract: docs/compress-spec.md sections 3 + 4. Queue / compare / automation are Builder C.
import { formatBytes, hhmmssToSecondsWithMs, pointerToTime, secondsToHHMMSSWithMs, sliderPercents } from './time.js';
import { compressBus } from './compress-bus.js';

const PREVIEW_SECONDS = 10;
const ESTIMATE_DEBOUNCE_MS = 200;
const SAVE_DEBOUNCE_MS = 600;
const SECTION_STORAGE_KEY = 'compressSectionOpen';
const STANDARD_SIZES = [8, 10, 25, 50, 100];
const QUICK_PRESET_IDS = ['discord', 'whatsapp', 'email', 'half', 'hevc-archive'];

const DEFAULTS = {
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

const CODEC_LABELS = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
const AUDIO_CODEC_LABELS = { aac: 'AAC', opus: 'Opus', mp3: 'MP3' };
const CHANNEL_LABELS = { source: 'Source channels', 2: 'Stereo', 1: 'Mono' };
const SPEED_LABELS = { fast: 'Fast', balanced: 'Balanced', slow: 'Slow' };
const QUALITY_STEPS = [
  { max: 20, label: 'Smallest' },
  { max: 40, label: 'Small' },
  { max: 60, label: 'Balanced' },
  { max: 80, label: 'High' },
  { max: 100, label: 'Best' }
];

const state = {
  capabilities: null,
  capabilitiesLoaded: false,
  desiredEncoder: 'auto',
  presets: { builtIn: [], custom: [] },
  presetsLoaded: false,
  presetsLoading: null,
  probe: null,
  activePath: '',
  loadToken: 0,
  tabEl: null,
  sectionOpen: { video: true, picture: false, audio: false, subtitles: false, output: false },
  sizeMode: 'mb',
  percentVal: null,
  customSize: false,
  mode: 'quality',
  presetId: null,
  presetModified: false,
  syncing: false,
  trimStart: 0,
  trimEnd: 0,
  duration: 0,
  scrub: false,
  dragHandle: null,
  timelineRect: null,
  previewing: false,
  estimate: null,
  estimateToken: 0,
  estimateTimer: null,
  saveTimer: null,
  subsFilePath: '',
  outputDir: '',
  pendingPresetId: null,
  noticeTimer: null,
  restored: false
};

function el(id) {
  return document.getElementById(id);
}

const api = () => window.electronAPI || {};

const ui = {
  tab: el('compress-tab'),
  emptyState: el('compress-empty-state'),
  emptyNote: el('compress-empty-note'),
  dropZone: el('compress-drop-zone'),
  browse: el('btn-compress-browse'),
  hintChips: el('compress-hint-chips'),
  loading: el('compress-loading'),
  loadingFile: el('compress-loading-file'),
  workspace: el('compress-workspace'),
  fileName: el('compress-file-name'),
  badgeDuration: el('compress-badge-duration'),
  badgeRes: el('compress-badge-res'),
  badgeSize: el('compress-badge-size'),
  badgeCodec: el('compress-badge-codec'),
  changeFile: el('btn-compress-change-file'),
  closeFile: el('btn-compress-close-file'),
  playerWrap: el('compress-player-wrap'),
  video: el('compress-video-player'),
  cropOverlay: el('compress-crop-overlay'),
  cropShadeTop: el('compress-crop-shade-top'),
  cropShadeBottom: el('compress-crop-shade-bottom'),
  cropShadeLeft: el('compress-crop-shade-left'),
  cropShadeRight: el('compress-crop-shade-right'),
  cropFrame: el('compress-crop-frame'),
  timeline: el('compress-timeline'),
  timelineRange: el('compress-timeline-range'),
  playhead: el('compress-timeline-playhead'),
  handleStart: el('compress-handle-start'),
  handleEnd: el('compress-handle-end'),
  labelCurrent: el('compress-label-current'),
  labelTotal: el('compress-label-total'),
  trimStartInput: el('compress-trim-start'),
  trimEndInput: el('compress-trim-end'),
  setStart: el('btn-compress-set-start'),
  setEnd: el('btn-compress-set-end'),
  specSize: el('compress-spec-size'),
  specRes: el('compress-spec-res'),
  specFps: el('compress-spec-fps'),
  specVcodec: el('compress-spec-vcodec'),
  specBitrate: el('compress-spec-bitrate'),
  specAudio: el('compress-spec-audio'),
  specSubs: el('compress-spec-subs'),
  presetChips: el('compress-preset-chips'),
  presetStatus: el('compress-preset-status'),
  savePresetBtn: el('btn-compress-save-preset'),
  presetForm: el('compress-preset-form'),
  presetName: el('compress-preset-name'),
  presetConfirm: el('btn-compress-preset-confirm'),
  presetCancel: el('btn-compress-preset-cancel'),
  goalSize: el('compress-goal-size'),
  goalQuality: el('compress-goal-quality'),
  goalRemux: el('compress-goal-remux'),
  panelSize: el('compress-panel-size'),
  panelQuality: el('compress-panel-quality'),
  panelRemux: el('compress-panel-remux'),
  sizeChips: el('compress-size-chips'),
  sizeCustom: el('compress-size-custom'),
  percentChips: el('compress-percent-chips'),
  qualityRange: el('compress-quality-range'),
  qualityValue: el('compress-quality-value'),
  qualityLabel: el('compress-quality-label'),
  remuxContainer: el('compress-remux-container'),
  codec: el('compress-codec'),
  encoder: el('compress-encoder'),
  encoderHint: el('compress-encoder-hint'),
  speed: el('compress-speed'),
  maxHeight: el('compress-max-height'),
  maxFps: el('compress-max-fps'),
  videoSummary: el('compress-video-summary'),
  videoDisabledNote: el('compress-video-disabled-note'),
  detectCrop: el('btn-compress-detect-crop'),
  cropTop: el('compress-crop-top'),
  cropBottom: el('compress-crop-bottom'),
  cropLeft: el('compress-crop-left'),
  cropRight: el('compress-crop-right'),
  cropNote: el('compress-crop-note'),
  flipH: el('compress-flip-h'),
  flipV: el('compress-flip-v'),
  deinterlace: el('compress-deinterlace'),
  denoise: el('compress-denoise'),
  speedFactor: el('compress-speed-factor'),
  pictureSummary: el('compress-picture-summary'),
  pictureDisabledNote: el('compress-picture-disabled-note'),
  audioMode: el('compress-audio-mode'),
  audioCodec: el('compress-audio-codec'),
  audioBitrate: el('compress-audio-bitrate'),
  audioChannels: el('compress-audio-channels'),
  audioTrack: el('compress-audio-track'),
  normalize: el('compress-normalize'),
  volumeDb: el('compress-volume-db'),
  audioSummary: el('compress-audio-summary'),
  audioDisabledNote: el('compress-audio-disabled-note'),
  subsBurn: el('compress-subs-burn'),
  subsTrack: el('compress-subs-track'),
  subsFileRow: el('compress-subs-file-row'),
  subsFile: el('compress-subs-file'),
  subsFileBtn: el('btn-compress-subs-file'),
  subsKeep: el('compress-subs-keep'),
  subsNote: el('compress-subs-note'),
  subtitlesSummary: el('compress-subtitles-summary'),
  subsDisabledNote: el('compress-subs-disabled-note'),
  container: el('compress-container'),
  suffix: el('compress-suffix'),
  outputFolder: el('compress-output-folder'),
  outputFolderBtn: el('btn-compress-output-folder'),
  outputFolderClear: el('btn-compress-output-folder-clear'),
  outputNote: el('compress-output-note'),
  stripMetadata: el('compress-strip-metadata'),
  outputSummary: el('compress-output-summary'),
  estimateSize: el('compress-estimate-size'),
  estimateDelta: el('compress-estimate-delta'),
  estimateKind: el('compress-estimate-kind'),
  estimateBar: el('compress-estimate-bar'),
  estimateBefore: el('compress-estimate-before'),
  estimateAfter: el('compress-estimate-after'),
  estimateEncoder: el('compress-estimate-encoder'),
  estimateResolution: el('compress-estimate-resolution'),
  estimateAudio: el('compress-estimate-audio'),
  estimateWarnings: el('compress-estimate-warnings'),
  previewBtn: el('btn-compress-preview'),
  previewSpinner: el('compress-preview-spinner'),
  previewLabel: el('compress-preview-label'),
  previewCancel: el('btn-compress-preview-cancel'),
  previewNote: el('compress-preview-note'),
  addQueueBtn: el('btn-compress-add-queue'),
  runBtn: el('btn-compress-run'),
  batchNote: el('compress-batch-note'),
  queueRoot: el('compress-queue-root'),
  compareRoot: el('compress-compare-root')
};
state.tabEl = ui.tab;

// ---------- small helpers ----------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback = 1) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function isGpuEncoder(name) {
  const caps = state.capabilities;
  if (!caps || !name) return false;
  for (const key of Object.keys(caps.codecs || {})) {
    const found = (caps.codecs[key] || []).find((enc) => enc && enc.name === name);
    if (found) return !!found.hardware;
  }
  return /_nvenc$|_qsv$|_amf$|_videotoolbox$/.test(name);
}

function encoderLabel(name) {
  const caps = state.capabilities;
  if (!name || name === 'auto') return 'Auto';
  if (caps && caps.codecs) {
    for (const key of Object.keys(caps.codecs)) {
      const found = (caps.codecs[key] || []).find((enc) => enc && enc.name === name);
      if (found) return found.label || name;
    }
  }
  const known = {
    libx264: 'x264 (software)',
    libx265: 'x265 (software)',
    libsvtav1: 'SVT-AV1 (software)',
    libaom: 'libaom (software)',
    libvpx_vp9: 'libvpx (software)',
    h264_nvenc: 'NVIDIA NVENC',
    hevc_nvenc: 'NVIDIA NVENC',
    av1_nvenc: 'NVIDIA NVENC',
    h264_qsv: 'Intel Quick Sync',
    hevc_qsv: 'Intel Quick Sync',
    av1_qsv: 'Intel Quick Sync',
    h264_amf: 'AMD AMF',
    hevc_amf: 'AMD AMF',
    av1_amf: 'AMD AMF',
    h264_videotoolbox: 'Apple VideoToolbox',
    hevc_videotoolbox: 'Apple VideoToolbox'
  };
  return known[name] || name;
}

function encoderShortLabel(name) {
  if (!name || name === 'auto') return 'Auto';
  const isGpu = isGpuEncoder(name);
  const brand = encoderLabel(name);
  return isGpu ? `GPU · ${brand}` : 'Software';
}

function autoEncoderFor(codec) {
  const caps = state.capabilities;
  if (!caps || !caps.autoEncoder) return null;
  return caps.autoEncoder[codec] || null;
}

function capsFor(codec) {
  const caps = state.capabilities;
  if (!caps || !caps.codecs) return null;
  return caps.codecs[codec] || null;
}

function showNotice(text, tone = 'info') {
  text = cleanIpcText(text);
  if (ui.batchNote) {
    ui.batchNote.textContent = text;
    ui.batchNote.className = `cmp-inline-note cmp-inline-note-top${tone === 'warn' ? ' is-warn' : tone === 'ok' ? ' is-ok' : tone === 'error' ? ' is-error' : ''}`;
    ui.batchNote.hidden = !text;
  }
  if (state.noticeTimer) clearTimeout(state.noticeTimer);
  state.noticeTimer = null;
  if (text) {
    state.noticeTimer = setTimeout(() => {
      state.noticeTimer = null;
      if (ui.batchNote) ui.batchNote.hidden = true;
    }, 5000);
  }
}

// Electron wraps main-process errors as "Error invoking remote method 'x': Error: msg"; users only need msg.
function cleanIpcText(text) {
  return String(text == null ? '' : text).replace(/Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/g, '');
}

function setPreviewNote(text, tone = 'info') {
  if (!ui.previewNote) return;
  text = cleanIpcText(text);
  ui.previewNote.textContent = text;
  ui.previewNote.className = `cmp-preview-note${tone === 'warn' ? ' is-warn' : tone === 'error' ? ' is-error' : tone === 'ok' ? ' is-ok' : ''}`;
  ui.previewNote.hidden = !text;
}

function setEmptyNote(text, tone = 'info') {
  if (!ui.emptyNote) return;
  text = cleanIpcText(text);
  ui.emptyNote.textContent = text;
  ui.emptyNote.className = `cmp-inline-note${tone === 'warn' ? ' is-warn' : tone === 'ok' ? ' is-ok' : tone === 'error' ? ' is-error' : ''}`;
  ui.emptyNote.hidden = !text;
}

function setScreen(screen) {
  if (ui.emptyState) ui.emptyState.hidden = screen !== 'empty';
  if (ui.loading) ui.loading.hidden = screen !== 'loading';
  if (ui.workspace) ui.workspace.hidden = screen !== 'workspace';
}

// ---------- options / control plumbing ----------

function mergeOptions(base, patch) {
  const merged = JSON.parse(JSON.stringify(base));
  if (!patch || typeof patch !== 'object') return merged;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && merged[key] && typeof merged[key] === 'object') {
      merged[key] = { ...merged[key], ...JSON.parse(JSON.stringify(value)) };
    } else {
      merged[key] = JSON.parse(JSON.stringify(value));
    }
  }
  return merged;
}

function readCropValues() {
  const probe = state.probe;
  const maxW = probe && probe.width ? probe.width : 16384;
  const maxH = probe && probe.height ? probe.height : 16384;
  const top = clamp(toInt(ui.cropTop?.value, 0), 0, maxH - 2);
  const bottom = clamp(toInt(ui.cropBottom?.value, 0), 0, maxH - top - 2);
  const left = clamp(toInt(ui.cropLeft?.value, 0), 0, maxW - 2);
  const right = clamp(toInt(ui.cropRight?.value, 0), 0, maxW - left - 2);
  return { top, bottom, left, right };
}

function cropIsSet(crop) {
  return !!crop && (crop.top > 0 || crop.bottom > 0 || crop.left > 0 || crop.right > 0);
}

function activeRotate() {
  const pressed = ui.tab ? ui.tab.querySelector('.cmp-chip-mini[aria-pressed="true"]') : null;
  return pressed ? toInt(pressed.dataset.rotate, 0) : 0;
}

function selectedRotateButton(deg) {
  if (!ui.tab) return;
  ui.tab.querySelectorAll('.cmp-chip-mini[data-rotate]').forEach((btn) => {
    btn.setAttribute('aria-pressed', toInt(btn.dataset.rotate, 0) === deg ? 'true' : 'false');
  });
}

function readOptions() {
  const options = JSON.parse(JSON.stringify(DEFAULTS));
  const mode = state.mode;
  const crop = readCropValues();
  const duration = state.duration || 0;

  options.presetId = state.presetModified ? null : state.presetId || null;
  options.mode = mode;
  if (mode === 'size') {
    if (state.sizeMode === 'percent' && state.percentVal) {
      options.targetSizePercent = state.percentVal;
      options.targetSizeMB = null;
    } else {
      options.targetSizeMB = clamp(toFloat(ui.sizeCustom?.value, 10) || 10, 0.1, 10240);
      options.targetSizePercent = null;
    }
  } else {
    options.targetSizeMB = null;
    options.targetSizePercent = null;
  }
  options.quality = clamp(toInt(ui.qualityRange?.value, 70), 0, 100);
  options.codec = ui.codec?.value || 'h264';
  // desiredEncoder mirrors the select once capabilities are loaded, and holds
  // the pending request before that — so it wins over the placeholder "Auto".
  options.encoder = state.desiredEncoder || ui.encoder?.value || 'auto';
  options.speed = ui.speed?.value || 'balanced';
  options.container = (mode === 'remux' ? ui.remuxContainer?.value : ui.container?.value) || 'mp4';
  if (ui.remuxContainer && mode !== 'remux') ui.remuxContainer.value = options.container;
  options.maxHeight = toInt(ui.maxHeight?.value, 0) || null;
  options.maxFps = toInt(ui.maxFps?.value, 0) || null;
  options.trim = {
    start: state.trimStart > 0.01 ? state.trimStart : null,
    end: duration > 0 && state.trimEnd < duration - 0.01 && state.trimEnd > 0 ? state.trimEnd : null
  };
  options.crop = cropIsSet(crop) ? crop : null;
  options.rotate = activeRotate();
  options.flipH = !!ui.flipH?.checked;
  options.flipV = !!ui.flipV?.checked;
  options.deinterlace = (ui.deinterlace?.value || 'off') === 'on';
  options.denoise = ui.denoise?.value || 'off';
  options.speedFactor = clamp(toFloat(ui.speedFactor?.value, 1) || 1, 0.25, 4);

  options.audio = {
    mode: ui.audioMode?.value || 'encode',
    codec: ui.audioCodec?.value || 'aac',
    bitrateKbps: clamp(toInt(ui.audioBitrate?.value, 128) || 128, 48, 320),
    channels: ui.audioChannels?.value === '2' ? 2 : ui.audioChannels?.value === '1' ? 1 : 'source',
    trackIndex: ui.audioTrack?.value && ui.audioTrack.value !== 'auto' ? toInt(ui.audioTrack.value, 0) : null,
    normalize: !!ui.normalize?.checked,
    volumeDb: clamp(toFloat(ui.volumeDb?.value, 0), -20, 20)
  };

  const burnKind = ui.subsBurn?.value || 'none';
  // A "burn from file" request without a chosen file would fail the job, so
  // treat it as "none" until a file is picked.
  const effectiveBurn = burnKind === 'file' && !state.subsFilePath ? 'none' : burnKind;
  options.subtitles = {
    burn: {
      kind: effectiveBurn,
      trackIndex: effectiveBurn === 'track' && ui.subsTrack?.value !== 'auto' ? toInt(ui.subsTrack.value, 0) : null,
      filePath: effectiveBurn === 'file' ? state.subsFilePath || null : null
    },
    keepSoft: !!ui.subsKeep?.checked
  };
  options.stripMetadata = !!ui.stripMetadata?.checked;
  options.output = {
    dir: state.outputDir || null,
    suffix: ui.suffix?.value != null ? ui.suffix.value : ' (compressed)'
  };
  return options;
}

function applyOptions(options) {
  if (!options || typeof options !== 'object') return;
  state.syncing = true;
  try {
    const mode = options.mode === 'size' || options.mode === 'remux' ? options.mode : 'quality';
    state.mode = mode;
    state.percentVal = Number.isFinite(options.targetSizePercent) ? options.targetSizePercent : null;
    state.sizeMode = state.percentVal ? 'percent' : 'mb';
    state.customSize = !!(!state.percentVal && Number.isFinite(options.targetSizeMB) && !STANDARD_SIZES.includes(options.targetSizeMB));

    if (Number.isFinite(options.targetSizeMB) && ui.sizeCustom) {
      ui.sizeCustom.value = String(options.targetSizeMB);
    }
    if (options.quality != null && ui.qualityRange) ui.qualityRange.value = String(clamp(toInt(options.quality, 70), 0, 100));
    if (ui.codec && options.codec) {
      const codecExists = [...ui.codec.options].some((opt) => opt.value === options.codec && !opt.disabled);
      if (codecExists) ui.codec.value = options.codec;
    }
    if (options.encoder) {
      // Keep the requested encoder even while the option list is still just
      // "Auto"; loadCapabilities() re-applies it once the real list exists.
      state.desiredEncoder = options.encoder;
      if (state.capabilitiesLoaded) rebuildEncoderOptions();
      else if (ui.encoder) ui.encoder.value = 'auto';
    }
    if (ui.speed && options.speed) ui.speed.value = options.speed;
    if (ui.container && options.container) ui.container.value = options.container;
    if (ui.remuxContainer && options.container) ui.remuxContainer.value = options.container;
    if (ui.maxHeight) ui.maxHeight.value = String(options.maxHeight || 0);
    if (ui.maxFps) ui.maxFps.value = String(options.maxFps || 0);

    // Only touch the trim markers when the incoming options actually specify
    // them — applying a preset must not wipe a trim the user just dragged.
    const trim = options.trim || {};
    if (Number.isFinite(trim.start) || Number.isFinite(trim.end)) {
      state.trimStart = Number.isFinite(trim.start) ? trim.start : 0;
      state.trimEnd = Number.isFinite(trim.end) ? trim.end : state.duration || 0;
      syncTimeline();
    } else {
      syncTrimInputs();
    }

    const crop = options.crop || { top: 0, bottom: 0, left: 0, right: 0 };
    if (ui.cropTop) ui.cropTop.value = String(crop.top || 0);
    if (ui.cropBottom) ui.cropBottom.value = String(crop.bottom || 0);
    if (ui.cropLeft) ui.cropLeft.value = String(crop.left || 0);
    if (ui.cropRight) ui.cropRight.value = String(crop.right || 0);

    selectedRotateButton(clamp(toInt(options.rotate, 0), 0, 270));
    if (ui.flipH) ui.flipH.checked = !!options.flipH;
    if (ui.flipV) ui.flipV.checked = !!options.flipV;
    if (ui.deinterlace) ui.deinterlace.value = options.deinterlace ? 'on' : 'off';
    if (ui.denoise && options.denoise) ui.denoise.value = options.denoise;
    if (ui.speedFactor) ui.speedFactor.value = String(Number.isFinite(options.speedFactor) ? options.speedFactor : 1);

    const audio = options.audio || {};
    if (ui.audioMode && audio.mode) ui.audioMode.value = audio.mode;
    if (ui.audioCodec && audio.codec) {
      const has = [...ui.audioCodec.options].some((o) => o.value === audio.codec);
      if (has) ui.audioCodec.value = audio.codec;
    }
    if (ui.audioBitrate && audio.bitrateKbps != null) ui.audioBitrate.value = String(audio.bitrateKbps);
    if (ui.audioChannels) ui.audioChannels.value = audio.channels === 2 ? '2' : audio.channels === 1 ? '1' : 'source';
    if (ui.audioTrack) ui.audioTrack.value = Number.isFinite(audio.trackIndex) ? String(audio.trackIndex) : 'auto';
    if (ui.normalize) ui.normalize.checked = !!audio.normalize;
    if (ui.volumeDb && audio.volumeDb != null) ui.volumeDb.value = String(audio.volumeDb);

    const subs = (options.subtitles && options.subtitles.burn) || {};
    if (ui.subsBurn) ui.subsBurn.value = subs.kind || 'none';
    if (ui.subsTrack) ui.subsTrack.value = Number.isFinite(subs.trackIndex) ? String(subs.trackIndex) : 'auto';
    state.subsFilePath = subs.filePath || '';
    if (ui.subsFile) ui.subsFile.value = state.subsFilePath;
    if (ui.subsKeep) ui.subsKeep.checked = !!(options.subtitles && options.subtitles.keepSoft);

    if (ui.stripMetadata) ui.stripMetadata.checked = !!options.stripMetadata;
    const output = options.output || {};
    state.outputDir = output.dir || '';
    if (ui.outputFolder) ui.outputFolder.value = state.outputDir;
    if (ui.suffix && typeof output.suffix === 'string') ui.suffix.value = output.suffix;
    if (ui.presetStatus) ui.presetStatus.hidden = true;
  } finally {
    state.syncing = false;
  }
  refreshGoalUI();
  refreshSummaries();
  layoutCropOverlay();
  refreshAvailability();
  scheduleEstimate();
}

function applyPreset(preset) {
  if (!preset || !preset.options) return;
  state.presetId = preset.id || null;
  state.presetModified = false;
  applyOptions(mergeOptions(DEFAULTS, preset.options));
  if (ui.presetStatus) ui.presetStatus.hidden = true;
  renderPresetChips();
  persistOptionsSoon();
  showNotice(`Preset applied: ${preset.label}`, 'ok');
}

function markModified() {
  if (state.syncing) return;
  if (state.presetId) state.presetModified = true;
  if (ui.presetStatus) ui.presetStatus.hidden = !(state.presetId && state.presetModified);
  if (!ui.presetChips) return;
  ui.presetChips.querySelectorAll('.cmp-preset-chip').forEach((chip) => {
    const main = chip.querySelector('.cmp-preset-main');
    const active = !state.presetModified && !!main && main.dataset.presetId === state.presetId;
    chip.classList.toggle('is-active', active);
    if (main) main.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

// ---------- goal / quality UI ----------

function qualityLabelFor(value) {
  const v = clamp(toInt(value, 70), 0, 100);
  for (const step of QUALITY_STEPS) {
    if (v <= step.max) return step.label;
  }
  return 'Best';
}

function refreshGoalUI() {
  const mode = state.mode;
  for (const [btn, panel, name] of [
    [ui.goalSize, ui.panelSize, 'size'],
    [ui.goalQuality, ui.panelQuality, 'quality'],
    [ui.goalRemux, ui.panelRemux, 'remux']
  ]) {
    if (!btn || !panel) continue;
    const active = mode === name;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.classList.toggle('is-active', active);
    panel.hidden = !active;
  }

  const sizeValue = toFloat(ui.sizeCustom?.value, 0);
  ui.sizeChips?.querySelectorAll('.cmp-chip').forEach((chip) => {
    const mb = chip.dataset.mb;
    const active = mb === 'custom'
      ? state.sizeMode === 'mb' && (state.customSize || !STANDARD_SIZES.includes(sizeValue))
      : state.sizeMode === 'mb' && Math.abs(sizeValue - toFloat(mb, 0)) < 0.01;
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  ui.percentChips?.querySelectorAll('.cmp-chip').forEach((chip) => {
    const pct = toFloat(chip.dataset.percent, 0);
    const active = pct > 0
      ? state.sizeMode === 'percent' && state.percentVal === pct
      : state.sizeMode === 'mb';
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  if (ui.sizeCustom) {
    ui.sizeCustom.disabled = state.sizeMode === 'percent';
    // The custom MB field only shows once "Custom…" is the chosen target.
    const customRow = ui.sizeCustom.closest('.cmp-inline-field');
    const customActive = state.sizeMode === 'mb' && (state.customSize || !STANDARD_SIZES.includes(sizeValue));
    if (customRow) customRow.hidden = !customActive;
  }

  const q = clamp(toInt(ui.qualityRange?.value, 70), 0, 100);
  if (ui.qualityValue) ui.qualityValue.textContent = String(q);
  if (ui.qualityLabel) ui.qualityLabel.textContent = qualityLabelFor(q);
}

function setMode(mode) {
  if (mode !== 'size' && mode !== 'quality' && mode !== 'remux') return;
  if (state.mode === mode) return;
  if (ui.container && ui.remuxContainer) {
    if (mode === 'remux') ui.remuxContainer.value = ui.container.value || 'mp4';
    else if (state.mode === 'remux') ui.container.value = ui.remuxContainer.value || 'mp4';
  }
  state.mode = mode;
  refreshGoalUI();
  refreshAvailability();
  refreshSummaries();
  markModified();
  scheduleEstimate();
  persistOptionsSoon();
}

// ---------- summaries ----------

function resolutionSummary(estimate) {
  if (estimate && estimate.outputWidth && estimate.outputHeight) {
    return `${estimate.outputWidth}x${estimate.outputHeight}`;
  }
  const height = toInt(ui.maxHeight?.value, 0);
  return height ? `${height}p cap` : 'Source resolution';
}

function refreshSummaries() {
  const mode = state.mode;
  const codec = ui.codec?.value || 'h264';
  const enc = ui.encoder?.value || 'auto';
  if (ui.videoSummary) {
    const speedText = SPEED_LABELS[ui.speed?.value || 'balanced'] || 'Balanced';
    ui.videoSummary.textContent = mode === 'remux'
      ? 'Skipped — Convert only'
      : `${CODEC_LABELS[codec] || codec} · ${enc === 'auto' ? 'Auto encoder' : encoderShortLabel(enc)} · ${resolutionSummary(state.estimate)} · ${speedText}`;
  }

  const crop = readCropValues();
  if (ui.pictureSummary) {
    const cropText = cropIsSet(crop) ? `Crop ${crop.top}/${crop.bottom}/${crop.left}/${crop.right}` : 'No crop';
    const extras = [];
    if (activeRotate()) extras.push(`${activeRotate()}°`);
    if (ui.flipH?.checked) extras.push('flip H');
    if (ui.flipV?.checked) extras.push('flip V');
    if ((ui.deinterlace?.value || 'off') === 'on') extras.push('deinterlace');
    if ((ui.denoise?.value || 'off') !== 'off') extras.push(`denoise ${ui.denoise.value}`);
    const factor = toFloat(ui.speedFactor?.value, 1);
    if (Math.abs(factor - 1) > 0.001) extras.push(`${factor}× speed`);
    ui.pictureSummary.textContent = mode === 'remux'
      ? 'Skipped — Convert only'
      : [cropText, ...(extras.length ? extras : ['0°'])].join(' · ');
  }

  if (ui.audioSummary) {
    const audioMode = ui.audioMode?.value || 'encode';
    if (mode === 'remux' || audioMode === 'copy') {
      ui.audioSummary.textContent = mode === 'remux' ? 'Skipped — Convert only' : 'Kept as-is';
    } else if (audioMode === 'none') {
      ui.audioSummary.textContent = 'Removed';
    } else {
      const codecLabel = AUDIO_CODEC_LABELS[ui.audioCodec?.value || 'aac'] || 'AAC';
      const kbps = toInt(ui.audioBitrate?.value, 128);
      const channels = CHANNEL_LABELS[ui.audioChannels?.value === '1' ? 1 : ui.audioChannels?.value === '2' ? 2 : 'source'];
      const extra = ui.normalize?.checked ? ' · normalized' : '';
      ui.audioSummary.textContent = `${codecLabel} ${kbps} kbps · ${channels}${extra}`;
    }
  }

  if (ui.subtitlesSummary) {
    const kind = ui.subsBurn?.value || 'none';
    let text = 'Not burned in';
    if (kind === 'track') text = 'Burn embedded track';
    else if (kind === 'file') text = 'Burn subtitle file';
    if (mode === 'remux' && kind !== 'none') text = 'Skipped — Convert only';
    else if (ui.subsKeep?.checked) text = `${text} · soft subs kept`;
    ui.subtitlesSummary.textContent = text;
  }

  if (ui.outputSummary) {
    const container = (mode === 'remux' ? ui.remuxContainer?.value : ui.container?.value) || 'mp4';
    const where = state.outputDir ? 'Custom folder' : 'Next to original';
    ui.outputSummary.textContent = `${container.toUpperCase()} · ${where}`;
  }

  if (ui.outputNote) {
    const container = (mode === 'remux' ? ui.remuxContainer?.value : ui.container?.value) || 'mp4';
    const suffix = ui.suffix?.value || ' (compressed)';
    const base = state.probe && state.probe.filename
      ? state.probe.filename.replace(/\.([a-z0-9]+)$/i, '')
      : 'name';
    ui.outputNote.textContent = '';
    const text = document.createTextNode(
      `Saved ${state.outputDir ? 'in the chosen folder' : 'next to the original'} as `
    );
    ui.outputNote.appendChild(text);
    const mono = document.createElement('span');
    mono.className = 'cmp-mono';
    mono.textContent = `${base}${suffix}.${container}`;
    ui.outputNote.appendChild(mono);
    ui.outputNote.appendChild(document.createTextNode(' — the original is never overwritten.'));
  }

  if (ui.encoderHint) {
    if (mode === 'remux') {
      ui.encoderHint.textContent = 'Encoder is unused when only the container changes.';
    } else {
      const caps = state.capabilities;
      const auto = autoEncoderFor(codec);
      if (enc === 'auto') {
        ui.encoderHint.textContent = auto
          ? `Auto picks ${encoderLabel(auto)}${isGpuEncoder(auto) ? ' (GPU)' : ' (software)'} for ${CODEC_LABELS[codec] || codec}.`
          : 'Auto picks the fastest verified encoder for this codec.';
      } else {
        ui.encoderHint.textContent = `${encoderLabel(enc)}${isGpuEncoder(enc) ? ' — GPU encoding' : ' — software encoding'}.`;
      }
      if (caps && caps.ffmpegVersion) {
        ui.encoderHint.title = `FFmpeg ${caps.ffmpegVersion}`;
      }
    }
  }

  if (ui.subsFileRow) ui.subsFileRow.hidden = (ui.subsBurn?.value || 'none') !== 'file';
  if (ui.subsNote) {
    const caps = state.capabilities;
    const burnPossible = !caps || !caps.features || caps.features.subtitlesBurn !== false;
    if (mode === 'remux') ui.subsNote.textContent = 'Convert only keeps existing subtitle tracks untouched.';
    else if (!burnPossible) ui.subsNote.textContent = 'This FFmpeg build has no libass support, so burn-in is unavailable.';
    else ui.subsNote.textContent = 'Burn-in needs libass support in the bundled FFmpeg; soft subs are kept when the container supports them.';
  }
}

// ---------- availability ----------

const CONTROL_SELECTOR = 'select, input, button';

function sectionControls() {
  const ids = [
    'compress-section-video-panel',
    'compress-section-picture-panel',
    'compress-section-audio-panel',
    'compress-section-subtitles-panel',
    'compress-section-output-panel'
  ];
  const out = [];
  for (const id of ids) {
    const panel = el(id);
    if (!panel) continue;
    panel.querySelectorAll(CONTROL_SELECTOR).forEach((c) => out.push(c));
  }
  return out;
}

function baseTitle(control) {
  if (!control.dataset.cmpTitle) control.dataset.cmpTitle = control.title || '';
  return control.dataset.cmpTitle;
}

function disableControl(control, reason) {
  control.disabled = true;
  control.title = reason;
}

function refreshAvailability() {
  const mode = state.mode;
  const caps = state.capabilities;
  const remux = mode === 'remux';

  for (const control of sectionControls()) {
    control.disabled = false;
    control.title = baseTitle(control);
  }

  if (remux) {
    const reason = 'Not available in Convert only — the streams are copied as-is.';
    for (const id of ['compress-section-video-panel', 'compress-section-picture-panel', 'compress-section-audio-panel']) {
      const panel = el(id);
      if (!panel) continue;
      panel.querySelectorAll(CONTROL_SELECTOR).forEach((control) => disableControl(control, reason));
    }
    const subsPanel = el('compress-section-subtitles-panel');
    if (subsPanel) {
      for (const control of [ui.subsBurn, ui.subsTrack, ui.subsFileBtn, ui.subsKeep]) {
        if (control) disableControl(control, reason);
      }
    }
  }

  for (const note of [ui.videoDisabledNote, ui.pictureDisabledNote, ui.audioDisabledNote, ui.subsDisabledNote]) {
    if (note) note.hidden = !remux;
  }

  if (remux && ui.container) {
    disableControl(ui.container, 'Convert only uses the container chosen under Goal.');
  }

  if (!remux && caps) {
    const list = capsFor(ui.codec?.value || 'h264');
    if (Array.isArray(list) && list.length === 0 && ui.codec && !ui.codec.disabled) {
      disableControl(ui.codec, `${CODEC_LABELS[ui.codec.value] || 'This codec'} is not available in the bundled FFmpeg.`);
    }
    const features = caps.features || {};
    if (ui.audioCodec) {
      for (const opt of [...ui.audioCodec.options]) {
        if (opt.value === 'opus') opt.disabled = features.opus === false;
        if (opt.value === 'mp3') opt.disabled = features.mp3 === false;
      }
      if (ui.audioCodec.selectedOptions[0]?.disabled) {
        const fallback = [...ui.audioCodec.options].find((opt) => !opt.disabled);
        if (fallback) ui.audioCodec.value = fallback.value;
      }
    }
    if (features.loudnorm === false && ui.normalize && !ui.normalize.disabled) {
      disableControl(ui.normalize, 'Loudness normalisation needs a FFmpeg build with loudnorm. Your build does not include it.');
    }
    if (features.subtitlesBurn === false) {
      if (ui.subsBurn) {
        [...ui.subsBurn.options].filter((opt) => opt.value !== 'none').forEach((opt) => { opt.disabled = true; });
        if (ui.subsBurn.value !== 'none') ui.subsBurn.value = 'none';
      }
      if (ui.subsFileBtn && !ui.subsFileBtn.disabled) {
        disableControl(ui.subsFileBtn, 'This FFmpeg build has no libass support for burning subtitles.');
      }
    }
  }

  const probe = state.probe;
  const audioTracks = probe ? (probe.audioTracks || []).length : 0;
  const subTracks = probe ? (probe.subtitleTracks || []).length : 0;
  if (ui.audioTrack && !remux) {
    if (!audioTracks) disableControl(ui.audioTrack, 'This file has no audio tracks.');
    else ui.audioTrack.disabled = false;
  }
  if (ui.subsTrack && !remux) {
    if (!subTracks) disableControl(ui.subsTrack, 'This file has no subtitle tracks.');
    else ui.subsTrack.disabled = false;
  }
  if (ui.subsKeep) {
    if (!subTracks) disableControl(ui.subsKeep, 'This file has no subtitle tracks to keep.');
    else if (!remux) ui.subsKeep.disabled = false;
  }
}

// ---------- presets ----------

function presetChip(preset) {
  const wrap = document.createElement('div');
  wrap.className = 'cmp-preset-chip';
  const isActive = !state.presetModified && !!state.presetId && state.presetId === preset.id;
  wrap.classList.toggle('is-active', isActive);

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'cmp-preset-main';
  main.textContent = preset.label || preset.id;
  main.dataset.presetId = preset.id || '';
  main.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  main.title = preset.description || preset.label || '';
  main.addEventListener('click', () => applyPreset(preset));
  wrap.appendChild(main);

  if (!preset.builtIn) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cmp-chip-del';
    del.textContent = '×';
    del.title = `Delete preset "${preset.label || preset.id}"`;
    del.setAttribute('aria-label', `Delete preset ${preset.label || preset.id}`);
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      await deletePreset(preset.id);
    });
    wrap.appendChild(del);
  }
  return wrap;
}

function renderPresetChips() {
  if (!ui.presetChips) return;
  ui.presetChips.textContent = '';
  const builtIn = state.presets.builtIn || [];
  const custom = state.presets.custom || [];
  if (!builtIn.length && !custom.length) {
    const empty = document.createElement('span');
    empty.className = 'cmp-help';
    empty.textContent = 'Presets are loading…';
    ui.presetChips.appendChild(empty);
    return;
  }
  for (const preset of [...builtIn, ...custom]) {
    ui.presetChips.appendChild(presetChip(preset));
  }
}

function renderHintChips() {
  if (!ui.hintChips) return;
  ui.hintChips.textContent = '';
  const all = [...(state.presets.builtIn || []), ...(state.presets.custom || [])];
  const chosen = QUICK_PRESET_IDS
    .map((id) => all.find((p) => p.id === id))
    .filter(Boolean);
  const fallback = [
    { id: 'discord', label: 'Discord 10 MB' },
    { id: 'whatsapp', label: 'WhatsApp 16 MB' },
    { id: 'email', label: 'Email 25 MB' },
    { id: 'half', label: 'Half the size' }
  ];
  const items = chosen.length ? chosen : fallback;
  for (const preset of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmp-hint-chip';
    btn.textContent = preset.label || preset.id;
    btn.title = preset.description || `Use the ${preset.label || preset.id} preset for your next file`;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      state.pendingPresetId = preset.id;
      ui.hintChips.querySelectorAll('.cmp-hint-chip').forEach((c) => {
        c.classList.remove('is-active');
        c.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
      setEmptyNote(`${preset.label || preset.id} is ready — drop a video or browse to apply it.`, 'ok');
      if (ui.browse) ui.browse.focus();
    });
    ui.hintChips.appendChild(btn);
  }
}

async function loadPresets() {
  if (state.presetsLoading) return state.presetsLoading;
  state.presetsLoading = (async () => {
    try {
      const result = await api().compressListPresets();
      if (result && typeof result === 'object') {
        state.presets = {
          builtIn: Array.isArray(result.builtIn) ? result.builtIn : [],
          custom: Array.isArray(result.custom) ? result.custom : []
        };
        state.presetsLoaded = true;
      }
    } catch (err) {
      console.error('[compress] preset list failed:', err);
    } finally {
      state.presetsLoading = null;
    }
    renderPresetChips();
    renderHintChips();
  })();
  return state.presetsLoading;
}

async function deletePreset(id) {
  if (!id) return;
  try {
    await api().compressDeletePreset(id);
    if (state.presetId === id) {
      state.presetId = null;
      state.presetModified = false;
      if (ui.presetStatus) ui.presetStatus.hidden = true;
    }
    await loadPresets();
    compressBus.emit('presets-changed');
    showNotice('Preset deleted.', 'ok');
  } catch (err) {
    showNotice(`Could not delete preset: ${err.message}`, 'error');
  }
}

function openPresetForm() {
  if (!ui.presetForm) return;
  ui.presetForm.hidden = false;
  if (ui.presetName) {
    ui.presetName.value = '';
    ui.presetName.focus();
  }
}

function closePresetForm() {
  if (ui.presetForm) ui.presetForm.hidden = true;
}

async function savePreset(event) {
  if (event) event.preventDefault();
  const label = (ui.presetName?.value || '').trim();
  if (!label) {
    ui.presetName?.focus();
    return;
  }
  try {
    const options = readOptions();
    delete options.presetId;
    const preset = await api().compressSavePreset({ label, options });
    if (preset && preset.id) {
      state.presetId = preset.id;
      state.presetModified = false;
      if (ui.presetStatus) ui.presetStatus.hidden = true;
    }
    closePresetForm();
    await loadPresets();
    compressBus.emit('presets-changed');
    showNotice(`Preset "${label}" saved.`, 'ok');
    renderPresetChips();
  } catch (err) {
    showNotice(`Could not save preset: ${err.message}`, 'error');
  }
}

// ---------- capabilities ----------

function rebuildCodecOptions() {
  const caps = state.capabilities;
  if (!caps || !caps.codecs || !ui.codec) return;
  for (const opt of [...ui.codec.options]) {
    const codec = opt.value;
    const list = caps.codecs[codec];
    const unavailable = Array.isArray(list) && list.length === 0;
    opt.disabled = unavailable;
    opt.title = unavailable ? `${opt.textContent} is not supported by the bundled FFmpeg.` : '';
  }
  if (ui.codec.selectedOptions[0]?.disabled) {
    const first = [...ui.codec.options].find((o) => !o.disabled);
    if (first) ui.codec.value = first.value;
  }
}

// Short form for the Auto option so it fits the select: "NVENC", "Quick Sync", "x264"...
function shortEncoderLabel(name) {
  const n = String(name || '');
  if (/nvenc/.test(n)) return 'NVENC';
  if (/_qsv$/.test(n)) return 'Quick Sync';
  if (/_amf$/.test(n)) return 'AMD AMF';
  if (/videotoolbox/.test(n)) return 'VideoToolbox';
  if (n === 'libx264') return 'x264';
  if (n === 'libx265') return 'x265';
  if (n === 'libsvtav1') return 'SVT-AV1';
  if (n === 'libaom-av1') return 'libaom';
  if (n === 'libvpx-vp9') return 'libvpx';
  return encoderLabel(n);
}

function rebuildEncoderOptions(preferred) {
  if (!ui.encoder) return;
  const codec = (ui.codec?.value) || 'h264';
  const list = capsFor(codec) || [];
  const current = preferred || state.desiredEncoder || ui.encoder.value || 'auto';
  ui.encoder.textContent = '';
  const auto = document.createElement('option');
  auto.value = 'auto';
  const autoName = autoEncoderFor(codec);
  auto.textContent = autoName
    ? `Auto · ${shortEncoderLabel(autoName)} (${isGpuEncoder(autoName) ? 'GPU' : 'CPU'})`
    : 'Auto';
  auto.title = autoName ? `Resolves to ${encoderLabel(autoName)}` : 'Best verified encoder for this codec';
  ui.encoder.appendChild(auto);
  const sorted = [...list].sort((a, b) => (a.hardware === b.hardware ? 0 : a.hardware ? 1 : -1));
  for (const enc of sorted) {
    const opt = document.createElement('option');
    opt.value = enc.name;
    opt.textContent = `${enc.label || encoderLabel(enc.name)}${enc.hardware ? ' (GPU)' : ' (software)'}`;
    opt.title = enc.twoPass ? 'Supports two-pass encoding' : 'One-pass encoding';
    ui.encoder.appendChild(opt);
  }
  let resolved = current;
  const exists = [...ui.encoder.options].some((o) => o.value === current);
  if (!exists) {
    resolved = 'auto';
    // While capabilities are still loading the option list is only "Auto";
    // keep the requested encoder so it can be re-applied afterwards.
    if (state.capabilitiesLoaded) state.desiredEncoder = 'auto';
  } else {
    state.desiredEncoder = current;
  }
  ui.encoder.value = resolved;
}

function hasAnyEncoder(caps) {
  return !!(caps && caps.codecs && Object.values(caps.codecs).some((list) => Array.isArray(list) && list.length > 0));
}

async function loadCapabilities({ refresh = false } = {}) {
  try {
    const caps = await api().compressGetCapabilities(refresh ? { refresh: true } : undefined);
    state.capabilities = caps || null;
  } catch (err) {
    console.error('[compress] capabilities failed:', err);
    state.capabilities = null;
  }
  state.capabilitiesLoaded = true;
  rebuildCodecOptions();
  rebuildEncoderOptions();
  refreshAvailability();
  refreshSummaries();
  scheduleEstimate();
}

// ---------- crop overlay ----------

function layoutCropOverlay() {
  if (!ui.cropOverlay || !ui.video) return;
  const crop = readCropValues();
  const probe = state.probe;
  const hasCrop = cropIsSet(crop);
  ui.cropOverlay.hidden = !hasCrop || !probe;
  if (!hasCrop || !probe || !probe.width || !probe.height) {
    if (ui.cropNote) ui.cropNote.textContent = 'The dimmed area shows what will be cropped away.';
    return;
  }
  // Video element uses object-fit: contain, so the rendered frame may letterbox.
  const wrapW = ui.playerWrap ? ui.playerWrap.clientWidth : 0;
  const wrapH = ui.playerWrap ? ui.playerWrap.clientHeight : 0;
  if (!wrapW || !wrapH) return;
  const frameAspect = probe.width / probe.height;
  const wrapAspect = wrapW / wrapH;
  let drawW = wrapW;
  let drawH = wrapH;
  if (frameAspect > wrapAspect) drawH = wrapW / frameAspect;
  else drawW = wrapH * frameAspect;
  const drawX = (wrapW - drawW) / 2;
  const drawY = (wrapH - drawH) / 2;

  const px = (value, total, size) => clamp((value / total) * size, 0, size);
  const l = px(crop.left, probe.width, drawW);
  const r = px(crop.right, probe.width, drawW);
  const t = px(crop.top, probe.height, drawH);
  const b = px(crop.bottom, probe.height, drawH);

  const setShade = (node, style) => {
    if (!node) return;
    Object.assign(node.style, {
      left: `${style.left}px`,
      top: `${style.top}px`,
      width: `${style.width}px`,
      height: `${style.height}px`
    });
  };

  setShade(ui.cropShadeTop, { left: drawX, top: drawY, width: drawW, height: t });
  setShade(ui.cropShadeBottom, { left: drawX, top: drawY + drawH - b, width: drawW, height: b });
  setShade(ui.cropShadeLeft, { left: drawX, top: drawY + t, width: l, height: drawH - t - b });
  setShade(ui.cropShadeRight, { left: drawX + drawW - r, top: drawY + t, width: r, height: drawH - t - b });

  if (ui.cropFrame) {
    Object.assign(ui.cropFrame.style, {
      left: `${drawX + l}px`,
      top: `${drawY + t}px`,
      width: `${Math.max(0, drawW - l - r)}px`,
      height: `${Math.max(0, drawH - t - b)}px`
    });
  }

  if (ui.cropNote) {
    const outW = Math.max(2, probe.width - crop.left - crop.right);
    const outH = Math.max(2, probe.height - crop.top - crop.bottom);
    const even = (n) => (n % 2 === 0 ? n : n - 1);
    ui.cropNote.textContent = `Source ${probe.width}x${probe.height} → cropped ${even(outW)}x${even(outH)}. Dimmed = removed.`;
  }
}

// ---------- timeline / trim ----------

function syncTrimInputs() {
  if (ui.trimStartInput) ui.trimStartInput.value = secondsToHHMMSSWithMs(state.trimStart || 0);
  if (ui.trimEndInput) ui.trimEndInput.value = secondsToHHMMSSWithMs(state.trimEnd || 0);
}

function syncTimeline() {
  const duration = state.duration;
  if (!duration) return;
  const { startPct, endPct, widthPct } = sliderPercents(state.trimStart, state.trimEnd, duration);
  if (ui.timelineRange) {
    ui.timelineRange.style.left = `${startPct}%`;
    ui.timelineRange.style.width = `${widthPct}%`;
  }
  if (ui.handleStart) ui.handleStart.style.left = `${startPct}%`;
  if (ui.handleEnd) ui.handleEnd.style.left = `${endPct}%`;
  if (ui.labelTotal) ui.labelTotal.textContent = secondsToHHMMSSWithMs(duration);
  syncTrimInputs();
}

function currentTimeSafe(fallback) {
  const t = ui.video ? Number(ui.video.currentTime) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

function seek(time) {
  if (!ui.video || !Number.isFinite(time)) return;
  try {
    ui.video.currentTime = clamp(time, 0, state.duration || time);
  } catch (err) {
    console.warn('[compress] seek failed:', err);
  }
  updatePlayhead(time);
}

function updatePlayhead(time) {
  const duration = state.duration;
  if (!ui.playhead) return;
  const pct = duration > 0 ? clamp(time / duration, 0, 1) * 100 : 0;
  ui.playhead.style.left = `${pct}%`;
  if (ui.labelCurrent) ui.labelCurrent.textContent = secondsToHHMMSSWithMs(time || 0);
}

function applyTrimValues(start, end, { seekTo = null } = {}) {
  const duration = state.duration || Math.max(end, start);
  let s = clamp(toFloat(start, 0), 0, duration);
  let e = clamp(toFloat(end, duration), 0, duration);
  if (e < s) {
    if (seekTo === 'end') s = e;
    else e = s;
  }
  state.trimStart = s;
  state.trimEnd = e;
  syncTimeline();
  if (seekTo != null) seek(seekTo === 'end' ? e : s);
  markModified();
  scheduleEstimate();
  persistOptionsSoon();
}

function handleTimelinePointer(event) {
  const rect = ui.timeline ? ui.timeline.getBoundingClientRect() : null;
  if (!rect || !state.duration) return { pct: 0, timeVal: 0 };
  return pointerToTime(event.clientX, rect, state.duration);
}

function beginDrag(kind) {
  return (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.dragHandle = kind;
    state.timelineRect = ui.timeline ? ui.timeline.getBoundingClientRect() : null;
    document.addEventListener('mousemove', onDragMove, { passive: true });
    document.addEventListener('mouseup', endDrag);
  };
}

function onDragMove(event) {
  if (!state.dragHandle || !state.timelineRect || !state.duration) return;
  const { timeVal } = handleTimelinePointer(event);
  if (state.dragHandle === 'start') {
    applyTrimValues(Math.min(timeVal, state.trimEnd), state.trimEnd, { seekTo: 'start' });
  } else if (state.dragHandle === 'end') {
    applyTrimValues(state.trimStart, Math.max(timeVal, state.trimStart), { seekTo: 'end' });
  }
}

function endDrag() {
  state.dragHandle = null;
  state.timelineRect = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', endDrag);
}

function beginScrub(event) {
  if (!ui.timeline || !state.duration) return;
  if (event.target === ui.handleStart || event.target === ui.handleEnd) return;
  event.preventDefault();
  state.scrub = true;
  state.timelineRect = ui.timeline.getBoundingClientRect();
  const { timeVal } = handleTimelinePointer(event);
  seek(timeVal);
  document.addEventListener('mousemove', onScrubMove, { passive: true });
  document.addEventListener('mouseup', endScrub);
}

function onScrubMove(event) {
  if (!state.scrub || !state.timelineRect) return;
  const { timeVal } = handleTimelinePointer(event);
  seek(timeVal);
}

function endScrub() {
  state.scrub = false;
  state.timelineRect = null;
  document.removeEventListener('mousemove', onScrubMove);
  document.removeEventListener('mouseup', endScrub);
}

// ---------- estimate ----------

function scheduleEstimate() {
  if (state.estimateTimer) clearTimeout(state.estimateTimer);
  state.estimateTimer = setTimeout(runEstimate, ESTIMATE_DEBOUNCE_MS);
}

async function runEstimate() {
  state.estimateTimer = null;
  if (!state.probe || !state.activePath) return;
  const token = ++state.estimateToken;
  const options = readOptions();
  try {
    const result = await api().compressEstimate({ probe: state.probe, options });
    if (token !== state.estimateToken) return;
    state.estimate = result || null;
    renderEstimate(result, options);
  } catch (err) {
    if (token !== state.estimateToken) return;
    renderEstimate(null, options, err);
  }
}

function renderEstimate(estimate, options, error) {
  const inputSize = state.probe ? state.probe.size : 0;
  if (ui.estimateBefore) ui.estimateBefore.textContent = formatBytes(inputSize);
  if (ui.estimateAfter) ui.estimateAfter.textContent = '—';
  if (ui.estimateDelta) {
    ui.estimateDelta.hidden = true;
    ui.estimateDelta.textContent = '';
  }
  if (ui.estimateBar) ui.estimateBar.style.width = '0%';
  if (ui.estimateWarnings) ui.estimateWarnings.textContent = '';

  if (ui.estimateKind) {
    const kind = estimate && estimate.estimateKind;
    ui.estimateKind.textContent = kind === 'exact-target' ? 'exact target' : kind === 'remux' ? 'remux' : 'approx.';
    ui.estimateKind.title = kind === 'exact-target'
      ? 'The target size is computed from the video length, so this should land close.'
      : kind === 'remux'
        ? 'Convert only copies the streams, so the size stays about the same.'
        : 'A heuristic from the quality setting — the real size can differ by 10–20 %.';
  }

  if (ui.estimateEncoder) {
    const name = estimate && estimate.encoder ? estimate.encoder : autoEncoderFor(options.codec);
    const gpu = isGpuEncoder(name);
    ui.estimateEncoder.textContent = name ? (gpu ? 'GPU' : 'CPU') : 'CPU';
    ui.estimateEncoder.classList.toggle('is-gpu', gpu);
    ui.estimateEncoder.title = name ? encoderLabel(name) : 'Encoder is resolved when the job starts';
  }

  if (ui.estimateResolution) {
    if (estimate && estimate.outputWidth && estimate.outputHeight) {
      ui.estimateResolution.textContent = `${estimate.outputWidth}x${estimate.outputHeight}`;
    } else {
      ui.estimateResolution.textContent = resolutionSummary(null);
    }
  }

  if (ui.estimateAudio) {
    if (options.audio.mode === 'none') ui.estimateAudio.textContent = 'No audio';
    else if (options.audio.mode === 'copy') ui.estimateAudio.textContent = 'Audio copied';
    else {
      ui.estimateAudio.textContent = `${AUDIO_CODEC_LABELS[options.audio.codec] || 'AAC'} ${options.audio.bitrateKbps} kbps`;
    }
  }

  if (error) {
    if (ui.estimateSize) ui.estimateSize.textContent = '≈ —';
    if (ui.estimateWarnings) appendEstimateLine('Could not estimate this combination.', 'warn');
    return;
  }
  if (!estimate) {
    if (ui.estimateSize) ui.estimateSize.textContent = '≈ —';
    return;
  }

  const bytes = estimate.estimatedBytes;
  // A size target is a ceiling, not a guess: say "Under 10 MB" in the units the user picked.
  const targetMB = estimate.estimateKind === 'exact-target' && !options.targetSizePercent && Number.isFinite(options.targetSizeMB)
    ? options.targetSizeMB
    : null;
  if (ui.estimateSize) {
    ui.estimateSize.textContent = targetMB != null
      ? `Under ${targetMB} MB`
      : bytes != null ? `≈ ${formatBytes(bytes)}` : estimate.mode === 'remux' ? '≈ same size' : '≈ —';
  }
  if (ui.estimateKind && estimate.estimateKind === 'exact-target') ui.estimateKind.textContent = 'target';

  if (bytes != null && inputSize > 0) {
    const pct = Math.round((1 - bytes / inputSize) * 1000) / 10;
    if (ui.estimateDelta) {
      ui.estimateDelta.hidden = false;
      ui.estimateDelta.textContent = pct > 0 ? `−${Math.round(pct)} %` : pct < 0 ? `+${Math.abs(Math.round(pct))} %` : '0 %';
    }
    if (ui.estimateBar) {
      // The bar is the new file's size relative to the original (the full track).
      const share = clamp((bytes / inputSize) * 100, 1.5, 100);
      ui.estimateBar.style.width = `${share}%`;
    }
  }
  if (bytes != null && ui.estimateAfter) ui.estimateAfter.textContent = formatBytes(bytes);

  if (ui.estimateWarnings) {
    for (const warning of estimate.warnings || []) appendEstimateLine(warning, 'warn');
    for (const note of estimate.notes || []) {
      // The GPU/CPU chip already names the encoder.
      if (/^Using .+\((GPU|CPU)\)\.?$/.test(String(note).trim())) continue;
      appendEstimateLine(note, 'note');
    }
  }

  refreshSummaries();
}

function appendEstimateLine(text, tone) {
  if (!ui.estimateWarnings || !text) return;
  const line = document.createElement('span');
  line.className = tone === 'warn' ? 'cmp-warn-line' : 'cmp-note-line';
  line.textContent = text;
  ui.estimateWarnings.appendChild(line);
}

// ---------- persistence ----------

function persistOptionsSoon() {
  if (state.syncing) return;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    persistOptions();
  }, SAVE_DEBOUNCE_MS);
}

function persistOptions() {
  const options = readOptions();
  // Per-file settings would silently apply to the next video (or after a restart).
  options.trim = { start: null, end: null };
  options.crop = null;
  options.rotate = 0;
  options.flipH = false;
  options.flipV = false;
  if (options.subtitles) options.subtitles.burn = { kind: 'none', trackIndex: null, filePath: null };
  if (options.audio) options.audio.trackIndex = null;
  try {
    const pending = api().saveSettings({ compressLastOptions: options });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (err) {
    console.warn('[compress] could not save last options:', err);
  }
}

async function restoreOptions() {
  if (state.restored) return;
  // A download card can open a file (and its preset) before init finishes
  // awaiting capabilities — don't clobber that with the previous session.
  if (state.loadToken > 0 || state.activePath) {
    state.restored = true;
    return;
  }
  state.restored = true;
  let saved = null;
  try {
    const settings = await api().getSettings();
    saved = settings && settings.compressLastOptions;
  } catch (err) {
    console.warn('[compress] could not read settings:', err);
  }
  if (saved && typeof saved === 'object') {
    applyOptions(mergeOptions(DEFAULTS, saved));
    if (saved.presetId && state.presetsLoaded) {
      const all = [...(state.presets.builtIn || []), ...(state.presets.custom || [])];
      const preset = all.find((p) => p.id === saved.presetId);
      if (preset) {
        state.presetId = preset.id;
        renderPresetChips();
      }
    }
  } else {
    applyOptions(DEFAULTS);
  }
}

// ---------- sections / localStorage ----------

function readSectionState() {
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(state.sectionOpen)) {
          if (typeof parsed[key] === 'boolean') state.sectionOpen[key] = parsed[key];
        }
      }
    }
  } catch (err) {
    // localStorage may be unavailable; defaults are fine.
  }
}

function writeSectionState() {
  try {
    localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(state.sectionOpen));
  } catch (err) {
    // ignore quota / privacy-mode failures
  }
}

function applySectionState() {
  for (const key of Object.keys(state.sectionOpen)) {
    const toggle = el(`compress-section-${key}-toggle`);
    const panel = el(`compress-section-${key}-panel`);
    if (!toggle || !panel) continue;
    const open = state.sectionOpen[key];
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  }
}

function toggleSection(key) {
  state.sectionOpen[key] = !state.sectionOpen[key];
  applySectionState();
  writeSectionState();
}

// ---------- subtitle file / output folder ----------

async function chooseSubtitleFile() {
  try {
    const filePath = await api().compressSelectSubtitle();
    if (!filePath) return;
    state.subsFilePath = filePath;
    if (ui.subsFile) ui.subsFile.value = filePath;
    if (ui.subsBurn) ui.subsBurn.value = 'file';
    if (ui.subsFileRow) ui.subsFileRow.hidden = false;
    refreshSummaries();
    markModified();
    scheduleEstimate();
    persistOptionsSoon();
  } catch (err) {
    showNotice(`Could not pick a subtitle file: ${err.message}`, 'error');
  }
}

async function chooseOutputFolder() {
  try {
    const dir = await api().selectFolder();
    if (!dir) return;
    state.outputDir = dir;
    if (ui.outputFolder) ui.outputFolder.value = dir;
    refreshSummaries();
    markModified();
    persistOptionsSoon();
  } catch (err) {
    showNotice(`Could not pick an output folder: ${err.message}`, 'error');
  }
}

function clearOutputFolder() {
  state.outputDir = '';
  if (ui.outputFolder) ui.outputFolder.value = '';
  refreshSummaries();
  markModified();
  persistOptionsSoon();
}

async function detectCrop() {
  if (!state.activePath) return;
  const btn = ui.detectCrop;
  if (btn) {
    btn.disabled = true;
    if (btn.dataset.labelHtml == null) btn.dataset.labelHtml = btn.innerHTML;
    btn.textContent = 'Detecting…';
  }
  const token = state.loadToken;
  try {
    const result = await api().compressDetectCrop(state.activePath);
    if (token !== state.loadToken) return; // a different file was opened meanwhile
    if (result) {
      const probe = state.probe || {};
      const maxW = probe.width || result.width || 16384;
      const maxH = probe.height || result.height || 16384;
      if (ui.cropTop) ui.cropTop.value = String(clamp(toInt(result.top, 0), 0, maxH - 2));
      if (ui.cropBottom) ui.cropBottom.value = String(clamp(toInt(result.bottom, 0), 0, maxH - 2));
      if (ui.cropLeft) ui.cropLeft.value = String(clamp(toInt(result.left, 0), 0, maxW - 2));
      if (ui.cropRight) ui.cropRight.value = String(clamp(toInt(result.right, 0), 0, maxW - 2));
      layoutCropOverlay();
      refreshSummaries();
      markModified();
      scheduleEstimate();
      persistOptionsSoon();
      const any = ['top', 'bottom', 'left', 'right'].some((k) => toInt(result[k], 0) > 0);
      showNotice(any ? 'Black bars detected and filled in.' : 'No black bars found.', any ? 'ok' : 'info');
    }
  } catch (err) {
    showNotice(`Crop detection failed: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (btn.dataset.labelHtml != null) btn.innerHTML = btn.dataset.labelHtml;
    }
  }
}

// ---------- probe / active file ----------

function baseName(path) {
  if (!path) return '';
  return path.split(/[\\/]/).pop() || path;
}

function fillTrackSelect(select, tracks, kind) {
  if (!select) return;
  const previous = select.value;
  select.textContent = '';
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = tracks && tracks.length ? 'First track (auto)' : 'No tracks';
  auto.disabled = !tracks || tracks.length === 0;
  select.appendChild(auto);
  (tracks || []).forEach((track, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    const partsTitle = [];
    if (kind === 'audio') {
      if (track.codec) partsTitle.push(track.codec.toUpperCase());
      if (track.channels) partsTitle.push(track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels} ch`);
      if (track.kbps) partsTitle.push(`${track.kbps} kbps`);
      opt.textContent = `Track ${index + 1}${partsTitle.length ? ` — ${partsTitle.join(' · ')}` : ''}`;
    } else {
      if (track.codec) partsTitle.push(track.codec.toUpperCase());
      if (track.text === false) partsTitle.push('image-based');
      opt.textContent = `Track ${index + 1}${partsTitle.length ? ` — ${partsTitle.join(' · ')}` : ''}`;
    }
    if (track.lang) opt.textContent += ` (${track.lang})`;
    if (track.title) opt.textContent += ` · ${track.title}`;
    opt.title = opt.textContent;
    select.appendChild(opt);
  });
  const exists = [...select.options].some((o) => o.value === previous);
  select.value = exists ? previous : 'auto';
}

function resetTrimFromProbe(probe) {
  state.duration = Number.isFinite(probe?.duration) ? probe.duration : 0;
  state.trimStart = 0;
  state.trimEnd = state.duration;
  syncTimeline();
  updatePlayhead(0);
}

function populateSpecs(probe) {
  if (!probe) return;
  if (ui.fileName) {
    ui.fileName.textContent = probe.filename || baseName(probe.filePath) || 'Untitled';
    ui.fileName.title = probe.filePath || probe.filename || '';
  }
  if (ui.badgeDuration) ui.badgeDuration.textContent = probe.duration ? secondsToHHMMSSWithMs(probe.duration) : '--:--';
  if (ui.badgeRes) ui.badgeRes.textContent = probe.width && probe.height ? `${probe.width}x${probe.height}` : '—';
  if (ui.badgeSize) ui.badgeSize.textContent = formatBytes(probe.size);
  if (ui.badgeCodec) ui.badgeCodec.textContent = probe.vcodec ? probe.vcodec.toUpperCase() : '—';

  if (ui.specSize) ui.specSize.textContent = formatBytes(probe.size);
  if (ui.specRes) ui.specRes.textContent = probe.width && probe.height ? `${probe.width}x${probe.height}` : '—';
  if (ui.specFps) {
    const fps = Number(probe.fps);
    ui.specFps.textContent = fps ? `${Math.round(fps * 1000) / 1000} fps` : '—';
  }
  if (ui.specVcodec) ui.specVcodec.textContent = probe.vcodec || '—';
  if (ui.specBitrate) {
    ui.specBitrate.textContent = probe.videoKbps
      ? `${Math.round(probe.videoKbps)} kbps video`
      : probe.bitrateKbps
        ? `${Math.round(probe.bitrateKbps)} kbps`
        : '—';
  }
  if (ui.specAudio) {
    const tracks = probe.audioTracks || [];
    ui.specAudio.textContent = tracks.length
      ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}${tracks[0] && tracks[0].codec ? ` · ${tracks[0].codec.toUpperCase()}` : ''}`
      : 'None';
  }
  if (ui.specSubs) {
    const tracks = probe.subtitleTracks || [];
    ui.specSubs.textContent = tracks.length ? `${tracks.length} track${tracks.length === 1 ? '' : 's'}` : 'None';
  }

  fillTrackSelect(ui.audioTrack, probe.audioTracks, 'audio');
  fillTrackSelect(ui.subsTrack, probe.subtitleTracks, 'subtitle');
  if (ui.audioTrack) ui.audioTrack.disabled = !(probe.audioTracks || []).length;
  if (ui.subsTrack) ui.subsTrack.disabled = !(probe.subtitleTracks || []).length;
  if (ui.subsKeep) ui.subsKeep.disabled = !(probe.subtitleTracks || []).length;

  if (ui.labelTotal) ui.labelTotal.textContent = secondsToHHMMSSWithMs(state.duration);
  layoutCropOverlay();
}

async function loadFile(filePath, { enqueueRest = [] } = {}) {
  if (!filePath) return;
  const token = ++state.loadToken;
  cancelRunningPreview();
  resetPerFileControls();
  setEmptyNote('');
  clearPendingHint();
  state.activePath = filePath;
  if (ui.loadingFile) ui.loadingFile.textContent = baseName(filePath);
  setScreen('loading');
  try {
    const probe = await api().compressProbe(filePath);
    if (token !== state.loadToken) return;
    if (!probe || typeof probe !== 'object') throw new Error('No metadata returned for this file');
    if (!hasAnyEncoder(state.capabilities)) loadCapabilities({ refresh: true });
    // Audio-only, corrupt or renamed non-video files have nothing to compress here.
    if (!probe.hasVideo || !(probe.duration > 0)) {
      throw new Error(probe.audioTracks && probe.audioTracks.length && !probe.hasVideo
        ? 'This is an audio-only file. The Compress tab works on videos.'
        : "This file isn't a readable video (no video stream was found).");
    }
    state.probe = probe;
    populateSpecs(probe);
    resetTrimFromProbe(probe);

    const url = await api().getFileUrl(filePath);
    if (token !== state.loadToken) return;
    if (ui.video) {
      try { ui.video.pause(); } catch (err) { /* not playing */ }
      ui.video.src = url;
      ui.video.load();
    }

    setScreen('workspace');
    setPreviewNote('');
    if (ui.previewLabel) ui.previewLabel.textContent = 'Preview 10 s';
    refreshAvailability();
    refreshSummaries();
    layoutCropOverlay();
    scheduleEstimate();
    applySectionState();
    compressBus.emit('active-file-changed', {
      filePath,
      filename: probe.filename || baseName(filePath),
      probe
    });
    if (enqueueRest.length) {
      const rest = enqueueRest.length === 1 ? '1 more file' : `${enqueueRest.length} more files`;
      const ids = await enqueuePaths(enqueueRest, 'batch', { silent: true });
      if (ids.length) showNotice(`${rest} added to the queue.`, 'ok');
    }
  } catch (err) {
    if (token !== state.loadToken) return;
    state.probe = null;
    state.activePath = '';
    state.duration = 0;
    setScreen('empty');
    setEmptyNote(`Couldn't open ${baseName(filePath)}. ${err.message}`, 'error');
    compressBus.emit('active-file-changed', { filePath: null });
  }
}

function cancelRunningPreview() {
  if (!state.previewing) return;
  state.previewToken = (state.previewToken || 0) + 1; // the old result is now stale
  try {
    const pending = api().compressCancelPreview();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (err) {
    // Preview may already be finished; nothing to do.
  }
  setPreviewBusy(false);
}

// Crop, rotation, flips and picked tracks describe one video; a new file starts without them.
function resetPerFileControls() {
  for (const input of [ui.cropTop, ui.cropBottom, ui.cropLeft, ui.cropRight]) {
    if (input) input.value = '0';
  }
  selectedRotateButton(0);
  if (ui.flipH) ui.flipH.checked = false;
  if (ui.flipV) ui.flipV.checked = false;
  if (ui.audioTrack) ui.audioTrack.value = 'auto';
  if (ui.subsTrack) ui.subsTrack.value = 'auto';
}

function clearPendingHint() {
  state.pendingPresetId = null;
  if (!ui.hintChips) return;
  ui.hintChips.querySelectorAll('.cmp-hint-chip').forEach((c) => {
    c.classList.remove('is-active');
    c.setAttribute('aria-pressed', 'false');
  });
}

function closeFile() {
  state.loadToken += 1;
  state.estimateToken += 1;
  if (state.estimateTimer) {
    clearTimeout(state.estimateTimer);
    state.estimateTimer = null;
  }
  cancelRunningPreview();
  resetPerFileControls();
  setEmptyNote('');
  if (ui.video) {
    try { ui.video.pause(); } catch (err) { /* ignore */ }
    ui.video.removeAttribute('src');
    ui.video.load();
  }
  state.probe = null;
  state.activePath = '';
  state.duration = 0;
  state.trimStart = 0;
  state.trimEnd = 0;
  state.estimate = null;
  if (ui.cropOverlay) ui.cropOverlay.hidden = true;
  if (ui.fileName) {
    ui.fileName.textContent = '—';
    ui.fileName.title = '';
  }
  setPreviewNote('');
  setScreen('empty');
  compressBus.emit('active-file-changed', { filePath: null });
}

async function openFiles(paths, { presetId = null } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return;
  if (presetId) {
    await loadPresets();
    const all = [...(state.presets.builtIn || []), ...(state.presets.custom || [])];
    const preset = all.find((p) => p.id === presetId);
    if (preset) {
      applyPreset(preset);
    } else {
      // Unknown id (list still loading): let main resolve it and keep the chip state honest.
      state.presetId = presetId;
      state.presetModified = false;
      renderPresetChips();
    }
  }
  const [first, ...rest] = list;
  await loadFile(first, { enqueueRest: rest });
}

// ---------- enqueue ----------

async function enqueuePaths(paths, source = 'batch', { silent = false } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return [];
  try {
    const options = readOptions();
    const jobs = list.map((inputPath) => ({ inputPath, options, source: source === 'batch' ? 'manual' : source }));
    const result = await api().compressEnqueue({ jobs });
    const ids = result && result.jobIds ? result.jobIds : [];
    if (ui.queueRoot) ui.queueRoot.hidden = false;
    const skipped = list.length - ids.length;
    if (!silent || skipped > 0) {
      if (ids.length === 0) showNotice('Nothing was queued: the files could not be found.', 'error');
      else {
        const label = ids.length === 1 ? '1 file' : `${ids.length} files`;
        showNotice(`${label} added to the queue.${skipped > 0 ? ` ${skipped} could not be found.` : ''}`, skipped > 0 ? 'warn' : 'ok');
      }
    }
    return ids;
  } catch (err) {
    showNotice(`Could not queue files: ${err.message}`, 'error');
    return [];
  }
}

async function enqueueActive() {
  if (!state.activePath) {
    setPreviewNote('Load a video first.', 'warn');
    return false;
  }
  if (state.enqueueing) return false;
  state.enqueueing = true;
  setTimeout(() => { state.enqueueing = false; }, 600);
  try {
    const options = readOptions();
    const result = await api().compressEnqueue({
      jobs: [{ inputPath: state.activePath, options, source: 'manual' }]
    });
    const ids = result && result.jobIds ? result.jobIds : [];
    if (ids.length === 0) {
      setPreviewNote('This file is no longer where it was. Open it again.', 'error');
      return false;
    }
    showNotice('Added to the queue.', 'ok');
    return true;
  } catch (err) {
    setPreviewNote(`Could not queue this file: ${err.message}`, 'error');
    return false;
  }
}

function scrollQueueIntoView() {
  if (!ui.queueRoot) return;
  ui.queueRoot.hidden = false;
  try {
    ui.queueRoot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    // older browser without smooth scrolling
  }
}

async function compressNow() {
  if (!state.activePath) {
    setPreviewNote('Load a video first.', 'warn');
    return;
  }
  const ok = await enqueueActive();
  if (ok) {
    setPreviewNote('');
    scrollQueueIntoView();
    persistOptions();
  }
}

// ---------- preview ----------

function playheadSeconds() {
  if (!ui.video) return 0;
  let t = currentTimeSafe(0);
  if (t < state.trimStart) t = state.trimStart;
  if (state.trimEnd > 0 && t > state.trimEnd) t = state.trimStart;
  return t;
}

function setPreviewBusy(busy) {
  state.previewing = busy;
  if (ui.previewSpinner) ui.previewSpinner.hidden = !busy;
  if (ui.previewCancel) ui.previewCancel.hidden = !busy;
  if (ui.previewLabel) ui.previewLabel.textContent = busy ? 'Previewing…' : 'Preview 10 s';
  if (ui.previewBtn) ui.previewBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
  if (ui.runBtn) ui.runBtn.disabled = false;
}

async function startPreview() {
  if (!state.activePath || !state.probe) {
    setPreviewNote('Load a video first.', 'warn');
    return;
  }
  if (state.previewing) return;
  const start = playheadSeconds();
  const remaining = state.trimEnd > start ? state.trimEnd - start : state.duration - start;
  const duration = Math.max(1, Math.min(PREVIEW_SECONDS, remaining || PREVIEW_SECONDS));
  setPreviewBusy(true);
  setPreviewNote('Encoding a 10-second sample… this takes a few seconds.', 'info');
  const sourcePath = state.activePath;
  const loadToken = state.loadToken;
  const previewToken = (state.previewToken = (state.previewToken || 0) + 1);
  const stale = () => loadToken !== state.loadToken || previewToken !== state.previewToken;
  try {
    const options = readOptions();
    const result = await api().compressPreview({
      inputPath: sourcePath,
      options,
      startSeconds: start,
      durationSeconds: duration
    });
    if (stale()) return;
    if (!result || !result.previewPath) throw new Error('Preview finished without a file');
    setPreviewBusy(false);
    const sample = result.sampleBytes != null ? formatBytes(result.sampleBytes) : null;
    const projected = result.projectedBytes != null ? formatBytes(result.projectedBytes) : null;
    const parts = [];
    if (sample) parts.push(`sample ${sample}`);
    if (projected) parts.push(`projected full size ${projected}`);
    const summary = parts.length
      ? `Preview ready: ${parts.join(' · ')}.`
      : 'Preview ready.';
    setPreviewNote(summary, 'ok');
    compressBus.openCompare({
      label: `${Math.round(result.duration || duration)} s preview`,
      originalPath: sourcePath,
      compressedPath: result.previewPath,
      startSeconds: result.sourceStart != null ? result.sourceStart : start,
      duration: result.duration != null ? result.duration : duration,
      speedFactor: options.mode === 'remux' ? 1 : (Number(options.speedFactor) || 1)
    });
  } catch (err) {
    if (stale()) return;
    const message = err && err.message ? err.message : 'Unknown error';
    setPreviewBusy(false);
    if (/cancel/i.test(message)) {
      setPreviewNote('Preview cancelled.', 'info');
    } else {
      setPreviewNote(`Preview failed: ${message}`, 'error');
    }
  }
}

async function cancelPreview() {
  try {
    await api().compressCancelPreview();
    setPreviewNote('Cancelling preview…', 'info');
  } catch (err) {
    setPreviewNote(`Could not cancel preview: ${err.message}`, 'error');
  }
}

// ---------- drag & drop / browse ----------

function pathsFromDrop(event) {
  const files = event.dataTransfer && event.dataTransfer.files ? [...event.dataTransfer.files] : [];
  const paths = [];
  for (const file of files) {
    const path = api().getPathForFile ? api().getPathForFile(file) : '';
    if (path) paths.push(path);
  }
  return paths;
}

async function browseFiles() {
  try {
    const paths = await api().compressSelectFiles();
    if (!Array.isArray(paths) || !paths.length) return;
    await openFiles(paths, { presetId: state.pendingPresetId || null });
    state.pendingPresetId = null;
  } catch (err) {
    setEmptyNote(`Could not open the file picker: ${err.message}`, 'error');
  }
}

function wireDropZone() {
  const zone = ui.dropZone;
  if (!zone) return;
  zone.addEventListener('click', (event) => {
    if (ui.browse && (event.target === ui.browse || ui.browse.contains(event.target))) return;
    browseFiles();
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && zone.contains(event.relatedTarget)) return;
    zone.classList.remove('dragover');
  });
  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    const paths = pathsFromDrop(event);
    if (!paths.length) {
      setEmptyNote('That drop had no local file — drag a file from Explorer instead.', 'warn');
      return;
    }
    await openFiles(paths, { presetId: state.pendingPresetId || null });
    state.pendingPresetId = null;
  });
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      browseFiles();
    }
  });
}

function wireWorkspaceDrop() {
  if (!ui.workspace) return;
  ui.workspace.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  ui.workspace.addEventListener('drop', async (event) => {
    event.preventDefault();
    const paths = pathsFromDrop(event);
    if (!paths.length) return;
    // First dropped file becomes active; the rest join the queue with current settings.
    await openFiles(paths, { presetId: null });
  });
}

// ---------- keyboard ----------

function focusInField(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button' || tag === 'a' || tag === 'video') return true;
  if (target.isContentEditable) return true;
  return !!target.closest && !!target.closest('button, [role="button"], [role="tab"], summary');
}

function onKeyDown(event) {
  if (!state.tabEl || !state.tabEl.classList.contains('active')) return;
  if (focusInField(event.target)) return;
  if (!state.activePath) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('.cmpc-overlay')) return;

  if (event.code === 'Space') {
    event.preventDefault();
    if (ui.video) {
      if (ui.video.paused) {
        const t = playheadSeconds();
        if (Math.abs((ui.video.currentTime || 0) - t) > 0.35) seek(t);
        const playing = ui.video.play();
        if (playing && typeof playing.catch === 'function') playing.catch(() => {});
      } else {
        ui.video.pause();
      }
    }
    return;
  }
  if (event.key === 'i' || event.key === 'I') {
    event.preventDefault();
    const t = currentTimeSafe(state.trimStart);
    applyTrimValues(Math.min(t, state.trimEnd), state.trimEnd, { seekTo: 'start' });
    return;
  }
  if (event.key === 'o' || event.key === 'O') {
    event.preventDefault();
    const t = currentTimeSafe(state.duration);
    applyTrimValues(state.trimStart, Math.max(t, state.trimStart), { seekTo: 'end' });
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.repeat) return;
    compressNow();
  }
}

// ---------- video events ----------

function wireVideo() {
  if (!ui.video) return;
  ui.video.addEventListener('timeupdate', () => {
    if (!state.duration) return;
    updatePlayhead(ui.video.currentTime || 0);
  });
  ui.video.addEventListener('seeking', () => {
    if (!state.duration) return;
    updatePlayhead(ui.video.currentTime || 0);
  });
  ui.video.addEventListener('loadedmetadata', () => {
    if (!ui.video) return;
    if (!state.duration && Number.isFinite(ui.video.duration)) {
      state.duration = ui.video.duration;
      state.trimEnd = state.duration;
      syncTimeline();
    }
    layoutCropOverlay();
  });
  ui.video.addEventListener('play', () => {
    if (ui.playhead) ui.playhead.style.opacity = '1';
  });
  ui.video.addEventListener('pause', () => {
    if (ui.playhead) ui.playhead.style.opacity = '1';
  });
  window.addEventListener('resize', () => layoutCropOverlay());
}

// ---------- wiring ----------

function onControlChanged() {
  if (state.syncing) return;
  refreshSummaries();
  refreshAvailability();
  refreshGoalUI();
  markModified();
  scheduleEstimate();
  persistOptionsSoon();
}

function wireControls() {
  const watched = [
    'compress-codec', 'compress-encoder', 'compress-speed', 'compress-max-height', 'compress-max-fps',
    'compress-crop-top', 'compress-crop-bottom', 'compress-crop-left', 'compress-crop-right',
    'compress-flip-h', 'compress-flip-v', 'compress-deinterlace', 'compress-denoise', 'compress-speed-factor',
    'compress-audio-mode', 'compress-audio-codec', 'compress-audio-bitrate', 'compress-audio-channels',
    'compress-audio-track', 'compress-normalize', 'compress-volume-db',
    'compress-subs-burn', 'compress-subs-track', 'compress-subs-keep',
    'compress-container', 'compress-remux-container', 'compress-suffix', 'compress-strip-metadata',
    'compress-size-custom'
  ];
  for (const id of watched) {
    const control = el(id);
    if (!control) continue;
    const eventName = control.type === 'range' || control.type === 'number' ? 'input' : 'change';
    control.addEventListener(eventName, () => {
      if (id === 'compress-codec') rebuildEncoderOptions();
      if (id === 'compress-encoder' && ui.encoder) state.desiredEncoder = ui.encoder.value;
      if (id === 'compress-crop-top' || id === 'compress-crop-bottom' || id === 'compress-crop-left' || id === 'compress-crop-right') {
        layoutCropOverlay();
      }
      if (id === 'compress-subs-burn' && ui.subsFileRow) {
        ui.subsFileRow.hidden = ui.subsBurn.value !== 'file';
      }
      if (id === 'compress-size-custom') {
        state.customSize = !STANDARD_SIZES.includes(toFloat(ui.sizeCustom?.value, 0));
      }
      onControlChanged();
    });
  }

  // Quality slider needs live label updates on input, plus a change event for persistence.
  if (ui.qualityRange) {
    ui.qualityRange.addEventListener('input', () => {
      if (ui.qualityValue) ui.qualityValue.textContent = ui.qualityRange.value;
      if (ui.qualityLabel) ui.qualityLabel.textContent = qualityLabelFor(ui.qualityRange.value);
      markModified();
      scheduleEstimate();
    });
    ui.qualityRange.addEventListener('change', () => {
      refreshSummaries();
      persistOptionsSoon();
    });
  }

  // Goal segmented control
  [ui.goalSize, ui.goalQuality, ui.goalRemux].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Size chips
  ui.sizeChips?.querySelectorAll('.cmp-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const mb = chip.dataset.mb;
      state.sizeMode = 'mb';
      state.percentVal = null;
      state.customSize = mb === 'custom';
      if (mb === 'custom') {
        if (ui.sizeCustom) ui.sizeCustom.focus();
      } else if (ui.sizeCustom) {
        ui.sizeCustom.value = mb;
      }
      refreshGoalUI();
      markModified();
      scheduleEstimate();
      persistOptionsSoon();
    });
  });

  ui.percentChips?.querySelectorAll('.cmp-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const pct = toFloat(chip.dataset.percent, 0);
      if (pct === 0) {
        state.sizeMode = 'mb';
        state.percentVal = null;
      } else {
        state.sizeMode = 'percent';
        state.percentVal = pct;
        state.customSize = false;
      }
      refreshGoalUI();
      markModified();
      scheduleEstimate();
      persistOptionsSoon();
    });
  });

  // Rotate buttons
  ui.tab?.querySelectorAll('.cmp-chip-mini[data-rotate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedRotateButton(toInt(btn.dataset.rotate, 0));
      onControlChanged();
    });
  });

  // Trim
  if (ui.trimStartInput) {
    ui.trimStartInput.addEventListener('change', () => {
      applyTrimValues(hhmmssToSecondsWithMs(ui.trimStartInput.value), state.trimEnd);
    });
  }
  if (ui.trimEndInput) {
    ui.trimEndInput.addEventListener('change', () => {
      applyTrimValues(state.trimStart, hhmmssToSecondsWithMs(ui.trimEndInput.value));
    });
  }
  if (ui.setStart) {
    ui.setStart.addEventListener('click', () => {
      const t = currentTimeSafe(state.trimStart);
      applyTrimValues(Math.min(t, state.trimEnd), state.trimEnd, { seekTo: 'start' });
    });
  }
  if (ui.setEnd) {
    ui.setEnd.addEventListener('click', () => {
      const t = currentTimeSafe(state.duration);
      applyTrimValues(state.trimStart, Math.max(t, state.trimStart), { seekTo: 'end' });
    });
  }

  if (ui.timeline) {
    ui.timeline.addEventListener('mousedown', beginScrub);
    ui.timeline.addEventListener('dragstart', (event) => event.preventDefault());
  }
  if (ui.handleStart) ui.handleStart.addEventListener('mousedown', beginDrag('start'));
  if (ui.handleEnd) ui.handleEnd.addEventListener('mousedown', beginDrag('end'));

  // Sections
  for (const key of Object.keys(state.sectionOpen)) {
    const toggle = el(`compress-section-${key}-toggle`);
    if (toggle) toggle.addEventListener('click', () => toggleSection(key));
  }

  // Presets
  if (ui.savePresetBtn) ui.savePresetBtn.addEventListener('click', openPresetForm);
  if (ui.presetCancel) ui.presetCancel.addEventListener('click', closePresetForm);
  if (ui.presetForm) ui.presetForm.addEventListener('submit', savePreset);
  if (ui.presetName) {
    ui.presetName.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePresetForm();
    });
  }

  // Actions
  if (ui.browse) ui.browse.addEventListener('click', (event) => {
    event.stopPropagation();
    browseFiles();
  });
  if (ui.changeFile) ui.changeFile.addEventListener('click', browseFiles);
  if (ui.closeFile) ui.closeFile.addEventListener('click', closeFile);
  if (ui.previewBtn) ui.previewBtn.addEventListener('click', startPreview);
  if (ui.previewCancel) ui.previewCancel.addEventListener('click', cancelPreview);
  if (ui.addQueueBtn) ui.addQueueBtn.addEventListener('click', () => { enqueueActive(); persistOptions(); });
  if (ui.runBtn) ui.runBtn.addEventListener('click', compressNow);
  if (ui.detectCrop) ui.detectCrop.addEventListener('click', detectCrop);
  if (ui.subsFileBtn) ui.subsFileBtn.addEventListener('click', chooseSubtitleFile);
  if (ui.outputFolderBtn) ui.outputFolderBtn.addEventListener('click', chooseOutputFolder);
  if (ui.outputFolderClear) ui.outputFolderClear.addEventListener('click', clearOutputFolder);
}

// ---------- init ----------

function wireBus() {
  compressBus.on('open-files', async ({ paths, presetId }) => {
    await loadPresets();
    await openFiles(paths || [], { presetId: presetId || null });
  });
  compressBus.on('presets-changed', async () => {
    await loadPresets();
  });
}

async function init() {
  if (!ui.tab) return;
  readSectionState();
  applySectionState();
  wireDropZone();
  wireWorkspaceDrop();
  wireVideo();
  wireControls();
  wireBus();
  document.addEventListener('keydown', onKeyDown);
  renderHintChips();
  renderPresetChips();
  refreshGoalUI();
  refreshSummaries();
  await Promise.all([loadPresets(), loadCapabilities()]);
  await restoreOptions();
  renderPresetChips();
  renderHintChips();
  applySectionState();
  refreshGoalUI();
  refreshSummaries();
  refreshAvailability();
  if (!state.probe) setScreen('empty');
}

init().catch((err) => {
  console.error('[compress] init failed:', err);
});
