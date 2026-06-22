import { extractPdfText } from './pdfExtractor.js';
import { evaluateRules } from './rulesEngine.js';
import { annotatePdf } from './pdfAnnotator.js';

// Runs the rule checks against a single PDF and writes the resulting errors
// and warnings back onto a copy of the PDF as comments, returning the
// annotated bytes. Shape: { fileName, error, annotatedBytes, issueCount,
// errorCount, warnCount }. `error` is a human-readable string when the file
// could not be annotated (and annotatedBytes is null); otherwise it is null.
export async function annotateFile(fileName, pdfBytes, rulesConfig) {
  // pdfjs may detach the incoming buffer while reading it, so keep an
  // untouched copy for pdf-lib to load and write annotations onto.
  const originalBytes = pdfBytes.slice();

  let extracted;
  try {
    extracted = await extractPdfText(pdfBytes);
  } catch (err) {
    return { fileName, error: `PDF could not be read: ${err.message}`, annotatedBytes: null, issueCount: 0, errorCount: 0, warnCount: 0 };
  }

  const pages = extracted.pages;
  if (!pages.some((p) => p.items.length > 0)) {
    return {
      fileName,
      error: 'No text found — this PDF may be a scanned image, not a CAD export.',
      annotatedBytes: null, issueCount: 0, errorCount: 0, warnCount: 0,
    };
  }

  let issues;
  try {
    issues = evaluateRules(pages, rulesConfig);
  } catch (err) {
    return { fileName, error: `Could not evaluate rules: ${err.message}`, annotatedBytes: null, issueCount: 0, errorCount: 0, warnCount: 0 };
  }

  let annotatedBytes;
  try {
    annotatedBytes = await annotatePdf(originalBytes, issues);
  } catch (err) {
    return { fileName, error: `Could not write annotations: ${err.message}`, annotatedBytes: null, issueCount: issues.length, errorCount: 0, warnCount: 0 };
  }

  return {
    fileName,
    error: null,
    annotatedBytes,
    issueCount: issues.length,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warnCount: issues.filter((i) => i.severity === 'warn').length,
  };
}
