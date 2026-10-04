import { appendLog, hideDownloadCompleteCard, startDownloadIndicator, validateUrlInput } from './download.js';
import { state } from './state.js';
import { formatBytes, hhmmssToSeconds, pointerToTime, secondsToHHMMSS, sliderPercents } from './time.js';

// Twitch VOD State
let twitchVod = null;
let twitchDuration = 0;
let twitchStartVal = 0;
let twitchEndVal = 0;
let isPreviewingTwitchSelection = false;
let twitchLoadToken = 0;

const TWITCH_PREFS_KEY = 'twitch-prefs';
const MIN_SELECTION_SECONDS = 1;

// Elements
const twitchUrlInput = document.getElementById('twitch-url');
const twitchLoadBtn = document.getElementById('btn-twitch-load');
const twitchLoading = document.getElementById('twitch-loading');
const twitchError = document.getElementById('twitch-error');
const twitchErrorText = document.getElementById('twitch-error-text');
const twitchWorkspace = document.getElementById('twitch-workspace');
const twitchThumbnail = document.getElementById('twitch-video-thumbnail');
const twitchTitle = document.getElementById('twitch-video-title');
const twitchChannel = document.getElementById('twitch-video-channel');
const twitchDurationBadge = document.getElementById('twitch-video-duration-badge');
const twitchMeta = document.getElementById('twitch-video-meta');
const twitchPlayer = document.getElementById('twitch-video-player');
const twitchPlayerError = document.getElementById('twitch-player-error');
const twitchSlider = document.getElementById('twitch-slider');
const twitchSliderChapters = document.getElementById('twitch-slider-chapters');
const twitchSliderRange = document.getElementById('twitch-slider-range');
const twitchSliderPlayhead = document.getElementById('twitch-slider-playhead');
const twitchHandleStart = document.getElementById('twitch-handle-start');
const twitchHandleEnd = document.getElementById('twitch-handle-end');
const twitchLabelCurrent = document.getElementById('twitch-label-current-time');
const twitchLabelTotal = document.getElementById('twitch-label-total-time');
const twitchStartInput = document.getElementById('twitch-start-time-str');
const twitchEndInput = document.getElementById('twitch-end-time-str');
const twitchChaptersSection = document.getElementById('twitch-chapters-section');
const twitchChaptersList = document.getElementById('twitch-chapters-list');
const twitchQualitySelect = document.getElementById('twitch-quality');
const twitchContainerSelect = document.getElementById('twitch-container');
const twitchFragmentsSelect = document.getElementById('twitch-fragments');
const twitchPreciseToggle = document.getElementById('twitch-precise-cut');
const twitchEmbedToggle = document.getElementById('twitch-embed-metadata');
const twitchSummary = document.getElementById('twitch-selection-summary');
const btnTwitchSetStart = document.getElementById('btn-twitch-set-start');
const btnTwitchSetEnd = document.getElementById('btn-twitch-set-end');
const btnTwitchGoStart = document.getElementById('btn-twitch-go-start');
const btnTwitchGoEnd = document.getElementById('btn-twitch-go-end');
const btnTwitchPreview = document.getElementById('btn-twitch-preview-clip');
const btnTwitchResetRange = document.getElementById('btn-twitch-reset-range');
const btnTwitchDownload = document.getElementById('btn-twitch-download');
const btnTwitchDownloadAudio = document.getElementById('btn-twitch-download-audio');

