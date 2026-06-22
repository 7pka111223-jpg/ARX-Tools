import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummaryRow, renderRuleRow, renderSpellingRows } from '../../src/ui/render.js';
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

test('renderSpellingRows renders one row per misspelling with word, pages, and suggestions', () => {
  const html = renderSpellingRows({
    fileName: 'a.pdf',
    error: null,
    misspellings: [
      { word: 'clarifeir', pages: [1, 2], suggestions: ['clarifier'] },
      { word: 'recieve', pages: [3], suggestions: ['receive'] },
    ],
  });
  assert.equal((html.match(/<tr>/g) || []).length, 2);
  assert.ok(html.includes('clarifeir'));
  assert.ok(html.includes('clarifier'));
  assert.ok(html.includes('1, 2'));
});

test('renderSpellingRows shows a clean-bill row when there are no misspellings', () => {
  const html = renderSpellingRows({ fileName: 'a.pdf', error: null, misspellings: [] });
  assert.ok(html.includes('No misspellings found'));
});

test('renderSpellingRows shows the error for a file that could not be read', () => {
  const html = renderSpellingRows({ fileName: 'a.pdf', error: 'PDF is password-protected and could not be read.', misspellings: [] });
  assert.ok(html.includes('password-protected'));
  assert.ok(html.includes('class="fail"'));
});

test('renderSpellingRows escapes html-unsafe content', () => {
  const html = renderSpellingRows({ fileName: '<a>.pdf', error: null, misspellings: [{ word: '<script>', pages: [1], suggestions: ['<b>'] }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
