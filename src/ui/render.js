import { escapeHtml } from '../util.js';

export function renderSummaryRow(drawingResult) {
  const cls = drawingResult.pass ? 'pass' : 'fail';
  const label = drawingResult.pass ? 'PASS' : 'FAIL';
  return `<tr><td>${escapeHtml(drawingResult.fileName)}</td><td class="${cls}">${label}</td><td>${drawingResult.counts.error}</td><td>${drawingResult.counts.warn}</td></tr>`;
}

export function renderRuleRow(rule) {
  const id = escapeHtml(rule.id);
  const sevClass = rule.severity === 'error' ? 'rule-badge--error' : 'rule-badge--warn';
  const disabledBadge = rule.enabled
    ? ''
    : '<span class="rule-badge rule-badge--off">Disabled</span>';
  return `<div class="rule-row${rule.enabled ? '' : ' is-disabled'}" data-rule-id="${id}">
    <div class="rule-row__main">
      <span class="rule-row__label">${escapeHtml(rule.label)}</span>
      <span class="rule-chips">
        <span class="rule-badge rule-badge--cat">${escapeHtml(rule.category)}</span>
        <span class="rule-badge ${sevClass}">${escapeHtml(rule.severity)}</span>
        ${disabledBadge}
      </span>
    </div>
    <div class="rule-row__actions">
      <button type="button" class="btn btn-sm rule-edit-btn" data-rule-id="${id}">Edit</button>
      <button type="button" class="btn btn-sm btn-danger rule-delete-btn" data-rule-id="${id}">Delete</button>
    </div>
  </div>`;
}

// Renders one-or-more <tr> rows for a single file's spelling result: a single
// status row for extraction errors or a clean bill of health, otherwise one
// row per distinct misspelled word with its suggested corrections.
const MAX_SUGGESTIONS = 5;

export function renderSpellingRows(result) {
  if (result.error) {
    return `<tr><td>${escapeHtml(result.fileName)}</td><td class="fail" colspan="4">${escapeHtml(result.error)}</td></tr>`;
  }
  if (result.misspellings.length === 0) {
    return `<tr><td>${escapeHtml(result.fileName)}</td><td class="pass" colspan="4">No misspellings found</td></tr>`;
  }
  return result.misspellings
    .map((m) => {
      const word = escapeHtml(m.word);
      const suggestions = m.suggestions.slice(0, MAX_SUGGESTIONS).join(', ') || '—';
      // The button carries the word so a delegated handler can add it to the
      // custom dictionary (useful for names/codes that aren't misspellings).
      const action = `<button type="button" class="btn btn-sm spell-add-btn" data-add-word="${word}">Add to dictionary</button>`;
      return `<tr><td>${escapeHtml(result.fileName)}</td><td>${word}</td><td>${escapeHtml(m.pages.join(', '))}</td><td>${escapeHtml(suggestions)}</td><td>${action}</td></tr>`;
    })
    .join('');
}
