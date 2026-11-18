// Compress integration with download-complete cards, the auto-download hook and the automation
// settings block. See docs/compress-spec.md §1.11 / §1.12 and §4.
import { compressBus } from './compress-bus.js';
import { escapeHtml } from './html.js';

const ICONS = {
  compress: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="m14 10 7-7"/><path d="m3 21 7-7"/></svg>',
  caret: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  folder: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12 6h6a2 2 0 0 1 2 2v2"/></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
};

const CARD_IDS = [
  'video-download-complete-card',
  'instagram-download-complete-card',
  'clipper-download-complete-card',
  'twitch-download-complete-card'
];

const QUICK_PRESET_IDS = ['discord', 'whatsapp', 'email', 'half', 'hevc-archive'];
// Shown until `compressListPresets` resolves (labels come from the main process afterwards).
const QUICK_PRESET_FALLBACK_LABELS = {
  discord: 'Discord (10 MB)',
  whatsapp: 'WhatsApp (16 MB)',
  email: 'Email (25 MB)',
  half: 'Half the size',
  'hevc-archive': 'Smaller (HEVC)'
};
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'flac', 'opus', 'ogg', 'aac'];
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'ts', 'mts', 'm2ts', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ogv', 'vob'];

let presetCache = { builtIn: [], custom: [] };
let automation = null;
let automationLoaded = false;

let popoverEl = null;
let popoverAnchor = null;
let popoverCloseHandler = null;

const confirmTimers = new WeakMap();

/* -------------------------------- helpers -------------------------------- */

