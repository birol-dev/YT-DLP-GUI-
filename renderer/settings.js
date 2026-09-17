import { stopDownloadIndicator } from './download.js';
import { setupCityAutocomplete, showOnboardingFlow } from './onboarding.js';
import { state } from './state.js';
import { initAppDashboard } from './weather.js';

// Settings Variables and State

// Success Sound Synthesizer
export function playSuccessChime() {
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
export function applyTheme(accent) {
  document.documentElement.setAttribute('data-theme', accent || 'default');
}

// Theme Picker Interactions
document.querySelectorAll('.theme-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedAccent = btn.dataset.theme;
    
    // Instant live preview
    applyTheme(state.selectedAccent);
    triggerAutoSave(0);
  });
});

// Select folder browser
document.getElementById('btn-select-dir')?.addEventListener('click', async () => {
  const dirPath = await window.electronAPI.selectFolder();
  if (dirPath) {
    document.getElementById('settings-save-dir').value = dirPath;
    triggerAutoSave(0);
  }
});

// Reset folder browser to default
document.getElementById('btn-reset-dir')?.addEventListener('click', () => {
  document.getElementById('settings-save-dir').value = '';
  triggerAutoSave(0);
});

export function showSaveIndicator(message = 'Settings saved!', isSuccess = true) {
  const indicator = document.getElementById('settings-save-indicator');
  if (!indicator) return;
  
  indicator.innerHTML = isSuccess
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${escapeHtml(message)}`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${escapeHtml(message)}`;
  
  indicator.style.color = isSuccess ? '#22c55e' : '#ef4444';
  indicator.style.display = 'inline-flex';
  
  if (indicator._timeout) clearTimeout(indicator._timeout);
  indicator._timeout = setTimeout(() => {
    indicator.style.display = 'none';
  }, 2500);
}

export function collectCurrentSettingsFromUI() {
  const settingsCityInputVal = document.getElementById('settings-weather-city')?.value.trim() || '';
  
  let lat = state.currentSettings.weatherLat ?? null;
  let lon = state.currentSettings.weatherLon ?? null;
  let city = state.currentSettings.weatherCity || '';
  
  if (settingsCityInputVal) {
    if (state.settingsCityData && state.settingsCityData.name === settingsCityInputVal) {
      city = state.settingsCityData.name;
      lat = state.settingsCityData.lat;
      lon = state.settingsCityData.lon;
    } else {
      city = settingsCityInputVal;
    }
  } else {
    city = '';
    lat = null;
    lon = null;
  }

  return {
    downloadDir: document.getElementById('settings-save-dir')?.value || '',
    defaultQuality: document.getElementById('settings-default-quality')?.value || '1080',
    defaultSubLang: document.getElementById('settings-default-sublang')?.value || 'en',
    videoFormat: document.getElementById('settings-video-format')?.value || 'mp4',
    audioFormat: document.getElementById('settings-audio-format')?.value || 'mp3',
    accentColor: state.selectedAccent || 'default',
    soundEnabled: !!document.getElementById('settings-sound-enabled')?.checked,
    autoOpenFolder: !!document.getElementById('settings-auto-open')?.checked,
    userName: document.getElementById('settings-user-name')?.value.trim() || '',
    weatherCity: city,
    weatherLat: lat,
    weatherLon: lon,
    tempFormat: document.getElementById('settings-temp-format')?.value || 'fahrenheit',
    musicFinderService: document.getElementById('settings-musicfinder-service')?.value || 'acoustid',
    acoustidKey: document.getElementById('settings-acoustid-key')?.value.trim() || '',
    acrcloudKey: document.getElementById('settings-acrcloud-key')?.value.trim() || '',
    acrcloudSecret: document.getElementById('settings-acrcloud-secret')?.value.trim() || '',
    acrcloudHost: document.getElementById('settings-acrcloud-host')?.value.trim() || 'identify-us-west-2.acrcloud.com',
    acoustidScanInterval: parseInt(document.getElementById('settings-scan-interval')?.value || '90', 10),
    cookiesFromBrowser: document.getElementById('settings-cookies-browser')?.value || '',
    cookiesBrowserProfile: document.getElementById('settings-cookies-profile')?.value.trim().replace(/^["']|["']$/g, '') || '',
    cookiesFile: document.getElementById('settings-cookies-file-path')?.value || '',
    ytDlpChannel: document.getElementById('settings-ytdlp-channel')?.value || state.currentSettings.ytDlpChannel || 'master',
    dismissedYtDlpChannelHint: !!(state.currentSettings.dismissedYtDlpChannelHint || (typeof localStorage !== 'undefined' && localStorage.getItem('dismissedYtDlpChannelHint') === 'true')),
    autoUpdateDependencies: !!document.getElementById('settings-auto-update-deps')?.checked
  };
}

export async function performSaveSettings(isManual = false) {
  if (state.isAutoSaving || state.isInitializingSettingsUI) return;
  state.isAutoSaving = true;

  try {
    const newSettings = collectCurrentSettingsFromUI();
    const success = await window.electronAPI.saveSettings(newSettings);

    if (success) {
      state.currentSettings = { ...state.currentSettings, ...newSettings };

      // Instantly update copywriting descriptions
      updateTabDescriptions(state.currentSettings);

      // Instantly update main panel options if present
      if (document.getElementById('video-quality')) {
        document.getElementById('video-quality').value = state.currentSettings.defaultQuality || '1080';
      }
      if (document.getElementById('subs-lang')) {
        document.getElementById('subs-lang').value = state.currentSettings.defaultSubLang || 'en';
      }

      await refreshYtDlpChannelInfo();
      await updateYtDlpChannelHintLabels();

      showSaveIndicator(isManual ? 'Settings saved!' : 'All changes auto-saved', true);
    } else {
      showSaveIndicator('Failed to save settings', false);
    }
  } catch (err) {
    console.error('Settings save error:', err);
    showSaveIndicator('Save error: ' + (err.message || 'Unknown'), false);
  } finally {
    state.isAutoSaving = false;
  }
}

export function triggerAutoSave(debounceMs = 0) {
  if (state.isInitializingSettingsUI) return;
  if (state.autoSaveTimer) {
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = null;
  }

  if (debounceMs > 0) {
    state.autoSaveTimer = setTimeout(() => {
      performSaveSettings(false);
    }, debounceMs);
  } else {
    performSaveSettings(false);
  }
}

// Bind settings auto-save on all setting form controls
[
  'settings-temp-format',
  'settings-default-quality',
  'settings-default-sublang',
  'settings-video-format',
  'settings-audio-format',
  'settings-cookies-browser',
  'settings-musicfinder-service',
  'settings-ytdlp-channel'
].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      if (id === 'settings-cookies-browser') updateCookiesSettingsVisibility();
      if (id === 'settings-musicfinder-service') toggleCredentialsContainers(el.value);
      if (id === 'settings-ytdlp-channel') refreshYtDlpChannelInfo();
      triggerAutoSave(0);
    });
  }
});

