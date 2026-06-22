// Global State Tracking
let isDownloading = false;
let settingsCityData = null;

let downloadProgressState = {
  mode: 'single',
  currentItem: 1,
  totalItems: 1,
  itemPercent: 0,
  itemTitle: '',
  playlistTitle: ''
};

function resetDownloadProgressState() {
  downloadProgressState = {
    mode: 'single',
    currentItem: 1,
    totalItems: 1,
    itemPercent: 0,
    itemTitle: '',
    playlistTitle: ''
  };
}

function isLikelyPlaylistUrl(url) {
  return /[?&]list=/.test(url) || /youtube\.com\/playlist/i.test(url);
}

async function beginMediaDownload({ url, type, quality, statusMsg }) {
  resetDownloadProgressState();

  let initialStatus = statusMsg;
  if (isLikelyPlaylistUrl(url)) {
    try {
      const probe = await window.electronAPI.probePlaylist(url);
      if (probe.isPlaylist) {
        downloadProgressState.mode = 'playlist';
        downloadProgressState.totalItems = probe.playlistCount || 1;
        downloadProgressState.playlistTitle = probe.title || '';
        const countLabel = probe.playlistCount ? `${probe.playlistCount} items` : 'playlist';
        initialStatus = probe.title
          ? `Downloading playlist: ${probe.title} (${countLabel})`
          : `Downloading playlist (${countLabel})...`;
      }
    } catch {
      if (isLikelyPlaylistUrl(url)) {
        downloadProgressState.mode = 'playlist';
        initialStatus = 'Downloading playlist...';
      }
    }
  }

  startDownloadIndicator(initialStatus, { preserveProgressState: true });

  if (type === 'video') {
    window.electronAPI.downloadVideo({ url, quality });
  } else {
    window.electronAPI.downloadAudio({ url });
  }
}

function updateProgressUI(percentage, isDivider) {
  const fill = document.getElementById(isDivider ? 'divider-progress-fill' : 'progress-fill');
  const percentText = document.getElementById(isDivider ? 'divider-progress-percent-text' : 'progress-percent-text');
  const statusText = document.getElementById(isDivider ? 'divider-progress-status-text' : 'progress-status-text');
  const substatusText = document.getElementById('progress-substatus-text');

  if (!fill || !percentText) return;

  fill.style.width = `${percentage}%`;
  percentText.textContent = `${Math.round(percentage)}%`;

  if (isDivider) {
    if (statusText) {
      statusText.textContent = percentage === 100
        ? 'Processing and finalizing files...'
        : 'Downloading media...';
    }
    return;
  }

  if (!statusText) return;

  if (downloadProgressState.mode === 'playlist' && downloadProgressState.totalItems > 1) {
    const { currentItem, totalItems, itemPercent, itemTitle, playlistTitle } = downloadProgressState;
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

  if (percentage === 100) {
    statusText.textContent = 'Processing and finalizing files...';
  } else {
    statusText.textContent = 'Downloading media...';
  }
}

function parseDownloadProgressOutput(progress) {
  const itemMatch = progress.match(/Downloading item\s+(\d+)\s+of\s+(\d+)/i);
  if (itemMatch) {
    downloadProgressState.mode = 'playlist';
    downloadProgressState.currentItem = parseInt(itemMatch[1], 10);
    downloadProgressState.totalItems = parseInt(itemMatch[2], 10);
    downloadProgressState.itemPercent = 0;
  }

  const destMatch = progress.match(/Destination:\s*(.+)/);
  if (destMatch) {
    const dest = destMatch[1].trim();
    const fileName = dest.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
    if (fileName) downloadProgressState.itemTitle = fileName;
  }

  const percentMatch = progress.match(/\[download\]\s+([0-9.]+)%/);
  if (!percentMatch) return;

  const itemPercent = parseFloat(percentMatch[1]);
  downloadProgressState.itemPercent = itemPercent;

  const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
  const isDivider = currentTab === 'divider-tab';

  let displayPercent = itemPercent;
  if (downloadProgressState.mode === 'playlist' && downloadProgressState.totalItems > 1) {
    const { currentItem, totalItems } = downloadProgressState;
    displayPercent = ((currentItem - 1) + itemPercent / 100) / totalItems * 100;
  }

  updateProgressUI(displayPercent, isDivider);
}

// Tab switching logic
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

function updateTerminalVisibility(tabId) {
  const terminalEl = document.querySelector('.status-terminal');
  const progressEl = document.getElementById('download-progress-container');
  
  if (terminalEl) {
    if (tabId === 'settings-tab' || tabId === 'divider-tab' || tabId === 'musicfinder-tab' || tabId === 'browser-tab') {
      terminalEl.style.display = 'none';
      if (progressEl) progressEl.style.display = 'none';
    } else {
      terminalEl.style.display = 'flex';
      if (progressEl && progressEl.classList.contains('active')) {
        progressEl.style.display = 'block';
      }
    }
  }
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    
    // Pause video player if switching tabs
    const player = document.getElementById('clipper-video-player');
    if (player && typeof player.pause === 'function') {
      player.pause();
    }
    const dividerPlayer = document.getElementById('divider-video-player');
    if (dividerPlayer && typeof dividerPlayer.pause === 'function') {
      dividerPlayer.pause();
    }
    
    // Toggle terminal visibility
    updateTerminalVisibility(btn.dataset.tab);
    
    // Toggle browser view visibility
    if (btn.dataset.tab === 'browser-tab') {
      setTimeout(() => {
        const bounds = getPlaceholderBounds();
        window.electronAPI.browserViewInit(bounds);
      }, 50);
    } else {
      window.electronAPI.browserViewHide();
    }
  });
});

// Progress Bar Helper Routines
function startDownloadIndicator(statusMsg, options = {}) {
  if (!options.preserveProgressState) {
    resetDownloadProgressState();
  }
  isDownloading = true;
  const progressEl = document.getElementById('download-progress-container');
  const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
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
        substatusText.style.display = downloadProgressState.mode === 'playlist' ? 'block' : 'none';
        substatusText.textContent = '';
      }
    }
  }
}

function stopDownloadIndicator() {
  isDownloading = false;
  resetDownloadProgressState();
  const progressEl = document.getElementById('download-progress-container');
  if (progressEl) {
    progressEl.classList.remove('active');
    progressEl.style.display = 'none';
  }
  
  const progressBox = document.getElementById('divider-progress-box');
  if (progressBox) progressBox.style.display = 'none';

  const substatusText = document.getElementById('progress-substatus-text');
  if (substatusText) {
    substatusText.style.display = 'none';
    substatusText.textContent = '';
  }
}

// Download Video
document.getElementById('btn-download-video').addEventListener('click', async () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('video-url').value.trim();
  const quality = document.getElementById('video-quality').value;
  if (!url) return;

  await beginMediaDownload({
    url,
    type: 'video',
    quality,
    statusMsg: 'Downloading video...'
  });
  document.getElementById('video-url').value = '';
});

// Download Audio
document.getElementById('btn-download-audio').addEventListener('click', async () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('audio-url').value.trim();
  if (!url) return;

  await beginMediaDownload({
    url,
    type: 'audio',
    statusMsg: 'Extracting audio...'
  });
  document.getElementById('audio-url').value = '';
});

// Download Subtitles
document.getElementById('btn-download-subs').addEventListener('click', () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('subs-url').value;
  const lang = document.getElementById('subs-lang').value;
  if (!url) return;
  
  startDownloadIndicator('Extracting subtitles...');
  window.electronAPI.downloadSubtitles({ url, lang });
  document.getElementById('subs-url').value = '';
});

// Download All Subtitles
document.getElementById('btn-download-all-subs').addEventListener('click', () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('subs-url').value;
  if (!url) return;
  
  startDownloadIndicator('Extracting all subtitles...');
  window.electronAPI.downloadSubtitles({ url, lang: 'all' });
  document.getElementById('subs-url').value = '';
});

// Download Instagram
const btnDownloadInstagram = document.getElementById('btn-download-instagram');
if (btnDownloadInstagram) {
  btnDownloadInstagram.addEventListener('click', () => {
    if (isDownloading) {
      alert('A download is already in progress. Please wait for the current download to finish!');
      appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
      return;
    }
    const url = document.getElementById('instagram-url').value.trim();
    const format = document.getElementById('instagram-format').value;
    if (!url) return;
    
    const label = format === 'audio' ? 'audio' : 'video';
    startDownloadIndicator(`Downloading Instagram ${label}...`);
    window.electronAPI.downloadInstagram({ url, format });
    document.getElementById('instagram-url').value = '';
  });
}

// Terminal Output
const terminal = document.getElementById('terminal-output');

function appendLog(message, className = '') {
  const div = document.createElement('div');
  div.textContent = message;
  if (className) div.classList.add(className);
  terminal.appendChild(div);
  terminal.scrollTop = terminal.scrollHeight;
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
  if (currentSettings.soundEnabled) {
    playSuccessChime();
  }
  stopDownloadIndicator();


});

// Recents Logic
function getRecents() {
  const recents = localStorage.getItem('yt-recents');
  return recents ? JSON.parse(recents) : [];
}

function saveRecent(url, type, filePath) {
  const recents = getRecents();
  recents.unshift({ url, type, filePath, date: new Date().toLocaleString() });
  if (recents.length > 20) recents.pop();
  localStorage.setItem('yt-recents', JSON.stringify(recents));
  renderRecents();
}

function extractVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

