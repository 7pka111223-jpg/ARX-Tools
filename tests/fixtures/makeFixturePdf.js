import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Builds a one-page PDF with known text at a known position (near the
// bottom-right corner, where a title block typically lives) so tests can
// assert exact extraction results without depending on a real drawing file.
export async function makeFixturePdf({ withText = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]); // width 600, height 400
  if (withText) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('DWG NO: AB-123', { x: 420, y: 40, size: 10, font, color: rgb(0, 0, 0) });
    page.drawText('REV: A', { x: 420, y: 25, size: 10, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}

// Builds a one-page PDF containing a deliberately misspelled word alongside a
// correctly spelled one, so the standalone spelling pass has something to flag.
export async function makeMisspellingPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('clarifeir tank', { x: 100, y: 300, size: 12, font, color: rgb(0, 0, 0) });
  return doc.save();
}

// Builds a PDF whose document catalog/trailer/xref are intact (so
// pdfjsLib.getDocument(...) opens it successfully) but whose page tree
// /Kids array points at an object number that doesn't exist. pdfjs only
// resolves that dangling reference once a specific page is requested, so
// this reproduces a failure that happens strictly inside the per-page loop
// (doc.getPage(i)) rather than at document-open time. Requires the
// "classic" (non-compressed-xref) save format so the /Kids array appears
// as a plain, surgically-editable token in the byte stream.
export async function makePageLoopCorruptPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]);
  const bytes = await doc.save({ useObjectStreams: false });
  const text = Buffer.from(bytes).toString('latin1');

  if (!text.includes('/Kids [ 4 0 R ]')) {
    throw new Error(
      'makePageLoopCorruptPdf: pdf-lib output layout changed, expected "/Kids [ 4 0 R ]" token not found'
    );
  }
  // Point the page tree at object 999, which has no corresponding xref
  // entry, so getDocument() (which only needs the catalog/page-tree
  // container) still succeeds, but doc.getPage(1) throws while resolving
  // the dangling kid reference.
  const corruptedText = text.replace('/Kids [ 4 0 R ]', '/Kids [ 999 0 R ]');
  return new Uint8Array(Buffer.from(corruptedText, 'latin1'));
}
