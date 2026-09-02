import { formatBytes, hhmmssToSecondsWithMs, pointerToTime, secondsToHHMMSSWithMs, sliderPercents } from './time.js';

// ==========================================
// VIDEO TO GIF CONVERTER LOGIC
// ==========================================

// Global state variables for GIF tab
let gifSourcePath = '';
let gifDuration = 0;
let gifStartVal = 0;
let gifEndVal = 0;
let isGifPreviewing = false;
let activeGifDragHandle = null;
let isScrubbingGifPlayhead = false;
let gifLastTargetSeekTime = null;

// Elements
const gifImportZone = document.getElementById('gif-import-zone');
const gifDropZone = document.getElementById('gif-drop-zone');
const btnGifBrowse = document.getElementById('btn-gif-browse');
const gifLoading = document.getElementById('gif-loading');
const gifWorkspace = document.getElementById('gif-workspace');

const gifVideoPlayer = document.getElementById('gif-video-player');
const gifTimelineWrapper = document.getElementById('gif-timeline-wrapper');
const gifSliderRange = document.getElementById('gif-slider-range');
const gifSliderPlayhead = document.getElementById('gif-slider-playhead');
const gifLabelCurrent = document.getElementById('gif-label-current-time');
const gifLabelTotal = document.getElementById('gif-label-total-time');

const gifMetaValSize = document.getElementById('gif-meta-val-size');
const gifMetaValRes = document.getElementById('gif-meta-val-res');
const gifMetaValFps = document.getElementById('gif-meta-val-fps');
const gifMetaValDuration = document.getElementById('gif-meta-val-duration');

const gifVideoTitle = document.getElementById('gif-video-title');
const gifVideoDurationBadge = document.getElementById('gif-video-duration-badge');
const gifVideoResBadge = document.getElementById('gif-video-res-badge');

const gifStartInput = document.getElementById('gif-start-time-str');
const gifEndInput = document.getElementById('gif-end-time-str');
const btnGifSetStart = document.getElementById('btn-gif-set-start');
const btnGifSetEnd = document.getElementById('btn-gif-set-end');
const btnGifGoStart = document.getElementById('btn-gif-go-start');
const btnGifPreview = document.getElementById('btn-gif-preview-clip');
const btnGifGoEnd = document.getElementById('btn-gif-go-end');

const gifResolutionSelect = document.getElementById('gif-resolution');
const gifFpsRange = document.getElementById('gif-fps');
const gifFpsVal = document.getElementById('gif-fps-val');

const btnGifConvert = document.getElementById('btn-gif-convert');
const btnGifReset = document.getElementById('btn-gif-reset');
const btnGifOpenFolder = document.getElementById('btn-gif-open-folder');

const gifStatusContainer = document.getElementById('gif-status-container');
const gifStatusTitle = document.getElementById('gif-status-title');
const gifProgressPercent = document.getElementById('gif-progress-percent');
const gifProgressBar = document.getElementById('gif-progress-bar');

const gifResultsContainer = document.getElementById('gif-results-container');
const gifResultPath = document.getElementById('gif-result-path');

const gifErrorZone = document.getElementById('gif-error-zone');
const gifErrorMsg = document.getElementById('gif-error-msg');

// Set up Drag and Drop
if (gifDropZone) {
  gifDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    gifDropZone.classList.add('dragover');
  });

  gifDropZone.addEventListener('dragleave', () => {
    gifDropZone.classList.remove('dragover');
  });

  gifDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    gifDropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = window.electronAPI.getPathForFile(file);
      if (filePath) {
        loadGifSource(filePath);
      }
    }
  });
}

// Browse Button click
if (btnGifBrowse) {
  btnGifBrowse.addEventListener('click', async () => {
    const path = await window.electronAPI.selectVideoFile();
    if (path) {
      loadGifSource(path);
    }
  });
}

