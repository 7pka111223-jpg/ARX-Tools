export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

export function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

// Splits a text item into whitespace-separated word tokens, each tagged with
// the page it came from. Shared by the rules-and-spelling pipeline and the
// standalone spelling pass so both tokenize identically.
export function splitWords(text, page) {
  return text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, page }));
}
