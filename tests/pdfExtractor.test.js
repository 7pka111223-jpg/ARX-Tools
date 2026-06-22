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

test('an unrotated page reports rotation 0 and orientation from its raw width/height', async () => {
  const bytes = await makeFixturePdf(); // 600x400, no rotation
  const { pages } = await extractPdfText(bytes);
  assert.equal(pages[0].rotation, 0);
  assert.equal(pages[0].orientation, 'landscape');
});

test('a portrait page rotated 90 degrees reports the RAW (unswapped) width/height, the rotation, and the resulting landscape orientation', async () => {
  // A 400x600 (portrait) page rotated 90 degrees displays as 600x400
  // (landscape) -- width/height must stay the raw, pre-rotation values
  // (matching pdf-lib's own drawing space) while orientation reflects the
  // as-displayed shape.
  const bytes = await makeFixturePdf({ width: 400, height: 600, rotate: 90 });
  const { pages } = await extractPdfText(bytes);
  assert.equal(pages[0].width, 400);
  assert.equal(pages[0].height, 600);
  assert.equal(pages[0].rotation, 90);
  assert.equal(pages[0].orientation, 'landscape');
});

test('a page rotated 180 degrees keeps its raw width/height and orientation (no dimension swap)', async () => {
  const bytes = await makeFixturePdf({ width: 400, height: 600, rotate: 180 });
  const { pages } = await extractPdfText(bytes);
  assert.equal(pages[0].width, 400);
  assert.equal(pages[0].height, 600);
  assert.equal(pages[0].rotation, 180);
  assert.equal(pages[0].orientation, 'portrait');
});

test('item x/y coordinates are unaffected by the page rotation flag (raw content-stream space, not the rotated display space)', async () => {
  // The rotation flag changes nothing about the underlying content stream,
  // so the same text drawn at the same raw position must extract to the
  // same x/y whether or not the page is flagged as rotated -- this is the
  // exact invariant the original bug violated (it mixed a rotation-swapped
  // viewport height into an otherwise-raw y coordinate).
  const flat = await makeFixturePdf({ width: 400, height: 600, rotate: 0 });
  const rotated = await makeFixturePdf({ width: 400, height: 600, rotate: 90 });
  const flatDwg = (await extractPdfText(flat)).pages[0].items.find((it) => it.text === 'DWG NO: AB-123');
  const rotatedDwg = (await extractPdfText(rotated)).pages[0].items.find((it) => it.text === 'DWG NO: AB-123');
  assert.equal(rotatedDwg.x, flatDwg.x);
  assert.equal(rotatedDwg.y, flatDwg.y);
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
