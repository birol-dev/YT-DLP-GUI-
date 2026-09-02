import { startDownloadIndicator, stopDownloadIndicator } from './download.js';
import { playSuccessChime } from './settings.js';
import { state } from './state.js';
import { formatBytes, hhmmssToSecondsWithMs, pointerToTime, secondsToHHMMSSWithMs, sliderPercents } from './time.js';

// ==========================================
// Video Divider Tab Logic
// ==========================================
let dividerSourcePath = '';
let dividerDuration = 0;
let dividerStartVal = 0;
let dividerEndVal = 0;
let isDividerPreviewing = false;
let dividerMode = 'fast';
let isDividing = false;
let dividerLastTargetSeekTime = null;
let dividerOutputFolder = '';


export function getAspectRatioStr(width, height) {
  if (!width || !height) return '--';
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  const wRatio = width / divisor;
  const hRatio = height / divisor;
  
  if (wRatio === 16 && hRatio === 9) return '16:9 (Landscape)';
  if (wRatio === 9 && hRatio === 16) return '9:16 (Portrait)';
  if (wRatio === 1 && hRatio === 1) return '1:1 (Square)';
  if (wRatio === 4 && hRatio === 3) return '4:3 (Fullscreen)';
  
  return `${wRatio}:${hRatio}`;
}

// Elements
const dividerImportZone = document.getElementById('divider-import-zone');
const dividerDropZone = document.getElementById('divider-drop-zone');
const btnDividerBrowse = document.getElementById('btn-divider-browse');
const dividerUrlInput = document.getElementById('divider-url');
const dividerQualitySelect = document.getElementById('divider-quality');
const btnDividerLoad = document.getElementById('btn-divider-load');

const dividerWorkspace = document.getElementById('divider-workspace');
const dividerVideoTitle = document.getElementById('divider-video-title');
const dividerDurationBadge = document.getElementById('divider-video-duration-badge');
const dividerResBadge = document.getElementById('divider-video-res-badge');
const btnDividerReset = document.getElementById('btn-divider-reset');
const dividerVideoPlayer = document.getElementById('divider-video-player');

const dividerSliderWrapper = document.getElementById('divider-timeline-wrapper');
const dividerSliderRange = document.getElementById('divider-slider-range');
const dividerSliderPlayhead = document.getElementById('divider-slider-playhead');
const dividerLabelCurrent = document.getElementById('divider-label-current-time');
const dividerLabelTotal = document.getElementById('divider-label-total-time');

const dividerStartInput = document.getElementById('divider-start-time-str');
const dividerEndInput = document.getElementById('divider-end-time-str');
const btnDividerSetStart = document.getElementById('btn-divider-set-start');
const btnDividerSetEnd = document.getElementById('btn-divider-set-end');
const btnDividerGoStart = document.getElementById('btn-divider-go-start');
const btnDividerPreview = document.getElementById('btn-divider-preview-clip');
const btnDividerGoEnd = document.getElementById('btn-divider-go-end');

const dividerChunkMin = document.getElementById('divider-chunk-min');
const dividerChunkSec = document.getElementById('divider-chunk-sec');
const dividerChunksPreviewCount = document.getElementById('divider-chunks-preview-count');

const spatialCheckboxes = {
  left: document.getElementById('spatial-left'),
  right: document.getElementById('spatial-right'),
  top: document.getElementById('spatial-top'),
  bottom: document.getElementById('spatial-bottom')
};

const btnDivideVideo = document.getElementById('btn-divide-video');
const btnDividerOpenFolder = document.getElementById('btn-divider-open-folder');

// Redesign Steps
const dividerStep1 = document.getElementById('divider-step-1');
const dividerStep2 = document.getElementById('divider-step-2');
const btnDividerNextStep = document.getElementById('btn-divider-next-step');
const btnDividerBackStep = document.getElementById('btn-divider-back-step');

// Prevent default drag and drop behaviors globally
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => e.preventDefault(), false);

// Setup Drag and Drop
if (dividerDropZone) {
  dividerDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dividerDropZone.classList.add('dragover');
  });

  dividerDropZone.addEventListener('dragleave', () => {
    dividerDropZone.classList.remove('dragover');
  });

  dividerDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dividerDropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = window.electronAPI.getPathForFile(file);
      if (filePath) {
        loadDividerSource(filePath);
      }
    }
  });
}