[
  'settings-sound-enabled',
  'settings-auto-open',
  'settings-auto-update-deps'
].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => triggerAutoSave(0));
  }
});

[
  'settings-user-name',
  'settings-weather-city',
  'settings-cookies-profile',
  'settings-acoustid-key',
  'settings-acrcloud-key',
  'settings-acrcloud-secret',
  'settings-acrcloud-host'
].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => triggerAutoSave(400));
    el.addEventListener('change', () => triggerAutoSave(0));
  }
});

const scanIntervalSlider = document.getElementById('settings-scan-interval');
if (scanIntervalSlider) {
  scanIntervalSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    const label = document.getElementById('label-scan-interval-val');
    if (label) label.textContent = `${val}s`;
    const mfInput = document.getElementById('musicfinder-scan-interval');
    if (mfInput) mfInput.value = val;
    const mfLabel = document.getElementById('label-musicfinder-scan-interval-val');
    if (mfLabel) mfLabel.textContent = `${val}s`;
  });
  scanIntervalSlider.addEventListener('change', () => {
    triggerAutoSave(0);
  });
}

// Manual Save button handler
document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
  await performSaveSettings(true);
});

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderCookiesTestStatus(result, isLoading = false) {
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

export function hideCookiesTestStatus() {
  const statusEl = document.getElementById('cookies-test-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.innerHTML = '';
    statusEl.className = 'cookies-test-status';
  }
}

export function renderYtDlpChannelStatus(result, isLoading = false, actionType = 'switch') {
  const statusEl = document.getElementById('ytdlp-channel-status');
  const switchBtn = document.getElementById('btn-switch-ytdlp-channel');
  const forceBtn = document.getElementById('btn-force-update-ytdlp');
  if (!statusEl) return;

  statusEl.style.display = 'block';
  statusEl.className = 'cookies-test-status';

  if (isLoading) {
    statusEl.classList.add('testing');
    const actionTitle = actionType === 'force' ? 'Forcefully updating yt-dlp...' : 'Switching yt-dlp build...';
    statusEl.innerHTML = `
      <div class="cookies-test-status-title">${actionTitle}</div>
      <div class="cookies-test-status-detail">Stopping any blocking tasks, downloading and installing the clean release binary. This may take a moment.</div>
    `;
    if (switchBtn) {
      switchBtn.disabled = true;
      switchBtn.textContent = 'Switching...';
    }
    if (forceBtn) {
      forceBtn.disabled = true;
      forceBtn.textContent = 'Updating...';
    }
    return;
  }

  if (switchBtn) {
    switchBtn.disabled = false;
    switchBtn.textContent = 'Switch Channel Now';
  }
  if (forceBtn) {
    forceBtn.disabled = false;
    forceBtn.textContent = 'Force Update yt-dlp';
  }

  if (!result) return;

  statusEl.classList.add(result.level || (result.ok ? 'success' : 'error'));

  let html = `<div class="cookies-test-status-title">${escapeHtml(result.message || 'Operation completed.')}</div>`;
  if (result.detail) {
    html += `<div class="cookies-test-status-detail">${escapeHtml(result.detail)}</div>`;
  }
  if (result.tip) {
    html += `<div class="cookies-test-status-tip">${escapeHtml(result.tip)}</div>`;
  }
  statusEl.innerHTML = html;
}

export async function refreshYtDlpChannelInfo() {
  const infoEl = document.getElementById('ytdlp-channel-info');
  const badgeEl = document.getElementById('ytdlp-status-badge');
  if (!infoEl || !window.electronAPI.getYtDlpInfo) return;

  try {
    const info = await window.electronAPI.getYtDlpInfo();
    if (!info.available) {
      infoEl.textContent = 'yt-dlp is not installed locally yet. It will be downloaded on first use or when you switch channels.';
      if (badgeEl) {
        badgeEl.textContent = 'Not Installed';
        badgeEl.style.backgroundColor = 'hsl(var(--destructive) / 0.15)';
        badgeEl.style.color = 'hsl(var(--destructive))';
      }
      return;
    }

    const installedChannel = info.installedChannel || info.channel || 'unknown';
    const selectedChannel = document.getElementById('settings-ytdlp-channel')?.value || info.channel || 'master';
    const mismatch = installedChannel && selectedChannel && installedChannel !== selectedChannel;
    infoEl.textContent = mismatch
      ? `Installed: ${installedChannel} (${info.version || 'unknown'}) — selected ${selectedChannel}. Click Switch Channel Now to apply.`
      : `Installed: ${installedChannel} (${info.version || 'unknown'})${info.local ? '' : ' via system PATH'}`;
    if (badgeEl) {
      badgeEl.textContent = `v${info.version || 'installed'}`;
      badgeEl.style.backgroundColor = 'hsl(142 76% 36% / 0.15)';
      badgeEl.style.color = '#22c55e';
    }
  } catch (err) {
    infoEl.textContent = 'Could not read yt-dlp version info.';
    if (badgeEl) {
      badgeEl.textContent = 'Error';
      badgeEl.style.backgroundColor = 'hsl(var(--destructive) / 0.15)';
      badgeEl.style.color = 'hsl(var(--destructive))';
    }
  }
}

const btnSwitchYtDlpChannel = document.getElementById('btn-switch-ytdlp-channel');
if (btnSwitchYtDlpChannel) {
  btnSwitchYtDlpChannel.addEventListener('click', async () => {
    const channel = document.getElementById('settings-ytdlp-channel')?.value || 'master';
    stopDownloadIndicator();
    renderYtDlpChannelStatus(null, true, 'switch');
    try {
      const result = await window.electronAPI.switchYtDlpChannel(channel);
      renderYtDlpChannelStatus(result, false, 'switch');
      if (result?.ok) {
        state.currentSettings = {
          ...state.currentSettings,
          ytDlpChannel: result.targetChannel || channel,
          ytDlpInstalledChannel: result.channel,
          ytDlpInstalledVersion: result.version
        };
      }
      await refreshYtDlpChannelInfo();
      await updateYtDlpChannelHintLabels();
    } catch (err) {
      renderYtDlpChannelStatus({
        ok: false,
        level: 'error',
        message: 'Channel switch could not be completed.',
        tip: err.message || 'Try again in a moment.'
      }, false, 'switch');
    }
  });
}

const btnForceUpdateYtDlp = document.getElementById('btn-force-update-ytdlp');
if (btnForceUpdateYtDlp) {
  btnForceUpdateYtDlp.addEventListener('click', async () => {
    const channel = document.getElementById('settings-ytdlp-channel')?.value || state.currentSettings.ytDlpChannel || 'master';
    stopDownloadIndicator();

    // Provide immediate visual feedback on the button
    const originalBtnHTML = btnForceUpdateYtDlp.innerHTML;
    btnForceUpdateYtDlp.disabled = true;
    btnForceUpdateYtDlp.innerHTML = `
      <div class="loading-spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display: inline-block; vertical-align: middle;"></div>
      <span>Updating...</span>
    `;

    renderYtDlpChannelStatus(null, true, 'force');
    try {
      const result = await window.electronAPI.forceUpdateYtDlp(channel);
      renderYtDlpChannelStatus(result, false, 'force');
      if (result?.ok) {
        state.currentSettings = {
          ...state.currentSettings,
          ytDlpChannel: result.targetChannel || channel,
          ytDlpInstalledChannel: result.channel,
          ytDlpInstalledVersion: result.version
        };
        showSaveIndicator(result.message || `yt-dlp updated to ${result.version || 'latest'}`, true);
      } else {
        showSaveIndicator(result?.message || 'Force update failed', false);
      }
      await refreshYtDlpChannelInfo();
      await updateYtDlpChannelHintLabels();
    } catch (err) {
      renderYtDlpChannelStatus({
        ok: false,
        level: 'error',
        message: 'Force update could not be completed.',
        tip: err.message || 'Try again in a moment.'
      }, false, 'force');
      showSaveIndicator('Force update failed: ' + (err.message || 'Unknown error'), false);
    } finally {
      btnForceUpdateYtDlp.disabled = false;
      btnForceUpdateYtDlp.innerHTML = originalBtnHTML;
    }
  });
}

const ytDlpChannelSelect = document.getElementById('settings-ytdlp-channel');
if (ytDlpChannelSelect) {
  ytDlpChannelSelect.addEventListener('change', () => {
    refreshYtDlpChannelInfo();
  });
}

if (window.electronAPI.onYtDlpChannelChanged) {
  window.electronAPI.onYtDlpChannelChanged((data) => {
    if (data?.ok === false) {
      renderYtDlpChannelStatus({
        ok: false,
        level: 'error',
        message: data.error || 'Failed to update build.',
        tip: 'Check your internet connection and try again.'
      });
      return;
    }

    if (data?.channel) {
      state.currentSettings = {
        ...state.currentSettings,
        ytDlpInstalledChannel: data.channel,
        ytDlpInstalledVersion: data.version,
        ytDlpChannel: data.targetChannel || data.channel
      };

      const isForceUpdate = data.source === 'force-update';
      renderYtDlpChannelStatus({
        ok: true,
        level: 'success',
        message: isForceUpdate
          ? `yt-dlp is now up to date on the ${data.channel} channel (${data.version}).`
          : `yt-dlp is now on the ${data.channel} channel (${data.version}).`
      }, false, isForceUpdate ? 'force' : 'switch');
    }
    refreshYtDlpChannelInfo();
    updateYtDlpChannelHintLabels();
  });
}

export async function refreshFfmpegInfo() {
  const infoEl = document.getElementById('ffmpeg-version-info');
  const badgeEl = document.getElementById('ffmpeg-status-badge');
  if (!infoEl || !window.electronAPI?.getFfmpegInfo) return;

  try {
    const info = await window.electronAPI.getFfmpegInfo();
    if (!info?.available) {
      infoEl.textContent = 'FFmpeg is not detected in local path or system PATH.';
      if (badgeEl) {
        badgeEl.textContent = 'Missing';
        badgeEl.style.backgroundColor = 'hsl(var(--destructive) / 0.15)';
        badgeEl.style.color = 'hsl(var(--destructive))';
      }
      return;
    }

    infoEl.textContent = `Installed: FFmpeg ${info.version || 'unknown'} (${info.local ? 'local build' : 'system PATH'})`;
    if (badgeEl) {
      badgeEl.textContent = `v${info.version || 'installed'}`;
      badgeEl.style.backgroundColor = 'hsl(142 76% 36% / 0.15)';
      badgeEl.style.color = '#22c55e';
    }
  } catch (err) {
    infoEl.textContent = 'Could not read FFmpeg version info.';
    if (badgeEl) {
      badgeEl.textContent = 'Error';
      badgeEl.style.backgroundColor = 'hsl(var(--destructive) / 0.15)';
      badgeEl.style.color = 'hsl(var(--destructive))';
    }
  }
}

export function updateLastUpdateCheckLabel(timestamp) {
  const labelEl = document.getElementById('label-last-update-check');
  if (!labelEl) return;
  if (!timestamp) {
    labelEl.textContent = 'Last checked: Never';
    return;
  }
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      labelEl.textContent = `Last checked: ${timestamp}`;
      return;
    }
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    labelEl.textContent = `Last checked: ${dateStr} at ${timeStr}`;
  } catch {
    labelEl.textContent = 'Last checked: Recently';
  }
}

