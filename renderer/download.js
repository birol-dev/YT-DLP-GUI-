import { bindRecentThumbnailActions, extractVideoId, saveRecent } from './recents.js';
import { playSuccessChime } from './settings.js';
import { state } from './state.js';

export function resetDownloadProgressState() {
  state.downloadProgressState = {
    mode: 'single',
    currentItem: 1,
    totalItems: 1,
    itemPercent: 0,
    itemTitle: '',
    playlistTitle: ''
  };
}

export function resetActiveDownloadInfo() {
  state.activeDownloadInfo = {
    url: '',
    type: 'video',
    quality: '',
    badge: '',
    title: '',
    phase: '',
    speed: '',
    eta: '',
    size: '',
    percent: 0
  };
}

export function updateActiveDownloadBanner() {
  const badgeEl = document.getElementById('active-download-badge');
  const titleEl = document.getElementById('active-download-title');
  const thumbEl = document.getElementById('active-download-thumb');
  const iconEl = document.getElementById('active-download-icon');
  const statsEl = document.getElementById('active-download-stats');
  const phaseEl = document.getElementById('progress-status-text');

  if (badgeEl && state.activeDownloadInfo.badge) {
    badgeEl.textContent = state.activeDownloadInfo.badge;
  }
  if (titleEl && state.activeDownloadInfo.title) {
    titleEl.textContent = state.activeDownloadInfo.title;
  }

  // Thumbnail handling
  const videoId = extractVideoId(state.activeDownloadInfo.url || '');
  if (videoId && thumbEl && iconEl) {
    thumbEl.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    thumbEl.style.display = 'block';
    iconEl.style.display = 'none';
  } else if (thumbEl && iconEl) {
    thumbEl.style.display = 'none';
    iconEl.style.display = 'flex';
  }

  // Live Stats handling (Size, Speed, ETA)
  if (statsEl) {
    const statsParts = [];
    if (state.activeDownloadInfo.size) statsParts.push(state.activeDownloadInfo.size);
    if (state.activeDownloadInfo.speed) statsParts.push(state.activeDownloadInfo.speed);
    if (state.activeDownloadInfo.eta) statsParts.push(`ETA ${state.activeDownloadInfo.eta}`);

    if (statsParts.length > 0) {
      statsEl.textContent = statsParts.join(' • ');
      statsEl.style.display = 'inline-block';
    } else {
      statsEl.style.display = 'none';
    }
  }

  if (phaseEl && state.activeDownloadInfo.phase) {
    phaseEl.textContent = state.activeDownloadInfo.phase;
  }
}

export function isLikelyPlaylistUrl(url) {
  return /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
}

export async function beginMediaDownload({ url, type, quality, statusMsg }) {
  resetDownloadProgressState();
  resetActiveDownloadInfo();

  let initialStatus = statusMsg;
  let detectedTitle = '';

  if (isLikelyPlaylistUrl(url)) {
    try {
      const probe = await window.electronAPI.probePlaylist(url);
      if (probe.isPlaylist) {
        state.downloadProgressState.mode = 'playlist';
        state.downloadProgressState.totalItems = probe.playlistCount || 1;
        state.downloadProgressState.playlistTitle = probe.title || '';
        detectedTitle = probe.title || '';
        const countLabel = probe.playlistCount ? `${probe.playlistCount} items` : 'playlist';
        initialStatus = probe.title
          ? `Downloading playlist: ${probe.title} (${countLabel})`
          : `Downloading playlist (${countLabel})...`;
      }
    } catch {
      if (isLikelyPlaylistUrl(url)) {
        state.downloadProgressState.mode = 'playlist';
        initialStatus = 'Downloading playlist...';
      }
    }
  }

  const badge = type === 'video'
    ? `VIDEO • ${(quality ? quality + 'P ' : '') + (state.currentSettings.videoFormat || 'mp4').toUpperCase()}`
    : `AUDIO • ${(state.currentSettings.audioFormat || 'mp3').toUpperCase()}`;

  startDownloadIndicator(initialStatus, {
    preserveProgressState: true,
    url,
    type,
    quality,
    badge,
    title: detectedTitle || url
  });

  if (type === 'video') {
    window.electronAPI.downloadVideo({ url, quality });
  } else {
    window.electronAPI.downloadAudio({ url });
  }
}