// Reset workspace
if (btnGifReset) {
  btnGifReset.addEventListener('click', () => {
    if (gifVideoPlayer) {
      gifVideoPlayer.pause();
      gifVideoPlayer.src = '';
    }
    gifSourcePath = '';
    gifDuration = 0;
    
    if (gifWorkspace) gifWorkspace.style.display = 'none';
    if (gifImportZone) gifImportZone.style.display = 'flex';
    if (gifStatusContainer) gifStatusContainer.style.display = 'none';
    if (gifResultsContainer) gifResultsContainer.style.display = 'none';
    if (gifErrorZone) gifErrorZone.style.display = 'none';
    
    // Reset metadata fields
    if (gifMetaValSize) gifMetaValSize.textContent = '--';
    if (gifMetaValRes) gifMetaValRes.textContent = '--';
    if (gifMetaValFps) gifMetaValFps.textContent = '--';
    if (gifMetaValDuration) gifMetaValDuration.textContent = '--';
    
    if (gifStartInput) gifStartInput.value = '00:00:00.000';
    if (gifEndInput) gifEndInput.value = '00:00:00.000';
  });
}

// Probing and importing video file
export async function loadGifSource(filePath) {
  if (gifImportZone) gifImportZone.style.display = 'none';
  if (gifLoading) gifLoading.style.display = 'flex';
  if (gifWorkspace) gifWorkspace.style.display = 'none';
  if (gifStatusContainer) gifStatusContainer.style.display = 'none';
  if (gifResultsContainer) gifResultsContainer.style.display = 'none';
  if (gifErrorZone) gifErrorZone.style.display = 'none';

  try {
    gifSourcePath = filePath;
    const meta = await window.electronAPI.probeLocalVideo(filePath);
    
    gifDuration = meta.duration;
    gifStartVal = 0;
    gifEndVal = meta.duration;
    
    if (gifVideoTitle) gifVideoTitle.textContent = meta.filename;
    if (gifVideoDurationBadge) gifVideoDurationBadge.textContent = secondsToHHMMSSWithMs(meta.duration);
    if (gifVideoResBadge) gifVideoResBadge.textContent = meta.width && meta.height ? `${meta.width}x${meta.height}` : 'Unknown';
    
    if (gifLabelTotal) gifLabelTotal.textContent = secondsToHHMMSSWithMs(meta.duration);
    if (gifLabelCurrent) gifLabelCurrent.textContent = secondsToHHMMSSWithMs(0);
    if (gifStartInput) gifStartInput.value = secondsToHHMMSSWithMs(0);
    if (gifEndInput) gifEndInput.value = secondsToHHMMSSWithMs(meta.duration);
    
    const fileUrl = await window.electronAPI.getFileUrl(filePath);
    if (gifVideoPlayer) {
      gifVideoPlayer.src = fileUrl;
      gifVideoPlayer.load();
    }
    
    // Set specifications metadata
    if (gifMetaValSize) gifMetaValSize.textContent = formatBytes(meta.size);
    if (gifMetaValRes) gifMetaValRes.textContent = meta.width && meta.height ? `${meta.width}x${meta.height}` : '--';
    if (gifMetaValFps) gifMetaValFps.textContent = meta.fps ? `${meta.fps} fps` : '--';
    if (gifMetaValDuration) gifMetaValDuration.textContent = meta.duration ? `${meta.duration.toFixed(2)}s` : '--';

    if (gifLoading) gifLoading.style.display = 'none';
    if (gifWorkspace) gifWorkspace.style.display = 'flex';
    
    updateGifSliderUI();
  } catch (err) {
    if (gifLoading) gifLoading.style.display = 'none';
    if (gifImportZone) gifImportZone.style.display = 'flex';
    alert('Failed to load local video file:\n' + err.message);
  }
}

// Range slider rendering and scrub logic
export function updateGifSliderUI() {
  if (gifDuration > 0 && gifSliderRange) {
    const { startPct, endPct, widthPct } = sliderPercents(gifStartVal, gifEndVal, gifDuration);
    
    gifSliderRange.style.left = `${startPct}%`;
    gifSliderRange.style.width = `${widthPct}%`;
    
    const startHandle = document.getElementById('gif-handle-start');
    const endHandle = document.getElementById('gif-handle-end');
    if (startHandle) startHandle.style.left = `${startPct}%`;
    if (endHandle) endHandle.style.left = `${endPct}%`;
  }
}

