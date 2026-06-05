// Global State Tracking
let isDownloading = false;
let settingsCityData = null;

// Tab switching logic
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

function updateTerminalVisibility(tabId) {
  const terminalEl = document.querySelector('.status-terminal');
  const progressEl = document.getElementById('download-progress-container');
  
  if (terminalEl) {
    if (tabId === 'settings-tab') {
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
    
    // Toggle terminal visibility
    updateTerminalVisibility(btn.dataset.tab);
  });
});

// Progress Bar Helper Routines
function startDownloadIndicator(statusMsg) {
  isDownloading = true;
  const progressEl = document.getElementById('download-progress-container');
  if (progressEl) {
    progressEl.classList.add('active');
    const currentTab = document.querySelector('.nav-btn.active').dataset.tab;
    if (currentTab !== 'settings-tab') {
      progressEl.style.display = 'block';
    }
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-percent-text').textContent = '0%';
    document.getElementById('progress-status-text').textContent = statusMsg;
  }
}

function stopDownloadIndicator() {
  isDownloading = false;
  const progressEl = document.getElementById('download-progress-container');
  if (progressEl) {
    progressEl.classList.remove('active');
    progressEl.style.display = 'none';
  }
}

// Download Video
document.getElementById('btn-download-video').addEventListener('click', () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('video-url').value;
  const quality = document.getElementById('video-quality').value;
  if (!url) return;
  
  startDownloadIndicator('Downloading video...');
  window.electronAPI.downloadVideo({ url, quality });
  document.getElementById('video-url').value = '';
});

// Download Audio
document.getElementById('btn-download-audio').addEventListener('click', () => {
  if (isDownloading) {
    alert('A download is already in progress. Please wait for the current download to finish!');
    appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
    return;
  }
  const url = document.getElementById('audio-url').value;
  if (!url) return;
  
  startDownloadIndicator('Extracting audio...');
  window.electronAPI.downloadAudio({ url });
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
  // Try to parse out the carriage returns yt-dlp uses to update the same line
  const lines = progress.split('\r');
  const text = lines[lines.length - 1].trim();
  if (text) appendLog(text);
  
  // Parse percentage from yt-dlp output
  const percentMatch = progress.match(/\[download\]\s+([0-9.]+)%/);
  if (percentMatch) {
    const percentage = parseFloat(percentMatch[1]);
    const fill = document.getElementById('progress-fill');
    const percentText = document.getElementById('progress-percent-text');
    if (fill && percentText) {
      fill.style.width = `${percentage}%`;
      percentText.textContent = `${Math.round(percentage)}%`;
      
      const statusText = document.getElementById('progress-status-text');
      if (percentage === 100) {
        statusText.textContent = 'Processing and finalizing files...';
      } else {
        statusText.textContent = 'Downloading media...';
      }
    }


  }
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
    
    let thumbnailHtml = '';
    if (videoId) {
      thumbnailHtml = `<img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail" class="recent-thumbnail" style="cursor: pointer;" title="Click to open folder">`;
    } else if (isInstagram) {
      thumbnailHtml = `<div class="recent-thumbnail" style="cursor: pointer; background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%); color: white; border: none;" title="Click to open folder">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>
      </div>`;
    } else {
      thumbnailHtml = `<div class="recent-thumbnail" style="cursor: pointer;" title="Click to open folder"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
    }
    
    li.innerHTML = `
      ${thumbnailHtml}
      <div class="recent-details">
        <a href="${item.url}" target="_blank" class="recent-url" title="${item.url}">${item.url}</a>
        <div class="recent-meta">
          <span class="badge">${item.type.toUpperCase()}</span>
          <span>${item.date}</span>
        </div>
      </div>
    `;

    const thumbEl = li.querySelector('.recent-thumbnail');
    if (thumbEl && item.filePath) {
      thumbEl.addEventListener('click', () => {
        window.electronAPI.openFolder(item.filePath);
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
    tempFormat: document.getElementById('settings-temp-format').value
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
const depStatusYt = document.getElementById('dep-status-yt');
const depStatusFfmpeg = document.getElementById('dep-status-ffmpeg');
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
    switch (data.type) {
      case 'checking':
        depModal.classList.add('active');
        if (depValYt) depValYt.textContent = 'Verifying...';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Verifying...';
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
        }
        break;

      case 'progress':
        if (depProgressFill) depProgressFill.style.width = `${data.progress}%`;
        if (depProgressPercent) depProgressPercent.textContent = `${data.progress}%`;
        
        if (data.item === 'yt-dlp') {
          if (depValYt) depValYt.textContent = `Downloading (${data.progress}%)...`;
        } else if (data.item === 'ffmpeg') {
          if (depValFfmpeg) depValFfmpeg.textContent = `Downloading (${data.progress}%)...`;
        }
        break;

      case 'extracting':
        if (depProgressFill) depProgressFill.style.width = '100%';
        if (depProgressPercent) depProgressPercent.textContent = '100%';
        if (depProgressText) depProgressText.textContent = 'Extracting FFmpeg binaries...';
        if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item extracting';
        if (depValFfmpeg) depValFfmpeg.textContent = 'Extracting...';
        break;

      case 'download-complete':
        if (data.item === 'yt-dlp') {
          if (depStatusYt) depStatusYt.className = 'dependency-status-item completed';
          if (depValYt) depValYt.textContent = 'Completed';
        } else if (data.item === 'ffmpeg') {
          if (depStatusFfmpeg) depStatusFfmpeg.className = 'dependency-status-item completed';
          if (depValFfmpeg) depValFfmpeg.textContent = 'Completed';
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
  
  // Skip button handler
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
        tempFormat: 'fahrenheit'
      };
      
      await window.electronAPI.finishOnboarding(onboardingData);
      currentSettings = { ...currentSettings, ...onboardingData, onboardingComplete: true };
      
      modal.classList.remove('active');
      await initSettingsUI();
    });
  }
  
  // Start button handler
  const btnStart = document.getElementById('btn-onboarding-start');
  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      btnStart.disabled = true;
      btnStart.textContent = 'Saving...';
      
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
        // Attempt search for input text if they didn't select from the list
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
              // Fallback to IP geolocation
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
          // Empty input: estimate via IP
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
      
      const onboardingData = {
        userName: userName,
        weatherCity: city,
        weatherLat: lat,
        weatherLon: lon,
        tempFormat: tempFormat
      };
      
      await window.electronAPI.finishOnboarding(onboardingData);
      currentSettings = { ...currentSettings, ...onboardingData, onboardingComplete: true };
      
      modal.classList.remove('active');
      await initSettingsUI();
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

