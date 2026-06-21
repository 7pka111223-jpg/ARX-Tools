import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfText } from '../src/pdfExtractor.js';
import { makeFixturePdf, makePageLoopCorruptPdf } from './fixtures/makeFixturePdf.js';

test('extracts text items with page size and pageNumber', async () => {
  const bytes = await makeFixturePdf();
  const { pages } = await extractPdfText(bytes);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].pageNumber, 1);
  assert.equal(pages[0].width, 600);
  assert.equal(pages[0].height, 400);
  const texts = pages[0].items.map((it) => it.text);
  assert.ok(texts.includes('DWG NO: AB-123'));
  assert.ok(texts.includes('REV: A'));
});

test('y coordinate is flipped so smaller y means nearer the top', async () => {
  const bytes = await makeFixturePdf();
  const { pages } = await extractPdfText(bytes);
  const revItem = pages[0].items.find((it) => it.text === 'REV: A');
  const dwgItem = pages[0].items.find((it) => it.text === 'DWG NO: AB-123');
  // REV was drawn at a lower pdf-lib y (25) than DWG NO (40), i.e. nearer
  // the bottom of the page, so after flipping it must have a LARGER y.
  assert.ok(revItem.y > dwgItem.y);
});

test('throws a CORRUPT-coded error for unparsable bytes', async () => {
  await assert.rejects(
    () => extractPdfText(new Uint8Array([1, 2, 3, 4, 5])),
    (err) => err.code === 'CORRUPT'
  );
});

test('reports zero items when a page has no text', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const { pages } = await extractPdfText(bytes);
  assert.equal(pages[0].items.length, 0);
});

test('throws a CORRUPT-coded error for a failure inside the per-page loop (not document-open)', async () => {
  // This PDF opens successfully (valid catalog/xref/trailer) but its page
  // tree references a non-existent object, so the failure can only occur
  // once extractPdfText starts iterating pages via doc.getPage(i) -- it
  // proves the whole function body (not just getDocument) is covered by
  // the CORRUPT/ENCRYPTED classification.
  const bytes = await makePageLoopCorruptPdf();
  await assert.rejects(
    () => extractPdfText(bytes),
    (err) => err.code === 'CORRUPT'
  );
});