export function seekGifVideoPlayer(time) {
  if (!gifVideoPlayer) return;
  if (!gifVideoPlayer.seeking) {
    gifVideoPlayer.currentTime = time;
    gifLastTargetSeekTime = null;
  } else {
    gifLastTargetSeekTime = time;
  }
}

if (gifVideoPlayer) {
  gifVideoPlayer.addEventListener('seeked', () => {
    if (gifLastTargetSeekTime !== null) {
      gifVideoPlayer.currentTime = gifLastTargetSeekTime;
      gifLastTargetSeekTime = null;
    }
  });

  gifVideoPlayer.addEventListener('timeupdate', () => {
    if (gifDuration > 0 && gifSliderPlayhead && gifLabelCurrent) {
      const pct = (gifVideoPlayer.currentTime / gifDuration) * 100;
      gifSliderPlayhead.style.left = `${pct}%`;
      gifLabelCurrent.textContent = secondsToHHMMSSWithMs(gifVideoPlayer.currentTime);
      
      if (isGifPreviewing) {
        if (gifVideoPlayer.currentTime >= gifEndVal) {
          gifVideoPlayer.pause();
          isGifPreviewing = false;
          if (btnGifPreview) btnGifPreview.textContent = 'Preview Segment';
        }
      }
    }
  });

  gifVideoPlayer.addEventListener('pause', () => {
    isGifPreviewing = false;
    if (btnGifPreview) btnGifPreview.textContent = 'Preview Segment';
  });
}

let cachedGifTimelineRect = null;
let pendingGifDragRaf = false;

export function handleGifMouseDown(type) {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    activeGifDragHandle = type;
    if (gifTimelineWrapper) {
      cachedGifTimelineRect = gifTimelineWrapper.getBoundingClientRect();
    }
    document.addEventListener('mousemove', handleGifMouseMove, { passive: true });
    document.addEventListener('mouseup', handleGifMouseUp);
  };
}

export function handleGifMouseMove(e) {
  if (!activeGifDragHandle || gifDuration <= 0) return;
  if (!cachedGifTimelineRect && gifTimelineWrapper) {
    cachedGifTimelineRect = gifTimelineWrapper.getBoundingClientRect();
  }
  if (!cachedGifTimelineRect) return;

  const clientX = e.clientX;
  if (!pendingGifDragRaf) {
    pendingGifDragRaf = true;
    requestAnimationFrame(() => {
      pendingGifDragRaf = false;
      if (!activeGifDragHandle || !cachedGifTimelineRect) return;

      const rect = cachedGifTimelineRect;
      const { pct, timeVal } = pointerToTime(clientX, rect, gifDuration);

      if (gifSliderPlayhead) gifSliderPlayhead.style.left = `${pct * 100}%`;
      if (gifLabelCurrent) gifLabelCurrent.textContent = secondsToHHMMSSWithMs(timeVal);

      if (activeGifDragHandle === 'start') {
        gifStartVal = Math.min(timeVal, gifEndVal);
        if (gifStartInput) gifStartInput.value = secondsToHHMMSSWithMs(gifStartVal);
        seekGifVideoPlayer(gifStartVal);
      } else if (activeGifDragHandle === 'end') {
        gifEndVal = Math.max(timeVal, gifStartVal);
        if (gifEndInput) gifEndInput.value = secondsToHHMMSSWithMs(gifEndVal);
        seekGifVideoPlayer(gifEndVal);
      }
      updateGifSliderUI();
    });
  }
}

export function handleGifMouseUp() {
  activeGifDragHandle = null;
  cachedGifTimelineRect = null;
  document.removeEventListener('mousemove', handleGifMouseMove);
  document.removeEventListener('mouseup', handleGifMouseUp);
}

const gifStartHandleEl = document.getElementById('gif-handle-start');
const gifEndHandleEl = document.getElementById('gif-handle-end');
if (gifStartHandleEl) gifStartHandleEl.addEventListener('mousedown', handleGifMouseDown('start'));
if (gifEndHandleEl) gifEndHandleEl.addEventListener('mousedown', handleGifMouseDown('end'));

