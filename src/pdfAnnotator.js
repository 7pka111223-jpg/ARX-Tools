import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFHexString } from 'pdf-lib';

// Error / warning palette, as both a pdf-lib color (for drawn shapes/text)
// and a raw [r,g,b] array (for the annotation object's /C colour entry).
const STYLE = {
  error: { color: rgb(0.78, 0.10, 0.10), rgb: [0.78, 0.10, 0.10], tag: 'ERROR' },
  warn: { color: rgb(0.80, 0.45, 0.05), rgb: [0.80, 0.45, 0.05], tag: 'WARNING' },
};

function styleFor(severity) {
  return STYLE[severity] || STYLE.warn;
}

// Helvetica (a Standard 14 font) can only draw WinAnsi characters, so any
// glyph the extracted text might contain that's outside printable ASCII is
// replaced before it reaches drawText (the full text still goes into the
// annotation's Unicode-capable Contents).
function drawable(text) {
  return String(text ?? '').replace(/[^\x20-\x7E]/g, '?');
}

// Human-readable comment text for an issue, e.g.
// 'ERROR — dwgNo: Field "DWG NO" value "..." does not match... (found: "...")'.
function commentText(issue) {
  const { tag } = styleFor(issue.severity);
  const found = issue.foundText ? ` (found: "${issue.foundText}")` : '';
  return `${tag} — ${issue.ruleId}: ${issue.message}${found}`;
}

function ensureAnnots(doc, page) {
  const key = PDFName.of('Annots');
  let annots = page.node.lookupMaybe(key, PDFArray);
  if (!annots) {
    annots = doc.context.obj([]);
    page.node.set(key, annots);
  }
  return annots;
}

// Adds a proper "Text" (sticky-note) annotation so the message also shows up
// in a PDF reader's comments/markup panel, not just as drawn ink.
function addStickyNote(doc, page, rect, contents, rgbColor) {
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Name: 'Comment',
    Rect: rect,
    Contents: PDFHexString.fromText(contents),
    T: PDFHexString.fromText('Drawing Checker'),
    C: rgbColor,
    F: 4, // Print flag, so the note is included when the PDF is printed.
    Open: false,
  });
  ensureAnnots(doc, page).push(doc.context.register(annot));
}

// Draws a highlight box around the offending text plus a short tag, and
// attaches a sticky note carrying the full message. `box` is in the
// extractor's top-down coordinate space; pdf-lib draws from the bottom-left,
// so y is converted via the page height.
function annotateAtBox(doc, page, font, issue) {
  const style = styleFor(issue.severity);
  const ph = page.getHeight();
  const x = issue.box.x;
  const w = issue.box.w || 60;
  const h = issue.box.h || 10;
  const bottom = ph - issue.box.y; // text baseline measured from the page bottom
  const pad = 2;

  page.drawRectangle({
    x: x - pad,
    y: bottom - pad,
    width: w + pad * 2,
    height: h + pad * 2,
    borderColor: style.color,
    borderWidth: 1.5,
  });
  page.drawText(drawable(`${style.tag}: ${issue.ruleId}`), {
    x,
    y: bottom + h + pad + 1,
    size: 7,
    font,
    color: style.color,
  });

  const noteX = x + w + pad * 2 + 2;
  addStickyNote(doc, page, [noteX, bottom, noteX + 16, bottom + 16], commentText(issue), style.rgb);
}

// Fallback placement for issues with no on-page location (e.g. a required
// field that is entirely missing): stack the messages down the page's
// top-left corner so they're still recorded as visible comments.
function annotateStacked(doc, page, font, issue, slot) {
  const style = styleFor(issue.severity);
  const margin = 12;
  const lineHeight = 13;
  const y = page.getHeight() - margin - slot * lineHeight;

  page.drawText(drawable(commentText(issue)), { x: margin + 16, y, size: 8, font, color: style.color });
  addStickyNote(doc, page, [margin, y - 2, margin + 14, y + 12], commentText(issue), style.rgb);
}

function pageIndexFor(issue, pageCount) {
  const idx = Number.isInteger(issue.page) ? issue.page - 1 : 0;
  return Math.max(0, Math.min(pageCount - 1, idx));
}

// Loads a PDF and writes every issue onto it as a visible markup + sticky
// note, returning the annotated PDF bytes. Issues that carry a `box` are
// drawn at that location; the rest are stacked at the top-left of their page.
export async function annotatePdf(pdfBytes, issues) {
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  if (pages.length === 0) return doc.save();

  const stackSlots = new Map(); // pageIndex -> next free stacked-note slot
  for (const issue of issues) {
    const pageIndex = pageIndexFor(issue, pages.length);
    const page = pages[pageIndex];
    if (issue.box && Number.isFinite(issue.box.x) && Number.isFinite(issue.box.y)) {
      annotateAtBox(doc, page, font, issue);
    } else {
      const slot = stackSlots.get(pageIndex) || 0;
      stackSlots.set(pageIndex, slot + 1);
      annotateStacked(doc, page, font, issue, slot);
    }
  }
  return doc.save();
}
