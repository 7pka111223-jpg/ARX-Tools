import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';
import { annotatePdf } from '../src/pdfAnnotator.js';

async function blankPdf(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([600, 400]);
  return doc.save();
}

function annotCount(page) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  return annots ? annots.size() : 0;
}

test('annotatePdf returns a valid PDF and adds a sticky note per issue', async () => {
  const bytes = await blankPdf();
  const issues = [
    { severity: 'error', ruleId: 'dwgNo', page: 1, foundText: 'J2501-JPD-EBH-DG-2000', message: 'Field "DWG NO" does not match', box: { x: 100, y: 120, w: 90, h: 10 } },
    { severity: 'warn', ruleId: 'rev', page: 1, foundText: null, message: 'Required field "REV" was not found' },
  ];
  const out = await annotatePdf(bytes, issues);
  assert.ok(out instanceof Uint8Array);
  assert.equal(Buffer.from(out.slice(0, 5)).toString('latin1'), '%PDF-');

  const reloaded = await PDFDocument.load(out);
  assert.equal(annotCount(reloaded.getPage(0)), 2);
});

test('annotatePdf places a boxed issue on its own page and clamps an out-of-range page', async () => {
  const bytes = await blankPdf(2);
  const issues = [
    { severity: 'error', ruleId: 'a', page: 2, message: 'on page two', box: { x: 10, y: 10, w: 20, h: 8 } },
    { severity: 'warn', ruleId: 'b', page: 99, message: 'page out of range -> clamped to last page' },
  ];
  const reloaded = await PDFDocument.load(await annotatePdf(bytes, issues));
  assert.equal(annotCount(reloaded.getPage(1)), 2); // both land on page 2 (index 1)
  assert.equal(annotCount(reloaded.getPage(0)), 0);
});

test('annotatePdf does not throw on non-ASCII found text (drawn text is sanitized)', async () => {
  const bytes = await blankPdf();
  const issues = [
    { severity: 'error', ruleId: 'x', page: 1, foundText: 'café—“smart”', message: 'unicode † test', box: { x: 50, y: 50, w: 40, h: 9 } },
  ];
  const out = await annotatePdf(bytes, issues);
  assert.ok(out instanceof Uint8Array);
});

test('annotatePdf with no issues returns the PDF unchanged in structure (no annotations)', async () => {
  const bytes = await blankPdf();
  const reloaded = await PDFDocument.load(await annotatePdf(bytes, []));
  assert.equal(annotCount(reloaded.getPage(0)), 0);
});
