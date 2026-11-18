// Tiny event bus shared by the Compress tab modules (workspace, queue, compare, card).
// See docs/compress-spec.md section 4.3.
const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[compress-bus] listener for "${event}" failed:`, err);
    }
  }
}

function showCompressTab() {
  const btn = document.querySelector('.nav-btn[data-tab="compress-tab"]');
  if (btn && !btn.classList.contains('active')) btn.click();
}

function openFiles(paths, { presetId } = {}) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (list.length === 0) return;
  showCompressTab();
  emit('open-files', { paths: list, presetId: presetId || null });
}

function openCompare({ originalPath, compressedPath, startSeconds = 0, duration = null, label = '', speedFactor = 1 } = {}) {
  if (!originalPath || !compressedPath) return;
  showCompressTab();
  emit('open-compare', { originalPath, compressedPath, startSeconds, duration, label, speedFactor });
}

export const compressBus = { on, off, emit, openFiles, openCompare, showCompressTab };
