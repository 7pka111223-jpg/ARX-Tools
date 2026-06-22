import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFHexString, degrees } from 'pdf-lib';

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

// pdf-lib's page.getRotation() returns the raw stored /Rotate value
// unnormalized (it can be negative or >= 360, unlike pdf.js's getViewport,
// which always normalizes); collapse it to one of the four valid values.
function normalizeRotation(angle) {
  const r = ((angle % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

// Converts a point from the page's VISUAL (as-displayed) space - x right,
// y down, origin top-left, the same convention pdfExtractor.js's item
// x/y use - into pdf-lib's RAW drawing space (x right, y up, origin
// bottom-left), given the raw page size and the page's own clockwise
// /Rotate value. There is no on-page anchor to inherit correctness from
// here (unlike annotateAtBox, see below), so the four cases below are
// needed; they're derived from pdf.js's PageViewport transform (the same
// rotateA/B/C/D table pdfExtractor.js relies on for the reverse direction).
function visualToRaw(vx, vy, rawWidth, rawHeight, rotation) {
  switch (rotation) {
    case 90: return { x: vy, y: vx };
    case 180: return { x: rawWidth - vx, y: vy };
    case 270: return { x: rawWidth - vy, y: rawHeight - vx };
    default: return { x: vx, y: rawHeight - vy };
  }
}

// Same conversion for a rectangle: each corner can map to a different raw
// corner depending on rotation, so the two transformed points are re-sorted
// into a normalized [x1,y1,x2,y2] rather than assumed to keep their order.
function visualRectToRaw(vx1, vy1, vx2, vy2, rawWidth, rawHeight, rotation) {
  const p1 = visualToRaw(vx1, vy1, rawWidth, rawHeight, rotation);
  const p2 = visualToRaw(vx2, vy2, rawWidth, rawHeight, rotation);
  return [Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)];
}

// Fallback placement for issues with no on-page location (e.g. a required
// field that is entirely missing): stack the messages down the page's
// visual top-left corner so they're still recorded as visible comments.
// Unlike annotateAtBox, this has no real text to anchor to and inherit
// rotation-consistency from, so the visual position is converted to raw
// space explicitly, and the text itself is drawn with a matching
// compensating rotation so it still reads upright once the PDF viewer
// applies the page's own rotation on top.
function annotateStacked(doc, page, font, issue, slot) {
  const style = styleFor(issue.severity);
  const margin = 12;
  const lineHeight = 13;
  const rawWidth = page.getWidth();
  const rawHeight = page.getHeight();
  const rotation = normalizeRotation(page.getRotation().angle);

  const vx = margin + 16;
  const vy = margin + slot * lineHeight;
  const { x, y } = visualToRaw(vx, vy, rawWidth, rawHeight, rotation);

  page.drawText(drawable(commentText(issue)), { x, y, size: 8, font, color: style.color, rotate: degrees(rotation) });

  // The icon sits beside the text line: a couple of px below its baseline
  // to comfortably above it. Visual y grows downward, the opposite of the
  // raw axis the old fixed formula offset directly, so the offsets'
  // direction (which one subtracts, which adds) flips accordingly.
  const rect = visualRectToRaw(margin, vy - 12, margin + 14, vy + 2, rawWidth, rawHeight, rotation);
  addStickyNote(doc, page, rect, commentText(issue), style.rgb);
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
