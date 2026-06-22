import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testPattern, testFormat, buildPatternFromExample } from '../../src/ui/patternTester.js';

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

test('buildPatternFromExample: a fixed prefix plus an all-digit variable suffix', () => {
  const result = buildPatternFromExample('J2501-JPD-EBH-DG-20103', '20103');
  assert.equal(result.error, null);
  assert.equal(result.warning, null);
  assert.equal(result.pattern, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  assert.match(result.explanation, /the text "J2501-JPD-EBH-DG-"/);
  assert.match(result.explanation, /5 digits/);
  // The generated pattern actually matches another drawing with the same scheme.
  assert.equal(new RegExp(result.pattern).test('J2501-JPD-EBH-DG-20104'), true);
  assert.equal(new RegExp(result.pattern).test('J2501-JPD-EBH-DG-2010'), false);
  assert.equal(new RegExp(result.pattern).test('X2501-JPD-EBH-DG-20103'), false);
});

test('buildPatternFromExample: a variable part that is the entire example generalizes mixed runs', () => {
  // No fixed prefix/suffix: the whole value is "variable", so each
  // digit/letter run becomes a class+count and punctuation stays literal.
  const result = buildPatternFromExample('2024-01-15', '2024-01-15');
  assert.equal(result.pattern, '^\\d{4}\\-\\d{2}\\-\\d{2}$');
  assert.equal(new RegExp(result.pattern).test('2024-12-31'), true);
});

test('buildPatternFromExample: a single-letter variable part', () => {
  const result = buildPatternFromExample('A', 'A');
  assert.equal(result.pattern, '^[A-Z]$');
  assert.equal(new RegExp(result.pattern).test('B'), true);
  assert.equal(new RegExp(result.pattern).test('1'), false);
});

test('buildPatternFromExample: a variable part with mixed character classes', () => {
  const result = buildPatternFromExample('REV-20A', '20A');
  assert.equal(result.pattern, '^REV\\-\\d{2}[A-Z]$');
});

test('buildPatternFromExample: reports a warning (not an error) when the variable text is ambiguous', () => {
  const result = buildPatternFromExample('AB-001-AB', 'AB');
  assert.equal(result.error, null);
  assert.match(result.warning, /more than once/);
  // The first occurrence is used as the variable part, so "AB" at the start
  // becomes the variable run and the trailing "-AB" is kept as a literal suffix.
  assert.equal(result.pattern, '^[A-Z]{2}\\-001\\-AB$');
});

test('buildPatternFromExample: an empty example returns a guidance error', () => {
  const result = buildPatternFromExample('', '20103');
  assert.match(result.error, /example/i);
  assert.equal(result.pattern, null);
});

test('buildPatternFromExample: an empty variable part returns a guidance error', () => {
  const result = buildPatternFromExample('J2501-JPD-EBH-DG-20103', '');
  assert.match(result.error, /changes between drawings/i);
  assert.equal(result.pattern, null);
});

test('buildPatternFromExample: a variable part not present in the example returns an error', () => {
  const result = buildPatternFromExample('J2501-JPD-EBH-DG-20103', '99999');
  assert.match(result.error, /not found/i);
  assert.equal(result.pattern, null);
});
