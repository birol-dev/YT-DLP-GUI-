import { appendLog, hideDownloadCompleteCard, startDownloadIndicator, validateUrlInput } from './download.js';
import { state } from './state.js';
import { hhmmssToSeconds, pointerToTime, secondsToHHMMSS, sliderPercents } from './time.js';

// Video Clipper State
let clipperDuration = 0;
let clipperStartVal = 0;
let clipperEndVal = 0;
let isPreviewingClip = false;


// Elements
const clipperUrlInput = document.getElementById('clipper-url');
const clipperLoadBtn = document.getElementById('btn-clipper-load');
const clipperLoading = document.getElementById('clipper-loading');
const clipperWorkspace = document.getElementById('clipper-workspace');
const clipperThumbnail = document.getElementById('clipper-video-thumbnail');
const clipperTitle = document.getElementById('clipper-video-title');
const clipperDurationBadge = document.getElementById('clipper-video-duration-badge');
const clipperPlayer = document.getElementById('clipper-video-player');
const clipperAudio = document.getElementById('clipper-audio-player');
const clipperPlayerError = document.getElementById('clipper-player-error');
const clipperSliderWrapper = document.querySelector('.clipper-slider-wrapper');
const clipperSliderRange = document.getElementById('clipper-slider-range');
const clipperSliderPlayhead = document.getElementById('clipper-slider-playhead');
const clipperLabelCurrent = document.getElementById('clipper-label-current-time');
const clipperLabelTotal = document.getElementById('clipper-label-total-time');

const clipperStartInput = document.getElementById('clipper-start-time-str');
const clipperEndInput = document.getElementById('clipper-end-time-str');

const btnClipperSetStart = document.getElementById('btn-clipper-set-start');
const btnClipperSetEnd = document.getElementById('btn-clipper-set-end');
const btnClipperGoStart = document.getElementById('btn-clipper-go-start');
const btnClipperGoEnd = document.getElementById('btn-clipper-go-end');
const btnClipperPreview = document.getElementById('btn-clipper-preview-clip');
const btnClipperDownload = document.getElementById('btn-clipper-download');
const btnClipperDownloadAudio = document.getElementById('btn-clipper-download-audio');

const handleStart = document.getElementById('clipper-handle-start');
const handleEnd = document.getElementById('clipper-handle-end');
let activeDragHandle = null;

// Throttled seeking queue for smooth streaming video scrubbing
let lastTargetSeekTime = null;

export function seekVideoPlayer(time) {
  if (!clipperPlayer || clipperPlayer.style.display === 'none') return;
  if (!clipperPlayer.seeking) {
    clipperPlayer.currentTime = time;
    if (clipperAudio && clipperAudio.src) {
      try { clipperAudio.currentTime = time; } catch (e) {}
    }
    lastTargetSeekTime = null;
  } else {
    lastTargetSeekTime = time;
  }
}

// Add seeked listener to process queued seeks
if (clipperPlayer) {
  clipperPlayer.addEventListener('seeked', () => {
    if (lastTargetSeekTime !== null) {
      clipperPlayer.currentTime = lastTargetSeekTime;
      if (clipperAudio && clipperAudio.src) {
        try { clipperAudio.currentTime = lastTargetSeekTime; } catch (e) {}
      }
      lastTargetSeekTime = null;
    } else if (clipperAudio && clipperAudio.src) {
      try { clipperAudio.currentTime = clipperPlayer.currentTime; } catch (e) {}
    }
  });
}

if (clipperAudio) {
  clipperAudio.addEventListener('error', () => {
    // Non-fatal: if audio fails to load, keep video playing silently
    try { clipperAudio.removeAttribute('src'); } catch (e) {}
  });
}

// Update custom range bar UI
export function updateClipperSliderUI() {
  if (clipperDuration > 0) {
    const { startPct, endPct, widthPct } = sliderPercents(clipperStartVal, clipperEndVal, clipperDuration);
    
    clipperSliderRange.style.left = `${startPct}%`;
    clipperSliderRange.style.width = `${widthPct}%`;
    
    if (handleStart) handleStart.style.left = `${startPct}%`;
    if (handleEnd) handleEnd.style.left = `${endPct}%`;
  }
}