function renderRecents() {
  const list = document.getElementById('recents-list');
  list.innerHTML = '';
  const recents = getRecents();
  
  if (recents.length === 0) {
    list.innerHTML = '<li style="color: var(--muted-foreground); text-align: center; padding: 2rem;">No recent downloads.</li>';
    return;
  }
  
  recents.forEach(item => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    
    const videoId = extractVideoId(item.url);
    const isInstagram = item.url.includes('instagram.com') || item.url.includes('instagr.am') || item.type.startsWith('ig-');
    
    const thumbTitle = 'Click to reveal file · Drag to import into Premiere Pro';
    let thumbnailHtml = '';
    if (videoId) {
      thumbnailHtml = `<img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail" class="recent-thumbnail" title="${thumbTitle}">`;
    } else if (isInstagram) {
      thumbnailHtml = `<div class="recent-thumbnail" style="background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); color: white; border: none;" title="${thumbTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
      </div>`;
    } else {
      thumbnailHtml = `<div class="recent-thumbnail" title="${thumbTitle}"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
    }
    
    li.innerHTML = `
      ${thumbnailHtml}
      <div class="recent-details">
        <button type="button" class="recent-url" title="${item.url}">${item.url}</button>
        <div class="recent-meta">
          <span class="badge">${item.type.toUpperCase()}</span>
          <span>${item.date}</span>
        </div>
      </div>
    `;

    const thumbEl = li.querySelector('.recent-thumbnail');
    if (thumbEl && item.filePath) {
      let didDrag = false;

      thumbEl.setAttribute('draggable', 'true');
      thumbEl.addEventListener('dragstart', (e) => {
        didDrag = true;
        e.preventDefault();
        window.electronAPI.startFileDrag(item.filePath);
      });
      thumbEl.addEventListener('dragend', () => {
        setTimeout(() => { didDrag = false; }, 0);
      });
      thumbEl.addEventListener('click', () => {
        if (didDrag) return;
        window.electronAPI.openFolder(item.filePath);
      });
    }

    const urlEl = li.querySelector('.recent-url');
    if (urlEl) {
      urlEl.addEventListener('click', () => {
        window.electronAPI.openExternalUrl(item.url);
      });
    }

    list.appendChild(li);
  });
}

// Initial render
renderRecents();

// Settings Variables and State
let currentSettings = {};
let selectedAccent = 'default';

// Success Sound Synthesizer
function playSuccessChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // First tone (C5)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); 
    gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    
    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.3);
    
    // Second tone (E5, delayed by 0.1s)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); 
    gain2.gain.setValueAtTime(0, audioCtx.currentTime);
    gain2.gain.setValueAtTime(0.08, audioCtx.currentTime + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    
    osc2.start(audioCtx.currentTime + 0.1);
    osc2.stop(audioCtx.currentTime + 0.5);
  } catch (err) {
    console.error('Failed to play success chime:', err);
  }
}

// Apply Theme
function applyTheme(accent) {
  document.documentElement.setAttribute('data-theme', accent || 'default');
}

// Theme Picker Interactions
document.querySelectorAll('.theme-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedAccent = btn.dataset.theme;
    
    // Instant live preview
    applyTheme(selectedAccent);
  });
});

// Select folder browser
document.getElementById('btn-select-dir').addEventListener('click', async () => {
  const dirPath = await window.electronAPI.selectFolder();
  if (dirPath) {
    document.getElementById('settings-save-dir').value = dirPath;
  }
});

// Reset folder browser to default
document.getElementById('btn-reset-dir').addEventListener('click', () => {
  document.getElementById('settings-save-dir').value = '';
});

// Save settings handler
document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const settingsCityInputVal = document.getElementById('settings-weather-city').value.trim();
  
  let lat = null;
  let lon = null;
  let city = '';
  
  if (settingsCityInputVal) {
    if (settingsCityData && settingsCityData.name === settingsCityInputVal) {
      city = settingsCityData.name;
      lat = settingsCityData.lat;
      lon = settingsCityData.lon;
    } else {
      // User typed something but didn't select from autocomplete list, or it's a different value
      if (settingsCityInputVal.length >= 2) {
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(settingsCityInputVal)}&count=1&language=en&format=json`);
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const firstCity = data.results[0];
            const region = firstCity.admin1 ? `, ${firstCity.admin1}` : '';
            const country = firstCity.country ? `, ${firstCity.country}` : '';
            city = `${firstCity.name}${region}${country}`;
            lat = firstCity.latitude;
            lon = firstCity.longitude;
            // Update settingsCityData to match the geocoded city
            settingsCityData = { name: city, lat, lon };
            // Update input value with fully formatted name
            document.getElementById('settings-weather-city').value = city;
          } else {
            // Geocoding returned no results, fallback to previous settings
            city = currentSettings.weatherCity || '';
            lat = currentSettings.weatherLat;
            lon = currentSettings.weatherLon;
          }
        } catch (e) {
          console.error('Failed to geocode settings location:', e);
          city = currentSettings.weatherCity || '';
          lat = currentSettings.weatherLat;
          lon = currentSettings.weatherLon;
        }
      } else {
        city = currentSettings.weatherCity || '';
        lat = currentSettings.weatherLat;
        lon = currentSettings.weatherLon;
      }
    }
  } else {
    // If input is cleared, set coordinates to null to trigger dynamic IP estimation
    settingsCityData = { name: '', lat: null, lon: null };
  }

  const newSettings = {
    downloadDir: document.getElementById('settings-save-dir').value,
    defaultQuality: document.getElementById('settings-default-quality').value,
    defaultSubLang: document.getElementById('settings-default-sublang').value,
    videoFormat: document.getElementById('settings-video-format').value,
    audioFormat: document.getElementById('settings-audio-format').value,
    accentColor: selectedAccent,
    soundEnabled: document.getElementById('settings-sound-enabled').checked,
    autoOpenFolder: document.getElementById('settings-auto-open').checked,
    userName: document.getElementById('settings-user-name').value.trim(),
    weatherCity: city,
    weatherLat: lat,
    weatherLon: lon,
    tempFormat: document.getElementById('settings-temp-format').value,
    musicFinderService: document.getElementById('settings-musicfinder-service').value,
    acoustidKey: document.getElementById('settings-acoustid-key').value.trim(),
    acrcloudKey: document.getElementById('settings-acrcloud-key').value.trim(),
    acrcloudSecret: document.getElementById('settings-acrcloud-secret').value.trim(),
    acrcloudHost: document.getElementById('settings-acrcloud-host').value.trim() || 'identify-us-west-2.acrcloud.com',
    acoustidScanInterval: parseInt(document.getElementById('settings-scan-interval').value, 10),
    cookiesFromBrowser: document.getElementById('settings-cookies-browser').value,
    cookiesBrowserProfile: document.getElementById('settings-cookies-profile').value.trim().replace(/^["']|["']$/g, '')
  };

  const success = await window.electronAPI.saveSettings(newSettings);
  if (success) {
    currentSettings = { ...currentSettings, ...newSettings };
    
    // Instantly update copywriting descriptions
    updateTabDescriptions(currentSettings);
    
    // Instantly update main panel options
    if (document.getElementById('video-quality')) {
      document.getElementById('video-quality').value = currentSettings.defaultQuality || '1080';
    }
    if (document.getElementById('subs-lang')) {
      document.getElementById('subs-lang').value = currentSettings.defaultSubLang || 'en';
    }

    // Instantly update dashboard greeting & weather
    initAppDashboard();

    // Display nice animated visual feedback
    const indicator = document.getElementById('settings-save-indicator');
    indicator.style.display = 'inline-flex';
    setTimeout(() => {
      indicator.style.display = 'none';
    }, 3000);
  }
});

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCookiesTestStatus(result, isLoading = false) {
  const statusEl = document.getElementById('cookies-test-status');
  const testBtn = document.getElementById('btn-test-cookies');
  if (!statusEl) return;

  statusEl.style.display = 'block';
  statusEl.className = 'cookies-test-status';

  if (isLoading) {
    statusEl.classList.add('testing');
    statusEl.innerHTML = `
      <div class="cookies-test-status-title">Testing cookies...</div>
      <div class="cookies-test-status-detail">Step 1: Reading browser cookie database. Step 2: Checking YouTube session. This may take up to a minute.</div>
    `;
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
    }
    return;
  }

  if (testBtn) {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Cookies';
  }

  if (!result) return;

  statusEl.classList.add(result.level || (result.ok ? 'success' : 'error'));

  let html = `<div class="cookies-test-status-title">${escapeHtml(result.message)}</div>`;
  if (result.detail) {
    html += `<div class="cookies-test-status-detail">${escapeHtml(result.detail)}</div>`;
  }
  if (result.tip) {
    html += `<div class="cookies-test-status-tip">${escapeHtml(result.tip)}</div>`;
  }
  statusEl.innerHTML = html;
}

function hideCookiesTestStatus() {
  const statusEl = document.getElementById('cookies-test-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.innerHTML = '';
    statusEl.className = 'cookies-test-status';
  }
}

const btnTestCookies = document.getElementById('btn-test-cookies');
if (btnTestCookies) {
  btnTestCookies.addEventListener('click', async () => {
    const browser = document.getElementById('settings-cookies-browser').value;
    const profile = document.getElementById('settings-cookies-profile').value.trim().replace(/^["']|["']$/g, '');
    const testUrl = document.getElementById('settings-cookies-test-url').value.trim();

    if (!browser) {
      renderCookiesTestStatus({
        ok: false,
        level: 'error',
        message: 'Select a browser before testing cookies.',
        tip: 'Choose Chrome, Edge, Firefox, or another supported browser from the dropdown.'
      });
      return;
    }

    renderCookiesTestStatus(null, true);

    try {
      const result = await window.electronAPI.testBrowserCookies({ browser, profile, testUrl });
      renderCookiesTestStatus(result);
    } catch (err) {
      renderCookiesTestStatus({
        ok: false,
        level: 'error',
        message: 'Cookie test could not be completed.',
        tip: err.message || 'Try again after closing the selected browser.'
      });
    }
  });
}

const cookiesBrowserSelect = document.getElementById('settings-cookies-browser');
if (cookiesBrowserSelect) {
  cookiesBrowserSelect.addEventListener('change', () => {
    if (!cookiesBrowserSelect.value) {
      hideCookiesTestStatus();
    }
  });
}

// Reset onboarding handler
const btnResetOnboarding = document.getElementById('btn-reset-onboarding');
if (btnResetOnboarding) {
  btnResetOnboarding.addEventListener('click', async () => {
    const confirmReset = confirm("Are you sure you want to reset the onboarding flow? This will reset your profile setup and allow you to recheck dependencies.");
    if (confirmReset) {
      const resetSettings = {
        onboardingComplete: false,
        firstRunComplete: false
      };
      const success = await window.electronAPI.saveSettings(resetSettings);
      if (success) {
        currentSettings = { ...currentSettings, ...resetSettings };
        alert("Onboarding has been reset! The application will now reload to start the setup wizard.");
        location.reload();
      } else {
        alert("Failed to reset onboarding settings.");
      }
    }
  });
}

// Dynamically update video/audio tab descriptions based on current format settings
function updateTabDescriptions(settings) {
  const videoFormat = settings.videoFormat || 'mp4';
  const audioFormat = settings.audioFormat || 'mp3';

  const videoDescEl = document.getElementById('video-card-desc');
  if (videoDescEl) {
    if (videoFormat === 'mp4') {
      videoDescEl.textContent = 'Downloads MP4 (H.264 / AAC) format specifically optimized for AE/PR compatibility.';
    } else if (videoFormat === 'mkv') {
      videoDescEl.textContent = 'Downloads MKV (Matroska) container optimized for best quality archiving.';
    } else if (videoFormat === 'webm') {
      videoDescEl.textContent = 'Downloads WebM (VP9/AV1 / Opus) format optimized for high efficiency web delivery.';
    }
  }

  const audioDescEl = document.getElementById('audio-card-desc');
  if (audioDescEl) {
    if (audioFormat === 'mp3') {
      audioDescEl.textContent = 'Extracts high-quality audio as MP3 (320kbps Level 0 VBR).';
    } else if (audioFormat === 'm4a') {
      audioDescEl.textContent = 'Extracts highly efficient web-standard audio as M4A (AAC codec).';
    } else if (audioFormat === 'wav') {
      audioDescEl.textContent = 'Extracts uncompressed studio-grade lossless audio as WAV (24-bit PCM).';
    } else if (audioFormat === 'flac') {
      audioDescEl.textContent = 'Extracts high-fidelity compressed lossless audio as FLAC.';
    }
  }
}

// Listen for format changes in settings to update the panel descriptions in real-time
document.getElementById('settings-video-format').addEventListener('change', (e) => {
  updateTabDescriptions({
    videoFormat: e.target.value,
    audioFormat: document.getElementById('settings-audio-format').value
  });
});

document.getElementById('settings-audio-format').addEventListener('change', (e) => {
  updateTabDescriptions({
    videoFormat: document.getElementById('settings-video-format').value,
    audioFormat: e.target.value
  });
});


// Load settings on startup
async function initSettingsUI() {
  try {
    currentSettings = await window.electronAPI.getSettings();
    selectedAccent = currentSettings.accentColor || 'default';
    
    applyTheme(selectedAccent);
    
    document.getElementById('settings-save-dir').value = currentSettings.downloadDir || '';
    document.getElementById('settings-default-quality').value = currentSettings.defaultQuality || '1080';
    document.getElementById('settings-default-sublang').value = currentSettings.defaultSubLang || 'en';
    document.getElementById('settings-video-format').value = currentSettings.videoFormat || 'mp4';
    document.getElementById('settings-audio-format').value = currentSettings.audioFormat || 'mp3';
    document.getElementById('settings-sound-enabled').checked = !!currentSettings.soundEnabled;
    document.getElementById('settings-auto-open').checked = !!currentSettings.autoOpenFolder;
    document.getElementById('settings-cookies-browser').value = currentSettings.cookiesFromBrowser || '';
    document.getElementById('settings-cookies-profile').value = currentSettings.cookiesBrowserProfile || '';
    const mfService = currentSettings.musicFinderService || 'acoustid';
    document.getElementById('settings-musicfinder-service').value = mfService;
    
    const mfServiceSelector = document.getElementById('musicfinder-service-selector');
    if (mfServiceSelector) {
      mfServiceSelector.value = mfService;
    }
    
    document.getElementById('settings-acoustid-key').value = currentSettings.acoustidKey || '';
    document.getElementById('settings-acrcloud-key').value = currentSettings.acrcloudKey || '';
    document.getElementById('settings-acrcloud-secret').value = currentSettings.acrcloudSecret || '';
    document.getElementById('settings-acrcloud-host').value = currentSettings.acrcloudHost || 'identify-us-west-2.acrcloud.com';
    
    toggleCredentialsContainers(mfService);

    const scanInterval = currentSettings.acoustidScanInterval || 90;
    document.getElementById('settings-scan-interval').value = scanInterval;
    document.getElementById('label-scan-interval-val').textContent = `${scanInterval}s`;
    const mfScanInterval = document.getElementById('musicfinder-scan-interval');
    if (mfScanInterval) {
      mfScanInterval.value = scanInterval;
      const mfScanIntervalLabel = document.getElementById('label-musicfinder-scan-interval-val');
      if (mfScanIntervalLabel) mfScanIntervalLabel.textContent = `${scanInterval}s`;
    }
    
    // Populate user profile settings inputs
    document.getElementById('settings-user-name').value = currentSettings.userName || '';
    document.getElementById('settings-weather-city').value = currentSettings.weatherCity || '';
    document.getElementById('settings-temp-format').value = currentSettings.tempFormat || 'fahrenheit';
    settingsCityData = {
      name: currentSettings.weatherCity || '',
      lat: currentSettings.weatherLat,
      lon: currentSettings.weatherLon
    };
    
    // Instantly update copywriting descriptions based on loaded settings
    updateTabDescriptions(currentSettings);
    
    document.querySelectorAll('.theme-option').forEach(btn => {
      if (btn.dataset.theme === selectedAccent) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Populate main panel dropdowns on startup
    if (document.getElementById('video-quality')) {
      document.getElementById('video-quality').value = currentSettings.defaultQuality || '1080';
    }
    if (document.getElementById('subs-lang')) {
      document.getElementById('subs-lang').value = currentSettings.defaultSubLang || 'en';
    }

    // Check if onboarding is complete
    if (!currentSettings.onboardingComplete) {
      showOnboardingFlow();
    } else {
      initAppDashboard();
    }
  } catch (err) {
    console.error('Failed to init settings UI:', err);
  }
}

// Run settings loader
initSettingsUI();

// Open Video / Audio save location buttons in Recents
const openVideoDirBtn = document.getElementById('btn-open-video-dir');
const openAudioDirBtn = document.getElementById('btn-open-audio-dir');

if (openVideoDirBtn) {
  openVideoDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('video');
  });
}

if (openAudioDirBtn) {
  openAudioDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('audio');
  });
}