let cachedProgressEls = null;

export function getProgressElements() {
  if (!cachedProgressEls) {
    cachedProgressEls = {
      fill: document.getElementById('progress-fill'),
      percentText: document.getElementById('progress-percent-text'),
      statusText: document.getElementById('progress-status-text'),
      substatusText: document.getElementById('progress-substatus-text'),
      dividerFill: document.getElementById('divider-progress-fill'),
      dividerPercentText: document.getElementById('divider-progress-percent-text'),
      dividerStatusText: document.getElementById('divider-progress-status-text')
    };
  }
  return cachedProgressEls;
}

let pendingProgressRaf = false;
let pendingProgressPercent = 0;
let pendingProgressIsDivider = false;

export function updateProgressUI(percentage, isDivider) {
  pendingProgressPercent = percentage;
  pendingProgressIsDivider = isDivider;

  if (!pendingProgressRaf) {
    pendingProgressRaf = true;
    requestAnimationFrame(() => {
      pendingProgressRaf = false;
      const els = getProgressElements();
      const isDiv = pendingProgressIsDivider;
      const pct = pendingProgressPercent;
      const fill = isDiv ? els.dividerFill : els.fill;
      const percentText = isDiv ? els.dividerPercentText : els.percentText;
      const statusText = isDiv ? els.dividerStatusText : els.statusText;
      const substatusText = els.substatusText;

      if (!fill || !percentText) return;

      fill.style.width = `${pct}%`;
      percentText.textContent = `${Math.round(pct)}%`;

      if (isDiv) {
        if (statusText) {
          statusText.textContent = pct === 100
            ? 'Processing and finalizing files...'
            : 'Downloading media...';
        }
        return;
      }

      if (!statusText) return;

      if (state.downloadProgressState.mode === 'playlist' && state.downloadProgressState.totalItems > 1) {
        const { currentItem, totalItems, itemPercent, itemTitle, playlistTitle } = state.downloadProgressState;
        statusText.textContent = `Downloading playlist (${currentItem}/${totalItems})`;
        if (substatusText) {
          substatusText.style.display = 'block';
          const titlePart = itemTitle || playlistTitle || 'Current item';
          substatusText.textContent = itemPercent >= 100
            ? `Item ${currentItem}: ${titlePart} — finalizing...`
            : `Item ${currentItem}: ${titlePart} — ${Math.round(itemPercent)}%`;
        }
        return;
      }

      if (substatusText) substatusText.style.display = 'none';

      if (pct === 100) {
        state.activeDownloadInfo.phase = 'Processing and finalizing files...';
        statusText.textContent = 'Processing and finalizing files...';
      } else if (!state.activeDownloadInfo.phase || state.activeDownloadInfo.phase.includes('Connecting')) {
        state.activeDownloadInfo.phase = 'Downloading media stream...';
        statusText.textContent = 'Downloading media stream...';
      }
    });
  }
}

