import { extractPdfText } from './pdfExtractor.js';
import { findMisspellings } from './spellChecker.js';
import { splitWords } from './util.js';

// Standalone spelling pass over a single PDF, independent of the title-block /
// formatting rules. Returns a per-file result the spelling report can consume:
//   { fileName, error: string|null, misspellings: [{ word, pages, suggestions }] }
// Extraction failures are reported via `error` (never thrown) so a single bad
// file does not abort a whole batch.
export async function spellCheckFile(fileName, pdfBytes, spellingConfig, spellInstance) {
  let extracted;
  try {
    extracted = await extractPdfText(pdfBytes);
  } catch (err) {
    const message = err.code === 'ENCRYPTED'
      ? 'PDF is password-protected and could not be read.'
      : `PDF could not be read: ${err.message}`;
    return { fileName, error: message, misspellings: [] };
  }

  const pages = extracted.pages;
  const hasText = pages.some((p) => p.items.length > 0);
  if (!hasText) {
    return {
      fileName,
      error: 'No text found — this PDF may be a scanned image, not a CAD export.',
      misspellings: [],
    };
  }

  // Drop tokens containing digits (drawing numbers, dates, codes) just like the
  // combined pipeline does, so they are never treated as misspelled words.
  const words = pages
    .flatMap((p) => p.items.flatMap((it) => splitWords(it.text, p.pageNumber)))
    .filter((w) => !/\d/.test(w.text));

  const misspellings = findMisspellings(words, spellInstance, spellingConfig || {});
  return { fileName, error: null, misspellings };
}