let updateToastTimeout = null;

export function showUpdateToast({ title, detail, type = 'checking', canRetry = false, autoDismiss = 0 } = {}) {
  const toast = document.getElementById('update-notification-toast');
  const iconEl = document.getElementById('update-toast-icon');
  const titleEl = document.getElementById('update-toast-title');
  const detailEl = document.getElementById('update-toast-detail');
  const retryBtn = document.getElementById('btn-update-toast-retry');
  if (!toast) return;

  if (updateToastTimeout) {
    clearTimeout(updateToastTimeout);
    updateToastTimeout = null;
  }

  toast.classList.remove('checking', 'updating', 'success', 'error', 'toast-fade-out');
  toast.classList.add(type);

  if (iconEl) {
    if (type === 'checking' || type === 'updating') {
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="animate-spin-slow"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>`;
    } else if (type === 'success') {
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>`;
    } else if (type === 'error') {
      iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }
  }

  if (titleEl && title) titleEl.textContent = title;
  if (detailEl && detail) detailEl.textContent = detail;

  if (retryBtn) {
    retryBtn.style.display = canRetry ? 'inline-block' : 'none';
  }

  toast.style.display = 'flex';

  if (autoDismiss > 0) {
    updateToastTimeout = setTimeout(() => {
      dismissUpdateToast();
    }, autoDismiss);
  }
}