export function parseDownloadProgressOutput(progress) {
  const itemMatch = progress.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i);
  if (itemMatch) {
    state.downloadProgressState.mode = 'playlist';
    state.downloadProgressState.currentItem = parseInt(itemMatch[1], 10);
    state.downloadProgressState.totalItems = parseInt(itemMatch[2], 10);
    state.downloadProgressState.itemPercent = 0;
  }

  const destMatch = progress.match(/(?:Destination|\[download\] Destination):\s*(.+)/i);
  if (destMatch) {
    const dest = destMatch[1].trim();
    const fileName = dest.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
    if (fileName) {
      state.downloadProgressState.itemTitle = fileName;
      state.activeDownloadInfo.title = fileName;
      updateActiveDownloadBanner();
    }
  }

  // Parse yt-dlp download stats: "[download]  45.2% of ~  85.40MiB at    4.25MiB/s ETA 00:11"
  const statsMatch = progress.match(/\[download\]\s+([0-9.]+)%(?:\s+of\s+~?\s*([0-9.]+\s*[A-Za-z]+))?(?:\s+at\s+([0-9.]+\s*[A-Za-z/]+))?(?:\s+ETA\s+([0-9:]+))?/i);
  if (statsMatch) {
    const percent = parseFloat(statsMatch[1]);
    const size = statsMatch[2] ? statsMatch[2].trim() : '';
    const speed = statsMatch[3] ? statsMatch[3].trim() : '';
    const eta = statsMatch[4] ? statsMatch[4].trim() : '';

    if (size) state.activeDownloadInfo.size = size;
    if (speed) state.activeDownloadInfo.speed = speed;
    if (eta) state.activeDownloadInfo.eta = eta;

    state.downloadProgressState.itemPercent = percent;
    state.activeDownloadInfo.percent = percent;

    if (percent < 100) {
      state.activeDownloadInfo.phase = 'Downloading media stream...';
    } else {
      state.activeDownloadInfo.phase = 'Processing and finalizing...';
    }

    updateActiveDownloadBanner();

    const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    const isDivider = currentTab === 'divider-tab';

    let displayPercent = percent;
    if (state.downloadProgressState.mode === 'playlist' && state.downloadProgressState.totalItems > 1) {
      const { currentItem, totalItems } = state.downloadProgressState;
      displayPercent = ((currentItem - 1) + percent / 100) / totalItems * 100;
    }

    updateProgressUI(displayPercent, isDivider);
    return;
  }

  if (progress.includes('[Merger]')) {
    state.activeDownloadInfo.phase = 'Merging video and audio streams...';
    updateActiveDownloadBanner();
  } else if (progress.includes('[ExtractAudio]')) {
    state.activeDownloadInfo.phase = 'Extracting audio track...';
    updateActiveDownloadBanner();
  } else if (progress.includes('[VideoConvertor]')) {
    state.activeDownloadInfo.phase = 'Converting video format...';
    updateActiveDownloadBanner();
  }
}

// Progress Bar Helper Routines
export function startDownloadIndicator(statusMsg, options = {}) {
  if (!options.preserveProgressState) {
    resetDownloadProgressState();
    resetActiveDownloadInfo();
  }
  state.isDownloading = true;

  if (options.url) state.activeDownloadInfo.url = options.url;
  if (options.type) state.activeDownloadInfo.type = options.type;
  if (options.badge) state.activeDownloadInfo.badge = options.badge;
  if (options.title) state.activeDownloadInfo.title = options.title;
  state.activeDownloadInfo.phase = statusMsg || 'Downloading media...';

  if (!state.activeDownloadInfo.title) {
    if (options.url) {
      const vid = extractVideoId(options.url);
      state.activeDownloadInfo.title = vid ? `YouTube (${vid})` : options.url;
    } else {
      state.activeDownloadInfo.title = statusMsg || 'Active Download';
    }
  }

  if (!state.activeDownloadInfo.badge) {
    const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (activeTab === 'audio-tab') state.activeDownloadInfo.badge = `AUDIO • ${(state.currentSettings.audioFormat || 'mp3').toUpperCase()}`;
    else if (activeTab === 'instagram-tab') state.activeDownloadInfo.badge = 'INSTAGRAM';
    else if (activeTab === 'subtitles-tab') state.activeDownloadInfo.badge = 'SUBTITLES';
    else if (activeTab === 'clipper-tab') state.activeDownloadInfo.badge = 'CLIP';
    else state.activeDownloadInfo.badge = `VIDEO • ${(state.currentSettings.videoFormat || 'mp4').toUpperCase()}`;
  }

  updateActiveDownloadBanner();

  const progressEl = document.getElementById('download-progress-container');
  const currentTab = document.querySelector('.nav-btn.active')?.dataset.tab;
  const substatusText = document.getElementById('progress-substatus-text');
  
  if (currentTab === 'divider-tab') {
    // Show inline divider progress
    const inlineStatus = document.getElementById('divider-inline-status-container');
    const progressBox = document.getElementById('divider-progress-box');
    const resultBox = document.getElementById('divider-result-box');
    const fill = document.getElementById('divider-progress-fill');
    const percentText = document.getElementById('divider-progress-percent-text');
    const statusText = document.getElementById('divider-progress-status-text');
    
    if (inlineStatus) inlineStatus.style.display = 'block';
    if (progressBox) progressBox.style.display = 'block';
    if (resultBox) resultBox.style.display = 'none';
    if (fill) fill.style.width = '0%';
    if (percentText) percentText.textContent = '0%';
    if (statusText) statusText.textContent = statusMsg;
    
    if (progressEl) progressEl.style.display = 'none';
  } else {
    if (progressEl) {
      progressEl.classList.add('active');
      if (currentTab !== 'settings-tab') {
        progressEl.style.display = 'block';
      }
      document.getElementById('progress-fill').style.width = '0%';
      document.getElementById('progress-percent-text').textContent = '0%';
      document.getElementById('progress-status-text').textContent = statusMsg;
      if (substatusText) {
        substatusText.style.display = state.downloadProgressState.mode === 'playlist' ? 'block' : 'none';
        substatusText.textContent = '';
      }
    }
  }
}

