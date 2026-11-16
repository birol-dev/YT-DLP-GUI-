// Shared HTML escaping for anything interpolated into innerHTML / attribute strings.
// Text that comes from outside the app (page titles, URLs, API responses, error
// messages, file names) must go through escapeHtml before it reaches the DOM.

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// Only http(s) URLs are allowed into href/src attributes; everything else becomes ''.
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}
