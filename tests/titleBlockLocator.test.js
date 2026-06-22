import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLabeledFieldOnPages,
  scanPageForPattern,
  findPatternMatches,
  longestLiteralStem,
} from '../src/titleBlockLocator.js';

function page(items) {
  return { pageNumber: 1, width: 1000, height: 800, items };
}

// Looks a field up anywhere in a single-page document (label finding no
// longer depends on a title-block region).
function labeled(items, field, others = [field]) {
  return findLabeledFieldOnPages([page(items)], field, others);
}

test('finds a field value by its label anywhere on the page', () => {
  const found = labeled([{ text: 'DWG NO: AB-123', x: 10, y: 10 }], { id: 'dwgNo', label: 'DWG NO' });
  assert.equal(found.value, 'AB-123');
  assert.equal(found.page, 1);
});

test('returns null when the label is missing entirely', () => {
  const found = labeled([{ text: 'REV: A', x: 800, y: 700 }], { id: 'dwgNo', label: 'DWG NO' });
  assert.equal(found, null);
});

// --- Bug A: a label-only item must not swallow the next field's label as its value ---
test('Bug A: a label with no real value does not swallow the next field label', () => {
  const fields = [
    { id: 'dwgNo', label: 'DWG NO' },
    { id: 'rev', label: 'REV' },
  ];
  const items = [
    { text: 'DWG NO:', x: 760, y: 700 },
    { text: 'REV:', x: 800, y: 700 },
    { text: 'A', x: 830, y: 700 },
  ];
  assert.equal(findLabeledFieldOnPages([page(items)], fields[0], fields), null);
  assert.equal(findLabeledFieldOnPages([page(items)], fields[1], fields).value, 'A');
});

// --- Bug D: a label-only item's value, when it comes from a separate next item,
// must capture the FULL text of that item, not just its first token ---
test('Bug D: a label-only item takes the full multi-word text of the next item as its value', () => {
  const items = [
    { text: 'DRAWN BY:', x: 760, y: 700 },
    { text: 'JOHN SMITH', x: 800, y: 700 },
  ];
  assert.equal(labeled(items, { id: 'drawnBy', label: 'DRAWN BY' }).value, 'JOHN SMITH');
});

// --- Bug B: a label substring inside an unrelated word must not be matched ---
test('Bug B: a label hiding inside an unrelated word is not matched', () => {
  const items = [
    { text: 'UPDATED', x: 760, y: 700 },
    { text: 'DATE: 2026-01-01', x: 760, y: 705 },
  ];
  assert.equal(labeled(items, { id: 'date', label: 'DATE' }).value, '2026-01-01');
});

// --- Bug C: overlapping labels (one a prefix/suffix of another) must resolve independently ---
test('Bug C: overlapping field labels resolve to their own values', () => {
  const fields = [
    { id: 'date', label: 'DATE' },
    { id: 'revDate', label: 'REVISION DATE' },
  ];
  const items = [
    { text: 'REVISION DATE: 2026-01-02', x: 760, y: 700 },
    { text: 'DATE: 2026-01-01', x: 760, y: 720 },
  ];
  assert.equal(findLabeledFieldOnPages([page(items)], fields[0], fields).value, '2026-01-01');
  assert.equal(findLabeledFieldOnPages([page(items)], fields[1], fields).value, '2026-01-02');
});

// --- scanPageForPattern: locating a value by pattern, with no label ---

test('scanPageForPattern finds a value anywhere on the page, with no label and no region', () => {
  // Sits in the top-left, nowhere near a "DWG NO" label - locateFieldsOnPage
  // would report this as missing, but the text is genuinely on the page.
  const p = page([{ text: 'J2501-JPD-EBH-DG-20103', x: 10, y: 10 }]);
  const match = scanPageForPattern(p, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  assert.equal(match, 'J2501-JPD-EBH-DG-20103');
});

test('scanPageForPattern returns null when nothing on the page matches', () => {
  const p = page([{ text: 'REV: A', x: 800, y: 700 }]);
  const match = scanPageForPattern(p, '^[A-Z]{2}-\\d{3}$');
  assert.equal(match, null);
});

test('scanPageForPattern reconstructs a value split across adjacent same-line items', () => {
  const p = page([
    { text: 'J2501-JPD-EBH-DG-', x: 10, y: 10 },
    { text: '20103', x: 90, y: 10 },
  ]);
  const match = scanPageForPattern(p, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  assert.equal(match, 'J2501-JPD-EBH-DG-20103');
});

test('scanPageForPattern does not merge items from different visual lines', () => {
  const p = page([
    { text: 'J2501-JPD-EBH-DG-', x: 10, y: 10 },
    { text: '20103', x: 90, y: 400 }, // far enough away to be a different line
  ]);
  const match = scanPageForPattern(p, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  assert.equal(match, null);
});

// --- findPatternMatches: contains-search semantics + boundary guards ---

test('findPatternMatches matches a value embedded with other text in one item', () => {
  const p = page([{ text: 'DWG NO: J2501-JPD-EBH-DG-20103', x: 800, y: 700, width: 120, height: 10 }]);
  const matches = findPatternMatches(p, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].text, 'J2501-JPD-EBH-DG-20103');
  assert.equal(matches[0].box.x, 800);
});

test('findPatternMatches enforces the exact digit count from a $-anchored pattern', () => {
  const six = page([{ text: 'J2501-JPD-EBH-DG-201030', x: 0, y: 0 }]);
  const five = page([{ text: 'J2501-JPD-EBH-DG-20103', x: 0, y: 0 }]);
  assert.equal(findPatternMatches(six, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$').length, 0);
  assert.equal(findPatternMatches(five, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$').length, 1);
});

test('findPatternMatches does not match the literal prefix in the middle of a longer token', () => {
  const p = page([{ text: 'XJ2501-JPD-EBH-DG-20103', x: 0, y: 0 }]);
  assert.equal(findPatternMatches(p, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$').length, 0);
});

test('longestLiteralStem extracts the fixed prefix from a built pattern', () => {
  assert.equal(longestLiteralStem('^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$'), 'J2501-JPD-EBH-DG-');
});

test('longestLiteralStem returns a short/empty stem when the pattern has no real literal run', () => {
  assert.equal(longestLiteralStem('^[A-Z]{2}-\\d{3}$'), '-');
  assert.equal(longestLiteralStem('.*'), '');
});