// Browse Button click
if (btnDividerBrowse) {
  btnDividerBrowse.addEventListener('click', async () => {
    const path = await window.electronAPI.selectVideoFile();
    if (path) {
      loadDividerSource(path);
    }
  });
}

// YouTube Load Button click
if (btnDividerLoad) {
  btnDividerLoad.addEventListener('click', () => {
    const url = dividerUrlInput.value.trim();
    if (!url) return;
    
    if (state.isDownloading) {
      alert('A download is already in progress. Please wait for it to finish.');
      return;
    }
    
    const quality = dividerQualitySelect.value;
    startDownloadIndicator('Downloading YouTube video source...');
    window.electronAPI.dividerImportUrl({ url, quality });
  });
}

// Reset workspace
if (btnDividerReset) {
  btnDividerReset.addEventListener('click', () => {
    dividerVideoPlayer.pause();
    dividerVideoPlayer.src = '';
    dividerSourcePath = '';
    dividerDuration = 0;
    
    dividerWorkspace.style.display = 'none';
    btnDividerOpenFolder.style.display = 'none';
    dividerImportZone.style.display = 'flex';
    dividerUrlInput.value = '';
    
    // Reset metadata fields
    const elSize = document.getElementById('meta-val-size');
    const elRes = document.getElementById('meta-val-res');
    const elAspect = document.getElementById('meta-val-aspect');
    const elFps = document.getElementById('meta-val-fps');
    const elVcodec = document.getElementById('meta-val-vcodec');
    const elAcodec = document.getElementById('meta-val-acodec');
    const elPath = document.getElementById('meta-val-path');
    
    if (elSize) elSize.textContent = '--';
    if (elRes) elRes.textContent = '--';
    if (elAspect) elAspect.textContent = '--';
    if (elFps) elFps.textContent = '--';
    if (elVcodec) elVcodec.textContent = '--';
    if (elAcodec) elAcodec.textContent = '--';
    if (elPath) {
      elPath.textContent = '--';
      elPath.title = '';
    }

    // Reset wizard pane visibility
    if (dividerStep2) dividerStep2.style.display = 'none';
    if (dividerStep1) dividerStep1.style.display = 'flex';
    
    // Hide inline feedback panels
    const inlineStatus = document.getElementById('divider-inline-status-container');
    if (inlineStatus) inlineStatus.style.display = 'none';
    const resultBox = document.getElementById('divider-result-box');
    if (resultBox) {
      resultBox.style.display = 'none';
      resultBox.className = 'divider-result-box';
      resultBox.innerHTML = '';
    }
  });
}

// Load Video File Source details
export async function loadDividerSource(filePath) {
  const dividerLoading = document.getElementById('divider-loading');
  if (dividerImportZone) dividerImportZone.style.display = 'none';
  if (dividerLoading) dividerLoading.style.display = 'flex';
  if (dividerWorkspace) dividerWorkspace.style.display = 'none';

  try {
    dividerSourcePath = filePath;
    const meta = await window.electronAPI.probeLocalVideo(filePath);
    
    dividerDuration = meta.duration;
    dividerStartVal = 0;
    dividerEndVal = meta.duration;
    
    dividerVideoTitle.textContent = meta.filename;
    dividerDurationBadge.textContent = secondsToHHMMSSWithMs(meta.duration);
    dividerResBadge.textContent = meta.width && meta.height ? `${meta.width}x${meta.height}` : 'Unknown Resolution';
    
    dividerLabelTotal.textContent = secondsToHHMMSSWithMs(meta.duration);
    dividerLabelCurrent.textContent = secondsToHHMMSSWithMs(0);
    dividerStartInput.value = secondsToHHMMSSWithMs(0);
    dividerEndInput.value = secondsToHHMMSSWithMs(meta.duration);
    
    const fileUrl = await window.electronAPI.getFileUrl(filePath);
    dividerVideoPlayer.src = fileUrl;
    dividerVideoPlayer.load();
    
    // Set specifications metadata fields
    const elSize = document.getElementById('meta-val-size');
    const elRes = document.getElementById('meta-val-res');
    const elAspect = document.getElementById('meta-val-aspect');
    const elFps = document.getElementById('meta-val-fps');
    const elVcodec = document.getElementById('meta-val-vcodec');
    const elAcodec = document.getElementById('meta-val-acodec');
    const elPath = document.getElementById('meta-val-path');
    
    if (elSize) elSize.textContent = formatBytes(meta.size);
    if (elRes) elRes.textContent = meta.width && meta.height ? `${meta.width}x${meta.height}` : '--';
    if (elAspect) elAspect.textContent = getAspectRatioStr(meta.width, meta.height);
    if (elFps) elFps.textContent = meta.fps ? `${meta.fps} fps` : '--';
    if (elVcodec) elVcodec.textContent = meta.vcodec || '--';
    if (elAcodec) elAcodec.textContent = meta.acodec || '--';
    if (elPath) {
      elPath.textContent = meta.filePath || '--';
      elPath.title = meta.filePath || '';
    }

    if (dividerImportZone) dividerImportZone.style.display = 'none';
    if (dividerLoading) dividerLoading.style.display = 'none';
    if (dividerWorkspace) dividerWorkspace.style.display = 'flex';
    btnDividerOpenFolder.style.display = 'none';
    
    // Reset wizard pane visibility
    if (dividerStep2) dividerStep2.style.display = 'none';
    if (dividerStep1) dividerStep1.style.display = 'flex';
    
    // Hide inline feedback panels
    const inlineStatus = document.getElementById('divider-inline-status-container');
    if (inlineStatus) inlineStatus.style.display = 'none';
    const resultBox = document.getElementById('divider-result-box');
    if (resultBox) {
      resultBox.style.display = 'none';
      resultBox.className = 'divider-result-box';
      resultBox.innerHTML = '';
    }
    
    updateDividerSliderUI();
    updateChunksCountPreview();
  } catch (err) {
    if (dividerLoading) dividerLoading.style.display = 'none';
    if (dividerImportZone) dividerImportZone.style.display = 'flex';
    alert('Failed to load local video file:\n' + err.message);
  }
}