const openInstagramDirBtn = document.getElementById('btn-open-instagram-dir');
if (openInstagramDirBtn) {
  openInstagramDirBtn.addEventListener('click', () => {
    window.electronAPI.openDownloadFolder('instagram');
  });
}

// Drag-to-Resize Status Terminal
const terminalResizer = document.getElementById('terminal-resizer');
const statusTerminalEl = document.querySelector('.status-terminal');

if (terminalResizer && statusTerminalEl) {
  terminalResizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.addEventListener('mousemove', handleTerminalResize);
    document.addEventListener('mouseup', stopTerminalResize);
    statusTerminalEl.classList.add('resizing');
  });

  function handleTerminalResize(e) {
    const rect = statusTerminalEl.getBoundingClientRect();
    // Calculate new height from cursor position to bottom of the element
    const newHeight = rect.bottom - e.clientY;
    
    // Enforce min/max height limits for usability
    if (newHeight >= 100 && newHeight <= 450) {
      statusTerminalEl.style.height = `${newHeight}px`;
    }
  }

  function stopTerminalResize() {
    document.removeEventListener('mousemove', handleTerminalResize);
    document.removeEventListener('mouseup', stopTerminalResize);
    statusTerminalEl.classList.remove('resizing');
  }
}

// Dependency installer IPC listener
const depModal = document.getElementById('dependency-modal');
const depValYt = document.getElementById('dep-val-yt');
const depValFfmpeg = document.getElementById('dep-val-ffmpeg');
const depValFpcalc = document.getElementById('dep-val-fpcalc');
const depStatusYt = document.getElementById('dep-status-yt');
const depStatusFfmpeg = document.getElementById('dep-status-ffmpeg');
const depStatusFpcalc = document.getElementById('dep-status-fpcalc');
const depProgressContainer = document.getElementById('dependency-progress-container');
const depProgressText = document.getElementById('dep-progress-text');
const depProgressPercent = document.getElementById('dep-progress-percent');
const depProgressFill = document.getElementById('dep-progress-fill');

const btnDepContinue = document.getElementById('btn-dep-continue');
if (btnDepContinue) {
  btnDepContinue.addEventListener('click', () => {
    window.electronAPI.continueAnyway();
    if (depModal) {
      depModal.classList.remove('active');
    }
  });
}

if (depModal) {
  window.electronAPI.onDependencyStatus((data) => {
    const onboardingModal = document.getElementById('onboarding-modal');
    const isOnboardingActive = onboardingModal && onboardingModal.classList.contains('active');
    
    if (isOnboardingActive) {
      if (typeof updateOnboardingDependencyStatus === 'function') {
        updateOnboardingDependencyStatus(data);
      }
      return;
    }

    switch (data.type) {
      case 'checking':
        depModal.classList.add('active');
        if (depValYt) depValYt.textContent = 'Verifying...';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Verifying...';
        if (depValFpcalc) depValFpcalc.textContent = 'Verifying...';
        break;

      case 'init':
        depModal.classList.add('active');
        
        // Update states based on what needs download
        if (data.needYtDlp) {
          if (depStatusYt) {
            depStatusYt.className = 'dependency-status-item downloading';
          }
          if (depValYt) depValYt.textContent = 'Awaiting download...';
        } else {
          if (depStatusYt) {
            depStatusYt.className = 'dependency-status-item completed';
          }
          if (depValYt) depValYt.textContent = 'Ready';
        }

        if (data.needFfmpeg) {
          if (depStatusFfmpeg) {
            depStatusFfmpeg.className = 'dependency-status-item downloading';
          }
          if (depValFfmpeg) depValFfmpeg.textContent = 'Awaiting download...';
        } else {
          if (depStatusFfmpeg) {
            depStatusFfmpeg.className = 'dependency-status-item completed';
          }
          if (depValFfmpeg) depValFfmpeg.textContent = 'Ready';
        }

        if (data.needFpcalc) {
          if (depStatusFpcalc) {
            depStatusFpcalc.className = 'dependency-status-item downloading';
          }
          if (depValFpcalc) depValFpcalc.textContent = 'Awaiting download...';
        } else {
          if (depStatusFpcalc) {
            depStatusFpcalc.className = 'dependency-status-item completed';
          }
          if (depValFpcalc) depValFpcalc.textContent = 'Ready';
        }
        break;

      case 'download-start':
        depModal.classList.add('active');
        if (depProgressContainer) depProgressContainer.style.display = 'block';
        if (depProgressFill) depProgressFill.style.width = '0%';
        if (depProgressPercent) depProgressPercent.textContent = '0%';
        
        if (data.item === 'yt-dlp') {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
          if (depValYt) depValYt.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading yt-dlp core...';
        } else if (data.item === 'ffmpeg') {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading FFmpeg utilities...';
        } else if (data.item === 'fpcalc') {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
          if (depValFpcalc) depValFpcalc.textContent = 'Downloading (0%)...';
          if (depProgressText) depProgressText.textContent = 'Downloading AcoustID fpcalc...';
        }
        break;

      case 'progress':
        if (depProgressFill) depProgressFill.style.width = `${data.progress}%`;
        if (depProgressPercent) depProgressPercent.textContent = `${data.progress}%`;
        
        if (data.item === 'yt-dlp') {
          if (depValYt) depValYt.textContent = `Downloading (${data.progress}%)...`;
        } else if (data.item === 'ffmpeg') {
          if (depValFfmpeg) depValFfmpeg.textContent = `Downloading (${data.progress}%)...`;
        } else if (data.item === 'fpcalc') {
          if (depValFpcalc) depValFpcalc.textContent = `Downloading (${data.progress}%)...`;
        }
        break;

      case 'extracting':
        if (depProgressFill) depProgressFill.style.width = '100%';
        if (depProgressPercent) depProgressPercent.textContent = '100%';
        if (data.item === 'fpcalc') {
          if (depProgressText) depProgressText.textContent = 'Extracting fpcalc binaries...';
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item extracting';
          if (depValFpcalc) depValFpcalc.textContent = 'Extracting...';
        } else {
          if (depProgressText) depProgressText.textContent = 'Extracting FFmpeg binaries...';
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item extracting';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Extracting...';
        }
        break;

      case 'download-complete':
        if (data.item === 'yt-dlp') {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
          if (depValYt) depValYt.textContent = 'Completed';
        } else if (data.item === 'ffmpeg') {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Completed';
        } else if (data.item === 'fpcalc') {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
          if (depValFpcalc) depValFpcalc.textContent = 'Completed';
        }
        break;

      case 'all-ready':
        if (depProgressText) depProgressText.textContent = 'Dependencies loaded. Launching...';
        if (depProgressFill) depProgressFill.style.width = '100%';
        if (depProgressPercent) depProgressPercent.textContent = '100%';
        
        // Final transition: remove active class to fade out the modal
        setTimeout(() => {
          depModal.classList.remove('active');
          if (depProgressContainer) depProgressContainer.style.display = 'none';
        }, 1200);
        break;

      case 'error':
        if (depProgressText) depProgressText.textContent = 'Setup Error!';
        if (depProgressPercent) depProgressPercent.textContent = 'Fail';
        
        if (depStatusYt && depStatusYt.classList.contains('downloading')) {
          depStatusYt.className = 'dependency-status-item error';
          if (depValYt) depValYt.textContent = 'Download failed';
        }
        if (depStatusFfmpeg && depStatusFfmpeg.classList.contains('downloading')) {
          depStatusFfmpeg.className = 'dependency-status-item error';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Download failed';
        }
        if (depStatusFpcalc && depStatusFpcalc.classList.contains('downloading')) {
          depStatusFpcalc.className = 'dependency-status-item error';
          if (depValFpcalc) depValFpcalc.textContent = 'Download failed';
        }
        
        alert(`Failed to configure dependencies:\n${data.message}\n\nPlease check your internet connection or install them manually.`);
        break;
    }
  });
}

// Video Clipper State
let clipperDuration = 0;
let clipperStartVal = 0;
let clipperEndVal = 0;
let isPreviewingClip = false;

// Time formatting helpers
function secondsToHHMMSS(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function hhmmssToSeconds(str) {
  const parts = str.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  } else if (parts.length === 1) {
    seconds += parseFloat(parts[0]);
  }
  return isNaN(seconds) ? 0 : seconds;
}

// Elements
const clipperUrlInput = document.getElementById('clipper-url');
const clipperLoadBtn = document.getElementById('btn-clipper-load');
const clipperLoading = document.getElementById('clipper-loading');
const clipperWorkspace = document.getElementById('clipper-workspace');
const clipperThumbnail = document.getElementById('clipper-video-thumbnail');
const clipperTitle = document.getElementById('clipper-video-title');
const clipperDurationBadge = document.getElementById('clipper-video-duration-badge');
const clipperPlayer = document.getElementById('clipper-video-player');
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

function seekVideoPlayer(time) {
  if (!clipperPlayer || clipperPlayer.style.display === 'none') return;
  if (!clipperPlayer.seeking) {
    clipperPlayer.currentTime = time;
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
      lastTargetSeekTime = null;
    }
  });
}

// Update custom range bar UI
function updateClipperSliderUI() {
  if (clipperDuration > 0) {
    const startPct = (clipperStartVal / clipperDuration) * 100;
    const endPct = (clipperEndVal / clipperDuration) * 100;
    const widthPct = Math.max(0, endPct - startPct);
    
    clipperSliderRange.style.left = `${startPct}%`;
    clipperSliderRange.style.width = `${widthPct}%`;
    
    if (handleStart) handleStart.style.left = `${startPct}%`;
    if (handleEnd) handleEnd.style.left = `${endPct}%`;
  }
}