let pendingGifScrubRaf = false;

export function handleGifPlayheadScrub(e) {
  if (gifDuration <= 0) return;
  if (!cachedGifTimelineRect && gifTimelineWrapper) {
    cachedGifTimelineRect = gifTimelineWrapper.getBoundingClientRect();
  }
  if (!cachedGifTimelineRect) return;

  const clientX = e.clientX;
  if (!pendingGifScrubRaf) {
    pendingGifScrubRaf = true;
    requestAnimationFrame(() => {
      pendingGifScrubRaf = false;
      if (!cachedGifTimelineRect) return;
      const rect = cachedGifTimelineRect;
      const { pct, timeVal } = pointerToTime(clientX, rect, gifDuration);

      seekGifVideoPlayer(timeVal);
      if (gifSliderPlayhead) gifSliderPlayhead.style.left = `${pct * 100}%`;
      if (gifLabelCurrent) gifLabelCurrent.textContent = secondsToHHMMSSWithMs(timeVal);
    });
  }
}

export function handleGifPlayheadMouseMove(e) {
  if (isScrubbingGifPlayhead) {
    handleGifPlayheadScrub(e);
  }
}

export function handleGifPlayheadMouseUp() {
  isScrubbingGifPlayhead = false;
  cachedGifTimelineRect = null;
  document.removeEventListener('mousemove', handleGifPlayheadMouseMove);
  document.removeEventListener('mouseup', handleGifPlayheadMouseUp);
}

if (gifTimelineWrapper) {
  gifTimelineWrapper.addEventListener('mousedown', (e) => {
    const startHandle = document.getElementById('gif-handle-start');
    const endHandle = document.getElementById('gif-handle-end');
    if (e.target === startHandle || e.target === endHandle) return;
    
    e.preventDefault();
    cachedGifTimelineRect = gifTimelineWrapper.getBoundingClientRect();
    isScrubbingGifPlayhead = true;
    handleGifPlayheadScrub(e);
    document.addEventListener('mousemove', handleGifPlayheadMouseMove, { passive: true });
    document.addEventListener('mouseup', handleGifPlayheadMouseUp);
  });
}

// Marker setters
if (btnGifSetStart) {
  btnGifSetStart.addEventListener('click', () => {
    if (gifVideoPlayer) {
      gifStartVal = Math.min(gifVideoPlayer.currentTime, gifEndVal);
      if (gifStartInput) gifStartInput.value = secondsToHHMMSSWithMs(gifStartVal);
      updateGifSliderUI();
    }
  });
}

if (btnGifSetEnd) {
  btnGifSetEnd.addEventListener('click', () => {
    if (gifVideoPlayer) {
      gifEndVal = Math.max(gifVideoPlayer.currentTime, gifStartVal);
      if (gifEndInput) gifEndInput.value = secondsToHHMMSSWithMs(gifEndVal);
      updateGifSliderUI();
    }
  });
}

// Text Inputs
if (gifStartInput) {
  gifStartInput.addEventListener('change', (e) => {
    const val = hhmmssToSecondsWithMs(e.target.value);
    gifStartVal = Math.max(0, Math.min(val, gifEndVal));
    e.target.value = secondsToHHMMSSWithMs(gifStartVal);
    updateGifSliderUI();
  });
}

if (gifEndInput) {
  gifEndInput.addEventListener('change', (e) => {
    const val = hhmmssToSecondsWithMs(e.target.value);
    gifEndVal = Math.max(gifStartVal, Math.min(val, gifDuration));
    e.target.value = secondsToHHMMSSWithMs(gifEndVal);
    updateGifSliderUI();
  });
}

// Playback buttons
if (btnGifGoStart) {
  btnGifGoStart.addEventListener('click', () => {
    seekGifVideoPlayer(gifStartVal);
  });
}

if (btnGifGoEnd) {
  btnGifGoEnd.addEventListener('click', () => {
    seekGifVideoPlayer(gifEndVal);
  });
}

