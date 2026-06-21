export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

export function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}
