// Compress queue panel: renders live job rows into #compress-queue-root.
// See docs/compress-spec.md §1.10 and §4.
import { compressBus } from './compress-bus.js';
import { copyTextToClipboard, flashCopyPathButton } from './download.js';
import { saveRecent } from './recents.js';
import { playSuccessChime } from './settings.js';
import { state } from './state.js';
import { formatBytes } from './time.js';

const ICONS = {
  file: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  chevron: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
  retry: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  play: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  folder: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2A2 2 0 0 0 12 6h6a2 2 0 0 1 2 2v2"/></svg>',
  compare: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  copy: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
};

const STATUS_LABELS = {
  queued: 'Queued',
  running: 'Compressing',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled'
};
const SOURCE_LABELS = { auto: 'Auto', watch: 'Watch', card: 'Card' };

let panel = null;
let listEl = null;
let countEl = null;
let emptyEl = null;
let confirmEl = null;
let clearBtn = null;
let cancelAllBtn = null;
let confirmTimer = null;
const rows = new Map();
const dragBindings = new WeakMap();

/* ------------------------------- helpers -------------------------------- */

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function baseName(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[/\\]/);
  return parts[parts.length - 1] || String(filePath);
}

function formatEta(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '';
  const s = Math.floor(total);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mmss = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

function runIpc(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[compress-queue]', err && err.message ? err.message : err));
}

/* ------------------------------- panel UI ------------------------------- */

function ensurePanel() {
  if (panel && panel.isConnected) return panel;
  if (panel && !panel.isConnected) {
    // Builder B's markup may have replaced the tab contents; rebuild inside the current root.
    panel = null;
    rows.clear();
  }
  const root = document.getElementById('compress-queue-root');
  if (!root) return null;

  root.textContent = '';
  const panelEl = document.createElement('div');
  panelEl.className = 'cmpq-panel';
  panelEl.innerHTML = `
    <div class="cmpq-panel-header">
      <button type="button" class="cmpq-collapse" data-role="collapse" title="Collapse queue" aria-expanded="true">${ICONS.chevron}</button>
      <span class="cmpq-title">Queue</span>
      <span class="cmpq-count cmpq-count-empty">Empty</span>
      <div class="cmpq-header-actions">
        <button type="button" class="cmpq-ghost-btn" data-role="clear" disabled>Clear finished</button>
        <button type="button" class="cmpq-ghost-btn cmpq-danger-btn" data-role="cancel-all" disabled>Cancel all</button>
      </div>
    </div>
    <div class="cmpq-confirm" hidden>
      <span class="cmpq-confirm-text">Cancel the running job and remove everything queued?</span>
      <button type="button" class="cmpq-mini-btn cmpq-danger-btn" data-role="confirm-cancel">Cancel all</button>
      <button type="button" class="cmpq-mini-btn" data-role="dismiss-cancel">Keep jobs</button>
    </div>
    <div class="cmpq-body">
      <div class="cmpq-empty">No jobs yet — drop files above or use a preset.</div>
      <div class="cmpq-list"></div>
    </div>
  `;

  root.appendChild(panelEl);
  panel = panelEl;
  listEl = panelEl.querySelector('.cmpq-list');
  countEl = panelEl.querySelector('.cmpq-count');
  emptyEl = panelEl.querySelector('.cmpq-empty');
  confirmEl = panelEl.querySelector('.cmpq-confirm');
  clearBtn = panelEl.querySelector('[data-role="clear"]');
  cancelAllBtn = panelEl.querySelector('[data-role="cancel-all"]');
  panelEl.addEventListener('click', handlePanelClick);
  return panel;
}

function hideConfirm() {
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  if (confirmEl) confirmEl.hidden = true;
}

function showConfirm() {
  if (!confirmEl) return;
  confirmEl.hidden = false;
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(hideConfirm, 6000);
}

function handlePanelClick(event) {
  const btn = event.target.closest('button');
  if (!btn || !panel || !panel.contains(btn)) return;

  const role = btn.dataset.role;
  if (role === 'collapse') {
    const collapsed = panel.classList.toggle('is-collapsed');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.title = collapsed ? 'Expand queue' : 'Collapse queue';
    return;
  }
  if (role === 'clear') {
    runIpc(window.electronAPI.compressClearFinished());
    return;
  }
  if (role === 'cancel-all') {
    if (confirmEl && !confirmEl.hidden) return;
    showConfirm();
    return;
  }
  if (role === 'confirm-cancel') {
    hideConfirm();
    runIpc(window.electronAPI.compressCancel('all'));
    return;
  }
  if (role === 'dismiss-cancel') {
    hideConfirm();
    return;
  }

  const action = btn.dataset.action;
  if (!action) {
    const errorToggle = btn.closest('.cmpq-error-toggle');
    if (errorToggle) {
      const rowEl = errorToggle.closest('.cmpq-row');
      const entry = rowEl ? rows.get(rowEl.dataset.jobId) : null;
      if (!entry) return;
      toggleError(entry, errorToggle);
    }
    return;
  }

  const rowEl = btn.closest('.cmpq-row');
  const entry = rowEl ? rows.get(rowEl.dataset.jobId) : null;
  if (!entry) return;
  handleRowAction(action, entry, btn);
}

function toggleError(entry, toggleBtn) {
  const expanded = entry.errorEl.hidden === false;
  entry.errorEl.hidden = expanded;
  toggleBtn.textContent = expanded ? 'Show error' : 'Hide error';
  toggleBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
}

function handleRowAction(action, entry, btn) {
  const job = entry.job;
  if (!job) return;
  switch (action) {
    case 'cancel':
      runIpc(window.electronAPI.compressCancel(job.id));
      break;
    case 'remove':
      runIpc(window.electronAPI.compressRemove(job.id));
      break;
    case 'retry':
      runIpc(window.electronAPI.compressRetry(job.id));
      break;
    case 'open-file':
      if (job.outputPath) window.electronAPI.openFile(job.outputPath);
      break;
    case 'open-folder':
      if (job.outputPath) window.electronAPI.openFolder(job.outputPath);
      break;
    case 'compare':
      if (job.inputPath && job.outputPath) {
        compressBus.openCompare({ originalPath: job.inputPath, compressedPath: job.outputPath, startSeconds: job.sourceStart || 0, speedFactor: job.speedFactor || 1 });
      }
      break;
    case 'copy-path': {
      const target = job.outputPath || job.inputPath;
      if (!target) return;
      copyTextToClipboard(target);
      flashCopyPathButton(btn);
      break;
    }
    default:
      break;
  }
}

/* -------------------------------- rows ---------------------------------- */

function jobName(job) {
  if (job.status === 'done' && job.outputPath) return baseName(job.outputPath);
  return job.filename || baseName(job.inputPath) || 'Untitled';
}

function rowStatusText(job) {
  return STATUS_LABELS[job.status] || String(job.status || '');
}

function actionButton(action, icon, label, title, variant) {
  const cls = ['cmpq-action'];
  if (variant) cls.push(`cmpq-action-${variant}`);
  const text = label ? `<span>${label}</span>` : '';
  const titleAttr = title ? ` title="${title}"` : '';
  return `<button type="button" class="${cls.join(' ')}" data-action="${action}"${titleAttr}>${icon}${text}</button>`;
}

function actionsHtml(job) {
  if (job.status === 'running') {
    return actionButton('cancel', ICONS.x, 'Cancel', 'Cancel this job', 'danger');
  }
  if (job.status === 'queued') {
    return actionButton('remove', ICONS.trash, 'Remove', 'Remove from queue', 'danger');
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    return actionButton('retry', ICONS.retry, 'Retry', 'Compress this file again', 'primary')
      + actionButton('remove', ICONS.trash, 'Remove', 'Remove from queue', 'danger');
  }
  if (job.status === 'done') {
    return actionButton('open-file', ICONS.play, 'Play', 'Open the compressed file', '')
      + actionButton('open-folder', ICONS.folder, 'Show folder', 'Show in folder', '')
      + actionButton('compare', ICONS.compare, 'Compare', 'Compare original vs compressed', '')
      + actionButton('copy-path', ICONS.copy, 'Copy path', 'Copy the output path', '');
  }
  return '';
}

function createRow(job) {
  const el = document.createElement('div');
  el.className = 'cmpq-row';
  el.dataset.jobId = String(job.id);
  el.innerHTML = `
    <div class="cmpq-drag" title="Drag to save the compressed file">${ICONS.file}</div>
    <div class="cmpq-row-main">
      <div class="cmpq-row-top">
        <span class="cmpq-name"></span>
        <span class="cmpq-source" hidden></span>
        <span class="cmpq-status"></span>
      </div>
      <div class="cmpq-summary"></div>
      <div class="cmpq-progress">
        <div class="cmpq-progress-track"><div class="cmpq-progress-fill"></div></div>
        <div class="cmpq-progress-meta">
          <span class="cmpq-percent"></span>
          <span class="cmpq-pass" hidden></span>
          <span class="cmpq-stats"></span>
        </div>
      </div>
      <div class="cmpq-sizes" hidden></div>
      <button type="button" class="cmpq-error-toggle" hidden>Show error</button>
      <pre class="cmpq-error" hidden></pre>
      <div class="cmpq-actions"></div>
    </div>
  `;

  const entry = {
    el,
    job,
    nameEl: el.querySelector('.cmpq-name'),
    sourceEl: el.querySelector('.cmpq-source'),
    statusEl: el.querySelector('.cmpq-status'),
    summaryEl: el.querySelector('.cmpq-summary'),
    fillEl: el.querySelector('.cmpq-progress-fill'),
    percentEl: el.querySelector('.cmpq-percent'),
    passEl: el.querySelector('.cmpq-pass'),
    statsEl: el.querySelector('.cmpq-stats'),
    sizesEl: el.querySelector('.cmpq-sizes'),
    errorToggle: el.querySelector('.cmpq-error-toggle'),
    errorEl: el.querySelector('.cmpq-error'),
    actionsEl: el.querySelector('.cmpq-actions'),
    dragEl: el.querySelector('.cmpq-drag'),
    actionsKey: '',
    status: ''
  };
  return entry;
}

function updateRow(entry, job) {
  const prevStatus = entry.status;
  entry.job = job;
  entry.status = job.status;

  entry.nameEl.textContent = jobName(job);
  entry.nameEl.title = job.inputPath || jobName(job);

  const sourceLabel = SOURCE_LABELS[job.source];
  if (sourceLabel) {
    entry.sourceEl.hidden = false;
    entry.sourceEl.textContent = sourceLabel;
    entry.sourceEl.dataset.source = job.source;
  } else {
    entry.sourceEl.hidden = true;
  }

  entry.statusEl.textContent = rowStatusText(job);
  entry.statusEl.className = `cmpq-status cmpq-status-${job.status || 'queued'}`;
  entry.summaryEl.textContent = job.summary || '';

  const percent = clampPercent(job.percent);
  const shownPercent = job.status === 'done' ? 100 : percent;
  entry.fillEl.style.width = `${shownPercent}%`;
  entry.fillEl.classList.toggle('is-done', job.status === 'done');
  entry.fillEl.classList.toggle('is-indeterminate', job.status === 'running' && percent === 0 && !job.pass);
  entry.percentEl.textContent = `${Math.round(percent)} %`;
  // A queued job has no progress yet; the status pill already says "Queued".
  const progressRow = entry.fillEl.closest('.cmpq-progress') || entry.fillEl.parentElement;
  if (progressRow) progressRow.hidden = job.status === 'queued';
  entry.percentEl.hidden = job.status === 'queued';

  const passes = Number(job.passes) || 0;
  if (passes > 1 && job.status === 'running') {
    const pass = Math.max(1, Math.min(passes, Number(job.pass) || 1));
    entry.passEl.hidden = false;
    entry.passEl.textContent = `Pass ${pass}/${passes}`;
  } else {
    entry.passEl.hidden = true;
  }

  const stats = [];
  const fps = Number(job.fps);
  if (Number.isFinite(fps) && fps > 0) stats.push(`${Math.round(fps)} fps`);
  const speed = Number(job.speed);
  if (Number.isFinite(speed) && speed > 0) stats.push(`${speed.toFixed(2)}×`);
  const eta = formatEta(job.etaSeconds);
  if (job.status === 'running' && eta) stats.push(`ETA ${eta}`);
  entry.statsEl.textContent = stats.join(' · ');

  if (job.status === 'done' && Number(job.inputSize) > 0 && Number(job.outputSize) > 0) {
    const saved = Math.round((1 - Number(job.outputSize) / Number(job.inputSize)) * 100);
    const sign = saved >= 0 ? '−' : '+';
    entry.sizesEl.hidden = false;
    entry.sizesEl.textContent = saved === 0
      ? `${formatBytes(job.inputSize)} → ${formatBytes(job.outputSize)} (same size)`
      : `${formatBytes(job.inputSize)} → ${formatBytes(job.outputSize)} (${sign}${Math.abs(saved)} %)`;
    entry.sizesEl.dataset.saved = String(saved);
    entry.sizesEl.classList.toggle('is-shrunk', saved > 0);
  } else {
    entry.sizesEl.hidden = true;
  }

  const errorText = job.status === 'failed' ? String(job.error || '').trim() : '';
  if (errorText) {
    entry.errorToggle.hidden = false;
    entry.errorEl.textContent = errorText;
  } else {
    entry.errorToggle.hidden = true;
    entry.errorToggle.textContent = 'Show error';
    entry.errorToggle.setAttribute('aria-expanded', 'false');
    entry.errorEl.hidden = true;
    entry.errorEl.textContent = '';
  }

  // Rebuild the action row only when what it offers changed.
  const actionsKey = `${job.status}|${job.outputPath || ''}|${job.inputPath || ''}`;
  if (entry.actionsKey !== actionsKey) {
    entry.actionsKey = actionsKey;
    entry.actionsEl.innerHTML = actionsHtml(job);
  }

  entry.el.classList.toggle('is-done', job.status === 'done');
  entry.el.classList.toggle('is-failed', job.status === 'failed');

  // Only finished jobs have a file that can be dragged out.
  bindDragOut(entry.dragEl, job.status === 'done' ? job.outputPath || '' : '');
  entry.dragEl.title = job.status === 'done'
    ? 'Drag to save the compressed file'
    : 'File icon';

  if (prevStatus && prevStatus !== job.status) {
    entry.el.classList.remove('cmpq-row-flash');
    // Force a reflow so the animation replays on status changes.
    void entry.el.offsetWidth;
    entry.el.classList.add('cmpq-row-flash');
  }
}

function bindDragOut(el, filePath) {
  if (!el) return;
  const previous = dragBindings.get(el);
  if (previous && previous.filePath === filePath) return;
  if (previous && previous.controller) previous.controller.abort();
  dragBindings.delete(el);

  el.removeAttribute('draggable');
  el.querySelectorAll('img, svg').forEach((child) => child.setAttribute('draggable', 'false'));
  if (!filePath) {
    dragBindings.set(el, { filePath: '', controller: null });
    return;
  }

  const controller = new AbortController();
  const { signal } = controller;
  dragBindings.set(el, { filePath, controller });
  el.setAttribute('draggable', 'true');

  let nativeDragActive = false;
  el.addEventListener('pointerdown', () => { nativeDragActive = false; }, { signal });
  el.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    nativeDragActive = true;
    window.electronAPI.startFileDrag(filePath);
  }, { signal });
  el.addEventListener('click', () => {
    if (nativeDragActive) {
      nativeDragActive = false;
      return;
    }
    window.electronAPI.openFolder(filePath);
  }, { signal });
}

