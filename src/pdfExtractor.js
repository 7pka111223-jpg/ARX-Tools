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
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.map((it) => ({
        text: it.str,
        x: it.transform[4],
        y: viewport.height - it.transform[5],
        width: it.width,
        height: it.height,
      }));
      pages.push({ pageNumber: i, width: viewport.width, height: viewport.height, items });
    }
    return { pages };
  } catch (err) {
    throw toClassifiedError(err);
  }
}