// Persisted option preferences (quality label, container, connections, toggles)
function loadTwitchPrefs() {
  try {
    return JSON.parse(localStorage.getItem(TWITCH_PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveTwitchPrefs() {
  const selectedQuality = getSelectedTwitchQuality();
  const prefs = {
    quality: selectedQuality ? selectedQuality.label : (loadTwitchPrefs().quality || ''),
    container: twitchContainerSelect.value,
    fragments: twitchFragmentsSelect.value,
    precise: twitchPreciseToggle.checked,
    embedMetadata: twitchEmbedToggle.checked
  };
  try {
    localStorage.setItem(TWITCH_PREFS_KEY, JSON.stringify(prefs));
  } catch { /* storage unavailable */ }
}

function applyTwitchPrefs() {
  const prefs = loadTwitchPrefs();
  const settingsFormat = state.currentSettings.videoFormat;
  twitchContainerSelect.value = prefs.container === 'mkv' || prefs.container === 'mp4'
    ? prefs.container
    : (settingsFormat === 'mkv' ? 'mkv' : 'mp4');
  twitchFragmentsSelect.value = ['1', '4', '8', '16'].includes(String(prefs.fragments)) ? String(prefs.fragments) : '8';
  twitchPreciseToggle.checked = prefs.precise === true;
  twitchEmbedToggle.checked = prefs.embedMetadata !== false;
}

function showTwitchError(message) {
  twitchErrorText.textContent = message;
  twitchError.style.display = 'flex';
}

function clearTwitchError() {
  twitchError.style.display = 'none';
  twitchErrorText.textContent = '';
}

function getSelectedTwitchQuality() {
  if (!twitchVod) return null;
  return twitchVod.qualities.find((q) => q.id === twitchQualitySelect.value) || null;
}

function twitchQualityText(q) {
  let text = q.label;
  if (q.isSource) text += ' (Source)';
  if (q.tbr > 0) text += ` — ${(q.tbr / 1000).toFixed(1)} Mbps`;
  return text;
}

function renderTwitchQualities(qualities) {
  twitchQualitySelect.innerHTML = '';
  qualities.forEach((q) => {
    const opt = document.createElement('option');
    opt.value = q.id;
    opt.textContent = twitchQualityText(q);
    twitchQualitySelect.appendChild(opt);
  });

  // Prefer the last used resolution, then the app's default max quality, then Source
  const prefs = loadTwitchPrefs();
  const remembered = qualities.find((q) => q.label === prefs.quality);
  const maxHeight = parseInt(state.currentSettings.defaultQuality || '1080', 10) || 1080;
  const withinDefault = qualities.find((q) => q.height > 0 && q.height <= maxHeight);
  const chosen = remembered || withinDefault || qualities[0];
  if (chosen) twitchQualitySelect.value = chosen.id;
}

function renderTwitchChapters(chapters) {
  twitchChaptersList.innerHTML = '';
  twitchSliderChapters.innerHTML = '';

  if (!chapters || chapters.length === 0 || twitchDuration <= 0) {
    twitchChaptersSection.style.display = 'none';
    return;
  }

  chapters.forEach((chapter, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'twitch-chapter-chip';
    chip.dataset.index = String(index);
    chip.title = `${chapter.title} (${secondsToHHMMSS(chapter.start)} - ${secondsToHHMMSS(chapter.end)})`;

    const titleEl = document.createElement('span');
    titleEl.className = 'twitch-chapter-chip-title';
    titleEl.textContent = chapter.title;
    const timeEl = document.createElement('span');
    timeEl.className = 'twitch-chapter-chip-time';
    timeEl.textContent = secondsToHHMMSS(chapter.start);
    chip.append(titleEl, timeEl);

    chip.addEventListener('click', () => {
      setTwitchRange(chapter.start, chapter.end);
      seekTwitchPlayer(chapter.start);
    });
    twitchChaptersList.appendChild(chip);

    if (chapter.start > 0) {
      const tick = document.createElement('div');
      tick.className = 'twitch-chapter-tick';
      tick.style.left = `${(chapter.start / twitchDuration) * 100}%`;
      twitchSliderChapters.appendChild(tick);
    }
  });

  twitchChaptersSection.style.display = 'flex';
}

function highlightActiveTwitchChapter() {
  if (!twitchVod) return;
  twitchChaptersList.querySelectorAll('.twitch-chapter-chip').forEach((chip) => {
    const chapter = twitchVod.chapters[parseInt(chip.dataset.index, 10)];
    const matches = chapter &&
      Math.abs(chapter.start - twitchStartVal) < 1 &&
      Math.abs(chapter.end - twitchEndVal) < 1;
    chip.classList.toggle('active', !!matches);
  });
}

function isFullTwitchSelection() {
  return twitchStartVal <= 0 && twitchEndVal >= Math.floor(twitchDuration);
}

function updateTwitchSummary() {
  twitchSummary.textContent = '';
  if (!twitchVod) return;

  const length = Math.max(0, twitchEndVal - twitchStartVal);
  const quality = getSelectedTwitchQuality();
  const full = isFullTwitchSelection();

  const lead = document.createElement('strong');
  lead.textContent = full
    ? `${twitchVod.kind === 'clip' ? 'Full clip' : 'Full VOD'} · ${secondsToHHMMSS(length)}`
    : `Selection · ${secondsToHHMMSS(length)}`;
  twitchSummary.appendChild(lead);

  const parts = [];
  if (!full) parts.push(`${secondsToHHMMSS(twitchStartVal)} → ${secondsToHHMMSS(twitchEndVal)}`);
  if (quality) {
    const estimate = quality.tbr > 0 ? formatBytes((quality.tbr * 1000 / 8) * length) : '';
    parts.push(estimate ? `about ${estimate} at ${quality.label}` : quality.label);
  }
  if (!full && twitchPreciseToggle.checked) parts.push('frame-accurate (re-encode)');
  if (parts.length > 0) {
    twitchSummary.appendChild(document.createTextNode(` · ${parts.join(' · ')}`));
  }
}

function updateTwitchSliderUI() {
  if (twitchDuration > 0) {
    const { startPct, endPct, widthPct } = sliderPercents(twitchStartVal, twitchEndVal, twitchDuration);
    twitchSliderRange.style.left = `${startPct}%`;
    twitchSliderRange.style.width = `${widthPct}%`;
    twitchHandleStart.style.left = `${startPct}%`;
    twitchHandleEnd.style.left = `${endPct}%`;
  }
  highlightActiveTwitchChapter();
  updateTwitchSummary();
}

function setTwitchRange(start, end) {
  const safeEnd = Math.max(MIN_SELECTION_SECONDS, Math.min(end, twitchDuration));
  const safeStart = Math.max(0, Math.min(start, safeEnd - MIN_SELECTION_SECONDS));
  twitchStartVal = safeStart;
  twitchEndVal = safeEnd;
  twitchStartInput.value = secondsToHHMMSS(twitchStartVal);
  twitchEndInput.value = secondsToHHMMSS(twitchEndVal);
  updateTwitchSliderUI();
}

function isTwitchPlayerUsable() {
  return !!twitchPlayer.getAttribute('src') && twitchPlayerError.style.display === 'none';
}

function getTwitchPlayheadTime(fallback) {
  return isTwitchPlayerUsable() ? twitchPlayer.currentTime : fallback;
}

function setTwitchPlayhead(time) {
  if (!(twitchDuration > 0)) return;
  const pct = Math.max(0, Math.min(1, time / twitchDuration)) * 100;
  twitchSliderPlayhead.style.left = `${pct}%`;
  twitchLabelCurrent.textContent = secondsToHHMMSS(time);
}

// Throttled seeking queue for smooth scrubbing over HLS
let pendingTwitchSeek = null;

function seekTwitchPlayer(time) {
  setTwitchPlayhead(time);
  if (!isTwitchPlayerUsable()) return;
  if (!twitchPlayer.seeking) {
    twitchPlayer.currentTime = time;
    pendingTwitchSeek = null;
  } else {
    pendingTwitchSeek = time;
  }
}

function stopTwitchPreviewState() {
  isPreviewingTwitchSelection = false;
  btnTwitchPreview.textContent = 'Preview Selection';
}

function resetTwitchPlayer() {
  stopTwitchPreviewState();
  try { twitchPlayer.pause(); } catch { /* ignore */ }
  twitchPlayer.removeAttribute('src');
  try { twitchPlayer.load(); } catch { /* ignore */ }
  twitchPlayerError.style.display = 'none';
  pendingTwitchSeek = null;
}

function formatTwitchMeta(info) {
  const parts = [];
  if (info.kind === 'clip') parts.push('Clip');
  if (info.timestamp > 0) {
    parts.push(new Date(info.timestamp * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  }
  if (info.viewCount > 0) parts.push(`${info.viewCount.toLocaleString()} views`);
  if (info.chapters.length > 1) parts.push(`${info.chapters.length} chapters`);
  return parts.join(' · ');
}

async function loadTwitchVod() {
  const url = validateUrlInput(twitchUrlInput, 'Twitch VOD URL');
  if (!url) return;

  const token = ++twitchLoadToken;
  hideDownloadCompleteCard('twitch');
  clearTwitchError();
  resetTwitchPlayer();
  twitchVod = null;
  twitchLoadBtn.disabled = true;
  twitchLoading.style.display = 'block';
  twitchWorkspace.style.display = 'none';

  let info;
  try {
    info = await window.electronAPI.fetchTwitchInfo(url);
  } catch (err) {
    info = { success: false, error: err.message || 'Unexpected error while loading the VOD.' };
  }
  if (token !== twitchLoadToken) return;

  twitchLoading.style.display = 'none';
  twitchLoadBtn.disabled = false;

  if (!info || !info.success) {
    const message = (info && info.error) || 'Failed to load the Twitch VOD.';
    showTwitchError(message);
    appendLog(`[TWITCH] ${message}`, 'log-error');
    return;
  }

  twitchVod = info;
  twitchDuration = info.duration;

  twitchTitle.textContent = info.title;
  twitchTitle.title = info.title;
  twitchChannel.textContent = info.uploader || 'Twitch';
  twitchDurationBadge.textContent = secondsToHHMMSS(info.duration);
  twitchMeta.textContent = formatTwitchMeta(info);
  twitchLabelTotal.textContent = secondsToHHMMSS(info.duration);
  if (info.thumbnail) {
    twitchThumbnail.src = info.thumbnail;
    twitchThumbnail.style.visibility = 'visible';
  } else {
    twitchThumbnail.removeAttribute('src');
    twitchThumbnail.style.visibility = 'hidden';
  }

  applyTwitchPrefs();
  renderTwitchQualities(info.qualities);
  renderTwitchChapters(info.chapters);

  // A "?t=1h2m3s" link starts the selection at that timestamp
  const initialStart = info.startSeconds > 0 && info.startSeconds < info.duration ? info.startSeconds : 0;
  setTwitchRange(initialStart, info.duration);
  setTwitchPlayhead(initialStart);

  if (info.previewUrl) {
    // Mute by default: missing audio devices must not kill video decode.
    twitchPlayer.muted = true;
    twitchPlayer.src = info.previewUrl;
    twitchPlayer.load();
    if (initialStart > 0) {
      twitchPlayer.addEventListener('loadedmetadata', () => seekTwitchPlayer(initialStart), { once: true });
    }
  } else {
    twitchPlayerError.style.display = 'flex';
  }

  twitchWorkspace.style.display = 'flex';
  appendLog(`[TWITCH] Loaded "${info.title}" — ${info.qualities.length} qualities, ${info.chapters.length} chapters.`, 'log-info');
}

twitchLoadBtn.addEventListener('click', loadTwitchVod);
twitchUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadTwitchVod();
  }
});

// Preview player wiring
twitchPlayer.addEventListener('error', () => {
  if (!twitchPlayer.getAttribute('src')) return;
  twitchPlayerError.style.display = 'flex';
  stopTwitchPreviewState();
});

twitchPlayer.addEventListener('seeked', () => {
  if (pendingTwitchSeek !== null) {
    const target = pendingTwitchSeek;
    pendingTwitchSeek = null;
    twitchPlayer.currentTime = target;
  }
});

twitchPlayer.addEventListener('timeupdate', () => {
  if (!(twitchDuration > 0) || activeTwitchHandle) return;
  setTwitchPlayhead(twitchPlayer.currentTime);
  if (isPreviewingTwitchSelection && twitchPlayer.currentTime >= twitchEndVal) {
    twitchPlayer.pause();
  }
});

twitchPlayer.addEventListener('pause', stopTwitchPreviewState);

// Dragging in/out handles
let activeTwitchHandle = null;
let cachedTwitchRect = null;
let pendingTwitchRaf = false;

function handleTwitchMouseMove(e) {
  if (!activeTwitchHandle || twitchDuration <= 0 || !cachedTwitchRect) return;
  const clientX = e.clientX;
  if (pendingTwitchRaf) return;
  pendingTwitchRaf = true;
  requestAnimationFrame(() => {
    pendingTwitchRaf = false;
    if (!activeTwitchHandle || !cachedTwitchRect) return;
    const { timeVal } = pointerToTime(clientX, cachedTwitchRect, twitchDuration);

    if (activeTwitchHandle === 'start') {
      setTwitchRange(Math.min(timeVal, twitchEndVal - MIN_SELECTION_SECONDS), twitchEndVal);
      seekTwitchPlayer(twitchStartVal);
    } else {
      setTwitchRange(twitchStartVal, Math.max(timeVal, twitchStartVal + MIN_SELECTION_SECONDS));
      seekTwitchPlayer(twitchEndVal);
    }
  });
}

function handleTwitchMouseUp() {
  activeTwitchHandle = null;
  cachedTwitchRect = null;
  document.removeEventListener('mousemove', handleTwitchMouseMove);
  document.removeEventListener('mouseup', handleTwitchMouseUp);
}

function handleTwitchMouseDown(type) {
  return (e) => {
    e.preventDefault();
    e.stopPropagation();
    activeTwitchHandle = type;
    cachedTwitchRect = twitchSlider.getBoundingClientRect();
    document.addEventListener('mousemove', handleTwitchMouseMove, { passive: true });
    document.addEventListener('mouseup', handleTwitchMouseUp);
  };
}

twitchHandleStart.addEventListener('mousedown', handleTwitchMouseDown('start'));
twitchHandleEnd.addEventListener('mousedown', handleTwitchMouseDown('end'));

// Timeline click-to-seek
twitchSlider.addEventListener('click', (e) => {
  if (e.target === twitchHandleStart || e.target === twitchHandleEnd) return;
  if (!(twitchDuration > 0)) return;
  const { timeVal } = pointerToTime(e.clientX, twitchSlider.getBoundingClientRect(), twitchDuration);
  seekTwitchPlayer(timeVal);
});

// In/Out markers
btnTwitchSetStart.addEventListener('click', () => {
  const current = getTwitchPlayheadTime(twitchStartVal);
  // Moving the in point past the out point pushes the out point to the end
  setTwitchRange(current, current >= twitchEndVal ? twitchDuration : twitchEndVal);
});

btnTwitchSetEnd.addEventListener('click', () => {
  const current = getTwitchPlayheadTime(twitchEndVal);
  setTwitchRange(current <= twitchStartVal ? 0 : twitchStartVal, current);
});

twitchStartInput.addEventListener('change', (e) => {
  const val = hhmmssToSeconds(e.target.value);
  setTwitchRange(Math.min(val, twitchEndVal - MIN_SELECTION_SECONDS), twitchEndVal);
  seekTwitchPlayer(twitchStartVal);
});

twitchEndInput.addEventListener('change', (e) => {
  const val = hhmmssToSeconds(e.target.value);
  setTwitchRange(twitchStartVal, Math.max(val, twitchStartVal + MIN_SELECTION_SECONDS));
  seekTwitchPlayer(twitchEndVal);
});

btnTwitchGoStart.addEventListener('click', () => seekTwitchPlayer(twitchStartVal));
btnTwitchGoEnd.addEventListener('click', () => seekTwitchPlayer(twitchEndVal));

btnTwitchResetRange.addEventListener('click', () => {
  setTwitchRange(0, twitchDuration);
});

// Preview the selected range
btnTwitchPreview.addEventListener('click', () => {
  if (!isTwitchPlayerUsable()) return;
  if (isPreviewingTwitchSelection && !twitchPlayer.paused) {
    twitchPlayer.pause();
    return;
  }
  twitchPlayer.currentTime = twitchStartVal;
  twitchPlayer.play().then(() => {
    isPreviewingTwitchSelection = true;
    btnTwitchPreview.textContent = 'Pause Preview';
  }).catch(() => {
    stopTwitchPreviewState();
  });
});

// Options
[twitchQualitySelect, twitchContainerSelect, twitchFragmentsSelect, twitchPreciseToggle, twitchEmbedToggle].forEach((el) => {
  el.addEventListener('change', () => {
    saveTwitchPrefs();
    updateTwitchSummary();
  });
});

// Downloads
function startTwitchDownload(mode) {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  if (!twitchVod) return;

  hideDownloadCompleteCard('twitch');
  twitchPlayer.pause();

  const quality = getSelectedTwitchQuality();
  const full = isFullTwitchSelection();
  const startStr = secondsToHHMMSS(twitchStartVal);
  const endStr = secondsToHHMMSS(twitchEndVal);
  const rangeLabel = full ? (twitchVod.kind === 'clip' ? 'Full clip' : 'Full VOD') : `${startStr} - ${endStr}`;
  const formatLabel = mode === 'audio'
    ? `AUDIO ${(state.currentSettings.audioFormat || 'mp3').toUpperCase()}`
    : `${quality ? quality.label.toUpperCase() : 'BEST'} ${twitchContainerSelect.value.toUpperCase()}`;

  startDownloadIndicator(`Downloading Twitch ${mode === 'audio' ? 'audio' : 'video'} (${rangeLabel})...`, {
    url: twitchVod.url,
    type: 'twitch',
    badge: `TWITCH • ${formatLabel} (${rangeLabel})`,
    title: twitchVod.title,
    thumbnail: twitchVod.thumbnail
  });

  window.electronAPI.downloadTwitchVod({
    url: twitchVod.url,
    mode,
    formatId: quality ? quality.id : '',
    container: twitchContainerSelect.value,
    startTime: twitchStartVal,
    endTime: twitchEndVal,
    duration: twitchDuration,
    precise: twitchPreciseToggle.checked,
    embedMetadata: twitchEmbedToggle.checked,
    fragments: parseInt(twitchFragmentsSelect.value, 10) || 8,
    thumbnail: twitchVod.thumbnail
  });
}

btnTwitchDownload.addEventListener('click', () => startTwitchDownload('video'));
btnTwitchDownloadAudio.addEventListener('click', () => startTwitchDownload('audio'));