// Slider / Marker Drag and Scrub UI Handlers
export function updateDividerSliderUI() {
  if (dividerDuration > 0) {
    const { startPct, endPct, widthPct } = sliderPercents(dividerStartVal, dividerEndVal, dividerDuration);
    
    dividerSliderRange.style.left = `${startPct}%`;
    dividerSliderRange.style.width = `${widthPct}%`;
    
    const startHandle = document.getElementById('divider-handle-start');
    const endHandle = document.getElementById('divider-handle-end');
    if (startHandle) startHandle.style.left = `${startPct}%`;
    if (endHandle) endHandle.style.left = `${endPct}%`;
  }
}

let activeDividerDragHandle = null;
let isScrubbingPlayhead = false;

export function seekDividerVideoPlayer(time) {
  if (!dividerVideoPlayer || dividerVideoPlayer.style.display === 'none') return;
  if (!dividerVideoPlayer.seeking) {
    dividerVideoPlayer.currentTime = time;
    dividerLastTargetSeekTime = null;
  } else {
    dividerLastTargetSeekTime = time;
  }
}

if (dividerVideoPlayer) {
  dividerVideoPlayer.addEventListener('seeked', () => {
    if (dividerLastTargetSeekTime !== null) {
      dividerVideoPlayer.currentTime = dividerLastTargetSeekTime;
      dividerLastTargetSeekTime = null;
    }
  });

  dividerVideoPlayer.addEventListener('timeupdate', () => {
    if (dividerDuration > 0) {
      const pct = (dividerVideoPlayer.currentTime / dividerDuration) * 100;
      dividerSliderPlayhead.style.left = `${pct}%`;
      dividerLabelCurrent.textContent = secondsToHHMMSSWithMs(dividerVideoPlayer.currentTime);
      
      if (isDividerPreviewing) {
        if (dividerVideoPlayer.currentTime >= dividerEndVal) {
          dividerVideoPlayer.pause();
          isDividerPreviewing = false;
          btnDividerPreview.textContent = 'Preview Segment';
        }
      }
    }
  });

  dividerVideoPlayer.addEventListener('pause', () => {
    isDividerPreviewing = false;
    btnDividerPreview.textContent = 'Preview Segment';
  });
}

export function handleDividerMouseDown(type) {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    activeDividerDragHandle = type;
    document.addEventListener('mousemove', handleDividerMouseMove);
    document.addEventListener('mouseup', handleDividerMouseUp);
  }
}

const startHandleEl = document.getElementById('divider-handle-start');
const endHandleEl = document.getElementById('divider-handle-end');
if (startHandleEl) startHandleEl.addEventListener('mousedown', handleDividerMouseDown('start'));
if (endHandleEl) endHandleEl.addEventListener('mousedown', handleDividerMouseDown('end'));

