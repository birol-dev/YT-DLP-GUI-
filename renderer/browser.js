import { appendLog, startDownloadIndicator } from './download.js';
import { state } from './state.js';
import { secondsToHHMMSS } from './time.js';

// ==========================================
// Browser Tab & Media Sniffer Logic
// ==========================================

let detectedMediaList = [];

export function getPlaceholderBounds() {
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

export function loadAddressBarUrl() {
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

export function getUrlDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

export function updateSnifferUI() {
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
    item.dataset.mediaUrl = media.url;
    
    let iconSvg = '';
    const isAudio = media.contentType && media.contentType.toLowerCase().startsWith('audio/');
    if (isAudio) {
      iconSvg = `<div class="sniffer-icon audio" style="color: hsl(var(--accent-cyan)); margin-right: 6px; display: flex; align-items: center;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    } else {
      iconSvg = `<div class="sniffer-icon video" style="color: hsl(var(--primary)); margin-right: 6px; display: flex; align-items: center;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/></svg></div>`;
    }
    
    let displayTitle = media.title || 'Media Stream';
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
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 3"/></svg>
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
          if (state.isDownloading) {
            alert('A download is already in progress. Please wait for the current download to finish!');
            appendLog('[⚠️ Warning] A download is already in progress. Concurrent downloads are disabled.', 'log-warn');
            return;
          }
          
          if (domain.includes('instagram.com')) {
            startDownloadIndicator('Downloading Instagram video...');
            window.electronAPI.downloadInstagram({ url: pageUrl, format: 'video' });
          } else {
            startDownloadIndicator('Downloading video...');
            window.electronAPI.downloadVideo({ url: pageUrl, quality: state.currentSettings.defaultQuality || '1080' });
          }
          
          const downloadsBtn = document.querySelector('.nav-btn[data-tab="video-tab"]');
          if (downloadsBtn) downloadsBtn.click();
        } else {
          if (state.isDownloading) {
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
    
    const existingItem = snifferMediaList?.querySelector(`[data-media-url="${CSS.escape(probedData.url)}"]`);
    if (existingItem) {
      const metaContainer = existingItem.querySelector('.sniffer-media-meta');
      if (metaContainer) {
        const isHls = probedData.url.includes('.m3u8');
        const isAudio = detectedMediaList[index].contentType && detectedMediaList[index].contentType.toLowerCase().startsWith('audio/');
        const badgeText = isHls ? 'HLS Stream' : (isAudio ? 'Audio' : 'Video');
        let resolutionText = '';
        let durationText = '';
        let codecText = '';
        
        if (probedData.width && probedData.height) {
          resolutionText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--primary) / 0.15); color: hsl(var(--primary)); border: 1px solid hsl(var(--primary) / 0.3); font-weight: 600;">${probedData.width}x${probedData.height}</span>`;
        }
        if (probedData.duration) {
          durationText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">${secondsToHHMMSS(probedData.duration)}</span>`;
        } else if (isHls) {
          durationText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">Live / Adaptive</span>`;
        }
        if (probedData.vcodec && probedData.vcodec !== 'Unknown') {
          codecText = `<span class="badge" style="padding: 1px 4px; font-size: 0.6rem; background-color: hsl(var(--secondary)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); font-weight: 600;">${probedData.vcodec}</span>`;
        }
        metaContainer.innerHTML = `
          <span class="badge" style="padding: 1px 4px; font-size: 0.6rem;">${badgeText}</span>
          ${resolutionText}
          ${durationText}
          ${codecText}
        `;
        return;
      }
    }
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

export function buildMediaPreviewSrc(url, pageUrl) {
  const params = new URLSearchParams();
  params.set('url', url);
  if (pageUrl) params.set('pageUrl', pageUrl);
  return `media-preview://fetch?${params.toString()}`;
}

export function restoreBrowserViewIfActive() {
  const activeTab = document.querySelector('.nav-btn.active');
  if (activeTab && activeTab.dataset.tab === 'browser-tab') {
    setTimeout(() => {
      window.electronAPI.browserViewInit(getPlaceholderBounds());
    }, 50);
  }
}

export function loadHlsJs() {
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

export async function playPreview(url, title, mediaMeta) {
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
