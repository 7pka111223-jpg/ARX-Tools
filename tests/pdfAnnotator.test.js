import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, PDFDict, degrees } from 'pdf-lib';
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

// Reads back the /Rect of the Nth annotation on a (reloaded) page, as a
// {x, y, width, height} box in pdf-lib's raw drawing space.
function annotRect(page, index = 0) {
  const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  const dict = annots.lookup(index, PDFDict);
  return dict.lookup(PDFName.of('Rect'), PDFArray).asRectangle();
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

test('a stacked (no-box) issue on an unrotated page lands at the fixed top-left corner', async () => {
  const bytes = await blankPdf(); // 600x400, rotation 0
  const issues = [{ severity: 'warn', ruleId: 'rev', page: 1, message: 'Required field "REV" was not found' }];
  const reloaded = await PDFDocument.load(await annotatePdf(bytes, issues));
  const rect = annotRect(reloaded.getPage(0));
  assert.deepEqual(rect, { x: 12, y: 386, width: 14, height: 14 });
});

test('a stacked (no-box) issue on a 90-degree-rotated page lands at the visual top-left, not the raw one', async () => {
  // A 400x600 (portrait) page rotated 90 degrees displays as 600x400
  // landscape. Without compensating for the rotation, the note would be
  // placed near the raw top-left, which displays at the wrong corner once
  // the viewer applies the rotation.
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.setRotation(degrees(90));
  const bytes = await doc.save();

  const issues = [{ severity: 'warn', ruleId: 'rev', page: 1, message: 'Required field "REV" was not found' }];
  const reloaded = await PDFDocument.load(await annotatePdf(bytes, issues));
  const rect = annotRect(reloaded.getPage(0));
  assert.deepEqual(rect, { x: 0, y: 12, width: 14, height: 14 });
});

test('stacked issues on a rotated page still occupy distinct, non-overlapping slots', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  page.setRotation(degrees(90));
  const bytes = await doc.save();

  const issues = [
    { severity: 'warn', ruleId: 'a', page: 1, message: 'first' },
    { severity: 'warn', ruleId: 'b', page: 1, message: 'second' },
  ];
  const reloaded = await PDFDocument.load(await annotatePdf(bytes, issues));
  const page0 = reloaded.getPage(0);
  assert.equal(annotCount(page0), 2);
  const rect0 = annotRect(page0, 0);
  const rect1 = annotRect(page0, 1);
  assert.notDeepEqual(rect0, rect1);
});
