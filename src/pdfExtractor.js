import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdfText(pdfBytes) {
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data: pdfBytes, password: '' }).promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') {
      const wrapped = new Error('PDF is password-protected');
      wrapped.code = 'ENCRYPTED';
      throw wrapped;
    }
    const wrapped = new Error((err && err.message) || 'Failed to parse PDF');
    wrapped.code = 'CORRUPT';
    throw wrapped;
  }

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
}
