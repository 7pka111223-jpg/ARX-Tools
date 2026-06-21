import { escapeHtml } from '../util.js';

export function renderSummaryRow(drawingResult) {
  const cls = drawingResult.pass ? 'pass' : 'fail';
  const label = drawingResult.pass ? 'PASS' : 'FAIL';
  return `<tr><td>${escapeHtml(drawingResult.fileName)}</td><td class="${cls}">${label}</td><td>${drawingResult.counts.error}</td><td>${drawingResult.counts.warn}</td></tr>`;
}

export function renderRuleOption(rule) {
  const suffix = rule.enabled ? '' : ' (disabled)';
  return `<option value="${escapeHtml(rule.id)}">${escapeHtml(rule.category)}: ${escapeHtml(rule.label)}${suffix}</option>`;
}