export function dismissUpdateToast() {
  const toast = document.getElementById('update-notification-toast');
  if (!toast) return;
  if (updateToastTimeout) {
    clearTimeout(updateToastTimeout);
    updateToastTimeout = null;
  }
  toast.classList.add('toast-fade-out');
  updateToastTimeout = setTimeout(() => {
    toast.style.display = 'none';
    toast.classList.remove('toast-fade-out');
    updateToastTimeout = null;
  }, 250);
}

const btnCheckAllUpdates = document.getElementById('btn-check-all-updates');
if (btnCheckAllUpdates) {
  btnCheckAllUpdates.addEventListener('click', async () => {
    const originalHtml = btnCheckAllUpdates.innerHTML;
    btnCheckAllUpdates.disabled = true;
    btnCheckAllUpdates.innerHTML = `
      <div class="loading-spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display: inline-block; vertical-align: middle;"></div>
      <span>Checking...</span>
    `;

    const resultBox = document.getElementById('dependency-update-result-box');
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.className = 'cookies-test-status testing';
      resultBox.innerHTML = '<div class="cookies-test-status-title">Checking for dependency updates...</div>';
    }

    try {
      const summary = await window.electronAPI.checkAllUpdates();
      if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.className = `cookies-test-status ${summary?.hasError ? 'error' : 'success'}`;
        resultBox.innerHTML = `
          <div class="cookies-test-status-title">${escapeHtml(summary?.message || 'Update check completed.')}</div>
          <div class="cookies-test-status-detail">yt-dlp: ${escapeHtml(summary?.ytDlp?.message || summary?.ytDlp?.version || 'Checked')} • FFmpeg: ${escapeHtml(summary?.ffmpeg?.message || summary?.ffmpeg?.version || 'Checked')}</div>
        `;
      }
      if (summary?.timestamp) {
        updateLastUpdateCheckLabel(summary.timestamp);
      }
      await refreshYtDlpChannelInfo();
      await refreshFfmpegInfo();
    } catch (err) {
      if (resultBox) {
        resultBox.style.display = 'block';
        resultBox.className = 'cookies-test-status error';
        resultBox.innerHTML = `<div class="cookies-test-status-title">Failed to check updates: ${escapeHtml(err.message || 'Unknown error')}</div>`;
      }
    } finally {
      btnCheckAllUpdates.disabled = false;
      btnCheckAllUpdates.innerHTML = originalHtml;
    }
  });
}