let cachedClipperRect = null;
let pendingClipperRaf = false;

// Dragging start/end handles
export function handleMouseDown(type) {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    activeDragHandle = type;
    if (clipperSliderWrapper) {
      cachedClipperRect = clipperSliderWrapper.getBoundingClientRect();
    }
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);
  };
}

if (handleStart) handleStart.addEventListener('mousedown', handleMouseDown('start'));
if (handleEnd) handleEnd.addEventListener('mousedown', handleMouseDown('end'));

export function handleMouseMove(e) {
  if (!activeDragHandle || clipperDuration <= 0) return;
  if (!cachedClipperRect && clipperSliderWrapper) {
    cachedClipperRect = clipperSliderWrapper.getBoundingClientRect();
  }
  if (!cachedClipperRect) return;

  const clientX = e.clientX;
  if (!pendingClipperRaf) {
    pendingClipperRaf = true;
    requestAnimationFrame(() => {
      pendingClipperRaf = false;
      if (!activeDragHandle || !cachedClipperRect) return;

      const rect = cachedClipperRect;
      const { pct, timeVal } = pointerToTime(clientX, rect, clipperDuration);
      
      // Instant visual feedback for playhead positioning during drag
      clipperSliderPlayhead.style.left = `${pct * 100}%`;
      clipperLabelCurrent.textContent = secondsToHHMMSS(timeVal);
      
      if (activeDragHandle === 'start') {
        clipperStartVal = Math.min(timeVal, clipperEndVal);
        clipperStartInput.value = secondsToHHMMSS(clipperStartVal);
        seekVideoPlayer(clipperStartVal);
      } else if (activeDragHandle === 'end') {
        clipperEndVal = Math.max(timeVal, clipperStartVal);
        clipperEndInput.value = secondsToHHMMSS(clipperEndVal);
        seekVideoPlayer(clipperEndVal);
      }
      updateClipperSliderUI();
    });
  }
}

export function handleMouseUp() {
  activeDragHandle = null;
  cachedClipperRect = null;
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
}

// Load Video Info Handler
if (clipperLoadBtn) {
  clipperLoadBtn.addEventListener('click', async () => {
    const url = validateUrlInput(clipperUrlInput, 'YouTube video URL');
    if (!url) return;
    
    hideDownloadCompleteCard('clipper');
    clipperLoadBtn.disabled = true;
    clipperLoading.style.display = 'block';
    clipperWorkspace.style.display = 'none';
    clipperPlayerError.style.display = 'none';
    clipperPlayer.style.display = 'block';
    
    // Pause existing preview
    clipperPlayer.pause();
    if (clipperAudio) {
      clipperAudio.pause();
      clipperAudio.removeAttribute('src');
      try { clipperAudio.load(); } catch (e) {}
    }
    
    try {
      const res = await window.electronAPI.fetchVideoInfo(url);
      clipperLoading.style.display = 'none';
      clipperLoadBtn.disabled = false;
      
      if (res.success) {
        clipperDuration = res.duration;
        clipperStartVal = 0;
        clipperEndVal = res.duration;
        
        clipperTitle.textContent = res.title;
        clipperThumbnail.src = res.thumbnail;
        clipperDurationBadge.textContent = secondsToHHMMSS(res.duration);
        clipperLabelTotal.textContent = secondsToHHMMSS(res.duration);
        clipperLabelCurrent.textContent = secondsToHHMMSS(0);
        
        clipperStartInput.value = secondsToHHMMSS(0);
        clipperEndInput.value = secondsToHHMMSS(res.duration);
        
        if (res.streamUrl) {
          // Mute by default: missing audio devices must not kill video decode.
          clipperPlayer.muted = true;
          clipperPlayer.src = res.streamUrl;
          clipperPlayer.load();

          if (res.audioUrl && clipperAudio) {
            clipperAudio.src = res.audioUrl;
            clipperAudio.load();
          } else if (clipperAudio) {
            clipperAudio.removeAttribute('src');
          }
        } else {
          clipperPlayer.style.display = 'none';
          clipperPlayerError.style.display = 'flex';
          if (clipperAudio) {
            clipperAudio.removeAttribute('src');
          }
        }
        
        clipperWorkspace.style.display = 'flex';
        updateClipperSliderUI();
      } else {
        alert('Failed to retrieve video details:\n' + res.error);
      }
    } catch (err) {
      clipperLoading.style.display = 'none';
      clipperLoadBtn.disabled = false;
      alert('An error occurred while loading the video:\n' + err.message);
    }
  });
}