if (btnGifPreview) {
  btnGifPreview.addEventListener('click', () => {
    if (!gifVideoPlayer) return;
    if (isGifPreviewing && !gifVideoPlayer.paused) {
      gifVideoPlayer.pause();
      isGifPreviewing = false;
      btnGifPreview.textContent = 'Preview Segment';
    } else {
      gifVideoPlayer.currentTime = gifStartVal;
      isGifPreviewing = true;
      gifVideoPlayer.play();
      btnGifPreview.textContent = 'Pause Preview';
    }
  });
}

// FPS Range Slider
if (gifFpsRange && gifFpsVal) {
  gifFpsRange.addEventListener('input', (e) => {
    gifFpsVal.textContent = `${e.target.value} FPS`;
  });
}

// Conversion Trigger
if (btnGifConvert) {
  btnGifConvert.addEventListener('click', async () => {
    if (!gifSourcePath) {
      alert('Please load a video file first.');
      return;
    }
    
    // Read current form configuration
    const startSec = hhmmssToSecondsWithMs(gifStartInput.value);
    const endSec = hhmmssToSecondsWithMs(gifEndInput.value);
    const fps = parseInt(gifFpsRange.value, 10);
    const width = gifResolutionSelect.value;
    
    // Front-end state validation
    if (endSec <= startSec) {
      alert('Validation Error: End time must be greater than start time.');
      return;
    }
    
    const cropDuration = endSec - startSec;
    if (cropDuration > 60) {
      alert('Validation Error: The selected clip is ' + cropDuration.toFixed(1) + 's long. Maximum GIF duration is limited to 60 seconds to avoid system memory overhead.');
      return;
    }

    // Toggle UI display states: Transition into loading mode
    if (gifStatusContainer) {
      gifStatusContainer.style.display = 'flex';
      gifStatusTitle.textContent = 'Processing high-quality GIF...';
      gifProgressPercent.textContent = '0%';
      if (gifProgressBar) gifProgressBar.style.width = '0%';
    }
    if (gifResultsContainer) gifResultsContainer.style.display = 'none';
    if (gifErrorZone) gifErrorZone.style.display = 'none';
    
    btnGifConvert.disabled = true;
    btnGifReset.disabled = true;
    
    const payload = {
      inputPath: gifSourcePath,
      fps,
      width,
      startTime: startSec,
      endTime: endSec
    };
    
    try {
      const response = await window.electronAPI.convertVideoToGif(payload);
      
      // Update UI elements based on response
      btnGifConvert.disabled = false;
      btnGifReset.disabled = false;
      
      if (gifStatusContainer) gifStatusContainer.style.display = 'none';
      
      if (response && response.success) {
        if (gifResultsContainer) gifResultsContainer.style.display = 'flex';
        if (gifResultPath) {
          gifResultPath.textContent = response.outputPath;
          // Wire up open folder click specifically for this output path
          btnGifOpenFolder.onclick = () => {
            window.electronAPI.openFolder(response.outputPath);
          };
        }
      } else {
        const errorMsg = (response && response.error) ? response.error : 'Unknown error during conversion';
        if (gifErrorZone) {
          gifErrorZone.style.display = 'block';
          if (gifErrorMsg) gifErrorMsg.textContent = errorMsg;
        }
      }
    } catch (err) {
      btnGifConvert.disabled = false;
      btnGifReset.disabled = false;
      if (gifStatusContainer) gifStatusContainer.style.display = 'none';
      if (gifErrorZone) {
        gifErrorZone.style.display = 'block';
        if (gifErrorMsg) gifErrorMsg.textContent = err.message;
      }
    }
  });
}

// Listen to progress updates
if (window.electronAPI.onGifProgress) {
  window.electronAPI.onGifProgress((percent) => {
    if (gifProgressPercent) gifProgressPercent.textContent = `${percent}%`;
    if (gifProgressBar) gifProgressBar.style.width = `${percent}%`;
  });
}

// Optionally listen to finished event if triggered through events rather than promise
if (window.electronAPI.onGifFinished) {
  window.electronAPI.onGifFinished((status) => {
    console.log('[Frontend GIF Finished Event Received]:', status);
  });
}