const btnForceUpdateFfmpeg = document.getElementById('btn-force-update-ffmpeg');
if (btnForceUpdateFfmpeg) {
  btnForceUpdateFfmpeg.addEventListener('click', async () => {
    const originalHtml = btnForceUpdateFfmpeg.innerHTML;
    btnForceUpdateFfmpeg.disabled = true;
    btnForceUpdateFfmpeg.innerHTML = `
      <div class="loading-spinner" style="width: 14px; height: 14px; border-width: 2px; margin-right: 6px; display: inline-block; vertical-align: middle;"></div>
      <span>Updating FFmpeg...</span>
    `;

    const statusEl = document.getElementById('ffmpeg-status');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.className = 'cookies-test-status testing';
      statusEl.innerHTML = '<div class="cookies-test-status-title">Updating FFmpeg...</div>';
    }

    try {
      const result = await window.electronAPI.updateFfmpeg();
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = `cookies-test-status ${result?.status === 'updated' || result?.status === 'up-to-date' ? 'success' : 'error'}`;
        statusEl.innerHTML = `
          <div class="cookies-test-status-title">${escapeHtml(result?.message || 'FFmpeg update completed.')}</div>
          ${result?.detail ? `<div class="cookies-test-status-detail">${escapeHtml(result.detail)}</div>` : ''}
        `;
      }
      await refreshFfmpegInfo();
      showSaveIndicator(result?.message || 'FFmpeg updated', result?.status !== 'error');
    } catch (err) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.className = 'cookies-test-status error';
        statusEl.innerHTML = `<div class="cookies-test-status-title">FFmpeg update error: ${escapeHtml(err.message || 'Unknown error')}</div>`;
      }
      showSaveIndicator('FFmpeg update failed', false);
    } finally {
      btnForceUpdateFfmpeg.disabled = false;
      btnForceUpdateFfmpeg.innerHTML = originalHtml;
    }
  });
}

document.getElementById('btn-update-toast-close')?.addEventListener('click', () => {
  dismissUpdateToast();
});

document.getElementById('btn-update-toast-retry')?.addEventListener('click', async () => {
  dismissUpdateToast();
  if (window.electronAPI?.checkAllUpdates) {
    try {
      await window.electronAPI.checkAllUpdates();
    } catch (err) {
      console.error('Retry update check failed:', err);
    }
  }
});

