import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locateFieldsOnPage } from '../src/titleBlockLocator.js';

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
