import { state } from './state.js';

// ==========================================
// Music Finder Tab Logic
// ==========================================

const musicFinderInputZone = document.getElementById('musicfinder-input-zone');
const musicFinderDropZone = document.getElementById('musicfinder-drop-zone');
const btnMusicFinderBrowse = document.getElementById('btn-musicfinder-browse');
const musicFinderUrlInput = document.getElementById('musicfinder-url');
const btnMusicFinderScanUrl = document.getElementById('btn-musicfinder-scan-url');

const musicFinderLoading = document.getElementById('musicfinder-loading');
const musicFinderProgressFill = document.getElementById('musicfinder-progress-fill');
const musicFinderProgressPercent = document.getElementById('musicfinder-progress-percent-text');
const musicFinderStatusText = document.getElementById('musicfinder-progress-status-text');
const musicFinderStepLog = document.getElementById('musicfinder-step-log');

const musicFinderResultsZone = document.getElementById('musicfinder-results-zone');
const musicFinderResultsSummary = document.getElementById('musicfinder-results-summary');
const btnMusicFinderClearResults = document.getElementById('btn-musicfinder-clear-results');
const musicFinderTracklist = document.getElementById('musicfinder-tracklist');

// Error Banner selectors
const musicFinderErrorZone = document.getElementById('musicfinder-error-zone');
const musicFinderErrorText = document.getElementById('musicfinder-error-text');
const btnMusicFinderErrorSettings = document.getElementById('btn-musicfinder-error-settings');
const btnMusicFinderErrorDismiss = document.getElementById('btn-musicfinder-error-dismiss');

let isScanningMusic = false;

// UI State machine helper
export function showMusicFinderState(state) {
  if (musicFinderInputZone) musicFinderInputZone.style.display = (state === 'input') ? 'flex' : 'none';
  if (musicFinderLoading) musicFinderLoading.style.display = (state === 'loading') ? 'flex' : 'none';
  if (musicFinderErrorZone) musicFinderErrorZone.style.display = (state === 'error') ? 'flex' : 'none';
  if (musicFinderResultsZone) musicFinderResultsZone.style.display = (state === 'results') ? 'flex' : 'none';
}

// Append log helper
export function appendScanLog(message) {
  if (!musicFinderStepLog) return;
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  musicFinderStepLog.appendChild(div);
  musicFinderStepLog.scrollTop = musicFinderStepLog.scrollHeight;
}

// Reset Scan UI
export function resetMusicFinderUI() {
  isScanningMusic = false;
  
  if (musicFinderUrlInput) musicFinderUrlInput.value = '';
  if (musicFinderStepLog) musicFinderStepLog.innerHTML = '';
  if (musicFinderProgressFill) musicFinderProgressFill.style.width = '0%';
  if (musicFinderProgressPercent) musicFinderProgressPercent.textContent = '0%';
  if (musicFinderStatusText) musicFinderStatusText.textContent = 'Awaiting scanning target...';
  
  showMusicFinderState('input');
}

// Drag & Drop event bindings
const musicFinderCard = document.getElementById('musicfinder-card');

if (musicFinderDropZone) {
  musicFinderDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    musicFinderDropZone.classList.add('dragover');
  });

  musicFinderDropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    musicFinderDropZone.classList.remove('dragover');
  });

  musicFinderDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    musicFinderDropZone.classList.remove('dragover');
    if (isScanningMusic) {
      alert('A music scan is already in progress. Please wait.');
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = window.electronAPI.getPathForFile(file);
      if (filePath) {
        startLocalFileScan(filePath);
      }
    }
  });
}

if (musicFinderCard) {
  musicFinderCard.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!isScanningMusic && musicFinderInputZone && musicFinderInputZone.style.display === 'none') {
      musicFinderCard.style.borderColor = 'hsl(var(--primary))';
      musicFinderCard.style.boxShadow = '0 0 0 1px hsl(var(--primary))';
    }
  });

  musicFinderCard.addEventListener('dragleave', () => {
    musicFinderCard.style.borderColor = '';
    musicFinderCard.style.boxShadow = '';
  });

  musicFinderCard.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    musicFinderCard.style.borderColor = '';
    musicFinderCard.style.boxShadow = '';
    if (isScanningMusic) {
      alert('A music scan is already in progress. Please wait.');
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = window.electronAPI.getPathForFile(file);
      if (filePath) {
        startLocalFileScan(filePath);
      }
    }
  });
}

// Browse click
if (btnMusicFinderBrowse) {
  btnMusicFinderBrowse.addEventListener('click', async () => {
    if (isScanningMusic) return;
    const filePath = await window.electronAPI.selectAudioVideoFile();
    if (filePath) {
      startLocalFileScan(filePath);
    }
  });
}

// URL scan click
if (btnMusicFinderScanUrl) {
  btnMusicFinderScanUrl.addEventListener('click', () => {
    if (isScanningMusic) return;
    const url = musicFinderUrlInput.value.trim();
    if (!url) return;
    
    startYoutubeUrlScan(url);
  });
}

// Clear click
if (btnMusicFinderClearResults) {
  btnMusicFinderClearResults.addEventListener('click', () => {
    resetMusicFinderUI();
  });
}