if (window.electronAPI?.onDependencyUpdateStatus) {
  window.electronAPI.onDependencyUpdateStatus((data) => {
    if (!data) return;

    if (data.phase === 'checking') {
      showUpdateToast({
        title: 'Checking for updates...',
        detail: data.message || 'Verifying yt-dlp and FFmpeg versions',
        type: 'checking',
        autoDismiss: 0
      });
    } else if (data.phase === 'downloading') {
      showUpdateToast({
        title: `Updating ${data.item === 'ffmpeg' ? 'FFmpeg' : (data.item === 'yt-dlp' ? 'yt-dlp' : 'Components')}...`,
        detail: data.message || 'Downloading latest release',
        type: 'updating',
        autoDismiss: 0
      });
    } else if (data.phase === 'progress') {
      if (data.progress !== undefined) {
        showUpdateToast({
          title: `Downloading ${data.item === 'ffmpeg' ? 'FFmpeg' : data.item}...`,
          detail: `${data.progress}% complete`,
          type: 'updating',
          autoDismiss: 0
        });
      }
      if (data.result?.item === 'yt-dlp') {
        refreshYtDlpChannelInfo();
      } else if (data.result?.item === 'ffmpeg') {
        refreshFfmpegInfo();
      }
    } else if (data.phase === 'extracting') {
      showUpdateToast({
        title: `Installing ${data.item === 'ffmpeg' ? 'FFmpeg' : data.item}...`,
        detail: data.message || 'Extracting and configuring files',
        type: 'updating',
        autoDismiss: 0
      });
    } else if (data.phase === 'completed') {
      updateLastUpdateCheckLabel(data.timestamp);
      refreshYtDlpChannelInfo();
      refreshFfmpegInfo();

      if (data.updatedCount > 0) {
        showUpdateToast({
          title: 'Updates Installed!',
          detail: data.message,
          type: 'success',
          autoDismiss: 6000
        });
      } else if (data.hasError) {
        showUpdateToast({
          title: 'Update Notice',
          detail: data.message,
          type: 'error',
          canRetry: true,
          autoDismiss: 8000
        });
      } else {
        showUpdateToast({
          title: 'Components Up to Date',
          detail: data.message,
          type: 'success',
          autoDismiss: 3500
        });
      }
    }
  });
}

export function updateCookiesSettingsVisibility() {
  const select = document.getElementById('settings-cookies-browser');
  if (!select) return;
  const val = select.value;
  const profileContainer = document.getElementById('settings-cookies-profile-container');
  const fileContainer = document.getElementById('settings-cookies-file-container');
  const browserHelp = document.getElementById('settings-cookies-browser-help');

  if (!val) {
    if (profileContainer) profileContainer.style.display = 'none';
    if (fileContainer) fileContainer.style.display = 'none';
    if (browserHelp) {
      browserHelp.textContent = 'Pass login cookies from your browser for age-gated or private content.';
    }
  } else if (val === 'file') {
    if (profileContainer) profileContainer.style.display = 'none';
    if (fileContainer) fileContainer.style.display = 'block';
    if (browserHelp) {
      browserHelp.textContent = 'Read cookies from a Netscape cookies text file (.txt). Perfect for locked browsers or advanced logins.';
    }
  } else if (val === 'app-browser') {
    if (profileContainer) profileContainer.style.display = 'none';
    if (fileContainer) fileContainer.style.display = 'none';
    if (browserHelp) {
      browserHelp.textContent = 'Uses cookies from the in-app browser (Browser tab). Navigate to YouTube or Instagram and log in there to authorize.';
    }
  } else {
    if (profileContainer) profileContainer.style.display = 'block';
    if (fileContainer) fileContainer.style.display = 'none';
    if (browserHelp) {
      browserHelp.textContent = `Extract cookies from your local ${val.charAt(0).toUpperCase() + val.slice(1)} browser database. Close the browser completely before testing or downloading.`;
    }
  }
}

