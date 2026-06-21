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
