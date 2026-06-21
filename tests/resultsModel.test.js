import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrawingResult, aggregateResults } from '../src/resultsModel.js';

test('buildDrawingResult passes when there are no error-severity issues', () => {
  const result = buildDrawingResult('a.pdf', [{ severity: 'warn' }]);
  assert.equal(result.pass, true);
  assert.deepEqual(result.counts, { error: 0, warn: 1 });
});

test('buildDrawingResult fails when there is at least one error-severity issue', () => {
  const result = buildDrawingResult('a.pdf', [{ severity: 'warn' }, { severity: 'error' }]);
  assert.equal(result.pass, false);
  assert.deepEqual(result.counts, { error: 1, warn: 1 });
});

test('buildDrawingResult passes with no issues at all', () => {
  const result = buildDrawingResult('a.pdf', []);
  assert.equal(result.pass, true);
  assert.deepEqual(result.counts, { error: 0, warn: 0 });
});

test('aggregateResults summarizes total/passed/failed', () => {
  const r1 = buildDrawingResult('a.pdf', []);
  const r2 = buildDrawingResult('b.pdf', [{ severity: 'error' }]);
  const agg = aggregateResults([r1, r2]);
  assert.equal(agg.total, 2);
  assert.equal(agg.passed, 1);
  assert.equal(agg.failed, 1);
  assert.deepEqual(agg.drawings, [r1, r2]);
});