export function handleDividerMouseMove(e) {
  if (!activeDividerDragHandle || dividerDuration <= 0) return;
  
  const rect = dividerSliderWrapper.getBoundingClientRect();
  const { pct, timeVal } = pointerToTime(e.clientX, rect, dividerDuration);
  
  dividerSliderPlayhead.style.left = `${pct * 100}%`;
  dividerLabelCurrent.textContent = secondsToHHMMSSWithMs(timeVal);
  
  if (activeDividerDragHandle === 'start') {
    dividerStartVal = Math.min(timeVal, dividerEndVal);
    dividerStartInput.value = secondsToHHMMSSWithMs(dividerStartVal);
    seekDividerVideoPlayer(dividerStartVal);
  } else if (activeDividerDragHandle === 'end') {
    dividerEndVal = Math.max(timeVal, dividerStartVal);
    dividerEndInput.value = secondsToHHMMSSWithMs(dividerEndVal);
    seekDividerVideoPlayer(dividerEndVal);
  }
  updateDividerSliderUI();
}

export function handleDividerMouseUp() {
  activeDividerDragHandle = null;
  document.removeEventListener('mousemove', handleDividerMouseMove);
  document.removeEventListener('mouseup', handleDividerMouseUp);
}

// Click and drag timeline track to seek and scrub
export function handlePlayheadScrub(e) {
  if (dividerDuration <= 0 || !dividerSliderWrapper) return;
  const rect = dividerSliderWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  const timeVal = pct * dividerDuration;
  
  seekDividerVideoPlayer(timeVal);
  
  dividerSliderPlayhead.style.left = `${pct * 100}%`;
  dividerLabelCurrent.textContent = secondsToHHMMSSWithMs(timeVal);
}

export function handlePlayheadMouseMove(e) {
  if (isScrubbingPlayhead) {
    handlePlayheadScrub(e);
  }
}

export function handlePlayheadMouseUp() {
  isScrubbingPlayhead = false;
  document.removeEventListener('mousemove', handlePlayheadMouseMove);
  document.removeEventListener('mouseup', handlePlayheadMouseUp);
}

if (dividerSliderWrapper) {
  dividerSliderWrapper.addEventListener('mousedown', (e) => {
    const startHandle = document.getElementById('divider-handle-start');
    const endHandle = document.getElementById('divider-handle-end');
    if (e.target === startHandle || e.target === endHandle) return;
    
    e.preventDefault();
    isScrubbingPlayhead = true;
    handlePlayheadScrub(e);
    document.addEventListener('mousemove', handlePlayheadMouseMove);
    document.addEventListener('mouseup', handlePlayheadMouseUp);
  });
}

// Wizard Step Navigation Transitions
if (btnDividerNextStep) {
  btnDividerNextStep.addEventListener('click', () => {
    if (dividerDuration <= 0) {
      alert('Please load a video file first.');
      return;
    }
    if (!dividerMode) {
      alert('Please select a divide mode.');
      return;
    }
    
    dividerStep1.style.display = 'none';
    dividerStep2.style.display = 'flex';
  });
}

if (btnDividerBackStep) {
  btnDividerBackStep.addEventListener('click', () => {
    dividerStep2.style.display = 'none';
    dividerStep1.style.display = 'flex';
  });
}

// In/Out Marker Setters
if (btnDividerSetStart) {
  btnDividerSetStart.addEventListener('click', () => {
    dividerStartVal = Math.min(dividerVideoPlayer.currentTime, dividerEndVal);
    dividerStartInput.value = secondsToHHMMSSWithMs(dividerStartVal);
    updateDividerSliderUI();
  });
}

if (btnDividerSetEnd) {
  btnDividerSetEnd.addEventListener('click', () => {
    dividerEndVal = Math.max(dividerVideoPlayer.currentTime, dividerStartVal);
    dividerEndInput.value = secondsToHHMMSSWithMs(dividerEndVal);
    updateDividerSliderUI();
  });
}

// Text Inputs
if (dividerStartInput) {
  dividerStartInput.addEventListener('change', (e) => {
    const val = hhmmssToSecondsWithMs(e.target.value);
    dividerStartVal = Math.max(0, Math.min(val, dividerEndVal));
    e.target.value = secondsToHHMMSSWithMs(dividerStartVal);
    updateDividerSliderUI();
  });
}

