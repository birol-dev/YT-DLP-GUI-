// Compare overlay: original vs compressed video with a wipe slider, side-by-side mode and a
// single shared transport. See docs/compress-spec.md §1.9 and §4.3 ('open-compare').
import { compressBus } from './compress-bus.js';
import { formatBytes } from './time.js';

const ICONS = {
  close: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  play: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  pause: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="4" height="16" x="6" y="4" rx="1"/><rect width="4" height="16" x="14" y="4" rx="1"/></svg>',
  columns: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>',
  wipe: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/><path d="m9 9-3 3 3 3"/></svg>',
  zoom: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  alert: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  external: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
};

const DRIFT_LIMIT = 0.15;

let overlay = null;
let modal = null;
let stageEl = null;
let videosEl = null;
let clipEl = null;
let originalVideo = null;
let compressedVideo = null;
let dividerEl = null;
let originalTag = null;
let compressedTag = null;
let errorEl = null;
let errorTextEl = null;
let playBtn = null;
let timeEl = null;
let scrubEl = null;
let scrubFill = null;
let scrubThumb = null;
let modeBtn = null;
let zoomBtn = null;
let modeHintEl = null;
let fileNameEl = null;
let lastFocused = null;
let abortController = null;
let rafId = 0;
let isPlaying = false;

const session = {
  originalPath: '',
  compressedPath: '',
  startSeconds: 0,
  speed: 1,
  loopEnd: 0,
  mode: 'wipe',
  wipe: 50,
  zoom: 1
};