export function stopDownloadIndicator() {
  state.isDownloading = false;
  resetDownloadProgressState();
  resetActiveDownloadInfo();
  const progressEl = document.getElementById('download-progress-container');
  if (progressEl) {
    progressEl.classList.remove('active');
    progressEl.style.display = 'none';
  }
  
  const statsEl = document.getElementById('active-download-stats');
  if (statsEl) {
    statsEl.style.display = 'none';
    statsEl.textContent = '';
  }

  const progressBox = document.getElementById('divider-progress-box');
  if (progressBox) progressBox.style.display = 'none';

  const substatusText = document.getElementById('progress-substatus-text');
  if (substatusText) {
    substatusText.style.display = 'none';
    substatusText.textContent = '';
  }
}

// Helper to validate and highlight empty URL inputs with user feedback
export function validateUrlInput(inputEl, label = 'URL') {
  if (!inputEl) return '';
  const val = inputEl.value.trim();
  if (!val) {
    inputEl.classList.remove('input-error-shake');
    void inputEl.offsetWidth; // Force DOM reflow to restart animation
    inputEl.classList.add('input-error-shake');
    inputEl.focus();
    appendLog(`[⚠️ Warning] Please enter a valid ${label} before starting.`, 'log-warn');
    setTimeout(() => {
      inputEl.classList.remove('input-error-shake');
    }, 1200);
    return '';
  }
  return val;
}

// Active Download Cancel Button Handler
const btnCancelDownload = document.getElementById('btn-cancel-download');
if (btnCancelDownload) {
  btnCancelDownload.addEventListener('click', async () => {
    btnCancelDownload.disabled = true;
    appendLog('[Download Cancelled] Stopping active download...', 'log-warn');
    try {
      if (window.electronAPI && typeof window.electronAPI.cancelDownload === 'function') {
        await window.electronAPI.cancelDownload();
      }
    } catch (err) {
      console.error('Failed to cancel download:', err);
    } finally {
      stopDownloadIndicator();
      btnCancelDownload.disabled = false;
    }
  });
}

// Download Video
document.getElementById('btn-download-video').addEventListener('click', async () => {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const inputEl = document.getElementById('video-url');
  const url = validateUrlInput(inputEl, 'YouTube video URL');
  if (!url) return;

  const quality = document.getElementById('video-quality').value;
  hideDownloadCompleteCard('video');

  await beginMediaDownload({
    url,
    type: 'video',
    quality,
    statusMsg: 'Downloading video...'
  });
  inputEl.value = '';
});

// Download Audio
document.getElementById('btn-download-audio').addEventListener('click', async () => {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const inputEl = document.getElementById('audio-url');
  const url = validateUrlInput(inputEl, 'YouTube audio URL');
  if (!url) return;

  hideDownloadCompleteCard('audio');

  await beginMediaDownload({
    url,
    type: 'audio',
    statusMsg: 'Extracting audio...'
  });
  inputEl.value = '';
});

// Download Subtitles
document.getElementById('btn-download-subs').addEventListener('click', () => {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const inputEl = document.getElementById('subs-url');
  const url = validateUrlInput(inputEl, 'YouTube subtitles URL');
  if (!url) return;
  
  const lang = document.getElementById('subs-lang').value;
  hideDownloadCompleteCard('subtitles');

  startDownloadIndicator('Extracting subtitles...', {
    url,
    type: 'subtitles',
    badge: `SUBTITLES • ${(lang || 'EN').toUpperCase()}`,
    title: url
  });
  window.electronAPI.downloadSubtitles({ url, lang });
  inputEl.value = '';
});