if (dividerEndInput) {
  dividerEndInput.addEventListener('change', (e) => {
    const val = hhmmssToSecondsWithMs(e.target.value);
    dividerEndVal = Math.max(dividerStartVal, Math.min(val, dividerDuration));
    e.target.value = secondsToHHMMSSWithMs(dividerEndVal);
    updateDividerSliderUI();
  });
}

// Split playback buttons
if (btnDividerGoStart) {
  btnDividerGoStart.addEventListener('click', () => {
    dividerVideoPlayer.currentTime = dividerStartVal;
  });
}

if (btnDividerGoEnd) {
  btnDividerGoEnd.addEventListener('click', () => {
    dividerVideoPlayer.currentTime = dividerEndVal;
  });
}

if (btnDividerPreview) {
  btnDividerPreview.addEventListener('click', () => {
    if (isDividerPreviewing && !dividerVideoPlayer.paused) {
      dividerVideoPlayer.pause();
      isDividerPreviewing = false;
      btnDividerPreview.textContent = 'Preview Segment';
    } else {
      dividerVideoPlayer.currentTime = dividerStartVal;
      isDividerPreviewing = true;
      dividerVideoPlayer.play();
      btnDividerPreview.textContent = 'Pause Preview';
    }
  });
}

// Mode cards switching
const modeCards = document.querySelectorAll('.divider-mode-card');
const dividerPanels = {
  fast: document.getElementById('panel-divider-trim'),
  precise: document.getElementById('panel-divider-trim'),
  chunks: document.getElementById('panel-divider-chunks'),
  spatial: document.getElementById('panel-divider-spatial')
};

modeCards.forEach(card => {
  card.addEventListener('click', () => {
    modeCards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    
    dividerMode = card.dataset.mode;
    
    // Toggle active panel
    Object.keys(dividerPanels).forEach(key => {
      if (key === dividerMode) {
        dividerPanels[key].classList.add('active');
      } else {
        if (!(dividerMode === 'precise' && key === 'fast') && !(dividerMode === 'fast' && key === 'precise')) {
          dividerPanels[key].classList.remove('active');
        }
      }
    });
  });
});

// Chunks count calculation preview
export function updateChunksCountPreview() {
  if (dividerDuration <= 0) {
    dividerChunksPreviewCount.textContent = '0';
    return;
  }
  const min = parseInt(dividerChunkMin.value, 10) || 0;
  const sec = parseInt(dividerChunkSec.value, 10) || 0;
  const totalSec = min * 60 + sec;
  
  if (totalSec <= 0) {
    dividerChunksPreviewCount.textContent = '0';
    return;
  }
  
  const count = Math.ceil(dividerDuration / totalSec);
  dividerChunksPreviewCount.textContent = count.toString();
}

if (dividerChunkMin) dividerChunkMin.addEventListener('input', updateChunksCountPreview);
if (dividerChunkSec) dividerChunkSec.addEventListener('input', updateChunksCountPreview);

// Spatial checkbox style styling
Object.keys(spatialCheckboxes).forEach(key => {
  const checkbox = spatialCheckboxes[key];
  if (checkbox) {
    checkbox.addEventListener('change', () => {
      const parent = checkbox.closest('.spatial-checkbox-container');
      if (checkbox.checked) {
        parent.classList.add('checked');
      } else {
        parent.classList.remove('checked');
      }
    });
  }
});

// Trigger Divide action
if (btnDivideVideo) {
  btnDivideVideo.addEventListener('click', () => {
    if (isDividing) {
      alert('A division task is already in progress.');
      return;
    }
    if (state.isDownloading) {
      alert('A source download is in progress. Please wait for it to complete.');
      return;
    }
    if (!dividerSourcePath) {
      alert('Please load a video file first.');
      return;
    }
    
    // Build options based on mode
    let options = {};
    if (dividerMode === 'fast' || dividerMode === 'precise') {
      options = {
        startTimeStr: dividerStartInput.value,
        endTimeStr: dividerEndInput.value,
        startTimeSeconds: dividerStartVal,
        endTimeSeconds: dividerEndVal
      };
      if (options.startTimeSeconds >= options.endTimeSeconds) {
        alert('Start Marker must be before End Marker.');
        return;
      }
    } else if (dividerMode === 'chunks') {
      const min = parseInt(dividerChunkMin.value, 10) || 0;
      const sec = parseInt(dividerChunkSec.value, 10) || 0;
      const totalSec = min * 60 + sec;
      if (totalSec <= 0) {
        alert('Please specify a chunk duration greater than 0.');
        return;
      }
      options = {
        segmentTimeSeconds: totalSec
      };
    } else if (dividerMode === 'spatial') {
      options = {
        left: spatialCheckboxes.left.checked,
        right: spatialCheckboxes.right.checked,
        top: spatialCheckboxes.top.checked,
        bottom: spatialCheckboxes.bottom.checked
      };
      if (!options.left && !options.right && !options.top && !options.bottom) {
        alert('Please check at least one crop region.');
        return;
      }
    }
    
    // Pause video player
    dividerVideoPlayer.pause();
    
    isDividing = true;
    btnDividerOpenFolder.style.display = 'none';
    startDownloadIndicator(`Dividing video using ${dividerMode.toUpperCase()} mode...`);
    
    window.electronAPI.divideVideo({
      inputPath: dividerSourcePath,
      mode: dividerMode,
      options
    });
  });
}

