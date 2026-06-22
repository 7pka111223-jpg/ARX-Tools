import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Classifies any failure raised while opening or reading a PDF into the
// error-code contract the file-processing pipeline depends on: a
// PasswordException means the file is encrypted, anything else means the
// file (or one of its pages) is corrupt/unparsable.
function toClassifiedError(err) {
  if (err && err.name === 'PasswordException') {
    const wrapped = new Error('PDF is password-protected');
    wrapped.code = 'ENCRYPTED';
    return wrapped;
  }
  const wrapped = new Error((err && err.message) || 'Failed to parse PDF');
  wrapped.code = 'CORRUPT';
  return wrapped;
}

export async function extractPdfText(pdfBytes) {
  try {
    const doc = await pdfjsLib.getDocument({
      data: pdfBytes,
      password: '',
      // Suppress pdfjs-dist's benign "Setting up fake worker." console
      // warning (we intentionally run pdfjs without a separate worker
      // script since we're already inside our own dedicated Worker).
      // ERRORS-only verbosity still lets real failures surface via thrown
      // exceptions -- it only silences internal console.log/console.warn
      // calls, not the error-classification logic below.
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    }).promise;

    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      // getTextContent() reports each item's transform in the page's RAW,
      // unrotated user space - the same space pdf-lib draws in. A viewport
      // built with the page's own rotation (the default) instead reports
      // width/height swapped for a 90/270 page, e.g. landscape-by-rotation
      // drawings. Flipping y with that rotated height while x/y themselves
      // are still unrotated put every annotation in the wrong place on any
      // rotated (landscape) page. A second viewport with rotation forced to
      // 0 keeps width/height/x/y all in that same raw space, consistently.
      const displayViewport = page.getViewport({ scale: 1 });
      const rawViewport = page.getViewport({ scale: 1, rotation: 0 });
      const rotation = displayViewport.rotation;
      const orientation = displayViewport.width > displayViewport.height ? 'landscape' : 'portrait';

      const content = await page.getTextContent();
      const items = content.items.map((it) => {
        const [x, y] = rawViewport.convertToViewportPoint(it.transform[4], it.transform[5]);
        return { text: it.str, x, y, width: it.width, height: it.height };
      });
      pages.push({
        pageNumber: i,
        width: rawViewport.width,
        height: rawViewport.height,
        rotation,
        orientation,
        items,
      });
    }
    return { pages };
  } catch (err) {
    throw toClassifiedError(err);
  }
}