// Dragging start/end handles
function handleMouseDown(type) {
  return function(e) {
    e.preventDefault();
    e.stopPropagation();
    activeDragHandle = type;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
}

if (handleStart) handleStart.addEventListener('mousedown', handleMouseDown('start'));
if (handleEnd) handleEnd.addEventListener('mousedown', handleMouseDown('end'));

function handleMouseMove(e) {
  if (!activeDragHandle || clipperDuration <= 0) return;
  
  const rect = clipperSliderWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  const timeVal = pct * clipperDuration;
  
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
}

function handleMouseUp() {
  activeDragHandle = null;
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
}

// Load Video Info Handler
if (clipperLoadBtn) {
  clipperLoadBtn.addEventListener('click', async () => {
    const url = clipperUrlInput.value.trim();
    if (!url) return;
    
    clipperLoadBtn.disabled = true;
    clipperLoading.style.display = 'block';
    clipperWorkspace.style.display = 'none';
    clipperPlayerError.style.display = 'none';
    clipperPlayer.style.display = 'block';
    
    // Pause existing preview
    clipperPlayer.pause();
    
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
          clipperPlayer.src = res.streamUrl;
          clipperPlayer.load();
        } else {
          clipperPlayer.style.display = 'none';
          clipperPlayerError.style.display = 'flex';
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
  });
  
  // Track playhead and preview duration boundaries
  clipperPlayer.addEventListener('timeupdate', () => {
    if (clipperDuration > 0) {
      const pct = (clipperPlayer.currentTime / clipperDuration) * 100;
      clipperSliderPlayhead.style.left = `${pct}%`;
      clipperLabelCurrent.textContent = secondsToHHMMSS(clipperPlayer.currentTime);
      
      if (isPreviewingClip) {
        if (clipperPlayer.currentTime >= clipperEndVal) {
          clipperPlayer.pause();
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
    }
  });
}

if (btnClipperGoEnd) {
  btnClipperGoEnd.addEventListener('click', () => {
    if (clipperPlayer && clipperPlayer.style.display !== 'none') {
      clipperPlayer.currentTime = clipperEndVal;
    }
  });
}

// Preview Range Clip Playback
if (btnClipperPreview) {
  btnClipperPreview.addEventListener('click', () => {
    if (clipperPlayer && clipperPlayer.style.display !== 'none') {
      if (isPreviewingClip && !clipperPlayer.paused) {
        clipperPlayer.pause();
        isPreviewingClip = false;
        btnClipperPreview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Preview Clip
        `;
      } else {
        clipperPlayer.currentTime = clipperStartVal;
        isPreviewingClip = true;
        clipperPlayer.play();
        btnClipperPreview.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="play-icon"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
          Pause Preview
        `;
      }
    }
  });
}

// Start Clipper Download Helpers
function startClipperDownload(format) {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  
  const url = clipperUrlInput.value.trim();
  const quality = document.getElementById('clipper-quality').value;
  
  if (!url) return;
  
  const startStr = secondsToHHMMSS(clipperStartVal);
  const endStr = secondsToHHMMSS(clipperEndVal);
  
  if (clipperPlayer && typeof clipperPlayer.pause === 'function') {
    clipperPlayer.pause();
  }


  
  startDownloadIndicator(`Downloading clip as ${format} (${startStr} - ${endStr})...`);
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

// Reusable formatting helpers that support milliseconds
function secondsToHHMMSSWithMs(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00.000';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds);
  const ms = Math.floor((totalSeconds % 1) * 1000);
  const hmsStr = [h, m % 60, s % 60].map(v => v.toString().padStart(2, '0')).join(':');
  const msStr = ms.toString().padStart(3, '0');
  return `${hmsStr}.${msStr}`;
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '--';
  if (bytes < 1024) return bytes + ' Bytes';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function getAspectRatioStr(width, height) {
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

function hhmmssToSecondsWithMs(str) {
  if (!str) return 0;
  const mainParts = str.split('.');
  const timeStr = mainParts[0];
  const msStr = mainParts[1] || '0';
  
  const parts = timeStr.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseInt(parts[2], 10);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseInt(parts[1], 10);
  } else if (parts.length === 1) {
    seconds += parseInt(parts[0], 10);
  }
  
  const ms = parseInt(msStr.padEnd(3, '0').slice(0, 3), 10) / 1000;
  return seconds + ms;
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
    
    if (isDownloading) {
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
async function loadDividerSource(filePath) {
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
function updateDividerSliderUI() {
  if (dividerDuration > 0) {
    const startPct = (dividerStartVal / dividerDuration) * 100;
    const endPct = (dividerEndVal / dividerDuration) * 100;
    const widthPct = Math.max(0, endPct - startPct);
    
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

function seekDividerVideoPlayer(time) {
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

function handleDividerMouseDown(type) {
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

function handleDividerMouseMove(e) {
  if (!activeDividerDragHandle || dividerDuration <= 0) return;
  
  const rect = dividerSliderWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  const timeVal = pct * dividerDuration;
  
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

function handleDividerMouseUp() {
  activeDividerDragHandle = null;
  document.removeEventListener('mousemove', handleDividerMouseMove);
  document.removeEventListener('mouseup', handleDividerMouseUp);
}

// Click and drag timeline track to seek and scrub
function handlePlayheadScrub(e) {
  if (dividerDuration <= 0 || !dividerSliderWrapper) return;
  const rect = dividerSliderWrapper.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  const timeVal = pct * dividerDuration;
  
  seekDividerVideoPlayer(timeVal);
  
  dividerSliderPlayhead.style.left = `${pct * 100}%`;
  dividerLabelCurrent.textContent = secondsToHHMMSSWithMs(timeVal);
}

function handlePlayheadMouseMove(e) {
  if (isScrubbingPlayhead) {
    handlePlayheadScrub(e);
  }
}

function handlePlayheadMouseUp() {
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
function updateChunksCountPreview() {
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
    if (isDownloading) {
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
  
  if (currentSettings.soundEnabled) {
    playSuccessChime();
  }
  
  dividerOutputFolder = data.outputDir;
  btnDividerOpenFolder.style.display = 'inline-flex';
  
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
          <div style="font-weight: 600;">Video Divided Successfully!</div>
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

// ==========================================
// Weather, Greetings & Onboarding Extension
// ==========================================

let onboardingCityData = null;

// Reusable City Search Autocomplete helper
function setupCityAutocomplete(inputEl, resultsEl, onSelectCallback) {
  let debounceTimer;
  
  inputEl.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    const query = e.target.value.trim();
    
    if (query.length < 2) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
      return;
    }
    
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`);
        const data = await res.json();
        
        resultsEl.innerHTML = '';
        if (data.results && data.results.length > 0) {
          data.results.forEach(city => {
            const li = document.createElement('li');
            const region = city.admin1 ? `, ${city.admin1}` : '';
            const country = city.country ? `, ${city.country}` : '';
            const displayName = `${city.name}${region}${country}`;
            
            li.textContent = displayName;
            li.addEventListener('click', () => {
              inputEl.value = displayName;
              resultsEl.innerHTML = '';
              resultsEl.style.display = 'none';
              onSelectCallback({
                name: displayName,
                lat: city.latitude,
                lon: city.longitude
              });
            });
            resultsEl.appendChild(li);
          });
          resultsEl.style.display = 'block';
        } else {
          const li = document.createElement('li');
          li.className = 'no-results';
          li.textContent = 'No cities found';
          resultsEl.appendChild(li);
          resultsEl.style.display = 'block';
        }
      } catch (err) {
        console.error('Geocoding search failed:', err);
      }
    }, 300);
  });
  
  // Close results list on click outside
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && e.target !== resultsEl) {
      resultsEl.innerHTML = '';
      resultsEl.style.display = 'none';
    }
  });
}

let onboardingDataCollected = {};
let hasMissingDependencies = false;

function updateOnboardingDependencyStatus(data) {
  const depStatusYt = document.getElementById('onboarding-dep-status-yt');
  const depStatusFfmpeg = document.getElementById('onboarding-dep-status-ffmpeg');
  const depStatusFpcalc = document.getElementById('onboarding-dep-status-fpcalc');
  
  const depValYt = document.getElementById('onboarding-dep-val-yt');
  const depValFfmpeg = document.getElementById('onboarding-dep-val-ffmpeg');
  const depValFpcalc = document.getElementById('onboarding-dep-val-fpcalc');
  
  const depProgressContainer = document.getElementById('onboarding-dep-progress-container');
  const depProgressText = document.getElementById('onboarding-dep-progress-text');
  const depProgressPercent = document.getElementById('onboarding-dep-progress-percent');
  const depProgressFill = document.getElementById('onboarding-dep-progress-fill');
  
  switch (data.type) {
    case 'checking':
      if (depValYt) depValYt.textContent = 'Verifying...';
      if (depValFfmpeg) depValFfmpeg.textContent = 'Verifying...';
      if (depValFpcalc) depValFpcalc.textContent = 'Verifying...';
      break;

    case 'init':
      if (data.needYtDlp) {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
        if (depValYt) depValYt.textContent = 'Awaiting download...';
      } else {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
        if (depValYt) depValYt.textContent = 'Ready';
      }

      if (data.needFfmpeg) {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Awaiting download...';
      } else {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Ready';
      }

      if (data.needFpcalc) {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
        if (depValFpcalc) depValFpcalc.textContent = 'Awaiting download...';
      } else {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
        if (depValFpcalc) depValFpcalc.textContent = 'Ready';
      }
      break;

    case 'download-start':
      if (depProgressContainer) depProgressContainer.style.display = 'block';
      if (depProgressFill) depProgressFill.style.width = '0%';
      if (depProgressPercent) depProgressPercent.textContent = '0%';
      
      if (data.item === 'yt-dlp') {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
        if (depValYt) depValYt.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading yt-dlp core...';
      } else if (data.item === 'ffmpeg') {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading FFmpeg utilities...';
      } else if (data.item === 'fpcalc') {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
        if (depValFpcalc) depValFpcalc.textContent = 'Downloading (0%)...';
        if (depProgressText) depProgressText.textContent = 'Downloading AcoustID fpcalc...';
      }
      break;

    case 'progress':
      if (depProgressFill) depProgressFill.style.width = `${data.progress}%`;
      if (depProgressPercent) depProgressPercent.textContent = `${data.progress}%`;
      
      if (data.item === 'yt-dlp') {
        if (depValYt) depValYt.textContent = `Downloading (${data.progress}%)...`;
      } else if (data.item === 'ffmpeg') {
        if (depValFfmpeg) depValFfmpeg.textContent = `Downloading (${data.progress}%)...`;
      } else if (data.item === 'fpcalc') {
        if (depValFpcalc) depValFpcalc.textContent = `Downloading (${data.progress}%)...`;
      }
      break;

    case 'extracting':
      if (depProgressFill) depProgressFill.style.width = '100%';
      if (depProgressPercent) depProgressPercent.textContent = '100%';
      if (data.item === 'fpcalc') {
        if (depProgressText) depProgressText.textContent = 'Extracting fpcalc...';
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item extracting';
        if (depValFpcalc) depValFpcalc.textContent = 'Extracting...';
      } else {
        if (depProgressText) depProgressText.textContent = 'Extracting FFmpeg...';
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item extracting';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Extracting...';
      }
      break;

    case 'download-complete':
      if (data.item === 'yt-dlp') {
        if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
        if (depValYt) depValYt.textContent = 'Completed';
      } else if (data.item === 'ffmpeg') {
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Completed';
      } else if (data.item === 'fpcalc') {
        if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
        if (depValFpcalc) depValFpcalc.textContent = 'Completed';
      }
      break;

    case 'all-ready':
      if (depProgressText) depProgressText.textContent = 'Dependencies loaded. Launching...';
      if (depProgressFill) depProgressFill.style.width = '100%';
      if (depProgressPercent) depProgressPercent.textContent = '100%';
      
      setTimeout(() => {
        const modal = document.getElementById('onboarding-modal');
        if (modal) modal.classList.remove('active');
        if (depProgressContainer) depProgressContainer.style.display = 'none';
        initSettingsUI();
      }, 1200);
      break;

    case 'error':
      if (depProgressText) depProgressText.textContent = 'Setup Error!';
      if (depProgressPercent) depProgressPercent.textContent = 'Fail';
      
      const finishBtn = document.getElementById('btn-onboarding-finish');
      if (finishBtn) {
        finishBtn.disabled = false;
        finishBtn.textContent = 'Retry Install';
      }
      const backBtn3 = document.getElementById('btn-onboarding-back-3');
      if (backBtn3) backBtn3.disabled = false;
      
      if (depStatusYt && depStatusYt.classList.contains('downloading')) {
        depStatusYt.className = 'dependency-status-item error';
        if (depValYt) depValYt.textContent = 'Download failed';
      }
      if (depStatusFfmpeg && depStatusFfmpeg.classList.contains('downloading')) {
        depStatusFfmpeg.className = 'dependency-status-item error';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Download failed';
      }
      if (depStatusFpcalc && depStatusFpcalc.classList.contains('downloading')) {
        depStatusFpcalc.className = 'dependency-status-item error';
        if (depValFpcalc) depValFpcalc.textContent = 'Download failed';
      }
      
      alert(`Failed to configure dependencies:\n${data.message}\n\nPlease check your internet connection or install them manually.`);
      break;
  }
}

// Show Onboarding flow modal
async function showOnboardingFlow() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.classList.add('active');
  
  // Populate system info placeholder in input
  const sysInfo = await window.electronAPI.getSystemInfo();
  const onboardingNameInput = document.getElementById('onboarding-name');
  if (onboardingNameInput && sysInfo.username) {
    onboardingNameInput.placeholder = sysInfo.username;
  }
  
  // Setup onboarding city autocomplete
  const onboardingCityInput = document.getElementById('onboarding-city');
  const onboardingCityResults = document.getElementById('onboarding-city-results');
  if (onboardingCityInput && onboardingCityResults) {
    setupCityAutocomplete(onboardingCityInput, onboardingCityResults, (data) => {
      onboardingCityData = data;
    });
  }

  // Set up Step 2 Dynamic Service Fields Toggling
  const musicServiceSelector = document.getElementById('onboarding-musicfinder-service');
  const acoustidContainer = document.getElementById('onboarding-acoustid-container');
  const acrcloudContainer = document.getElementById('onboarding-acrcloud-container');
  
  if (musicServiceSelector && acoustidContainer && acrcloudContainer) {
    musicServiceSelector.addEventListener('change', () => {
      if (musicServiceSelector.value === 'acoustid') {
        acoustidContainer.style.display = 'block';
        acrcloudContainer.style.display = 'none';
      } else {
        acoustidContainer.style.display = 'none';
        acrcloudContainer.style.display = 'flex';
      }
    });
  }

  // Navigation Steps helper
  const steps = [
    document.getElementById('onboarding-step-1'),
    document.getElementById('onboarding-step-2'),
    document.getElementById('onboarding-step-3')
  ];
  const pills = [
    document.getElementById('indicator-step-1'),
    document.getElementById('indicator-step-2'),
    document.getElementById('indicator-step-3')
  ];

  async function goToStep(stepNum) {
    steps.forEach((s, idx) => {
      if (s) s.style.display = (idx + 1 === stepNum) ? 'block' : 'none';
    });
    pills.forEach((p, idx) => {
      if (p) {
        if (idx + 1 === stepNum) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      }
    });

    if (stepNum === 3) {
      // Audit dependencies and display statuses
      const depStatusYt = document.getElementById('onboarding-dep-status-yt');
      const depStatusFfmpeg = document.getElementById('onboarding-dep-status-ffmpeg');
      const depStatusFpcalc = document.getElementById('onboarding-dep-status-fpcalc');
      const depValYt = document.getElementById('onboarding-dep-val-yt');
      const depValFfmpeg = document.getElementById('onboarding-dep-val-ffmpeg');
      const depValFpcalc = document.getElementById('onboarding-dep-val-fpcalc');
      const finishBtn = document.getElementById('btn-onboarding-finish');

      if (depValYt) depValYt.textContent = 'Checking...';
      if (depValFfmpeg) depValFfmpeg.textContent = 'Checking...';
      if (depValFpcalc) depValFpcalc.textContent = 'Checking...';

      try {
        const deps = await window.electronAPI.checkDependencies();
        hasMissingDependencies = !deps.ytDlp.available || !deps.ffmpeg.available || !deps.fpcalc.available;

        if (deps.ytDlp.available) {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
          if (depValYt) depValYt.textContent = 'Ready (Found)';
        } else {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item downloading';
          if (depValYt) depValYt.textContent = 'Not found - will install';
        }

        if (deps.ffmpeg.available) {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Ready (Found)';
        } else {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item downloading';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Not found - will install';
        }

        if (deps.fpcalc.available) {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item completed';
          if (depValFpcalc) depValFpcalc.textContent = 'Ready (Found)';
        } else {
          if (depStatusFpcalc) depStatusFpcalc.className = 'dependency-status-item downloading';
          if (depValFpcalc) depValFpcalc.textContent = 'Not found - will install';
        }

        if (finishBtn) {
          if (hasMissingDependencies) {
            finishBtn.textContent = 'Install & Finish';
          } else {
            finishBtn.textContent = 'Finish & Launch';
          }
        }
      } catch (err) {
        console.error('Failed to run system audit:', err);
      }
    }
  }

  // STEP 1 BUTTONS
  const btnNext1 = document.getElementById('btn-onboarding-next-1');
  if (btnNext1) {
    btnNext1.addEventListener('click', async () => {
      btnNext1.disabled = true;
      btnNext1.textContent = 'Resolving Location...';

      const userName = onboardingNameInput.value.trim();
      const tempFormat = document.getElementById('onboarding-temp-format').value;
      
      let city = 'Estimated Location';
      let lat = 37.7749;
      let lon = -122.4194;
      
      if (onboardingCityData) {
        city = onboardingCityData.name;
        lat = onboardingCityData.lat;
        lon = onboardingCityData.lon;
      } else {
        const textCity = onboardingCityInput.value.trim();
        if (textCity.length >= 2) {
          try {
            const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(textCity)}&count=1&language=en&format=json`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              const firstCity = data.results[0];
              const region = firstCity.admin1 ? `, ${firstCity.admin1}` : '';
              const country = firstCity.country ? `, ${firstCity.country}` : '';
              city = `${firstCity.name}${region}${country}`;
              lat = firstCity.latitude;
              lon = firstCity.longitude;
            } else {
              const ipRes = await fetch('https://ipapi.co/json/');
              const ipData = await ipRes.json();
              if (ipData.city) {
                const region = ipData.region ? `, ${ipData.region}` : '';
                city = `${ipData.city}${region}`;
                lat = ipData.latitude;
                lon = ipData.longitude;
              }
            }
          } catch (e) {
            console.error('Failed to geocode typed location:', e);
          }
        } else {
          try {
            const ipRes = await fetch('https://ipapi.co/json/');
            const ipData = await ipRes.json();
            if (ipData.city) {
              const region = ipData.region ? `, ${ipData.region}` : '';
              city = `${ipData.city}${region}`;
              lat = ipData.latitude;
              lon = ipData.longitude;
            }
          } catch (err) {
            console.error('IP Geolocation failed:', err);
          }
        }
      }

      onboardingDataCollected.userName = userName;
      onboardingDataCollected.weatherCity = city;
      onboardingDataCollected.weatherLat = lat;
      onboardingDataCollected.weatherLon = lon;
      onboardingDataCollected.tempFormat = tempFormat;

      btnNext1.disabled = false;
      btnNext1.textContent = 'Next Step';

      goToStep(2);
    });
  }

  const btnSkip = document.getElementById('btn-onboarding-skip');
  if (btnSkip) {
    btnSkip.addEventListener('click', async () => {
      btnSkip.disabled = true;
      btnSkip.textContent = 'Estimating location...';
      
      let estCity = 'Estimated Location';
      let estLat = 37.7749;
      let estLon = -122.4194;
      
      try {
        const ipRes = await fetch('https://ipapi.co/json/');
        const ipData = await ipRes.json();
        if (ipData.city) {
          const region = ipData.region ? `, ${ipData.region}` : '';
          estCity = `${ipData.city}${region}`;
          estLat = ipData.latitude;
          estLon = ipData.longitude;
        }
      } catch (err) {
        console.error('IP Geolocation failed:', err);
      }
      
      const onboardingData = {
        userName: '',
        weatherCity: estCity,
        weatherLat: estLat,
        weatherLon: estLon,
        tempFormat: 'fahrenheit',
        musicFinderService: 'acoustid',
        acoustidKey: '',
        acrcloudKey: '',
        acrcloudSecret: '',
        acrcloudHost: 'identify-us-west-2.acrcloud.com'
      };
      
      await window.electronAPI.finishOnboarding(onboardingData);
      currentSettings = { ...currentSettings, ...onboardingData, onboardingComplete: true };
      
      modal.classList.remove('active');
      await initSettingsUI();
    });
  }

  // STEP 2 BUTTONS
  const btnBack2 = document.getElementById('btn-onboarding-back-2');
  if (btnBack2) {
    btnBack2.addEventListener('click', () => {
      goToStep(1);
    });
  }

  const btnSkip2 = document.getElementById('btn-onboarding-skip-2');
  if (btnSkip2) {
    btnSkip2.addEventListener('click', () => {
      onboardingDataCollected.musicFinderService = 'acoustid';
      onboardingDataCollected.acoustidKey = '';
      onboardingDataCollected.acrcloudKey = '';
      onboardingDataCollected.acrcloudSecret = '';
      onboardingDataCollected.acrcloudHost = 'identify-us-west-2.acrcloud.com';
      goToStep(3);
    });
  }

  const btnNext2 = document.getElementById('btn-onboarding-next-2');
  if (btnNext2) {
    btnNext2.addEventListener('click', () => {
      const service = document.getElementById('onboarding-musicfinder-service').value;
      const acoustidKey = document.getElementById('onboarding-acoustid-key').value.trim();
      const acrcloudKey = document.getElementById('onboarding-acrcloud-key').value.trim();
      const acrcloudSecret = document.getElementById('onboarding-acrcloud-secret').value.trim();
      const acrcloudHost = document.getElementById('onboarding-acrcloud-host').value.trim() || 'identify-us-west-2.acrcloud.com';

      onboardingDataCollected.musicFinderService = service;
      onboardingDataCollected.acoustidKey = acoustidKey;
      onboardingDataCollected.acrcloudKey = acrcloudKey;
      onboardingDataCollected.acrcloudSecret = acrcloudSecret;
      onboardingDataCollected.acrcloudHost = acrcloudHost;

      goToStep(3);
    });
  }

  // STEP 3 BUTTONS
  const btnBack3 = document.getElementById('btn-onboarding-back-3');
  if (btnBack3) {
    btnBack3.addEventListener('click', () => {
      goToStep(2);
    });
  }

  const btnFinish = document.getElementById('btn-onboarding-finish');
  if (btnFinish) {
    btnFinish.addEventListener('click', async () => {
      btnFinish.disabled = true;
      const backBtn3 = document.getElementById('btn-onboarding-back-3');
      if (backBtn3) backBtn3.disabled = true;

      // Save settings
      await window.electronAPI.finishOnboarding(onboardingDataCollected);
      currentSettings = { ...currentSettings, ...onboardingDataCollected, onboardingComplete: true };

      if (hasMissingDependencies) {
        btnFinish.textContent = 'Installing...';
        // The backend automatically triggers setupDependencies inside finish-onboarding handler,
        // which sends 'checking', 'init', progress bars, and finally 'all-ready' back to us!
      } else {
        // Close modal immediately since there are no missing dependencies
        modal.classList.remove('active');
        await initSettingsUI();
      }
    });
  }
}

// App Dashboard Initializer
async function initAppDashboard() {
  const sysInfo = await window.electronAPI.getSystemInfo();
  const displayName = currentSettings.userName || sysInfo.username || 'user';
  
  // Render greeting
  renderGreeting(displayName);
  
  // Render weather & clock
  initWeatherAndClock();
}

// Render Time-of-day greetings
function renderGreeting(name) {
  const now = new Date();
  const hour = now.getHours();
  
  let titlePool = [];
  let subtitlePool = [];
  
  if (hour >= 5 && hour < 12) {
    titlePool = [
      'Good morning, {name}!',
      'Rise and shine, {name}!',
      'Wishing you a great morning, {name}!'
    ];
    subtitlePool = [
      'What are we downloading today?',
      'Ready to save some awesome videos?',
      'Let\'s start the day with some downloads!'
    ];
  } else if (hour >= 12 && hour < 17) {
    titlePool = [
      'Good afternoon, {name}!',
      'Welcome back, {name}!',
      'Hope your afternoon is going great, {name}!'
    ];
    subtitlePool = [
      'Ready to grab more videos?',
      'What\'s on your download list today?',
      'Let\'s download something interesting!'
    ];
  } else if (hour >= 17 && hour < 22) {
    titlePool = [
      'Good evening, {name}!',
      'Evening, {name}!',
      'Welcome back, {name}!'
    ];
    subtitlePool = [
      'Winding down with some downloads?',
      'Let\'s get your offline queue ready!',
      'What are we working on tonight?'
    ];
  } else {
    titlePool = [
      'Good night, {name}!',
      'Hello night owl, {name}!',
      'Rest well, {name}!'
    ];
    subtitlePool = [
      'Working late tonight?',
      'Grab your late-night downloads here.',
      'Need some offline content for the night?'
    ];
  }
  
  const randTitle = titlePool[Math.floor(Math.random() * titlePool.length)].replace('{name}', name);
  const randSubtitle = subtitlePool[Math.floor(Math.random() * subtitlePool.length)];
  
  const titleEls = document.querySelectorAll('.greeting-title');
  const subtitleEls = document.querySelectorAll('.greeting-subtitle');
  titleEls.forEach(el => {
    el.textContent = randTitle;
  });
  subtitleEls.forEach(el => {
    el.textContent = randSubtitle;
  });
}

// Weather Widget and Clock timers
let weatherTimer = null;
let clockTimer = null;

function initWeatherAndClock() {
  if (weatherTimer) clearInterval(weatherTimer);
  if (clockTimer) clearInterval(clockTimer);
  
  updateWeather();
  updateClock();
  
  weatherTimer = setInterval(updateWeather, 15 * 60 * 1000); // 15 mins
  clockTimer = setInterval(updateClock, 1000); // 1 sec
}

function updateClock() {
  const timeEls = document.querySelectorAll('.weather-time-value');
  const timeStr = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  timeEls.forEach(el => {
    el.textContent = timeStr;
  });
}

async function updateWeather() {
  const widgets = document.querySelectorAll('.weather-widget');
  if (widgets.length === 0) return;
  
  let lat = currentSettings.weatherLat;
  let lon = currentSettings.weatherLon;
  let city = currentSettings.weatherCity || 'Estimated Location';
  const tempFormat = currentSettings.tempFormat || 'fahrenheit';
  const unitSymbol = tempFormat === 'fahrenheit' ? '°F' : '°C';
  
  if (!lat || !lon) {
    try {
      const ipRes = await fetch('https://ipapi.co/json/');
      const ipData = await ipRes.json();
      if (ipData.latitude && ipData.longitude) {
        lat = ipData.latitude;
        lon = ipData.longitude;
        if (!currentSettings.weatherCity) {
          const region = ipData.region ? `, ${ipData.region}` : '';
          city = `${ipData.city}${region}`;
        }
      }
    } catch (err) {
      console.error('IP Geolocation failed in updateWeather:', err);
    }
  }
  
  if (!lat || !lon) {
    const noLocationHTML = `
      <div class="weather-icon-container" title="No location configured">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-weather-station" width="24" height="24">
          <path d="M12 2v20" />
          <path d="m17 22-5-5-5 5" />
          <rect x="9" y="10" width="6" height="5" rx="1" />
          <path d="M10 12h4M10 14h4" />
          <path d="M8 4h8" />
          <circle cx="8" cy="4" r="1.5" fill="currentColor" />
          <circle cx="16" cy="4" r="1.5" fill="currentColor" />
          <path d="m12 4-2-2m2 2 2-2" />
          <path d="M18 8c1.5-1.5 1.5-4 0-5.5" />
          <path d="M6 8c-1.5-1.5-1.5-4 0-5.5" />
        </svg>
      </div>
      <div class="weather-info">
        <div class="weather-temp-row">
          <span style="font-size: 0.85rem; font-weight: 600; color: hsl(var(--muted-foreground));">Setup Weather</span>
        </div>
        <div class="weather-desc" style="font-size: 0.7rem; margin-top: 2px;">No location set</div>
        <div class="weather-location-row" style="font-size: 0.7rem;">
          <span>Click to configure</span>
        </div>
      </div>
    `;
    widgets.forEach(w => {
      w.innerHTML = noLocationHTML;
    });
    return;
  }
  
  const cacheKey = `weather_${lat}_${lon}_${tempFormat}`;
  const cached = getCachedWeather(cacheKey);
  if (cached) {
    widgets.forEach((w, idx) => {
      renderWeatherCardContent(w, cached, city, unitSymbol, idx);
    });
    return;
  }
  
  // Try Open-Meteo first
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=${tempFormat}&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    
    if (data.current_weather) {
      saveCachedWeather(cacheKey, data.current_weather);
      widgets.forEach((w, idx) => {
        renderWeatherCardContent(w, data.current_weather, city, unitSymbol, idx);
      });
      return;
    }
  } catch (err) {
    console.warn('Open-Meteo failed, trying wttr.in fallback...', err);
  }
  
  // Fallback to wttr.in
  try {
    const url = `https://wttr.in/${lat},${lon}?format=j1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wttr.in error ${res.status}`);
    const data = await res.json();
    
    if (data.current_condition && data.current_condition.length > 0) {
      const cond = data.current_condition[0];
      const temp = tempFormat === 'fahrenheit' ? parseFloat(cond.temp_F) : parseFloat(cond.temp_C);
      const wwoCode = parseInt(cond.weatherCode);
      const weathercode = wwoCodeToWmo(wwoCode);
      
      const weatherData = {
        temperature: temp,
        weathercode: weathercode
      };
      
      saveCachedWeather(cacheKey, weatherData);
      widgets.forEach((w, idx) => {
        renderWeatherCardContent(w, weatherData, city, unitSymbol, idx);
      });
      return;
    }
  } catch (err) {
    console.error('All weather services failed:', err);
    widgets.forEach(w => {
      w.innerHTML = `
        <div class="weather-loading" style="flex-direction: column; gap: 4px; padding: 0.25rem 0.5rem; text-align: center;">
          <span style="color: #ef4444; font-weight: 500;">Failed to fetch weather</span>
          <span style="font-size: 0.7rem; opacity: 0.8; color: hsl(var(--muted-foreground));">Click to retry</span>
        </div>
      `;
    });
  }
}

function wwoCodeToWmo(wwoCode) {
  if (wwoCode === 113) return 0; // Clear
  if (wwoCode === 116) return 2; // Partly Cloudy
  if ([119, 122].includes(wwoCode)) return 3; // Cloudy/Overcast
  if ([143, 248, 260].includes(wwoCode)) return 45; // Fog
  if ([263, 266, 293, 296, 299, 302, 305, 308].includes(wwoCode)) return 63; // Rain
  if ([227, 230, 323, 326, 329, 332, 335, 338, 350, 368, 371, 395].includes(wwoCode)) return 73; // Snow
  if ([386, 389, 392].includes(wwoCode)) return 95; // Thunderstorm
  return 3;
}

function renderWeatherCardContent(widget, weatherData, city, unitSymbol, index) {
  const temp = Math.round(weatherData.temperature);
  const desc = getWeatherDescription(weatherData.weathercode);
  const iconSvg = getWeatherIconSVG(weatherData.weathercode, index);
  
  widget.innerHTML = `
    <div class="weather-icon-container" title="${desc}">
      ${iconSvg}
    </div>
    <div class="weather-info">
      <div class="weather-temp-row">
        <span class="weather-temp">${temp}${unitSymbol}</span>
      </div>
      <div class="weather-desc">${desc}</div>
      <div class="weather-location-row" title="${city}">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        <span>${city}</span>
      </div>
      <div class="weather-time-row">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="weather-time-value">${new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
    </div>
  `;
}

// Weather Cache helpers
function getCachedWeather(key) {
  cleanExpiredWeatherCaches();
  const cacheStr = localStorage.getItem(key);
  if (!cacheStr) return null;
  try {
    const cache = JSON.parse(cacheStr);
    if (Date.now() - cache.timestamp > 30 * 60 * 1000) { // 30 mins
      localStorage.removeItem(key);
      return null;
    }
    return cache.data;
  } catch (e) {
    localStorage.removeItem(key);
    return null;
  }
}

function saveCachedWeather(key, data) {
  const cache = {
    timestamp: Date.now(),
    data: data
  };
  localStorage.setItem(key, JSON.stringify(cache));
}

function cleanExpiredWeatherCaches() {
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('weather_')) {
      try {
        const cache = JSON.parse(localStorage.getItem(key));
        if (Date.now() - cache.timestamp > 2 * 60 * 60 * 1000) {
          localStorage.removeItem(key);
        }
      } catch (e) {
        localStorage.removeItem(key);
      }
    }
  }
}

function getWeatherIconSVG(weatherCode, index) {
  const suffix = index !== undefined ? `-${index}` : '';
  if (weatherCode === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="sun-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF275" />
          <stop offset="30%" stop-color="#FFAE00" />
          <stop offset="100%" stop-color="#FF5100" />
        </linearGradient>
      </defs>
      <g class="weather-animate-spin">
        <path d="M12,2 L12,4 M12,20 L12,22 M4.22,4.22 L5.64,5.64 M18.36,18.36 L19.78,19.78 M2,12 L4,12 M20,12 L22,12 M4.22,19.78 L5.64,18.36 M18.36,5.64 L19.78,4.22" 
              stroke="url(#sun-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
      </g>
      <circle cx="12" cy="12" r="5.5" fill="url(#sun-grad${suffix})" />
      <circle cx="10.5" cy="10.5" r="2.5" fill="#FFF" opacity="0.35" />
    </svg>`;
  }
  if ([1, 2, 3].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="cloud-sun-sun-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF066" />
          <stop offset="100%" stop-color="#FF7300" />
        </linearGradient>
        <linearGradient id="cloud-sun-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="100%" stop-color="#A5C2F1" />
        </linearGradient>
        <filter id="cloud-shadow${suffix}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.2" />
        </filter>
      </defs>
      <g transform="translate(3, -2)" class="weather-animate-spin">
        <circle cx="12" cy="12" r="4.5" fill="url(#cloud-sun-sun-grad${suffix})" />
        <path d="M12,4 L12,2 M12,22 L12,20 M4.22,4.22 L5.64,5.64 M18.36,18.36 L19.78,19.78 M2,12 L4,12 M20,12 L22,12 M4.22,19.78 L5.64,18.36 M18.36,5.64 L19.78,4.22" 
              stroke="url(#cloud-sun-sun-grad${suffix})" stroke-width="1.8" stroke-linecap="round" opacity="0.85" />
      </g>
      <path class="weather-animate-float" d="M17.5,18 A4.5,4.5 0 0,0 20,10.2 A6,6 0 0,0 8.5,8 A5,5 0 0,0 4,12.8 A4.5,4.5 0 0,0 6.5,18 Z" 
            fill="url(#cloud-sun-cloud-grad${suffix})" filter="url(#cloud-shadow${suffix})" />
    </svg>`;
  }
  if ([45, 48].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="fog-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#E2EDF8" />
          <stop offset="100%" stop-color="#8BB0D4" />
        </linearGradient>
        <linearGradient id="fog-line-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#8BB0D4" stop-opacity="0.2" />
          <stop offset="50%" stop-color="#C5D7EC" stop-opacity="1" />
          <stop offset="100%" stop-color="#8BB0D4" stop-opacity="0.2" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,15.5 A4.5,4.5 0 0,0 20,7.7 A6,6 0 0,0 8.5,5.5 A5,5 0 0,0 4,10.3 A4.5,4.5 0 0,0 6.5,15.5 Z" 
            fill="url(#fog-cloud-grad${suffix})" opacity="0.85" />
      <g class="weather-animate-pulse">
        <line x1="3" y1="16" x2="21" y2="16" stroke="url(#fog-line-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
        <line x1="5" y1="19.5" x2="19" y2="19.5" stroke="url(#fog-line-grad${suffix})" stroke-width="2.5" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([51, 53, 55, 56, 57].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="drizzle-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#BACDDC" />
          <stop offset="100%" stop-color="#698FA8" />
        </linearGradient>
        <linearGradient id="drop-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#7CD3FC" />
          <stop offset="100%" stop-color="#0284C7" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,15 A4.5,4.5 0 0,0 20,7.2 A6,6 0 0,0 8.5,5 A5,5 0 0,0 4,9.8 A4.5,4.5 0 0,0 6.5,15 Z" 
            fill="url(#drizzle-cloud-grad${suffix})" />
      <g class="weather-animate-rain">
        <line x1="8" y1="17" x2="7" y2="20" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
        <line x1="12" y1="18" x2="11" y2="21" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
        <line x1="16" y1="17" x2="15" y2="20" stroke="url(#drop-grad${suffix})" stroke-width="2" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="rain-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#8EA2B3" />
          <stop offset="100%" stop-color="#475C6D" />
        </linearGradient>
        <linearGradient id="rain-drop-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#38BDF8" />
          <stop offset="100%" stop-color="#0284C7" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#rain-cloud-grad${suffix})" />
      <g class="weather-animate-rain">
        <line x1="9" y1="16" x2="7.5" y2="21" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
        <line x1="13" y1="17" x2="11.5" y2="22" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
        <line x1="17" y1="16" x2="15.5" y2="21" stroke="url(#rain-drop-grad${suffix})" stroke-width="2.2" stroke-linecap="round" />
      </g>
    </svg>`;
  }
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="snow-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#EBF4FC" />
          <stop offset="100%" stop-color="#B0CBE5" />
        </linearGradient>
        <linearGradient id="snow-flake-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#FFFFFF" />
          <stop offset="100%" stop-color="#7DD3FC" />
        </linearGradient>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#snow-cloud-grad${suffix})" />
      <g class="weather-animate-rain" stroke="url(#snow-flake-grad${suffix})" stroke-width="1.8" stroke-linecap="round">
        <g transform="translate(8, 18)">
          <line x1="0" y1="-2.5" x2="0" y2="2.5" />
          <line x1="-2.5" y1="0" x2="2.5" y2="0" />
          <line x1="-1.7" y1="-1.7" x2="1.7" y2="1.7" />
          <line x1="-1.7" y1="1.7" x2="1.7" y2="-1.7" />
        </g>
        <g transform="translate(13, 19.5)">
          <line x1="0" y1="-2" x2="0" y2="2" />
          <line x1="-2" y1="0" x2="2" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="1.4" y2="1.4" />
          <line x1="-1.4" y1="1.4" x2="1.4" y2="-1.4" />
        </g>
        <g transform="translate(18, 17.5)">
          <line x1="0" y1="-2" x2="0" y2="2" />
          <line x1="-2" y1="0" x2="2" y2="0" />
          <line x1="-1.4" y1="-1.4" x2="1.4" y2="1.4" />
          <line x1="-1.4" y1="1.4" x2="1.4" y2="-1.4" />
        </g>
      </g>
    </svg>`;
  }
  if ([95, 96, 99].includes(weatherCode)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
      <defs>
        <linearGradient id="thunder-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#555A6E" />
          <stop offset="100%" stop-color="#232733" />
        </linearGradient>
        <linearGradient id="bolt-grad${suffix}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#FFF59D" />
          <stop offset="50%" stop-color="#FBC02D" />
          <stop offset="100%" stop-color="#F57F17" />
        </linearGradient>
        <filter id="bolt-glow${suffix}" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <path class="weather-animate-float" d="M17.5,14 A4.5,4.5 0 0,0 20,6.2 A6,6 0 0,0 8.5,4 A5,5 0 0,0 4,8.8 A4.5,4.5 0 0,0 6.5,14 Z" 
            fill="url(#thunder-cloud-grad${suffix})" />
      <polygon class="weather-animate-pulse" points="12,12 8,17 11,17 9,23 15,16 12,16" 
               fill="url(#bolt-grad${suffix})" filter="url(#bolt-glow${suffix})" />
    </svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <defs>
      <linearGradient id="default-cloud-grad${suffix}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFFFFF" />
        <stop offset="100%" stop-color="#A2C3E7" />
      </linearGradient>
      <filter id="cloud-shadow-simple${suffix}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.15" />
      </filter>
    </defs>
    <path class="weather-animate-float" d="M17.5,15 A4.5,4.5 0 0,0 20,7.2 A6,6 0 0,0 8.5,5 A5,5 0 0,0 4,9.8 A4.5,4.5 0 0,0 6.5,15 Z" 
          fill="url(#default-cloud-grad${suffix})" filter="url(#cloud-shadow-simple${suffix})" />
  </svg>`;
}

function getWeatherDescription(weatherCode) {
  const mapping = {
    0: "Clear Sky",
    1: "Mainly Clear",
    2: "Partly Cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing Rime Fog",
    51: "Light Drizzle",
    53: "Moderate Drizzle",
    55: "Dense Drizzle",
    56: "Light Freezing Drizzle",
    57: "Dense Freezing Drizzle",
    61: "Slight Rain",
    63: "Moderate Rain",
    65: "Heavy Rain",
    66: "Light Freezing Rain",
    67: "Heavy Freezing Rain",
    71: "Slight Snowfall",
    73: "Moderate Snowfall",
    75: "Heavy Snowfall",
    77: "Snow Grains",
    80: "Slight Rain Showers",
    81: "Moderate Rain Showers",
    82: "Violent Rain Showers",
    85: "Slight Snow Showers",
    86: "Heavy Snow Showers",
    95: "Thunderstorm",
    96: "Thunderstorm with Hail",
    99: "Thunderstorm with Heavy Hail"
  };
  return mapping[weatherCode] || "Cloudy";
}

// Click weather card to auto-update or switch to settings
document.querySelectorAll('.weather-widget').forEach(widget => {
  widget.addEventListener('click', () => {
    const lat = currentSettings.weatherLat;
    const lon = currentSettings.weatherLon;
    
    if (!lat || !lon) {
      // If no location is set, switch to settings tab so they can configure it
      const settingsBtn = document.querySelector('[data-tab="settings-tab"]');
      if (settingsBtn) {
        settingsBtn.click();
      }
      return;
    }
    
    // Clear cache
    const tempFormat = currentSettings.tempFormat || 'fahrenheit';
    const cacheKey = `weather_${lat}_${lon}_${tempFormat}`;
    localStorage.removeItem(cacheKey);
    
    // Show loading spinner on all widgets
    document.querySelectorAll('.weather-widget').forEach(w => {
      w.innerHTML = `
        <div class="weather-loading">
          <div class="loading-spinner small"></div>
          <span>Refreshing weather...</span>
        </div>
      `;
    });
    
    // Refresh weather
    updateWeather();
  });
});

// Set up settings city search autocomplete once on load
const settingsCityInput = document.getElementById('settings-weather-city');
const settingsCityResults = document.getElementById('settings-city-results');
if (settingsCityInput && settingsCityResults) {
  setupCityAutocomplete(settingsCityInput, settingsCityResults, (data) => {
    settingsCityData = data;
  });
}

// Scan Interval Slider dynamic update
const scanIntervalInput = document.getElementById('settings-scan-interval');
const scanIntervalLabel = document.getElementById('label-scan-interval-val');
const musicFinderScanIntervalInput = document.getElementById('musicfinder-scan-interval');
const musicFinderScanIntervalLabel = document.getElementById('label-musicfinder-scan-interval-val');

if (scanIntervalInput && scanIntervalLabel) {
  scanIntervalInput.addEventListener('input', (e) => {
    const val = e.target.value;
    scanIntervalLabel.textContent = `${val}s`;
    if (musicFinderScanIntervalInput) {
      musicFinderScanIntervalInput.value = val;
    }
    if (musicFinderScanIntervalLabel) {
      musicFinderScanIntervalLabel.textContent = `${val}s`;
    }
  });
}

if (musicFinderScanIntervalInput && musicFinderScanIntervalLabel) {
  musicFinderScanIntervalInput.addEventListener('input', (e) => {
    const val = e.target.value;
    musicFinderScanIntervalLabel.textContent = `${val}s`;
    if (scanIntervalInput) {
      scanIntervalInput.value = val;
    }
    if (scanIntervalLabel) {
      scanIntervalLabel.textContent = `${val}s`;
    }
  });

  musicFinderScanIntervalInput.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value, 10);
    currentSettings.acoustidScanInterval = val;
    await window.electronAPI.saveSettings(currentSettings);
  });
}

// Toggle credentials containers visibility
function toggleCredentialsContainers(service) {
  const acoustidContainer = document.getElementById('acoustid-credentials-container');
  const acrcloudContainer = document.getElementById('acrcloud-credentials-container');
  if (acoustidContainer && acrcloudContainer) {
    if (service === 'acrcloud') {
      acoustidContainer.style.display = 'none';
      acrcloudContainer.style.display = 'flex';
    } else {
      acoustidContainer.style.display = 'block';
      acrcloudContainer.style.display = 'none';
    }
  }
}

// Preferred Service dropdown toggles display in Settings
const settingsServiceSelect = document.getElementById('settings-musicfinder-service');
if (settingsServiceSelect) {
  settingsServiceSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    toggleCredentialsContainers(val);
    
    // Sync to finder tab selector
    const mfServiceSelector = document.getElementById('musicfinder-service-selector');
    if (mfServiceSelector) {
      mfServiceSelector.value = val;
    }
  });
}

// Service Selector dropdown in Finder tab
const mfServiceSelectorInput = document.getElementById('musicfinder-service-selector');
if (mfServiceSelectorInput) {
  mfServiceSelectorInput.addEventListener('change', async (e) => {
    const val = e.target.value;
    
    // Sync to settings tab select
    if (settingsServiceSelect) {
      settingsServiceSelect.value = val;
      toggleCredentialsContainers(val);
    }
    
    // Persist immediately on toggle
    currentSettings.musicFinderService = val;
    await window.electronAPI.saveSettings(currentSettings);
  });
}

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
function showMusicFinderState(state) {
  if (musicFinderInputZone) musicFinderInputZone.style.display = (state === 'input') ? 'flex' : 'none';
  if (musicFinderLoading) musicFinderLoading.style.display = (state === 'loading') ? 'flex' : 'none';
  if (musicFinderErrorZone) musicFinderErrorZone.style.display = (state === 'error') ? 'flex' : 'none';
  if (musicFinderResultsZone) musicFinderResultsZone.style.display = (state === 'results') ? 'flex' : 'none';
}

// Append log helper
function appendScanLog(message) {
  if (!musicFinderStepLog) return;
  const div = document.createElement('div');
  div.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  musicFinderStepLog.appendChild(div);
  musicFinderStepLog.scrollTop = musicFinderStepLog.scrollHeight;
}

// Reset Scan UI
function resetMusicFinderUI() {
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
function startLocalFileScan(filePath) {
  isScanningMusic = true;
  
  showMusicFinderState('loading');
  if (musicFinderStepLog) musicFinderStepLog.innerHTML = '';
  
  appendScanLog(`Scanning local file: ${filePath}`);
  window.electronAPI.scanLocalFile(filePath);
}

// Start YouTube scan
function startYoutubeUrlScan(url) {
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
function renderScanResults(results) {
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

// ==========================================
// Browser Tab & Media Sniffer Logic
// ==========================================

let detectedMediaList = [];

function getPlaceholderBounds() {
  const placeholder = document.getElementById('browser-view-placeholder');
  if (!placeholder) return { x: 0, y: 0, width: 0, height: 0 };
  const rect = placeholder.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

// Window resizing
window.addEventListener('resize', () => {
  const activeTab = document.querySelector('.nav-btn.active');
  if (activeTab && activeTab.dataset.tab === 'browser-tab') {
    const bounds = getPlaceholderBounds();
    window.electronAPI.browserViewResize(bounds);
  }
});

// Browser control elements
const btnBrowserBack = document.getElementById('btn-browser-back');
const btnBrowserForward = document.getElementById('btn-browser-forward');
const btnBrowserReload = document.getElementById('btn-browser-reload');
const browserAddressBar = document.getElementById('browser-address-bar');
const btnBrowserGo = document.getElementById('btn-browser-go');

const btnSnifferDetected = document.getElementById('btn-sniffer-detected');
const snifferCount = document.getElementById('sniffer-count');
const snifferMediaSidebar = document.getElementById('sniffer-media-sidebar');
const snifferMediaList = document.getElementById('sniffer-media-list');
const btnSnifferClear = document.getElementById('btn-sniffer-clear');

if (btnBrowserBack) {
  btnBrowserBack.addEventListener('click', () => {
    window.electronAPI.browserViewControl('back');
  });
}

if (btnBrowserForward) {
  btnBrowserForward.addEventListener('click', () => {
    window.electronAPI.browserViewControl('forward');
  });
}

if (btnBrowserReload) {
  btnBrowserReload.addEventListener('click', () => {
    window.electronAPI.browserViewControl('reload');
  });
}

function loadAddressBarUrl() {
  if (browserAddressBar) {
    const url = browserAddressBar.value.trim();
    if (url) {
      window.electronAPI.browserViewLoad(url);
    }
  }
}

if (btnBrowserGo) {
  btnBrowserGo.addEventListener('click', loadAddressBarUrl);
}

if (browserAddressBar) {
  browserAddressBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadAddressBarUrl();
    }
  });
}

// Listen to browser navigation changes to update address bar input value
window.electronAPI.onBrowserNavigate((url) => {
  if (browserAddressBar) {
    browserAddressBar.value = url;
  }
  // Clear sniffed media on navigation to a new page
  detectedMediaList = [];
  updateSnifferUI();
});

// Toggle Sniffer Sidebar
if (btnSnifferDetected) {
  btnSnifferDetected.addEventListener('click', () => {
    if (snifferMediaSidebar) {
      const isVisible = snifferMediaSidebar.style.display === 'flex';
      snifferMediaSidebar.style.display = isVisible ? 'none' : 'flex';
      
      // Recalculate guest view bounds multiple times after sidebar toggles to account for layout layout reflow delays
      const resizeFn = () => {
        const bounds = getPlaceholderBounds();
        window.electronAPI.browserViewResize(bounds);
      };
      resizeFn();
      setTimeout(resizeFn, 50);
      setTimeout(resizeFn, 150);
      setTimeout(resizeFn, 300);
    }
  });
}

// Clear all detected media
if (btnSnifferClear) {
  btnSnifferClear.addEventListener('click', () => {
    detectedMediaList = [];
    updateSnifferUI();
  });
}

function getUrlDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function updateSnifferUI() {
  if (!snifferCount || !btnSnifferDetected || !snifferMediaList) return;
  
  const count = detectedMediaList.length;
  snifferCount.textContent = count;
  
  if (count > 0) {
    btnSnifferDetected.style.display = 'inline-flex';
  } else {
    btnSnifferDetected.style.display = 'none';
    if (snifferMediaSidebar) {
      snifferMediaSidebar.style.display = 'none';
      // Reset view boundaries
      setTimeout(() => {
        const bounds = getPlaceholderBounds();
        window.electronAPI.browserViewResize(bounds);
      }, 50);
    }
  }
  
  snifferMediaList.innerHTML = '';
  
  detectedMediaList.forEach((media, index) => {
    const item = document.createElement('div');
    item.className = 'sniffer-media-item';
    
    let iconSvg = '';
    const isAudio = media.contentType && media.contentType.toLowerCase().startsWith('audio/');
    if (isAudio) {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981; flex-shrink: 0;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    } else {
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #3b82f6; flex-shrink: 0;"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="m22 8-6 4 6 4V8Z"/></svg>`;
    }
    
    let displayTitle = media.title;
    try {
      const cleanUrl = media.url.split('?')[0].split('#')[0];
      const filename = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
      if (filename && filename.includes('.')) {
        displayTitle = filename;
      }
    } catch (e) {}

    const isHls = media.url.includes('.m3u8');
    const badgeText = isHls ? 'HLS Stream' : (isAudio ? 'Audio' : 'Video');
    
    // Probed details formatting
    let resolutionText = '';
    let durationText = '';
    let codecText = '';
    
    if (media.width && media.height) {
      resolutionText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--primary) / 0.15); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.3); font-weight: 600;">${media.width}x${media.height}</span>`;
    }
    if (media.duration) {
      durationText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">${secondsToHHMMSS(media.duration)}</span>`;
    } else if (isHls) {
      durationText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">Live / Adaptive</span>`;
    }
    if (media.vcodec && media.vcodec !== 'Unknown') {
      codecText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">${media.vcodec}</span>`;
    }
    
    item.innerHTML = `
      ${iconSvg}
      <div class="sniffer-media-info" style="flex: 1; min-width: 0;">
        <span class="sniffer-media-title" title="${displayTitle}" style="font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem;">${displayTitle}</span>
        <div class="sniffer-media-meta" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; margin-bottom: 4px;">
          <span class="badge" style="padding: 1px 4px; font-size: 0.6rem;">${badgeText}</span>
          ${resolutionText}
          ${durationText}
          ${codecText}
        </div>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; display: block; font-size: 0.65rem; color: hsl(var(--muted-foreground));" title="${media.url}">${media.url}</span>
      </div>
      <div class="sniffer-media-actions" style="display: flex; gap: 4px; align-items: center;">
        <button class="sniffer-action-btn btn-preview" title="Preview Stream" style="display: flex; align-items: center; justify-content: center; width: 1.65rem; height: 1.65rem; padding: 0; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); border-radius: 4px; color: hsl(var(--foreground)); cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        </button>
        <button class="sniffer-action-btn btn-dl" title="Download Media" style="display: flex; align-items: center; justify-content: center; width: 1.65rem; height: 1.65rem; padding: 0; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); border-radius: 4px; color: hsl(var(--foreground)); cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
        </button>
        <button class="sniffer-action-btn btn-copy" title="Copy URL" style="display: flex; align-items: center; justify-content: center; width: 1.65rem; height: 1.65rem; padding: 0; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); border-radius: 4px; color: hsl(var(--foreground)); cursor: pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        </button>
      </div>
    `;
    
    const btnPreview = item.querySelector('.btn-preview');
    const btnDl = item.querySelector('.btn-dl');
    const btnCopy = item.querySelector('.btn-copy');
    
    if (btnPreview) {
      btnPreview.addEventListener('click', () => {
        playPreview(media.url, displayTitle, media);
      });
    }

    if (btnDl) {
      btnDl.addEventListener('click', () => {
        const pageUrl = browserAddressBar ? browserAddressBar.value.trim() : '';
        const domain = getUrlDomain(pageUrl);
        
        if (domain && (domain.includes('youtube.com') || domain.includes('youtu.be') || domain.includes('instagram.com'))) {
          if (isDownloading) {
            alert('A download is already in progress. Please wait for the current download to finish!');
            appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
            return;
          }
          
          if (domain.includes('instagram.com')) {
            startDownloadIndicator('Downloading Instagram video...');
            window.electronAPI.downloadInstagram({ url: pageUrl, format: 'video' });
          } else {
            startDownloadIndicator('Downloading video...');
            window.electronAPI.downloadVideo({ url: pageUrl, quality: currentSettings.defaultQuality || '1080' });
          }
          
          const downloadsBtn = document.querySelector('.nav-btn[data-tab="video-tab"]');
          if (downloadsBtn) downloadsBtn.click();
        } else {
          if (isDownloading) {
            alert('A download is already in progress. Please wait for the current download to finish!');
            appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
            return;
          }
          
          startDownloadIndicator('Downloading media stream...');
          window.electronAPI.downloadMediaStream({
            url: media.url,
            title: media.title,
            contentType: media.contentType,
            pageUrl: media.pageUrl || (browserAddressBar ? browserAddressBar.value.trim() : '')
          });
          
          const downloadsBtn = document.querySelector('.nav-btn[data-tab="video-tab"]');
          if (downloadsBtn) downloadsBtn.click();
        }
      });
    }
    
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(media.url).then(() => {
          alert('Media URL copied to clipboard!');
        }).catch(err => {
          console.error('Failed to copy text:', err);
        });
      });
    }
    
    snifferMediaList.appendChild(item);
  });
}

