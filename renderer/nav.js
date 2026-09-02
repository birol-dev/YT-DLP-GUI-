import { getPlaceholderBounds } from './browser.js';

// Tab switching logic
const navBtns = document.querySelectorAll('.nav-btn');
const tabContents = document.querySelectorAll('.tab-content');

export function updateTerminalVisibility(tabId) {
  const terminalEl = document.querySelector('.status-terminal');
  const progressEl = document.getElementById('download-progress-container');
  
  if (terminalEl) {
    if (tabId === 'settings-tab' || tabId === 'divider-tab' || tabId === 'musicfinder-tab' || tabId === 'browser-tab' || tabId === 'gif-tab') {
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
    const gifPlayer = document.getElementById('gif-video-player');
    if (gifPlayer && typeof gifPlayer.pause === 'function') {
      gifPlayer.pause();
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
