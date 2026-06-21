import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryRow, renderRuleOption } from '../../src/ui/render.js';
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

test('renderRuleOption shows category, label, and a disabled marker when disabled', () => {
  const enabled = renderRuleOption({ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', enabled: true });
  assert.ok(enabled.includes('value="dwgNo"'));
  assert.ok(enabled.includes('titleBlock: DWG NO'));
  assert.ok(!enabled.includes('disabled'));

  const disabled = renderRuleOption({ id: 'rev', category: 'revision', label: 'REV', enabled: false });
  assert.ok(disabled.includes('(disabled)'));
});

test('renderRuleOption escapes html-unsafe labels', () => {
  const opt = renderRuleOption({ id: 'x', category: 'formatting', label: '<b>x</b>', enabled: true });
  assert.ok(!opt.includes('<b>x</b>'));
});