/* -------------------------------- helpers -------------------------------- */

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function clockTime(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '0:00';
  const s = Math.floor(total);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function safeErrorText(err) {
  if (!err) return '';
  return String(err.message || err);
}

function baseName(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function buildOverlay() {
  const root = document.getElementById('compress-compare-root');
  if (!root) return null;

  root.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'cmpc-overlay';
  wrap.innerHTML = `
    <div class="cmpc-modal" role="dialog" aria-modal="true" aria-label="Compare original and compressed video">
      <header class="cmpc-header">
        <div class="cmpc-heading">
          <span class="cmpc-heading-icon">${ICONS.columns}</span>
          <span class="cmpc-heading-title">Compare</span>
          <span class="cmpc-heading-file"></span>
        </div>
        <div class="cmpc-header-actions">
          <button type="button" class="cmpc-toggle" data-role="mode" aria-pressed="false" title="Switch between wipe split and side-by-side">${ICONS.columns}<span>Side by side</span></button>
          <button type="button" class="cmpc-toggle" data-role="zoom" aria-pressed="false" title="Zoom both videos to inspect detail">${ICONS.zoom}<span>2× zoom</span></button>
          <button type="button" class="cmpc-icon-btn" data-role="close" title="Close (Esc)" aria-label="Close compare">${ICONS.close}</button>
        </div>
      </header>
      <div class="cmpc-stage">
        <div class="cmpc-videos" data-mode="wipe">
          <div class="cmpc-layer cmpc-layer-original">
            <video class="cmpc-video cmpc-video-original" playsinline preload="auto" muted></video>
          </div>
          <div class="cmpc-layer cmpc-layer-compressed">
            <video class="cmpc-video cmpc-video-compressed" playsinline preload="auto"></video>
          </div>
          <span class="cmpc-tag cmpc-tag-original">Original</span>
          <span class="cmpc-tag cmpc-tag-compressed">Compressed</span>
          <div class="cmpc-divider" role="slider" tabindex="0" aria-label="Wipe split position"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"
               title="Drag, or use ← → to move the split">
            <span class="cmpc-divider-line"></span>
            <span class="cmpc-divider-grip">${ICONS.wipe}</span>
          </div>
        </div>
        <div class="cmpc-error" hidden>
          <span class="cmpc-error-icon">${ICONS.alert}</span>
          <div class="cmpc-error-body">
            <strong>Can't play these files here</strong>
            <span class="cmpc-error-text"></span>
          </div>
          <button type="button" class="cmpc-error-btn" data-role="open-both">${ICONS.external}<span>Open both files</span></button>
        </div>
      </div>
      <footer class="cmpc-controls">
        <button type="button" class="cmpc-play" data-role="play" title="Play (Space)" aria-label="Play">${ICONS.play}</button>
        <span class="cmpc-time">0:00 / 0:00</span>
        <div class="cmpc-scrub" role="slider" tabindex="0" aria-label="Seek in the compared range"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" title="Drag or click to seek">
          <div class="cmpc-scrub-track"><div class="cmpc-scrub-fill"></div><div class="cmpc-scrub-thumb"></div></div>
        </div>
        <span class="cmpc-mode-hint">Drag the split to compare</span>
      </footer>
    </div>
  `;
  root.appendChild(wrap);
  return wrap;
}

function wireElements(wrap) {
  overlay = wrap;
  modal = wrap.querySelector('.cmpc-modal');
  stageEl = wrap.querySelector('.cmpc-stage');
  videosEl = wrap.querySelector('.cmpc-videos');
  clipEl = wrap.querySelector('.cmpc-layer-compressed');
  originalVideo = wrap.querySelector('.cmpc-video-original');
  compressedVideo = wrap.querySelector('.cmpc-video-compressed');
  dividerEl = wrap.querySelector('.cmpc-divider');
  originalTag = wrap.querySelector('.cmpc-tag-original');
  compressedTag = wrap.querySelector('.cmpc-tag-compressed');
  errorEl = wrap.querySelector('.cmpc-error');
  errorTextEl = wrap.querySelector('.cmpc-error-text');
  playBtn = wrap.querySelector('.cmpc-play');
  timeEl = wrap.querySelector('.cmpc-time');
  scrubEl = wrap.querySelector('.cmpc-scrub');
  scrubFill = wrap.querySelector('.cmpc-scrub-fill');
  scrubThumb = wrap.querySelector('.cmpc-scrub-thumb');
  modeBtn = wrap.querySelector('[data-role="mode"]');
  zoomBtn = wrap.querySelector('[data-role="zoom"]');
  modeHintEl = wrap.querySelector('.cmpc-mode-hint');
  fileNameEl = wrap.querySelector('.cmpc-heading-file');
}

/* ------------------------------- wipe / zoom ------------------------------- */

function applyWipe(value) {
  session.wipe = clampPercent(value);
  if (!clipEl || !dividerEl) return;
  // The clip layer stays untransformed so the split never moves when zooming.
  clipEl.style.clipPath = `inset(0 ${100 - session.wipe}% 0 0)`;
  clipEl.style.webkitClipPath = `inset(0 ${100 - session.wipe}% 0 0)`;
  dividerEl.style.left = `${session.wipe}%`;
  dividerEl.setAttribute('aria-valuenow', String(Math.round(session.wipe)));
  applyZoomOrigin();
}

function applyZoomOrigin() {
  if (!videosEl) return;
  const origin = session.mode === 'wipe' ? `${session.wipe}% center` : 'center center';
  for (const video of [originalVideo, compressedVideo]) {
    if (!video) continue;
    video.style.transformOrigin = origin;
  }
}

function applyZoom() {
  const scale = session.zoom === 2 ? 'scale(2)' : '';
  for (const video of [originalVideo, compressedVideo]) {
    if (video) video.style.transform = scale;
  }
  if (videosEl) videosEl.classList.toggle('is-zoomed', session.zoom === 2);
  if (zoomBtn) {
    zoomBtn.querySelector('span').textContent = session.zoom === 2 ? '1× zoom' : '2× zoom';
    zoomBtn.setAttribute('aria-pressed', session.zoom === 2 ? 'true' : 'false');
  }
  applyZoomOrigin();
}

function setMode(mode) {
  session.mode = mode === 'side' ? 'side' : 'wipe';
  const isWipe = session.mode === 'wipe';
  videosEl.dataset.mode = session.mode;
  dividerEl.hidden = !isWipe;
  if (clipEl) clipEl.style.clipPath = isWipe ? `inset(0 ${100 - session.wipe}% 0 0)` : '';
  modeBtn.innerHTML = `${isWipe ? ICONS.columns : ICONS.wipe}<span>${isWipe ? 'Side by side' : 'Wipe split'}</span>`;
  modeBtn.setAttribute('aria-pressed', isWipe ? 'false' : 'true');
  if (modeHintEl) {
    modeHintEl.textContent = isWipe ? 'Drag the split to compare' : 'Side by side — both files play in sync';
  }
  applyZoomOrigin();
}

/* -------------------------------- transport -------------------------------- */

function loopLength() {
  const duration = Number(compressedVideo && compressedVideo.duration);
  if (Number.isFinite(duration) && duration > 0) {
    return session.loopEnd > 0 ? Math.min(session.loopEnd, duration) : duration;
  }
  return session.loopEnd > 0 ? session.loopEnd : 0;
}

// The output may be trimmed and sped up: output time t shows source time start + t * speed.
function originalTimeFor(t) {
  return session.startSeconds + (Number(t) || 0) * (session.speed || 1);
}

function seekPair(seconds) {
  if (!compressedVideo) return;
  const length = loopLength();
  const target = Math.max(0, Math.min(length || 0, Number(seconds) || 0));
  try {
    compressedVideo.currentTime = target;
    originalVideo.currentTime = originalTimeFor(target);
  } catch (_) { /* not seekable yet */ }
  updateProgress(target, length);
  syncOriginal(true);
}

function updateProgress(current, length) {
  const total = length || loopLength();
  const pct = total > 0 ? clampPercent((current / total) * 100) : 0;
  if (scrubFill) scrubFill.style.width = `${pct}%`;
  if (scrubThumb) scrubThumb.style.left = `${pct}%`;
  if (scrubEl) {
    scrubEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    scrubEl.setAttribute('aria-valuetext', `${clockTime(current)} of ${clockTime(total)}`);
  }
  if (timeEl) timeEl.textContent = `${clockTime(current)} / ${clockTime(total)}`;
}

function syncOriginal(force) {
  if (!originalVideo || !compressedVideo) return;
  if (!force && !isPlaying) return;
  const target = originalTimeFor(compressedVideo.currentTime);
  if (force || Math.abs(originalVideo.currentTime - target) > DRIFT_LIMIT) {
    try {
      originalVideo.currentTime = target;
    } catch (_) { /* ignore transient seek errors */ }
  }
}

function tick() {
  rafId = 0;
  if (!isPlaying || !overlay || !compressedVideo) return;
  const length = loopLength();
  if (length > 0 && compressedVideo.currentTime >= length - 0.02) {
    seekPair(0);
    if (compressedVideo.paused) playBoth();
  } else {
    syncOriginal(false);
  }
  updateProgress(compressedVideo.currentTime, length);
  rafId = requestAnimationFrame(tick);
}

function startTicker() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function stopTicker() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function setPlayingUI(playing) {
  isPlaying = playing;
  if (playBtn) {
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.title = playing ? 'Pause (Space)' : 'Play (Space)';
  }
}

function playBoth() {
  if (!compressedVideo || !originalVideo) return;
  syncOriginal(true);
  Promise.all([
    compressedVideo.play(),
    originalVideo.play().catch(() => {})
  ])
    .then(() => {
      setPlayingUI(true);
      startTicker();
    })
    .catch((err) => showError('Playback could not start', err));
}

function pauseBoth() {
  if (compressedVideo) compressedVideo.pause();
  if (originalVideo) originalVideo.pause();
  setPlayingUI(false);
  stopTicker();
}

function togglePlay() {
  if (isPlaying) pauseBoth();
  else playBoth();
}

/* -------------------------------- errors --------------------------------- */

function showError(message, err) {
  pauseBoth();
  if (stageEl) stageEl.classList.add('has-error');
  if (errorEl) errorEl.hidden = false;
  if (errorTextEl) {
    const extra = safeErrorText(err);
    errorTextEl.textContent = extra ? `${message} (${extra})` : message;
  }
}

function openBothFiles() {
  if (session.originalPath) window.electronAPI.openFile(session.originalPath);
  if (session.compressedPath) window.electronAPI.openFile(session.compressedPath);
}

/* --------------------------------- sizes --------------------------------- */

function probeSafe(filePath) {
  if (!filePath) return Promise.resolve(null);
  return Promise.resolve(window.electronAPI.compressProbe(filePath)).catch(() => null);
}

function fillSizes() {
  Promise.all([probeSafe(session.originalPath), probeSafe(session.compressedPath)]).then(([originalProbe, compressedProbe]) => {
    if (!overlay) return;
    const originalSize = originalProbe && Number(originalProbe.size) > 0 ? ` · ${formatBytes(originalProbe.size)}` : '';
    const compressedSize = compressedProbe && Number(compressedProbe.size) > 0 ? ` · ${formatBytes(compressedProbe.size)}` : '';
    if (originalTag) originalTag.textContent = `Original${originalSize}`;
    if (compressedTag) compressedTag.textContent = `Compressed${compressedSize}`;
  });
}

/* ------------------------------ open / close ------------------------------ */

function resetSession() {
  pauseBoth();
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  for (const video of [originalVideo, compressedVideo]) {
    if (!video) continue;
    video.pause();
    video.removeAttribute('src');
    try {
      video.load();
    } catch (_) { /* ignore */ }
  }
  if (overlay) overlay.remove();
  overlay = null;
  modal = null;
  stageEl = null;
  videosEl = null;
  clipEl = null;
  originalVideo = null;
  compressedVideo = null;
  dividerEl = null;
  originalTag = null;
  compressedTag = null;
  errorEl = null;
  errorTextEl = null;
  playBtn = null;
  timeEl = null;
  scrubEl = null;
  scrubFill = null;
  scrubThumb = null;
  modeBtn = null;
  zoomBtn = null;
  modeHintEl = null;
  fileNameEl = null;
  lastFocused = null;
  session.originalPath = '';
  session.compressedPath = '';
  session.startSeconds = 0;
  session.speed = 1;
  session.loopEnd = 0;
  session.mode = 'wipe';
  session.wipe = 50;
  session.zoom = 1;
}

function closeCompare() {
  const restoreTo = lastFocused;
  lastFocused = null;
  resetSession();
  if (restoreTo && typeof restoreTo.focus === 'function' && document.contains(restoreTo)) {
    try {
      restoreTo.focus();
    } catch (_) { /* ignore */ }
  }
}

/* ------------------------------ input handling ---------------------------- */

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isButtonTarget(target) {
  if (!target || !target.closest) return false;
  return !!target.closest('button, [role="button"], a[href]');
}

function trapFocus(event) {
  if (!modal || event.key !== 'Tab') return;
  const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !modal.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function onKeyDown(event) {
  if (!overlay) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCompare();
    return;
  }
  // Space is play/pause everywhere except on buttons, which need it for their own activation.
  if (event.key === ' ' && !isTypingTarget(event.target) && !isButtonTarget(event.target)) {
    event.preventDefault();
    togglePlay();
    return;
  }
  if (document.activeElement === dividerEl && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    applyWipe(session.wipe + (event.key === 'ArrowRight' ? step : -step));
    return;
  }
  if (document.activeElement === scrubEl && compressedVideo
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    seekPair(compressedVideo.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
  }
}

function wireEvents(wrap, controller) {
  const { signal } = controller;

  // Backdrop click closes.
  wrap.addEventListener('pointerdown', (event) => {
    if (event.target === wrap) closeCompare();
  }, { signal });

  wrap.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    const role = btn.dataset.role;
    if (role === 'close') closeCompare();
    else if (role === 'play') togglePlay();
    else if (role === 'mode') setMode(session.mode === 'wipe' ? 'side' : 'wipe');
    else if (role === 'zoom') {
      session.zoom = session.zoom === 2 ? 1 : 2;
      applyZoom();
    } else if (role === 'open-both') openBothFiles();
  }, { signal });

  document.addEventListener('keydown', onKeyDown, { signal });
  document.addEventListener('keydown', trapFocus, { signal });

  // Wipe handle: pointer drag (mouse, touch, pen) plus keyboard (handled above).
  let dragging = false;
  const moveTo = (clientX) => {
    const rect = videosEl.getBoundingClientRect();
    if (!rect.width) return;
    applyWipe(((clientX - rect.left) / rect.width) * 100);
  };
  dividerEl.addEventListener('pointerdown', (event) => {
    dragging = true;
    try {
      dividerEl.setPointerCapture(event.pointerId);
    } catch (_) { /* ignore */ }
    dividerEl.classList.add('is-dragging');
    event.preventDefault();
  }, { signal });
  dividerEl.addEventListener('pointermove', (event) => {
    if (dragging) moveTo(event.clientX);
  }, { signal });
  const endDrag = () => {
    dragging = false;
    dividerEl.classList.remove('is-dragging');
  };
  dividerEl.addEventListener('pointerup', endDrag, { signal });
  dividerEl.addEventListener('pointercancel', endDrag, { signal });
  dividerEl.addEventListener('lostpointercapture', endDrag, { signal });

  // Scrub bar: click/drag to seek the shared timeline.
  let scrubbing = false;
  const seekTo = (clientX) => {
    const rect = scrubEl.getBoundingClientRect();
    if (!rect.width) return;
    seekPair(((clientX - rect.left) / rect.width) * loopLength());
  };
  scrubEl.addEventListener('pointerdown', (event) => {
    scrubbing = true;
    try {
      scrubEl.setPointerCapture(event.pointerId);
    } catch (_) { /* ignore */ }
    seekTo(event.clientX);
    event.preventDefault();
  }, { signal });
  scrubEl.addEventListener('pointermove', (event) => {
    if (scrubbing) seekTo(event.clientX);
  }, { signal });
  const endScrub = () => { scrubbing = false; };
  scrubEl.addEventListener('pointerup', endScrub, { signal });
  scrubEl.addEventListener('pointercancel', endScrub, { signal });
  scrubEl.addEventListener('lostpointercapture', endScrub, { signal });

  compressedVideo.addEventListener('timeupdate', () => {
    updateProgress(compressedVideo.currentTime, loopLength());
  }, { signal });

  compressedVideo.addEventListener('play', () => {
    if (!isPlaying) {
      setPlayingUI(true);
      startTicker();
    }
  }, { signal });
  compressedVideo.addEventListener('pause', () => {
    if (isPlaying) {
      setPlayingUI(false);
      stopTicker();
    }
  }, { signal });
  compressedVideo.addEventListener('ended', () => pauseBoth(), { signal });

  for (const [video, label] of [[originalVideo, 'Original'], [compressedVideo, 'Compressed']]) {
    video.addEventListener('error', () => {
      // The error fired while clearing src on close is not a real failure.
      if (!video.getAttribute('src')) return;
      showError(`${label} file can't be played in the app`, null);
    }, { signal });
  }
}

function openCompare(payload) {
  if (!payload || !payload.originalPath || !payload.compressedPath) return;
  if (overlay) closeCompare();
  const wrap = buildOverlay();
  if (!wrap) return;
  wireElements(wrap);

  session.originalPath = payload.originalPath;
  session.compressedPath = payload.compressedPath;
  session.startSeconds = Math.max(0, Number(payload.startSeconds) || 0);
  session.speed = Number(payload.speedFactor) > 0 ? Number(payload.speedFactor) : 1;
  session.loopEnd = Math.max(0, Number(payload.duration) || 0);

  lastFocused = document.activeElement;
  abortController = new AbortController();
  wireEvents(wrap, abortController);

  if (fileNameEl) {
    fileNameEl.textContent = payload.label || baseName(payload.compressedPath);
    fileNameEl.title = payload.compressedPath;
  }

  applyWipe(50);
  setMode('wipe');
  applyZoom();
  updateProgress(0, 0);
  fillSizes();

  Promise.all([
    Promise.resolve(window.electronAPI.getFileUrl(payload.originalPath)),
    Promise.resolve(window.electronAPI.getFileUrl(payload.compressedPath))
  ])
    .then(([originalUrl, compressedUrl]) => {
      if (!overlay || !originalVideo || !compressedVideo) return;
      originalVideo.src = originalUrl;
      compressedVideo.src = compressedUrl;
      originalVideo.load();
      compressedVideo.load();

      originalVideo.addEventListener('loadedmetadata', () => {
        try {
          originalVideo.currentTime = session.startSeconds;
          originalVideo.playbackRate = session.speed || 1;
        } catch (_) { /* ignore */ }
        syncOriginal(true);
      }, { once: true });
      compressedVideo.addEventListener('loadedmetadata', () => {
        updateProgress(0, loopLength());
      }, { once: true });
    })
    .catch((err) => showError('Could not open these files for playback', err));

  if (playBtn) {
    try {
      playBtn.focus();
    } catch (_) { /* ignore */ }
  }
}

compressBus.on('open-compare', (payload) => openCompare(payload));
