import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryRow, renderRuleRow } from '../../src/ui/render.js';
import { buildDrawingResult } from '../../src/resultsModel.js';

test('renderSummaryRow shows PASS with the pass class for a passing drawing', () => {
  const row = renderSummaryRow(buildDrawingResult('a.pdf', []));
  assert.ok(row.includes('PASS'));
  assert.ok(row.includes('class="pass"'));
  assert.ok(row.includes('a.pdf'));
});

test('renderSummaryRow shows FAIL with the fail class for a failing drawing', () => {
  const row = renderSummaryRow(buildDrawingResult('b.pdf', [{ severity: 'error' }]));
  assert.ok(row.includes('FAIL'));
  assert.ok(row.includes('class="fail"'));
});

test('renderRuleRow shows label, category, severity, and per-row edit/delete actions', () => {
  const row = renderRuleRow({ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', severity: 'error', enabled: true });
  assert.ok(row.includes('data-rule-id="dwgNo"'));
  assert.ok(row.includes('DWG NO'));
  assert.ok(row.includes('titleBlock'));
  assert.ok(row.includes('error'));
  assert.ok(row.includes('rule-edit-btn'));
  assert.ok(row.includes('rule-delete-btn'));
  // An enabled rule shows no "Disabled" badge.
  assert.ok(!row.includes('>Disabled<'));
});

test('renderRuleRow marks a disabled rule with a Disabled badge', () => {
  const row = renderRuleRow({ id: 'rev', category: 'revision', label: 'REV', severity: 'warn', enabled: false });
  assert.ok(row.includes('>Disabled<'));
  assert.ok(row.includes('is-disabled'));
});

test('renderRuleRow escapes html-unsafe labels', () => {
  const row = renderRuleRow({ id: 'x', category: 'formatting', label: '<b>x</b>', severity: 'warn', enabled: true });
  assert.ok(!row.includes('<b>x</b>'));
});