window.electronAPI.onMediaDetected((media) => {
  const exists = detectedMediaList.some(item => item.url === media.url);
  if (!exists) {
    detectedMediaList.unshift(media);
    updateSnifferUI();
  }
});

window.electronAPI.onMediaProbed((probedData) => {
  const index = detectedMediaList.findIndex(item => item.url === probedData.url);
  if (index !== -1) {
    detectedMediaList[index] = {
      ...detectedMediaList[index],
      width: probedData.width,
      height: probedData.height,
      duration: probedData.duration,
      vcodec: probedData.vcodec,
      fps: probedData.fps
    };
    updateSnifferUI();
  }
});

// Clear browser storage data and cache
const btnBrowserClear = document.getElementById('btn-browser-clear');
if (btnBrowserClear) {
  btnBrowserClear.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all browser cache, cookies, and session storage?')) {
      const success = await window.electronAPI.browserClearData();
      if (success) {
        alert('Browser data cleared successfully!');
        window.electronAPI.browserViewControl('reload');
      } else {
        alert('Failed to clear browser data.');
      }
    }
  });
}

// Media Preview Modal Player Logic
let activeHls = null;
const PREVIEW_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function buildMediaPreviewSrc(url, pageUrl) {
  const params = new URLSearchParams();
  params.set('url', url);
  if (pageUrl) params.set('pageUrl', pageUrl);
  return `media-preview://fetch?${params.toString()}`;
}