function baseName(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function extensionOf(filePath) {
  const name = baseName(filePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isAudioFile(filePath) {
  return AUDIO_EXTENSIONS.includes(extensionOf(filePath));
}

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.includes(extensionOf(filePath));
}

function presetById(id) {
  const all = [...(presetCache.builtIn || []), ...(presetCache.custom || [])];
  return all.find((preset) => preset && preset.id === id) || null;
}

function allPresets() {
  return [...(presetCache.builtIn || []), ...(presetCache.custom || [])];
}

function runIpc(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[compress-card]', err && err.message ? err.message : err));
}

/* -------------------------------- presets -------------------------------- */

function loadPresets() {
  return Promise.resolve(window.electronAPI.compressListPresets())
    .then((result) => {
      presetCache = {
        builtIn: Array.isArray(result && result.builtIn) ? result.builtIn : [],
        custom: Array.isArray(result && result.custom) ? result.custom : []
      };
      return presetCache;
    })
    .catch((err) => {
      console.warn('[compress-card] Could not read presets:', err && err.message ? err.message : err);
      return presetCache;
    });
}

/* ---------------------------- automation state ---------------------------- */

function loadAutomation() {
  return Promise.resolve(window.electronAPI.compressGetAutomation())
    .then((value) => {
      automation = value || null;
      automationLoaded = true;
      return automation;
    })
    .catch((err) => {
      console.warn('[compress-card] Could not read automation settings:', err && err.message ? err.message : err);
      automation = null;
      automationLoaded = true;
      return null;
    });
}

function saveAutomation(partial) {
  return Promise.resolve(window.electronAPI.compressSetAutomation(partial))
    .then((value) => {
      if (value) {
        automation = value;
        automationLoaded = true;
      }
      return value;
    })
    .catch((err) => {
      console.warn('[compress-card] Could not save automation settings:', err && err.message ? err.message : err);
      return null;
    });
}

/* ============================ automation panel ============================ */

let autoToggle = null;
let autoPresetSelect = null;
let watchToggle = null;
let watchDirEl = null;
let watchChooseBtn = null;
let watchPresetSelect = null;
let watchStatusEl = null;

function presetOptionsHtml(selectedId) {
  const presets = allPresets();
  if (presets.length === 0) return '<option value="">No presets available</option>';
  return presets.map((preset) => {
    const label = String(preset.label || preset.id || '');
    const selected = preset.id === selectedId ? ' selected' : '';
    return `<option value="${escapeHtml(preset.id)}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
}

function buildAutomationPanel() {
  const root = document.getElementById('compress-automation-root');
  if (!root) return;
  root.textContent = '';

  const panel = document.createElement('div');
  panel.className = 'cmpq-panel cmpq-automation';
  panel.innerHTML = `
    <button type="button" class="cmpq-panel-header cmpq-automation-header cmpq-automation-toggle" data-role="auto-collapse" aria-expanded="false">
      <svg class="cmpq-automation-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      <span class="cmpq-title">Automation</span>
      <span class="cmpq-automation-summary" data-role="auto-summary">Off</span>
      <span class="cmpq-automation-note">Runs whenever the app is open.</span>
    </button>
    <div class="cmpq-automation-body" data-role="auto-body" hidden>
    <div class="cmpq-auto-block">
      <label class="switch-container cmpq-auto-switch">
        <input type="checkbox" data-role="auto-toggle">
        <span class="switch-slider"></span>
        <div class="switch-label-details">
          <span class="switch-title">Auto-compress after each video download</span>
          <span class="switch-description">Every successful video download is queued with the preset below. Audio and subtitle downloads are left alone.</span>
        </div>
      </label>
      <div class="cmpq-auto-row">
        <label class="cmpq-auto-label" for="cmpq-auto-preset">Preset</label>
        <select class="cmpq-auto-select" data-role="auto-preset" id="cmpq-auto-preset"></select>
      </div>
    </div>
    <div class="cmpq-auto-divider"></div>
    <div class="cmpq-auto-block">
      <label class="switch-container cmpq-auto-switch">
        <input type="checkbox" data-role="watch-toggle">
        <span class="switch-slider"></span>
        <div class="switch-label-details">
          <span class="switch-title">Watch folder</span>
          <span class="switch-description">New videos that appear in this folder (size stable for 3 s) are queued automatically. Outputs from this tab are ignored.</span>
        </div>
      </label>
      <div class="cmpq-auto-row">
        <span class="cmpq-auto-path" data-role="watch-dir">No folder selected</span>
        <button type="button" class="cmpq-mini-btn" data-role="watch-choose">${ICONS.folder}<span>Choose…</span></button>
      </div>
      <div class="cmpq-auto-row">
        <label class="cmpq-auto-label" for="cmpq-watch-preset">Preset</label>
        <select class="cmpq-auto-select" data-role="watch-preset" id="cmpq-watch-preset"></select>
      </div>
      <div class="cmpq-watch-status" data-role="watch-status" hidden></div>
    </div>
    </div>
  `;
  root.appendChild(panel);

  // Collapsed by default: most people set this up once. The header summary shows what is on.
  const collapseBtn = panel.querySelector('[data-role="auto-collapse"]');
  const body = panel.querySelector('[data-role="auto-body"]');
  automationSummaryEl = panel.querySelector('[data-role="auto-summary"]');
  let open = false;
  try { open = localStorage.getItem('compress-automation-open') === '1'; } catch (_) {}
  const setOpen = (value) => {
    open = value;
    body.hidden = !open;
    collapseBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.classList.toggle('is-open', open);
    try { localStorage.setItem('compress-automation-open', open ? '1' : '0'); } catch (_) {}
  };
  setOpen(open);
  collapseBtn.addEventListener('click', () => setOpen(!open));

  autoToggle = panel.querySelector('[data-role="auto-toggle"]');
  autoPresetSelect = panel.querySelector('[data-role="auto-preset"]');
  watchToggle = panel.querySelector('[data-role="watch-toggle"]');
  watchDirEl = panel.querySelector('[data-role="watch-dir"]');
  watchChooseBtn = panel.querySelector('[data-role="watch-choose"]');
  watchPresetSelect = panel.querySelector('[data-role="watch-preset"]');
  watchStatusEl = panel.querySelector('[data-role="watch-status"]');

  autoToggle.addEventListener('change', () => {
    runIpc(saveAutomation({ autoAfterDownload: autoToggle.checked }).then(() => refreshAutomationUI()));
  });
  autoPresetSelect.addEventListener('change', () => {
    runIpc(saveAutomation({ autoPresetId: autoPresetSelect.value }).then(() => refreshAutomationUI()));
  });
  watchToggle.addEventListener('change', () => {
    runIpc(saveAutomation({ watchEnabled: watchToggle.checked }).then(() => refreshAutomationUI()));
  });
  watchPresetSelect.addEventListener('change', () => {
    runIpc(saveAutomation({ watchPresetId: watchPresetSelect.value }).then(() => refreshAutomationUI()));
  });
  watchChooseBtn.addEventListener('click', () => {
    Promise.resolve(window.electronAPI.selectFolder())
      .then((folder) => {
        if (!folder) return null;
        return saveAutomation({ watchDir: folder });
      })
      .then(() => refreshAutomationUI())
      .catch((err) => console.warn('[compress-card] Folder selection failed:', err && err.message ? err.message : err));
  });

  refreshPresetSelects();
  refreshAutomationUI();
}

function refreshPresetSelects() {
  if (!autoPresetSelect || !watchPresetSelect) return;
  const currentAuto = automation ? automation.autoPresetId : null;
  const currentWatch = automation ? automation.watchPresetId : null;
  autoPresetSelect.innerHTML = presetOptionsHtml(currentAuto || 'discord');
  watchPresetSelect.innerHTML = presetOptionsHtml(currentWatch || 'half');
}

// The saved preset can be a custom one added after the select was built; add it instead of
// rebuilding the whole list so the user's current selection is never dropped.
function ensurePresetOption(select, presetId) {
  if (!presetId) return;
  if ([...select.options].some((option) => option.value === presetId)) return;
  const preset = presetById(presetId);
  const option = document.createElement('option');
  option.value = presetId;
  option.textContent = (preset && preset.label) || presetId;
  select.appendChild(option);
}

let automationSummaryEl = null;

function presetLabel(id) {
  const preset = presetById(id);
  return (preset && preset.label) || id || '';
}

function updateAutomationSummary(value) {
  if (!automationSummaryEl) return;
  const parts = [];
  if (value.autoAfterDownload) parts.push(`After download: ${presetLabel(value.autoPresetId)}`);
  if (value.watchEnabled) parts.push(value.watchActive ? 'Watching a folder' : 'Watch folder needs attention');
  automationSummaryEl.textContent = parts.length ? parts.join(' · ') : 'Off';
  automationSummaryEl.classList.toggle('is-on', parts.length > 0);
  automationSummaryEl.classList.toggle('is-warn', !!value.watchEnabled && !value.watchActive);
}

function refreshAutomationUI() {
  if (!autoToggle) return;
  const value = automation || {};
  updateAutomationSummary(value);
  autoToggle.checked = !!value.autoAfterDownload;
  watchToggle.checked = !!value.watchEnabled;

  if (autoPresetSelect && value.autoPresetId && autoPresetSelect.value !== value.autoPresetId) {
    ensurePresetOption(autoPresetSelect, value.autoPresetId);
    autoPresetSelect.value = value.autoPresetId;
  }
  if (watchPresetSelect && value.watchPresetId && watchPresetSelect.value !== value.watchPresetId) {
    ensurePresetOption(watchPresetSelect, value.watchPresetId);
    watchPresetSelect.value = value.watchPresetId;
  }

  if (watchDirEl) {
    watchDirEl.textContent = value.watchDir || 'No folder selected';
    watchDirEl.title = value.watchDir || '';
    watchDirEl.classList.toggle('is-empty', !value.watchDir);
  }

  if (watchStatusEl) {
    if (value.watchError) {
      watchStatusEl.hidden = false;
      watchStatusEl.className = 'cmpq-watch-status is-error';
      watchStatusEl.innerHTML = `${ICONS.alert}<span>${escapeHtml(value.watchError)}</span>`;
    } else if (value.watchActive && value.watchDir) {
      watchStatusEl.hidden = false;
      watchStatusEl.className = 'cmpq-watch-status is-active';
      watchStatusEl.innerHTML = `<span class="cmpq-watch-dot" aria-hidden="true"></span><span>Watching ${escapeHtml(value.watchDir)}</span>`;
    } else if (value.watchEnabled && !value.watchDir) {
      watchStatusEl.hidden = false;
      watchStatusEl.className = 'cmpq-watch-status is-idle';
      watchStatusEl.textContent = 'Choose a folder to start watching.';
    } else {
      watchStatusEl.hidden = true;
      watchStatusEl.textContent = '';
    }
  }
}

/* ====================== download-complete card button ===================== */

function wireCompressButtons() {
  for (const id of CARD_IDS) {
    const card = document.getElementById(id);
    if (!card) continue;
    const actions = card.querySelector('.download-complete-actions');
    if (!actions || actions.querySelector('.cmpk-split')) continue;

    const split = document.createElement('div');
    split.className = 'cmpk-split';
    split.innerHTML = `
      <button type="button" class="cmpk-main" data-role="main" title="Open this file in the Compress tab">
        ${ICONS.compress}<span>Compress</span>
      </button>
      <button type="button" class="cmpk-caret" data-role="caret" aria-haspopup="menu" aria-expanded="false"
              title="Queue with a quick preset" aria-label="Queue with a quick preset">
        ${ICONS.caret}
      </button>
    `;
    actions.appendChild(split);

    split.querySelector('[data-role="main"]').addEventListener('click', () => {
      const filePath = card.dataset.filePath;
      if (filePath) compressBus.openFiles([filePath]);
    });
    split.querySelector('[data-role="caret"]').addEventListener('click', (event) => {
      event.stopPropagation();
      togglePopover(card, split.querySelector('[data-role="caret"]'));
    });

    updateCardButton(card);
  }
}

function updateCardButton(card) {
  if (!card) return;
  const split = card.querySelector('.cmpk-split');
  if (!split) return;
  const filePath = card.dataset.filePath || '';
  const downloadType = String(card.dataset.downloadType || '').toLowerCase();
  const audioOnly = isAudioFile(filePath) || downloadType.includes('audio');
  const usable = filePath !== '' && !audioOnly;
  split.classList.toggle('is-disabled', !usable);
  split.querySelectorAll('button').forEach((btn) => {
    btn.disabled = !usable;
  });
  split.title = !filePath ? 'No file to compress' : usable ? '' : 'Audio files cannot be compressed';
}

/* --------------------------------- popover -------------------------------- */

const POPOVER_HTML = `
  <div class="cmpk-popover-title">Queue with</div>
  <div class="cmpk-popover-list" role="menu"></div>
`;

function getPopover() {
  if (popoverEl) return popoverEl;
  const el = document.createElement('div');
  el.className = 'cmpk-popover';
  el.hidden = true;
  el.innerHTML = POPOVER_HTML;
  document.body.appendChild(el);

  el.addEventListener('keydown', (event) => {
    const items = [...el.querySelectorAll('.cmpk-popover-item')];
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopover(true);
      return;
    }
    if (event.key === 'Tab') {
      closePopover(false);
      return;
    }
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  });

  popoverEl = el;
  return el;
}

function renderPopoverItems(card) {
  const el = getPopover();
  const list = el.querySelector('.cmpk-popover-list');
  const items = QUICK_PRESET_IDS.map((id) => presetById(id) || { id, label: QUICK_PRESET_FALLBACK_LABELS[id] || id });

  list.innerHTML = '';
  for (const preset of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmpk-popover-item';
    btn.dataset.presetId = preset.id;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `<span class="cmpk-popover-label">${escapeHtml(preset.label || preset.id)}</span>`;
    btn.addEventListener('click', () => {
      queueWithPreset(card, preset);
      closePopover(false);
    });
    list.appendChild(btn);
  }
}

function positionPopover(anchor) {
  const el = getPopover();
  const rect = anchor.getBoundingClientRect();
  el.style.visibility = 'hidden';
  el.hidden = false;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const gap = 6;
  const margin = 8;

  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - margin) {
    const above = rect.top - height - gap;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
  }
  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
  el.style.visibility = '';
}

function togglePopover(card, anchor) {
  const el = getPopover();
  if (!el.hidden && popoverAnchor === anchor) {
    closePopover(true);
    return;
  }
  closePopover(false);
  renderPopoverItems(card);
  popoverAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  positionPopover(anchor);

  popoverCloseHandler = (event) => {
    if (!popoverEl || popoverEl.hidden) return;
    if (event.type === 'keydown' && event.key === 'Escape') {
      event.preventDefault();
      closePopover(true);
      return;
    }
    if (popoverEl.contains(event.target) || (popoverAnchor && popoverAnchor.contains(event.target))) return;
    closePopover(false);
  };
  document.addEventListener('pointerdown', popoverCloseHandler, true);
  document.addEventListener('keydown', popoverCloseHandler, true);
  window.addEventListener('resize', onPopoverViewportChange, true);
  window.addEventListener('scroll', onPopoverViewportChange, true);

  const first = el.querySelector('.cmpk-popover-item');
  if (first) first.focus();
}

function onPopoverViewportChange() {
  if (popoverEl && !popoverEl.hidden && popoverAnchor) positionPopover(popoverAnchor);
  else closePopover(false);
}

function closePopover(restoreFocus) {
  if (!popoverEl || popoverEl.hidden) {
    if (popoverCloseHandler) detachPopoverListeners();
    return;
  }
  const anchor = popoverAnchor;
  popoverEl.hidden = true;
  popoverEl.style.visibility = '';
  if (anchor) {
    anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      try {
        anchor.focus();
      } catch (_) { /* ignore */ }
    }
  }
  popoverAnchor = null;
  detachPopoverListeners();
}

function detachPopoverListeners() {
  if (popoverCloseHandler) {
    document.removeEventListener('pointerdown', popoverCloseHandler, true);
    document.removeEventListener('keydown', popoverCloseHandler, true);
    popoverCloseHandler = null;
  }
  window.removeEventListener('resize', onPopoverViewportChange, true);
  window.removeEventListener('scroll', onPopoverViewportChange, true);
}

/* --------------------------- quick queue feedback -------------------------- */

function showQueuedConfirmation(card, preset) {
  showCardNotice(card, preset, false);
  const box = card.querySelector('.download-complete-actions')?.querySelector('.cmpk-confirm');
  if (!box) return;
  box.innerHTML = `
    <span class="cmpk-confirm-icon">${ICONS.check}</span>
    <span class="cmpk-confirm-text">Queued: ${escapeHtml(preset.label || preset.id)} —</span>
    <button type="button" class="cmpk-confirm-view" data-role="view">View</button>
  `;
  box.querySelector('[data-role="view"]').addEventListener('click', () => compressBus.showCompressTab());
}

function showQueueError(card, preset) {
  showCardNotice(card, preset, true);
}

// Shared tiny inline banner under the card's action row (queued confirmation or queue error).
function showCardNotice(card, preset, isError) {
  const actions = card.querySelector('.download-complete-actions');
  if (!actions) return;
  let box = actions.querySelector('.cmpk-confirm');
  if (!box) {
    box = document.createElement('div');
    box.className = 'cmpk-confirm';
    actions.appendChild(box);
  }
  box.classList.toggle('is-error', isError);
  box.innerHTML = `
    <span class="cmpk-confirm-icon">${isError ? ICONS.alert : ICONS.check}</span>
    <span class="cmpk-confirm-text">${isError
      ? `Could not queue ${escapeHtml(preset.label || preset.id)}.`
      : `Queued: ${escapeHtml(preset.label || preset.id)} —`}</span>
  `;
  box.hidden = false;

  const previous = confirmTimers.get(card);
  if (previous) clearTimeout(previous);
  confirmTimers.set(card, setTimeout(() => {
    box.hidden = true;
  }, 8000));
}

function queueWithPreset(card, preset) {
  const filePath = card.dataset.filePath;
  if (!filePath || !preset) return;
  Promise.resolve(window.electronAPI.compressEnqueue({
    jobs: [{ inputPath: filePath, options: { presetId: preset.id }, source: 'card' }]
  }))
    .then((result) => {
      const ids = result && Array.isArray(result.jobIds) ? result.jobIds : [];
      if (ids.length > 0) showQueuedConfirmation(card, preset);
      else showQueueError(card, preset);
    })
    .catch(() => showQueueError(card, preset));
}

/* ---------------------------- auto-compress hook --------------------------- */

function queueAutoCompress(data) {
  const filePath = data && data.filePath;
  if (!filePath) return;
  const type = String(data.type || '').toLowerCase();
  if (type.includes('audio') || type.includes('subtitle')) return;
  if (!isVideoFile(filePath)) return;
  if (baseName(filePath).toLowerCase().includes('(compressed')) return;
  if (!automation || !automation.autoAfterDownload) return;

  const presetId = automation.autoPresetId || 'discord';
  Promise.resolve(window.electronAPI.compressEnqueue({
    jobs: [{ inputPath: filePath, options: { presetId }, source: 'auto' }]
  })).catch(() => { /* keep the download flow quiet */ });
}

if (window.electronAPI.onDownloadComplete) {
  window.electronAPI.onDownloadComplete((data) => {
    if (!automationLoaded) {
      // Automation may not have arrived yet on the very first download; re-check once loaded.
      loadAutomation().then(() => {
        queueAutoCompress(data);
        refreshAutomationUI();
      });
      return;
    }
    queueAutoCompress(data);
  });
}

/* --------------------------------- wiring --------------------------------- */

document.addEventListener('download-card-shown', (event) => {
  const card = event.target && event.target.closest ? event.target.closest('.download-complete-card') : null;
  if (!card) return;
  updateCardButton(card);
  if (popoverEl && !popoverEl.hidden) closePopover(false);
});

compressBus.on('presets-changed', () => {
  loadPresets().then(() => {
    refreshPresetSelects();
    refreshAutomationUI();
  });
});

// Main pushes automation state when the watcher changes on its own (folder removed, watch error)
// and the preset list whenever a preset is saved or deleted anywhere.
if (typeof window.electronAPI.onCompressAutomationUpdate === 'function') {
  window.electronAPI.onCompressAutomationUpdate((value) => {
    if (!value) return;
    automation = value;
    automationLoaded = true;
    refreshAutomationUI();
  });
}
if (typeof window.electronAPI.onCompressPresetsUpdate === 'function') {
  window.electronAPI.onCompressPresetsUpdate((result) => {
    presetCache = {
      builtIn: Array.isArray(result && result.builtIn) ? result.builtIn : [],
      custom: Array.isArray(result && result.custom) ? result.custom : []
    };
    refreshPresetSelects();
    refreshAutomationUI();
  });
}

wireCompressButtons();
buildAutomationPanel();

loadPresets().then(() => {
  // Quick-preset labels may arrive after the buttons were built; popover is rebuilt on open.
  refreshPresetSelects();
  refreshAutomationUI();
});

loadAutomation().then(() => {
  refreshPresetSelects();
  refreshAutomationUI();
});
