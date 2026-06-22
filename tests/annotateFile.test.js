import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { annotateFile } from '../src/annotateFile.js';
import { makeFixturePdf, makeMisspellingPdf } from './fixtures/makeFixturePdf.js';

const rulesConfig = {
  project: [],
  spelling: { customDictionary: [], ignore: [] },
  rules: [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true }],
};
const rulesOnly = { rulesConfig, includeRules: true, includeSpelling: false };

// A spell instance that flags one specific word, used for the spelling paths.
const spellInstance = {
  correct: (w) => w.toLowerCase() !== 'clarifeir',
  suggest: () => ['clarifier'],
};

test('annotateFile writes a commented PDF when a rule fails', async () => {
  // The fixture's drawing number is "AB-123"; require "ZZ-999" so the rule fails.
  const bytes = await makeFixturePdf();
  const config = { ...rulesConfig, rules: [{ ...rulesConfig.rules[0], pattern: '^ZZ-999$' }] };
  const result = await annotateFile('drawing.pdf', bytes, { ...rulesOnly, rulesConfig: config });

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
  const result = await annotateFile('drawing.pdf', bytes, rulesOnly);
  assert.equal(result.error, null);
  assert.equal(result.issueCount, 0);
  assert.ok(result.annotatedBytes instanceof Uint8Array);
});

test('annotateFile annotates spelling mistakes when includeSpelling is set', async () => {
  const bytes = await makeMisspellingPdf(); // contains "clarifeir tank"
  const result = await annotateFile('drawing.pdf', bytes, {
    rulesConfig, spellingConfig: rulesConfig.spelling, spellInstance,
    includeRules: false, includeSpelling: true,
  });
  assert.equal(result.error, null);
  assert.equal(result.issueCount, 1);
  assert.equal(result.warnCount, 1);
  assert.ok(result.annotatedBytes instanceof Uint8Array);
});

test('annotateFile combines rule and spelling comments when both are requested', async () => {
  const bytes = await makeMisspellingPdf(); // "clarifeir tank", no valid drawing number
  const result = await annotateFile('drawing.pdf', bytes, {
    rulesConfig, spellingConfig: rulesConfig.spelling, spellInstance,
    includeRules: true, includeSpelling: true,
  });
  assert.equal(result.error, null);
  // 1 rule error (no matching drawing number) + 1 spelling warning.
  assert.ok(result.errorCount >= 1, JSON.stringify(result));
  assert.ok(result.warnCount >= 1, JSON.stringify(result));
});

test('annotateFile does not run spelling when includeSpelling is false', async () => {
  const bytes = await makeMisspellingPdf();
  const result = await annotateFile('drawing.pdf', bytes, {
    rulesConfig: { project: [], spelling: { customDictionary: [], ignore: [] }, rules: [] },
    includeRules: true, includeSpelling: false,
  });
  assert.equal(result.issueCount, 0);
});

test('annotateFile reports an error (and no bytes) for a scanned/textless PDF', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const result = await annotateFile('scan.pdf', bytes, rulesOnly);
  assert.equal(result.annotatedBytes, null);
  assert.match(result.error, /No text found/);
});

test('annotateFile reports an error for unreadable bytes instead of throwing', async () => {
  const result = await annotateFile('garbage.pdf', new Uint8Array([1, 2, 3]), rulesOnly);
  assert.equal(result.annotatedBytes, null);
  assert.match(result.error, /could not be read/i);
});
