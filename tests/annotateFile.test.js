import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { annotateFile } from '../src/annotateFile.js';
import { makeFixturePdf } from './fixtures/makeFixturePdf.js';

const baseConfig = {
  project: [],
  titleBlockRegion: { corner: 'bottom-right', widthPct: 30, heightPct: 25 },
  spelling: { customDictionary: [], ignore: [] },
  rules: [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true }],
};

test('annotateFile writes a commented PDF when a rule fails', async () => {
  // The fixture's drawing number is "AB-123"; require "ZZ-999" so the rule fails.
  const bytes = await makeFixturePdf();
  const config = { ...baseConfig, rules: [{ ...baseConfig.rules[0], pattern: '^ZZ-999$' }] };
  const result = await annotateFile('drawing.pdf', bytes, config);

  assert.equal(result.error, null);
  assert.ok(result.annotatedBytes instanceof Uint8Array);
  assert.equal(result.errorCount, 1);
  assert.ok(result.issueCount >= 1);
  // The output is still a loadable PDF.
  const reloaded = await PDFDocument.load(result.annotatedBytes);
  assert.equal(reloaded.getPageCount(), 1);
});

test('annotateFile still returns a valid PDF when everything passes (no comments)', async () => {
  const bytes = await makeFixturePdf(); // "DWG NO: AB-123" matches ^[A-Z]{2}-\d{3}$
  const result = await annotateFile('drawing.pdf', bytes, baseConfig);
  assert.equal(result.error, null);
  assert.equal(result.issueCount, 0);
  assert.ok(result.annotatedBytes instanceof Uint8Array);
});

test('annotateFile reports an error (and no bytes) for a scanned/textless PDF', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const result = await annotateFile('scan.pdf', bytes, baseConfig);
  assert.equal(result.annotatedBytes, null);
  assert.match(result.error, /No text found/);
});

test('annotateFile reports an error for unreadable bytes instead of throwing', async () => {
  const result = await annotateFile('garbage.pdf', new Uint8Array([1, 2, 3]), baseConfig);
  assert.equal(result.annotatedBytes, null);
  assert.match(result.error, /could not be read/i);
});