// Error screen buttons
if (btnMusicFinderErrorSettings) {
  btnMusicFinderErrorSettings.addEventListener('click', () => {
    const settingsBtn = document.querySelector('.nav-btn[data-tab="settings-tab"]');
    if (settingsBtn) {
      settingsBtn.click();
    }
    resetMusicFinderUI();
  });
}

if (btnMusicFinderErrorDismiss) {
  btnMusicFinderErrorDismiss.addEventListener('click', () => {
    resetMusicFinderUI();
  });
}

// Start local scan
export function startLocalFileScan(filePath) {
  isScanningMusic = true;
  
  showMusicFinderState('loading');
  if (musicFinderStepLog) musicFinderStepLog.innerHTML = '';
  
  appendScanLog(`Scanning local file: ${filePath}`);
  window.electronAPI.scanLocalFile(filePath);
}

// Start YouTube scan
export function startYoutubeUrlScan(url) {
  isScanningMusic = true;
  
  showMusicFinderState('loading');
  if (musicFinderStepLog) musicFinderStepLog.innerHTML = '';
  
  appendScanLog(`Processing YouTube URL: ${url}`);
  window.electronAPI.scanYoutubeUrl(url);
}

// IPC Listeners
window.electronAPI.onScanStatus((status) => {
  if (musicFinderStatusText) musicFinderStatusText.textContent = status;
  appendScanLog(status);
});

window.electronAPI.onScanProgress((progress) => {
  if (musicFinderProgressFill) musicFinderProgressFill.style.width = `${progress}%`;
  if (musicFinderProgressPercent) musicFinderProgressPercent.textContent = `${progress}%`;
});

window.electronAPI.onScanError((error) => {
  isScanningMusic = false;
  if (musicFinderErrorText) {
    musicFinderErrorText.textContent = error;
  }
  appendScanLog(`[ERROR] ${error}`);
  showMusicFinderState('error');
});

window.electronAPI.onScanComplete((results) => {
  isScanningMusic = false;
  renderScanResults(results);
});

// Render Results
export function renderScanResults(results) {
  showMusicFinderState('results');
  
  if (musicFinderResultsSummary) {
    musicFinderResultsSummary.textContent = `Identified ${results.length} unique track(s) inside this audio timeline.`;
  }
  
  if (!musicFinderTracklist) return;
  musicFinderTracklist.innerHTML = '';
  
  if (results.length === 0) {
    musicFinderTracklist.innerHTML = `
      <div style="color: hsl(var(--muted-foreground)); text-align: center; padding: 3rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>
        <span style="font-weight: 500;">No songs recognized</span>
        <span style="font-size: 0.75rem;">AcoustID database did not find matches for any of the generated fingerprints.</span>
      </div>
    `;
    return;
  }
  
  results.forEach(item => {
    const track = item.track;
    const trackItem = document.createElement('div');
    trackItem.className = 'track-item';
    trackItem.style.display = 'flex';
    trackItem.style.alignItems = 'center';
    trackItem.style.gap = '1rem';
    trackItem.style.padding = '0.75rem 1rem';
    trackItem.style.borderBottom = '1px solid hsl(var(--border) / 0.5)';
    trackItem.style.transition = 'background-color 0.15s ease';
    
    // Add hover behavior via JavaScript (inline class styles)
    trackItem.addEventListener('mouseenter', () => {
      trackItem.style.backgroundColor = 'hsl(var(--muted) / 0.3)';
    });
    trackItem.addEventListener('mouseleave', () => {
      trackItem.style.backgroundColor = 'transparent';
    });

    let imgHtml = '';
    if (track.coverUrl) {
      imgHtml = `<img src="${track.coverUrl}" alt="Cover" class="track-cover" style="width: 50px; height: 50px; border-radius: 4px; object-fit: cover; border: 1px solid hsl(var(--border));" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
    }
    
    const fallbackSvg = `
      <div class="track-cover-fallback" style="display: ${track.coverUrl ? 'none' : 'flex'}; width: 50px; height: 50px; border-radius: 4px; background-color: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); align-items: center; justify-content: center; border: 1px solid hsl(var(--border)); flex-shrink: 0;">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/><circle cx="12" cy="12" r="2"/></svg>
      </div>
    `;

    trackItem.innerHTML = `
      <div style="position: relative; width: 50px; height: 50px; flex-shrink: 0;">
        ${imgHtml}
        ${fallbackSvg}
      </div>
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;">
        <span style="font-weight: 600; font-size: 0.9rem; color: hsl(var(--foreground)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.title}</span>
        <span style="font-size: 0.775rem; color: hsl(var(--muted-foreground)); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.artist}</span>
        ${track.album ? `<span style="font-size: 0.725rem; color: hsl(var(--muted-foreground) / 0.8); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${track.album}</span>` : ''}
      </div>
      <div style="flex-shrink: 0; display: flex; align-items: center; gap: 8px;">
        <span class="badge" style="font-size: 0.7rem; font-family: monospace; letter-spacing: 0.02em; padding: 0.25rem 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">
          @ ${item.timestampStr}
        </span>
      </div>
    `;

    musicFinderTracklist.appendChild(trackItem);
  });
}