function restoreBrowserViewIfActive() {
  const activeTab = document.querySelector('.nav-btn.active');
  if (activeTab && activeTab.dataset.tab === 'browser-tab') {
    setTimeout(() => {
      window.electronAPI.browserViewInit(getPlaceholderBounds());
    }, 50);
  }
}

function loadHlsJs() {
  return new Promise((resolve, reject) => {
    if (window.Hls) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load hls.js from CDN'));
    document.head.appendChild(script);
  });
}

async function playPreview(url, title, mediaMeta) {
  const modal = document.getElementById('media-preview-modal');
  const video = document.getElementById('preview-video-player');
  const errorBox = document.getElementById('preview-player-error');
  const errorDetails = document.getElementById('preview-error-details');
  const titleEl = document.getElementById('preview-title');
  const metaUrl = document.getElementById('preview-meta-url');
  const metaRes = document.getElementById('preview-meta-res');
  const metaDuration = document.getElementById('preview-meta-duration');
  const metaCodec = document.getElementById('preview-meta-codec');

  if (!modal || !video) return;

  // Clean up previous instances
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }
  video.removeAttribute('src');
  video.load();

  titleEl.textContent = title || 'Media Preview';
  metaUrl.textContent = url;
  metaUrl.title = url;
  
  metaRes.textContent = (mediaMeta.width && mediaMeta.height) ? `${mediaMeta.width}x${mediaMeta.height}` : 'Unknown';
  metaDuration.textContent = mediaMeta.duration ? secondsToHHMMSS(mediaMeta.duration) : 'Live / Adaptive';
  metaCodec.textContent = (mediaMeta.vcodec && mediaMeta.vcodec !== 'Unknown') ? mediaMeta.vcodec : 'Unknown';

  errorBox.style.display = 'none';
  modal.classList.add('active');

  window.electronAPI.browserViewHide();

  const pageUrl = mediaMeta.pageUrl || (browserAddressBar ? browserAddressBar.value.trim() : '');

  const isHls = url.includes('.m3u8');
  if (isHls) {
    try {
      await loadHlsJs();
      if (!window.Hls.isSupported()) {
        throw new Error('HLS is not supported in this browser environment');
      }
      activeHls = new window.Hls({
        xhrSetup: (xhr) => {
          xhr.setRequestHeader('User-Agent', PREVIEW_USER_AGENT);
          if (pageUrl) xhr.setRequestHeader('Referer', pageUrl);
        }
      });
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
          console.error('Fatal HLS error:', data);
          errorBox.style.display = 'flex';
          errorDetails.textContent = `HLS playback error: ${data.type} (${data.details})`;
        }
      });
    } catch (err) {
      errorBox.style.display = 'flex';
      errorDetails.textContent = err.message;
    }
  } else {
    video.src = buildMediaPreviewSrc(url, pageUrl);
    video.onerror = () => {
      errorBox.style.display = 'flex';
      errorDetails.textContent = 'Standard HTML5 media playback failed. The URL might be forbidden or format unsupported.';
    };
  }
}

// Media Preview Modal Close Controls
const btnPreviewClose = document.getElementById('btn-preview-close');
const mediaPreviewModal = document.getElementById('media-preview-modal');
if (btnPreviewClose && mediaPreviewModal) {
  const closeFn = () => {
    mediaPreviewModal.classList.remove('active');
    const video = document.getElementById('preview-video-player');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    if (activeHls) {
      activeHls.destroy();
      activeHls = null;
    }
    restoreBrowserViewIfActive();
  };
  btnPreviewClose.addEventListener('click', closeFn);
  mediaPreviewModal.addEventListener('click', (e) => {
    if (e.target === mediaPreviewModal) {
      closeFn();
    }
  });
}