// Open folder click
if (btnDividerOpenFolder) {
  btnDividerOpenFolder.addEventListener('click', () => {
    if (dividerOutputFolder) {
      window.electronAPI.openFolder(dividerOutputFolder);
    }
  });
}

// IPC Receivers for import yt-dlp & division progress
window.electronAPI.onDividerImportComplete((data) => {
  loadDividerSource(data.filePath);
  stopDownloadIndicator();
  
  // Show clean inline success status for remote source import
  const inlineStatus = document.getElementById('divider-inline-status-container');
  const resultBox = document.getElementById('divider-result-box');
  if (inlineStatus) inlineStatus.style.display = 'block';
  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.className = 'success';
    resultBox.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 2px;"><polyline points="20 6 9 17 4 12"/></svg>
        <div>
          <div style="font-weight: 600;">YouTube Video Imported Successfully</div>
          <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 2px;">Details and range controls are ready below.</div>
        </div>
      </div>
    `;
  }
});

window.electronAPI.onDivideStatus((status) => {
  const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
  if (currentTab === 'divider-tab') {
    const statusText = document.getElementById('divider-progress-status-text');
    if (statusText) statusText.textContent = status;
  } else {
    const statusText = document.getElementById('progress-status-text');
    if (statusText) statusText.textContent = status;
  }
});

window.electronAPI.onDivideProgress((progress) => {
  const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
  if (currentTab === 'divider-tab') {
    const fill = document.getElementById('divider-progress-fill');
    const percentText = document.getElementById('divider-progress-percent-text');
    if (fill && percentText) {
      fill.style.width = `${progress}%`;
      percentText.textContent = `${progress}%`;
    }
  } else {
    const fill = document.getElementById('progress-fill');
    const percentText = document.getElementById('progress-percent-text');
    if (fill && percentText) {
      fill.style.width = `${progress}%`;
      percentText.textContent = `${progress}%`;
    }
  }
});

window.electronAPI.onDivideComplete((data) => {
  isDividing = false;
  stopDownloadIndicator();
  
  if (state.currentSettings.soundEnabled) {
    playSuccessChime();
  }
  
  dividerOutputFolder = data.outputDir;
  btnDividerOpenFolder.style.display = 'inline-flex';
  
  const count = Array.isArray(data.filePaths) ? data.filePaths.length : 1;
  const countLabel = count === 1 ? '1 file created' : `${count} files created`;

  // Show clean inline success status
  const inlineStatus = document.getElementById('divider-inline-status-container');
  const resultBox = document.getElementById('divider-result-box');
  if (inlineStatus) inlineStatus.style.display = 'block';
  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.className = 'success';
    resultBox.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 2px;"><polyline points="20 6 9 17 4 12"/></svg>
        <div>
          <div style="font-weight: 600;">Video Divided Successfully! (${countLabel})</div>
          <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 2px;">Outputs saved in the output directory. Click "Open Output" in Step 2 to view.</div>
        </div>
      </div>
    `;
  }
});

window.electronAPI.onDivideError((error) => {
  isDividing = false;
  stopDownloadIndicator();
  
  // Show clean inline error status
  const inlineStatus = document.getElementById('divider-inline-status-container');
  const resultBox = document.getElementById('divider-result-box');
  if (inlineStatus) inlineStatus.style.display = 'block';
  if (resultBox) {
    resultBox.style.display = 'block';
    resultBox.className = 'error';
    resultBox.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 2px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <div style="font-weight: 600;">Division Failed</div>
          <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 2px;">${error}</div>
        </div>
      </div>
    `;
  }
});