/* ------------------------------ rendering ------------------------------- */

function renderJobs(jobs) {
  if (!ensurePanel()) return;
  const safeJobs = Array.isArray(jobs) ? jobs.filter((job) => job && job.id) : [];

  const seen = new Set();
  for (const job of safeJobs) seen.add(String(job.id));
  for (const [id, entry] of rows) {
    if (seen.has(id)) continue;
    entry.el.remove();
    rows.delete(id);
  }

  safeJobs.forEach((job, index) => {
    let entry = rows.get(String(job.id));
    if (!entry) {
      entry = createRow(job);
      rows.set(String(job.id), entry);
      listEl.appendChild(entry.el);
      updateRow(entry, job);
    } else {
      updateRow(entry, job);
    }
    const nodeAtIndex = listEl.children[index] || null;
    if (nodeAtIndex !== entry.el) listEl.insertBefore(entry.el, nodeAtIndex);
  });

  updateHeader(safeJobs);
}

function updateHeader(jobs) {
  const running = jobs.filter((job) => job.status === 'running').length;
  const queued = jobs.filter((job) => job.status === 'queued').length;
  const finished = jobs.filter((job) => job.status === 'done' || job.status === 'failed' || job.status === 'cancelled').length;

  let label = 'Empty';
  if (running > 0 && queued > 0) label = `${running} running · ${queued} queued`;
  else if (running > 0) label = `${running} running`;
  else if (queued > 0) label = `${queued} queued`;
  else if (finished > 0) label = `${finished} finished`;

  if (countEl) {
    countEl.textContent = label;
    countEl.classList.toggle('cmpq-count-empty', jobs.length === 0);
    countEl.classList.toggle('cmpq-count-active', running > 0 || queued > 0);
    countEl.title = `${running} running · ${queued} queued · ${finished} finished`;
  }
  if (clearBtn) clearBtn.disabled = finished === 0;
  if (cancelAllBtn) cancelAllBtn.disabled = running === 0 && queued === 0;
  if (running === 0 && queued === 0) hideConfirm();
  if (emptyEl) emptyEl.hidden = jobs.length > 0;
  if (listEl) listEl.hidden = jobs.length === 0;
}

/* -------------------------------- wiring -------------------------------- */

function loadQueue() {
  if (!ensurePanel()) return;
  Promise.resolve(window.electronAPI.compressGetQueue())
    .then((jobs) => renderJobs(jobs))
    .catch((err) => console.warn('[compress-queue] Could not load queue:', err && err.message ? err.message : err));
}

loadQueue();

if (window.electronAPI.onCompressQueueUpdate) {
  window.electronAPI.onCompressQueueUpdate((jobs) => renderJobs(jobs));
}

if (window.electronAPI.onCompressJobDone) {
  window.electronAPI.onCompressJobDone((job) => {
    if (!job || job.status !== 'done') return;
    // A completed job without a known path still belongs in the queue; the row shows "Done" and
    // no output actions. Only chime/recents need a real output file.
    if (!job.outputPath) return;
    if (state.currentSettings && state.currentSettings.soundEnabled) {
      try {
        playSuccessChime();
      } catch (_) { /* audio is optional */ }
    }
    saveRecent(job.outputPath, 'compress', job.outputPath);
  });
}