// Error handling for native player unsupported formats
if (clipperPlayer) {
  clipperPlayer.addEventListener('error', () => {
    clipperPlayer.style.display = 'none';
    clipperPlayerError.style.display = 'flex';
    if (clipperAudio) {
      clipperAudio.pause();
      clipperAudio.removeAttribute('src');
    }
  });

  clipperPlayer.addEventListener('play', () => {
    if (clipperAudio && clipperAudio.src) {
      clipperAudio.currentTime = clipperPlayer.currentTime;
      clipperAudio.play().catch(() => {});
    }
  });

  clipperPlayer.addEventListener('volumechange', () => {
    if (clipperAudio && clipperAudio.src) {
      clipperAudio.volume = clipperPlayer.volume;
      clipperAudio.muted = clipperPlayer.muted;
    }
  });
  
  // Track playhead and preview duration boundaries
  clipperPlayer.addEventListener('timeupdate', () => {
    if (clipperDuration > 0) {
      const pct = (clipperPlayer.currentTime / clipperDuration) * 100;
      clipperSliderPlayhead.style.left = `${pct}%`;
      clipperLabelCurrent.textContent = secondsToHHMMSS(clipperPlayer.currentTime);

      // Keep companion audio in sync with video stream
      if (clipperAudio && clipperAudio.src && !clipperPlayer.paused) {
        if (Math.abs(clipperAudio.currentTime - clipperPlayer.currentTime) > 0.25) {
          clipperAudio.currentTime = clipperPlayer.currentTime;
        }
      }
      
      if (isPreviewingClip) {
        if (clipperPlayer.currentTime >= clipperEndVal) {
          clipperPlayer.pause();
          if (clipperAudio && clipperAudio.src) clipperAudio.pause();
          isPreviewingClip = false;
          btnClipperPreview.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Preview Clip
          `;
        }
      }
    }
  });

  clipperPlayer.addEventListener('pause', () => {
    if (clipperAudio && clipperAudio.src) {
      clipperAudio.pause();
    }
    isPreviewingClip = false;
    btnClipperPreview.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Preview Clip
    `;
  });
}

// Timeline click-to-seek
if (clipperSliderWrapper) {
  clipperSliderWrapper.addEventListener('click', (e) => {
    // Ignore track click if user clicked start/end handles directly
    if (e.target === handleStart || e.target === handleEnd) return;
    
    if (clipperDuration > 0) {
      const rect = clipperSliderWrapper.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      if (clipperPlayer.style.display !== 'none') {
        clipperPlayer.currentTime = pct * clipperDuration;
      } else {
        // Fallback: manually place playhead if video can't play
        clipperSliderPlayhead.style.left = `${pct * 100}%`;
        clipperLabelCurrent.textContent = secondsToHHMMSS(pct * clipperDuration);
      }
    }
  });
}

// Set In/Out Markers
if (btnClipperSetStart) {
  btnClipperSetStart.addEventListener('click', () => {
    const curTime = (clipperPlayer && clipperPlayer.style.display !== 'none') ? clipperPlayer.currentTime : clipperStartVal;
    clipperStartVal = Math.min(curTime, clipperEndVal);
    clipperStartInput.value = secondsToHHMMSS(clipperStartVal);
    updateClipperSliderUI();
  });
}

if (btnClipperSetEnd) {
  btnClipperSetEnd.addEventListener('click', () => {
    const curTime = (clipperPlayer && clipperPlayer.style.display !== 'none') ? clipperPlayer.currentTime : clipperEndVal;
    clipperEndVal = Math.max(curTime, clipperStartVal);
    clipperEndInput.value = secondsToHHMMSS(clipperEndVal);
    updateClipperSliderUI();
  });
}

// Precise text input change handlers
if (clipperStartInput) {
  clipperStartInput.addEventListener('change', (e) => {
    const val = hhmmssToSeconds(e.target.value);
    clipperStartVal = Math.max(0, Math.min(val, clipperEndVal));
    e.target.value = secondsToHHMMSS(clipperStartVal);
    updateClipperSliderUI();
  });
}

if (clipperEndInput) {
  clipperEndInput.addEventListener('change', (e) => {
    const val = hhmmssToSeconds(e.target.value);
    clipperEndVal = Math.max(clipperStartVal, Math.min(val, clipperDuration));
    e.target.value = secondsToHHMMSS(clipperEndVal);
    updateClipperSliderUI();
  });
}

// Playback Helpers
if (btnClipperGoStart) {
  btnClipperGoStart.addEventListener('click', () => {
    if (clipperPlayer && clipperPlayer.style.display !== 'none') {
      clipperPlayer.currentTime = clipperStartVal;
      if (clipperAudio && clipperAudio.src) {
        try { clipperAudio.currentTime = clipperStartVal; } catch (e) {}
      }
    }
  });
}

if (btnClipperGoEnd) {
  btnClipperGoEnd.addEventListener('click', () => {
    if (clipperPlayer && clipperPlayer.style.display !== 'none') {
      clipperPlayer.currentTime = clipperEndVal;
      if (clipperAudio && clipperAudio.src) {
        try { clipperAudio.currentTime = clipperEndVal; } catch (e) {}
      }
    }
  });
}

// Preview Range Clip Playback
if (btnClipperPreview) {
  btnClipperPreview.addEventListener('click', () => {
    if (clipperPlayer && clipperPlayer.style.display !== 'none') {
      if (isPreviewingClip && !clipperPlayer.paused) {
        clipperPlayer.pause();
        if (clipperAudio && clipperAudio.src) clipperAudio.pause();
        isPreviewingClip = false;
        btnClipperPreview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Preview Clip
        `;
      } else {
        clipperPlayer.currentTime = clipperStartVal;
        if (clipperAudio && clipperAudio.src) {
          try { clipperAudio.currentTime = clipperStartVal; } catch (e) {}
        }
        isPreviewingClip = true;
        clipperPlayer.play();
        if (clipperAudio && clipperAudio.src) {
          clipperAudio.play().catch(() => {});
        }
        btnClipperPreview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
          Pause Preview
        `;
      }
    }
  });
}

// Start Clipper Download Helpers
export function startClipperDownload(format) {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  
  const url = clipperUrlInput.value.trim();
  const quality = document.getElementById('clipper-quality').value;
  
  if (!url) return;
  
  hideDownloadCompleteCard('clipper');

  const startStr = secondsToHHMMSS(clipperStartVal);
  const endStr = secondsToHHMMSS(clipperEndVal);
  
  if (clipperPlayer && typeof clipperPlayer.pause === 'function') {
    clipperPlayer.pause();
  }
  if (clipperAudio && typeof clipperAudio.pause === 'function') {
    clipperAudio.pause();
  }


  
  startDownloadIndicator(`Downloading clip as ${format} (${startStr} - ${endStr})...`, {
    url,
    type: 'clip',
    badge: `CLIP • ${format.toUpperCase()} (${startStr} - ${endStr})`,
    title: url
  });
  window.electronAPI.downloadClip({ url, quality, startTime: startStr, endTime: endStr, format });
}

if (btnClipperDownload) {
  btnClipperDownload.addEventListener('click', () => {
    startClipperDownload('video');
  });
}

if (btnClipperDownloadAudio) {
  btnClipperDownloadAudio.addEventListener('click', () => {
    startClipperDownload('audio');
  });
}
