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
