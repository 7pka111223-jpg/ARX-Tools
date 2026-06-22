import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testPattern, testFormat } from '../../src/ui/patternTester.js';

test('testPattern: a matching value reports ok=true', () => {
  const result = testPattern('^[A-Z]{2}-\\d{3}$', 'AB-123');
  assert.deepEqual(result, { ok: true, error: null });
});

test('testPattern: a non-matching value reports ok=false', () => {
  const result = testPattern('^[A-Z]{2}-\\d{3}$', 'ab-123');
  assert.deepEqual(result, { ok: false, error: null });
});

test('testPattern: requires the whole value to match, not just a substring', () => {
  const result = testPattern('^[A-Z]{2}-\\d{3}$', 'AB-123-EXTRA');
  assert.equal(result.ok, false);
});

test('testPattern: an invalid regex returns the error message instead of throwing', () => {
  const result = testPattern('(', 'anything');
  assert.equal(result.ok, null);
  assert.equal(typeof result.error, 'string');
  assert.ok(result.error.length > 0);
});

test('testPattern: an empty pattern returns a neutral ok=null with no error', () => {
  const result = testPattern('', 'anything');
  assert.deepEqual(result, { ok: null, error: null });
});

test('testFormat: flags found matches that do not satisfy the valid regex', () => {
  const result = testFormat('\\d{1,2}/\\d{1,2}/\\d{2,4}', '^\\d{4}-\\d{2}-\\d{2}$', 'Issued 01/02/2024');
  assert.equal(result.error, null);
  assert.deepEqual(result.matches, [{ text: '01/02/2024', ok: false }]);
});

test('testFormat: a found match that also satisfies valid is marked ok', () => {
  const result = testFormat('\\d{4}-\\d{2}-\\d{2}', '^\\d{4}-\\d{2}-\\d{2}$', 'Issued 2024-01-02');
  assert.deepEqual(result.matches, [{ text: '2024-01-02', ok: true }]);
});

test('testFormat: returns no matches when find does not appear in the text', () => {
  const result = testFormat('\\d{1,2}/\\d{1,2}/\\d{2,4}', '^\\d{4}-\\d{2}-\\d{2}$', 'No dates here');
  assert.deepEqual(result.matches, []);
  assert.equal(result.error, null);
});

test('testFormat: an invalid find regex returns an error instead of throwing', () => {
  const result = testFormat('(', '.*', 'some text');
  assert.deepEqual(result.matches, []);
  assert.ok(result.error.length > 0);
});

test('testFormat: an invalid valid regex returns an error instead of throwing', () => {
  const result = testFormat('\\d+', '(', 'some 123 text');
  assert.deepEqual(result.matches, []);
  assert.ok(result.error.length > 0);
});

test('testFormat: an empty find or valid returns no matches and no error', () => {
  assert.deepEqual(testFormat('', '^x$', 'text'), { matches: [], error: null });
  assert.deepEqual(testFormat('\\d+', '', 'text'), { matches: [], error: null });
});
