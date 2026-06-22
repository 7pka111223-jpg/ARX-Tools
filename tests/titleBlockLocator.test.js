import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  locateFieldsOnPage,
  scanPageForPattern,
  findPatternMatches,
  longestLiteralStem,
} from '../src/titleBlockLocator.js';

const region = { corner: 'bottom-right', widthPct: 30, heightPct: 25 };

function page(items) {
  return { pageNumber: 1, width: 1000, height: 800, items };
}

test('finds a field by label and validates against a pattern', () => {
  const p = page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }]);
  const fields = locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$' }], region);
  assert.deepEqual(fields.dwgNo, { value: 'AB-123', found: true, valid: true });
});

test('marks found but invalid when the value fails the pattern', () => {
  const p = page([{ text: 'DWG NO: 12345', x: 800, y: 700 }]);
  const fields = locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$' }], region);
  assert.equal(fields.dwgNo.found, true);
  assert.equal(fields.dwgNo.valid, false);
});

test('marks not found when the label is outside the region', () => {
  const p = page([{ text: 'DWG NO: AB-123', x: 10, y: 10 }]); // top-left, not bottom-right
  const fields = locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$' }], region);
  assert.equal(fields.dwgNo.found, false);
});

test('marks not found when the label is missing entirely', () => {
  const p = page([{ text: 'REV: A', x: 800, y: 700 }]);
  const fields = locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$' }], region);
  assert.equal(fields.dwgNo.found, false);
  assert.equal(fields.dwgNo.value, null);
});

test('a field without a pattern only checks presence', () => {
  const p = page([{ text: 'DRAWN BY: JS', x: 800, y: 700 }]);
  const fields = locateFieldsOnPage(p, [{ id: 'drawnBy', label: 'DRAWN BY' }], region);
  assert.equal(fields.drawnBy.found, true);
  assert.equal(fields.drawnBy.valid, true);
});

// --- Bug A: a label-only item must not swallow the next field's label as its value ---
test('Bug A: a label with no real value does not swallow the next field label', () => {
  const p = page([
    { text: 'DWG NO:', x: 760, y: 700 },
    { text: 'REV:', x: 800, y: 700 },
    { text: 'A', x: 830, y: 700 },
  ]);
  const fields = locateFieldsOnPage(
    p,
    [
      { id: 'dwgNo', label: 'DWG NO' },
      { id: 'rev', label: 'REV' },
    ],
    region
  );
  assert.deepEqual(fields.dwgNo, { value: null, found: false, valid: false });
  assert.deepEqual(fields.rev, { value: 'A', found: true, valid: true });
});

// --- Bug D: a label-only item's value, when it comes from a separate next item,
// must capture the FULL text of that item, not just its first token ---
test('Bug D: a label-only item takes the full multi-word text of the next item as its value', () => {
  const p = page([
    { text: 'DRAWN BY:', x: 760, y: 700 },
    { text: 'JOHN SMITH', x: 800, y: 700 },
  ]);
  const fields = locateFieldsOnPage(p, [{ id: 'drawnBy', label: 'DRAWN BY' }], region);
  assert.deepEqual(fields.drawnBy, { value: 'JOHN SMITH', found: true, valid: true });
});

// --- Bug B: a label substring inside an unrelated word must not be matched ---
test('Bug B: a label hiding inside an unrelated word is not matched', () => {
  const p = page([
    { text: 'UPDATED', x: 760, y: 700 },
    { text: 'DATE: 2026-01-01', x: 760, y: 705 },
  ]);
  const fields = locateFieldsOnPage(p, [{ id: 'date', label: 'DATE' }], region);
  assert.deepEqual(fields.date, { value: '2026-01-01', found: true, valid: true });
});

// --- Bug C: overlapping labels (one a prefix/suffix of another) must resolve independently ---
test('Bug C: overlapping field labels resolve to their own values', () => {
  const p = page([
    { text: 'REVISION DATE: 2026-01-02', x: 760, y: 700 },
    { text: 'DATE: 2026-01-01', x: 760, y: 720 },
  ]);
  const fields = locateFieldsOnPage(
    p,
    [
      { id: 'date', label: 'DATE' },
      { id: 'revDate', label: 'REVISION DATE' },
    ],
    region
  );
  assert.equal(fields.date.value, '2026-01-01');
  assert.equal(fields.revDate.value, '2026-01-02');
});

// --- Input validation ---
test('throws on an invalid region.corner', () => {
  const p = page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }]);
  assert.throws(
    () => locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO' }], { corner: 'rightt', widthPct: 30, heightPct: 25 }),
    /Invalid region.corner/
  );
});

test('throws on a non-finite region.widthPct', () => {
  const p = page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }]);
  assert.throws(
    () => locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO' }], { corner: 'bottom-right', widthPct: NaN, heightPct: 25 }),
    /Invalid region.widthPct/
  );
});

test('throws on a non-finite region.heightPct', () => {
  const p = page([{ text: 'DWG NO: AB-123', x: 800, y: 700 }]);
  assert.throws(
    () => locateFieldsOnPage(p, [{ id: 'dwgNo', label: 'DWG NO' }], { corner: 'bottom-right', widthPct: 30, heightPct: undefined }),
    /Invalid region.heightPct/
  );
});

// --- scanPageForPattern: the whole-page fallback used when label-based lookup fails ---

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
