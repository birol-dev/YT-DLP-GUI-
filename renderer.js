// Tab switching logic
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    navBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Download Video
document.getElementById('btn-download-video').addEventListener('click', () => {
  const url = document.getElementById('video-url').value;
  const quality = document.getElementById('video-quality').value;
  if (!url) return;
  window.electronAPI.downloadVideo({ url, quality });
  document.getElementById('video-url').value = '';
});

// Download Audio
document.getElementById('btn-download-audio').addEventListener('click', () => {
  const url = document.getElementById('audio-url').value;
  if (!url) return;
  window.electronAPI.downloadAudio({ url });
  document.getElementById('audio-url').value = '';
});

// Download Subtitles
document.getElementById('btn-download-subs').addEventListener('click', () => {
  const url = document.getElementById('subs-url').value;
  const lang = document.getElementById('subs-lang').value;
  if (!url) return;
  window.electronAPI.downloadSubtitles({ url, lang });
  document.getElementById('subs-url').value = '';
});

// Download All Subtitles
document.getElementById('btn-download-all-subs').addEventListener('click', () => {
  const url = document.getElementById('subs-url').value;
  if (!url) return;
  // pass lang as 'all' to indicate downloading all subs
  window.electronAPI.downloadSubtitles({ url, lang: 'all' });
  document.getElementById('subs-url').value = '';
});

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
});

window.electronAPI.onDownloadComplete((data) => {
  appendLog(`[✓] Download Complete: ${data.url} (${data.type})`, 'log-success');
  saveRecent(data.url, data.type, data.filePath);
  if (currentSettings.soundEnabled) {
    playSuccessChime();
  }
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
    const thumbnailHtml = videoId 
      ? `<img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail" class="recent-thumbnail" style="cursor: pointer;" title="Click to open folder">`
      : `<div class="recent-thumbnail" style="cursor: pointer;" title="Click to open folder"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg></div>`;
    
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
  const newSettings = {
    downloadDir: document.getElementById('settings-save-dir').value,
    defaultQuality: document.getElementById('settings-default-quality').value,
    defaultSubLang: document.getElementById('settings-default-sublang').value,
    accentColor: selectedAccent,
    soundEnabled: document.getElementById('settings-sound-enabled').checked,
    autoOpenFolder: document.getElementById('settings-auto-open').checked
  };

  const success = await window.electronAPI.saveSettings(newSettings);
  if (success) {
    currentSettings = newSettings;
    
    // Instantly update main panel options
    if (document.getElementById('video-quality')) {
      document.getElementById('video-quality').value = currentSettings.defaultQuality || '1080';
    }
    if (document.getElementById('subs-lang')) {
      document.getElementById('subs-lang').value = currentSettings.defaultSubLang || 'en';
    }

    // Display nice animated visual feedback
    const indicator = document.getElementById('settings-save-indicator');
    indicator.style.display = 'inline-flex';
    setTimeout(() => {
      indicator.style.display = 'none';
    }, 3000);
  }
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
    document.getElementById('settings-sound-enabled').checked = !!currentSettings.soundEnabled;
    document.getElementById('settings-auto-open').checked = !!currentSettings.autoOpenFolder;
    
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
  } catch (err) {
    console.error('Failed to init settings UI:', err);
  }
}

// Run settings loader
initSettingsUI();