const btnTestCookies = document.getElementById('btn-test-cookies');
if (btnTestCookies) {
  btnTestCookies.addEventListener('click', async () => {
    const browser = document.getElementById('settings-cookies-browser').value;
    const profile = document.getElementById('settings-cookies-profile').value.trim().replace(/^["']|["']$/g, '');
    const cookiesFile = document.getElementById('settings-cookies-file-path').value;
    const testUrl = document.getElementById('settings-cookies-test-url').value.trim();

    if (!browser) {
      renderCookiesTestStatus({
        ok: false,
        level: 'error',
        message: 'Select a browser or cookie option before testing.',
        tip: 'Choose Chrome, Edge, In-App Browser, or Custom File.'
      });
      return;
    }

    renderCookiesTestStatus(null, true);

    try {
      const result = await window.electronAPI.testBrowserCookies({ browser, profile, cookiesFile, testUrl });
      renderCookiesTestStatus(result);
    } catch (err) {
      renderCookiesTestStatus({
        ok: false,
        level: 'error',
        message: 'Cookie test could not be completed.',
        tip: err.message || 'Check settings, ensure the target browser is closed, or verify the cookies file is valid.'
      });
    }
  });
}

const cookiesBrowserSelect = document.getElementById('settings-cookies-browser');
if (cookiesBrowserSelect) {
  cookiesBrowserSelect.addEventListener('change', () => {
    updateCookiesSettingsVisibility();
    if (!cookiesBrowserSelect.value) {
      hideCookiesTestStatus();
    }
  });
}

const btnSelectCookiesFile = document.getElementById('btn-select-cookies-file');
if (btnSelectCookiesFile) {
  btnSelectCookiesFile.addEventListener('click', async () => {
    const filePath = await window.electronAPI.selectCookiesFile();
    if (filePath) {
      document.getElementById('settings-cookies-file-path').value = filePath;
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
        state.currentSettings = { ...state.currentSettings, ...resetSettings };
        alert("Onboarding has been reset! The application will now reload to start the setup wizard.");
        location.reload();
      } else {
        alert("Failed to reset onboarding settings.");
      }
    }
  });
}

// Dynamically update video/audio tab descriptions based on current format settings
const YTDLP_HINT_TABS = [
  { tabId: 'video-tab' },
  { tabId: 'audio-tab' },
  { tabId: 'instagram-tab', variant: 'instagram' },
  { tabId: 'subtitles-tab' },
  { tabId: 'clipper-tab' },
  { tabId: 'musicfinder-tab' },
  { tabId: 'divider-tab' },
  { tabId: 'browser-tab', placement: 'toolbar' }
];

export function getYtDlpHintMessage(variant) {
  if (variant === 'instagram') {
    return 'If Instagram downloads fail, switch yt-dlp builds in Settings. Try <strong>Master</strong> first, then <strong>Nightly</strong> or <strong>Stable</strong> if needed.';
  }
  return 'If downloads fail, open Settings and try another yt-dlp build: <strong>Stable</strong>, <strong>Nightly</strong>, or <strong>Master</strong>.';
}

export function openYtDlpChannelSettings() {
  const settingsBtn = document.querySelector('.nav-btn[data-tab="settings-tab"]');
  if (settingsBtn) settingsBtn.click();
  setTimeout(() => {
    const channelSelect = document.getElementById('settings-ytdlp-channel');
    channelSelect?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    channelSelect?.focus();
  }, 120);
}

export function isYtDlpChannelHintDismissed() {
  if (state.currentSettings && state.currentSettings.dismissedYtDlpChannelHint) return true;
  try {
    return localStorage.getItem('dismissedYtDlpChannelHint') === 'true';
  } catch (e) {
    return false;
  }
}

export function createYtDlpChannelHint(variant = 'default') {
  const hint = document.createElement('div');
  hint.className = 'ytdlp-channel-hint';
  hint.setAttribute('role', 'note');
  hint.innerHTML = `
    <svg class="ytdlp-channel-hint-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/></svg>
    <div class="ytdlp-channel-hint-body">
      <span class="ytdlp-channel-hint-message">${getYtDlpHintMessage(variant)}</span>
      <span class="ytdlp-channel-hint-current" data-ytdlp-hint-current>Checking installed yt-dlp...</span>
    </div>
    <button type="button" class="ytdlp-channel-hint-link">Open Settings</button>
    <button type="button" class="ytdlp-channel-hint-close" aria-label="Close warning">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  hint.querySelector('.ytdlp-channel-hint-link')?.addEventListener('click', openYtDlpChannelSettings);
  hint.querySelector('.ytdlp-channel-hint-close')?.addEventListener('click', async () => {
    // Remove all hint banners across all tabs immediately
    document.querySelectorAll('.ytdlp-channel-hint').forEach((el) => el.remove());
    // Persist dismissed preference in settings and localStorage permanently
    state.currentSettings.dismissedYtDlpChannelHint = true;
    try {
      localStorage.setItem('dismissedYtDlpChannelHint', 'true');
    } catch (e) {}
    await window.electronAPI.saveSettings({ dismissedYtDlpChannelHint: true });
  });
  return hint;
}

export function initYtDlpChannelHints() {
  if (isYtDlpChannelHintDismissed()) {
    document.querySelectorAll('.ytdlp-channel-hint').forEach((el) => el.remove());
    return;
  }

  YTDLP_HINT_TABS.forEach(({ tabId, variant, placement }) => {
    const tab = document.getElementById(tabId);
    if (!tab || tab.querySelector('.ytdlp-channel-hint')) return;

    const hint = createYtDlpChannelHint(variant);

    if (placement === 'toolbar') {
      const toolbar = tab.querySelector('#browser-toolbar');
      toolbar?.insertAdjacentElement('afterend', hint);
      return;
    }

    const cardHeader = tab.querySelector('.card .card-header');
    cardHeader?.insertAdjacentElement('afterend', hint);
  });

  updateYtDlpChannelHintLabels();
}

export async function updateYtDlpChannelHintLabels() {
  const labels = document.querySelectorAll('[data-ytdlp-hint-current]');
  if (!labels.length) return;

  let info = {
    channel: state.currentSettings?.ytDlpChannel || 'master',
    installedChannel: state.currentSettings?.ytDlpInstalledChannel || '',
    version: state.currentSettings?.ytDlpInstalledVersion || ''
  };

  try {
    if (window.electronAPI.getYtDlpInfo) {
      info = await window.electronAPI.getYtDlpInfo();
    }
  } catch {
    // Keep settings fallback.
  }

  const installedChannel = info.installedChannel || info.channel || 'unknown';
  const versionSuffix = info.version ? ` (${info.version})` : '';
  const text = `Currently installed: ${installedChannel}${versionSuffix}`;

  labels.forEach((el) => {
    el.textContent = text;
  });
}

export function updateTabDescriptions(settings) {
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
export async function initSettingsUI() {
  state.isInitializingSettingsUI = true;
  try {
    state.currentSettings = await window.electronAPI.getSettings();
    state.selectedAccent = state.currentSettings.accentColor || 'default';
    
    applyTheme(state.selectedAccent);
    
    document.getElementById('settings-save-dir').value = state.currentSettings.downloadDir || '';
    document.getElementById('settings-default-quality').value = state.currentSettings.defaultQuality || '1080';
    document.getElementById('settings-default-sublang').value = state.currentSettings.defaultSubLang || 'en';
    document.getElementById('settings-video-format').value = state.currentSettings.videoFormat || 'mp4';
    document.getElementById('settings-audio-format').value = state.currentSettings.audioFormat || 'mp3';
    document.getElementById('settings-sound-enabled').checked = !!state.currentSettings.soundEnabled;
    document.getElementById('settings-auto-open').checked = !!state.currentSettings.autoOpenFolder;
    const autoUpdateEl = document.getElementById('settings-auto-update-deps');
    if (autoUpdateEl) {
      autoUpdateEl.checked = state.currentSettings.autoUpdateDependencies !== false;
    }
    updateLastUpdateCheckLabel(state.currentSettings.lastUpdateCheck);
    document.getElementById('settings-cookies-browser').value = state.currentSettings.cookiesFromBrowser || '';
    document.getElementById('settings-cookies-profile').value = state.currentSettings.cookiesBrowserProfile || '';
    document.getElementById('settings-cookies-file-path').value = state.currentSettings.cookiesFile || '';
    updateCookiesSettingsVisibility();
    document.getElementById('settings-ytdlp-channel').value = state.currentSettings.ytDlpChannel || 'master';
    refreshYtDlpChannelInfo();
    refreshFfmpegInfo();
    const mfService = state.currentSettings.musicFinderService || 'acoustid';
    document.getElementById('settings-musicfinder-service').value = mfService;
    
    const mfServiceSelector = document.getElementById('musicfinder-service-selector');
    if (mfServiceSelector) {
      mfServiceSelector.value = mfService;
    }
    
    document.getElementById('settings-acoustid-key').value = state.currentSettings.acoustidKey || '';
    document.getElementById('settings-acrcloud-key').value = state.currentSettings.acrcloudKey || '';
    document.getElementById('settings-acrcloud-secret').value = state.currentSettings.acrcloudSecret || '';
    document.getElementById('settings-acrcloud-host').value = state.currentSettings.acrcloudHost || 'identify-us-west-2.acrcloud.com';
    
    toggleCredentialsContainers(mfService);

    const scanInterval = state.currentSettings.acoustidScanInterval || 90;
    document.getElementById('settings-scan-interval').value = scanInterval;
    document.getElementById('label-scan-interval-val').textContent = `${scanInterval}s`;
    const mfScanInterval = document.getElementById('musicfinder-scan-interval');
    if (mfScanInterval) {
      mfScanInterval.value = scanInterval;
      const mfScanIntervalLabel = document.getElementById('label-musicfinder-scan-interval-val');
      if (mfScanIntervalLabel) mfScanIntervalLabel.textContent = `${scanInterval}s`;
    }
    
    // Populate user profile settings inputs
    document.getElementById('settings-user-name').value = state.currentSettings.userName || '';
    document.getElementById('settings-weather-city').value = state.currentSettings.weatherCity || '';
    document.getElementById('settings-temp-format').value = state.currentSettings.tempFormat || 'fahrenheit';
    state.settingsCityData = {
      name: state.currentSettings.weatherCity || '',
      lat: state.currentSettings.weatherLat,
      lon: state.currentSettings.weatherLon
    };
    
    // Instantly update copywriting descriptions based on loaded settings
    updateTabDescriptions(state.currentSettings);
    
    document.querySelectorAll('.theme-option').forEach(btn => {
      if (btn.dataset.theme === state.selectedAccent) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Populate main panel dropdowns on startup
    if (document.getElementById('video-quality')) {
      document.getElementById('video-quality').value = state.currentSettings.defaultQuality || '1080';
    }
    if (document.getElementById('subs-lang')) {
      document.getElementById('subs-lang').value = state.currentSettings.defaultSubLang || 'en';
    }

    // Check if onboarding is complete
    if (!state.currentSettings.onboardingComplete) {
      showOnboardingFlow();
    } else {
      initAppDashboard();
    }

    initYtDlpChannelHints();
  } catch (err) {
    console.error('Failed to init settings UI:', err);
  } finally {
    state.isInitializingSettingsUI = false;
  }
}

// Run settings loader

const settingsCityInput = document.getElementById('settings-weather-city');
const settingsCityResults = document.getElementById('settings-city-results');
if (settingsCityInput && settingsCityResults) {
  setupCityAutocomplete(settingsCityInput, settingsCityResults, (data) => {
    state.settingsCityData = data;
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
    state.currentSettings.acoustidScanInterval = val;
    await window.electronAPI.saveSettings(state.currentSettings);
  });
}

// Toggle credentials containers visibility
export function toggleCredentialsContainers(service) {
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
    state.currentSettings.musicFinderService = val;
    await window.electronAPI.saveSettings(state.currentSettings);
  });
}