// Download All Subtitles
document.getElementById('btn-download-all-subs').addEventListener('click', () => {
  if (state.isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const inputEl = document.getElementById('subs-url');
  const url = validateUrlInput(inputEl, 'YouTube subtitles URL');
  if (!url) return;
  
  hideDownloadCompleteCard('subtitles');

  startDownloadIndicator('Extracting all subtitles...', {
    url,
    type: 'subtitles',
    badge: 'SUBTITLES • ALL',
    title: url
  });
  window.electronAPI.downloadSubtitles({ url, lang: 'all' });
  inputEl.value = '';
});

// Download Instagram
const btnDownloadInstagram = document.getElementById('btn-download-instagram');
if (btnDownloadInstagram) {
  btnDownloadInstagram.addEventListener('click', () => {
    if (state.isDownloading) {
      alert('A download is already in progress. Please wait for the current download to finish!');
      appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
      return;
    }
    const inputEl = document.getElementById('instagram-url');
    const url = validateUrlInput(inputEl, 'Instagram URL');
    if (!url) return;
    
    const format = document.getElementById('instagram-format').value;
    hideDownloadCompleteCard('instagram');

    const label = format === 'audio' ? 'audio' : 'video';
    startDownloadIndicator(`Downloading Instagram ${label}...`, {
      url,
      type: 'instagram',
      badge: `INSTAGRAM • ${format.toUpperCase()}`,
      title: url
    });
    window.electronAPI.downloadInstagram({ url, format });
    inputEl.value = '';
  });
}

// Download Complete Component Controller
const downloadCompleteCards = {
  video: {
    card: document.getElementById('video-download-complete-card'),
    badge: document.getElementById('video-complete-badge'),
    dismiss: document.getElementById('btn-video-dismiss-complete'),
    thumbWrap: document.getElementById('video-complete-thumb-wrap'),
    thumb: document.getElementById('video-complete-thumb'),
    icon: document.getElementById('video-complete-icon'),
    title: document.getElementById('video-complete-title'),
    path: document.getElementById('video-complete-path'),
    openFolder: document.getElementById('btn-video-open-folder'),
    openFile: document.getElementById('btn-video-open-file'),
    copyPath: document.getElementById('btn-video-copy-path')
  },
  audio: {
    card: document.getElementById('audio-download-complete-card'),
    badge: document.getElementById('audio-complete-badge'),
    dismiss: document.getElementById('btn-audio-dismiss-complete'),
    thumbWrap: document.getElementById('audio-complete-thumb-wrap'),
    thumb: document.getElementById('audio-complete-thumb'),
    icon: document.getElementById('audio-complete-icon'),
    title: document.getElementById('audio-complete-title'),
    path: document.getElementById('audio-complete-path'),
    openFolder: document.getElementById('btn-audio-open-folder'),
    openFile: document.getElementById('btn-audio-open-file'),
    copyPath: document.getElementById('btn-audio-copy-path')
  },
  instagram: {
    card: document.getElementById('instagram-download-complete-card'),
    badge: document.getElementById('instagram-complete-badge'),
    dismiss: document.getElementById('btn-instagram-dismiss-complete'),
    thumbWrap: document.getElementById('instagram-complete-thumb-wrap'),
    thumb: document.getElementById('instagram-complete-thumb'),
    icon: document.getElementById('instagram-complete-icon'),
    title: document.getElementById('instagram-complete-title'),
    path: document.getElementById('instagram-complete-path'),
    openFolder: document.getElementById('btn-instagram-open-folder'),
    openFile: document.getElementById('btn-instagram-open-file'),
    copyPath: document.getElementById('btn-instagram-copy-path')
  },
  subtitles: {
    card: document.getElementById('subtitles-download-complete-card'),
    badge: document.getElementById('subtitles-complete-badge'),
    dismiss: document.getElementById('btn-subtitles-dismiss-complete'),
    thumbWrap: document.getElementById('subtitles-complete-thumb-wrap'),
    thumb: document.getElementById('subtitles-complete-thumb'),
    icon: document.getElementById('subtitles-complete-icon'),
    title: document.getElementById('subtitles-complete-title'),
    path: document.getElementById('subtitles-complete-path'),
    openFolder: document.getElementById('btn-subtitles-open-folder'),
    openFile: document.getElementById('btn-subtitles-open-file'),
    copyPath: document.getElementById('btn-subtitles-copy-path')
  },
  clipper: {
    card: document.getElementById('clipper-download-complete-card'),
    badge: document.getElementById('clipper-complete-badge'),
    dismiss: document.getElementById('btn-clipper-dismiss-complete'),
    thumbWrap: document.getElementById('clipper-complete-thumb-wrap'),
    thumb: document.getElementById('clipper-complete-thumb'),
    icon: document.getElementById('clipper-complete-icon'),
    title: document.getElementById('clipper-complete-title'),
    path: document.getElementById('clipper-complete-path'),
    openFolder: document.getElementById('btn-clipper-open-folder'),
    openFile: document.getElementById('btn-clipper-open-file'),
    copyPath: document.getElementById('btn-clipper-copy-path')
  }
};

export function hideDownloadCompleteCard(targetTab) {
  if (targetTab && downloadCompleteCards[targetTab] && downloadCompleteCards[targetTab].card) {
    downloadCompleteCards[targetTab].card.style.display = 'none';
  }
}

const COPY_PATH_COPIED_HTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="copy-path-copied-label">Copied!</span>
        `;

export function flashCopyPathButton(btn) {
  if (!btn) return;
  if (!btn.classList.contains('is-copied')) {
    btn.dataset.idleHtml = btn.innerHTML;
  }
  clearTimeout(btn._copiedTimer);
  btn.classList.add('is-copied');
  btn.innerHTML = COPY_PATH_COPIED_HTML;
  btn._copiedTimer = setTimeout(() => {
    btn.classList.remove('is-copied');
    if (btn.dataset.idleHtml) btn.innerHTML = btn.dataset.idleHtml;
    btn._copiedTimer = null;
  }, 2500);
}

export async function copyTextToClipboard(text) {
  try {
    if (window.electronAPI && typeof window.electronAPI.copyToClipboard === 'function') {
      const ok = await window.electronAPI.copyToClipboard(text);
      if (ok) return true;
    }
  } catch (e) {
    console.warn('Native copyToClipboard failed, trying navigator.clipboard:', e);
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.error('Failed to copy path via navigator.clipboard:', e);
    return false;
  }
}

export function showDownloadCompleteCard({ type, url, filePath, title }) {
  let targetKey = 'video';
  if (type === 'audio') targetKey = 'audio';
  else if (type === 'subtitles') targetKey = 'subtitles';
  else if (type === 'ig-video' || type === 'ig-audio' || type === 'instagram') targetKey = 'instagram';
  else if (type === 'clip' || type === 'clip-audio') targetKey = 'clipper';
  else {
    const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab;
    if (activeTab === 'audio-tab') targetKey = 'audio';
    else if (activeTab === 'instagram-tab') targetKey = 'instagram';
    else if (activeTab === 'subtitles-tab') targetKey = 'subtitles';
    else if (activeTab === 'clipper-tab') targetKey = 'clipper';
    else targetKey = 'video';
  }

  const elements = downloadCompleteCards[targetKey];
  if (!elements || !elements.card) return;

  // Extract clean filename or title
  let displayTitle = title;
  if (!displayTitle && filePath) {
    const parts = filePath.split(/[/\\]/);
    displayTitle = parts[parts.length - 1];
  }
  if (!displayTitle) {
    displayTitle = url || 'Downloaded Media';
  }

  // Extract thumbnail if YouTube URL or ID
  const videoId = extractVideoId(url || '');
  if (videoId && elements.thumb && elements.icon) {
    elements.thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    elements.thumb.style.display = 'block';
    elements.icon.style.display = 'none';
  } else if (elements.thumb && elements.icon) {
    elements.thumb.style.display = 'none';
    elements.icon.style.display = 'flex';
  }

  // Update Title and Path
  if (elements.title) elements.title.textContent = displayTitle;
  if (elements.path) {
    elements.path.textContent = filePath ? `Saved to: ${filePath}` : 'Saved to Downloads';
    elements.path.title = filePath || '';
  }

  // Update Badge
  if (elements.badge) {
    if (targetKey === 'video') {
      elements.badge.textContent = (state.currentSettings.videoFormat || 'mp4').toUpperCase();
    } else if (targetKey === 'audio') {
      elements.badge.textContent = (state.currentSettings.audioFormat || 'mp3').toUpperCase();
    } else if (targetKey === 'subtitles') {
      elements.badge.textContent = 'VTT / SRT';
    } else if (targetKey === 'instagram') {
      elements.badge.textContent = (type && type.includes('audio')) ? 'IG MP3' : 'IG MP4';
    } else if (targetKey === 'clipper') {
      elements.badge.textContent = (type && type.includes('audio')) ? 'CLIP MP3' : 'CLIP MP4';
    }
  }

  // Wire Open Folder button
  if (elements.openFolder) {
    elements.openFolder.onclick = () => {
      if (filePath) {
        window.electronAPI.openFolder(filePath);
      } else {
        window.electronAPI.openDownloadFolder(targetKey);
      }
    };
  }

  // Wire Open File button
  if (elements.openFile) {
    elements.openFile.onclick = () => {
      if (filePath && window.electronAPI.openFile) {
        window.electronAPI.openFile(filePath);
      } else if (filePath) {
        window.electronAPI.openFolder(filePath);
      }
    };
  }

  // Wire Copy Path button
  if (elements.copyPath) {
    elements.copyPath.onclick = () => {
      if (!filePath) return;
      flashCopyPathButton(elements.copyPath);
      copyTextToClipboard(filePath);
    };
  }

  // Wire Dismiss button
  if (elements.dismiss) {
    elements.dismiss.onclick = () => {
      elements.card.style.display = 'none';
    };
  }

  // Wire native file drag on thumb wrap
  if (elements.thumbWrap && filePath) {
    bindRecentThumbnailActions(elements.thumbWrap, filePath);
  }

  // Display card with animation
  elements.card.style.display = 'flex';
  try {
    elements.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {}
}

// Terminal Output
const terminal = document.getElementById('terminal-output');
const MAX_TERMINAL_LINES = 500;
let pendingTerminalScrollRaf = false;

export function appendLog(message, className = '') {
  if (!terminal) return;
  const div = document.createElement('div');
  div.textContent = message;
  if (className) div.classList.add(className);
  terminal.appendChild(div);

  while (terminal.childElementCount > MAX_TERMINAL_LINES) {
    terminal.removeChild(terminal.firstElementChild);
  }

  if (!pendingTerminalScrollRaf) {
    pendingTerminalScrollRaf = true;
    requestAnimationFrame(() => {
      terminal.scrollTop = terminal.scrollHeight;
      pendingTerminalScrollRaf = false;
    });
  }
}

window.electronAPI.onDownloadStatus((status) => {
  appendLog(status, 'log-info');
});

window.electronAPI.onDownloadProgress((progress) => {
  const lines = progress.split('\r');
  const text = lines[lines.length - 1].trim();
  if (text) appendLog(text);
  parseDownloadProgressOutput(progress);
});

window.electronAPI.onUpdateLog((log) => {
  if (log.toLowerCase().includes('error')) {
    appendLog(log, 'log-error');
  } else {
    appendLog(log, 'log-warn');
  }
});

window.electronAPI.onDownloadError((error) => {
  appendLog(error, 'log-error');
  stopDownloadIndicator();
  
  const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
  if (currentTab === 'divider-tab') {
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
            <div style="font-weight: 600;">Import/Download Failed</div>
            <div style="font-size: 0.75rem; opacity: 0.9; margin-top: 2px;">${error}</div>
          </div>
        </div>
      `;
    }
  }
});

window.electronAPI.onDownloadComplete((data) => {
  appendLog(`[✓] Download Complete: ${data.url} (${data.type})`, 'log-success');
  saveRecent(data.url, data.type, data.filePath);
  if (state.currentSettings.soundEnabled) {
    playSuccessChime();
  }
  stopDownloadIndicator();
  showDownloadCompleteCard(data);
});
