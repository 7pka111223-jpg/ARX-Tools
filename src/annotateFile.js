import { extractPdfText } from './pdfExtractor.js';
import { evaluateRules } from './rulesEngine.js';
import { annotatePdf } from './pdfAnnotator.js';
import { spellingSets, misspelledWord } from './spellChecker.js';

// Builds spelling issues that carry an on-page box for each misspelled word.
// The word's box is estimated from its position within the containing text
// item (so several misspellings on one line don't all stack at the same
// spot). Tokens containing digits are skipped, exactly as the spelling
// pipeline does, so drawing numbers/codes aren't treated as words.
function locatedSpellingIssues(pages, spellInstance, spellingConfig) {
  if (!spellInstance) return [];
  const sets = spellingSets(spellingConfig || {});
  const issues = [];
  for (const p of pages) {
    for (const it of p.items) {
      const text = it.text || '';
      const len = text.length || 1;
      for (const m of text.matchAll(/\S+/g)) {
        const token = m[0];
        if (/\d/.test(token)) continue;
        if (!misspelledWord(token, spellInstance, sets)) continue;
        const x = it.x + (it.width || 0) * (m.index / len);
        const w = (it.width || 0) * (token.length / len);
        issues.push({
          category: 'spelling', severity: 'warn', ruleId: 'spelling',
          foundText: token, page: p.pageNumber,
          box: { x, y: it.y, w, h: it.height || 0 },
          message: `Possible misspelling: "${token}"`,
        });
      }
    }
  }
  return issues;
}

// Runs the requested checks against a single PDF and writes the resulting
// errors and warnings back onto a copy of the PDF as comments, returning the
// annotated bytes. Shape: { fileName, error, annotatedBytes, issueCount,
// errorCount, warnCount }. `error` is a human-readable string when the file
// could not be annotated (and annotatedBytes is null); otherwise it is null.
export async function annotateFile(fileName, pdfBytes, {
  rulesConfig,
  spellingConfig,
  spellInstance = null,
  includeRules = true,
  includeSpelling = false,
} = {}) {
  // pdfjs may detach the incoming buffer while reading it, so keep an
  // untouched copy for pdf-lib to load and write annotations onto.
  const originalBytes = pdfBytes.slice();

  const fail = (error, partial = {}) => ({
    fileName, error, annotatedBytes: null, issueCount: 0, errorCount: 0, warnCount: 0, ...partial,
  });

  let extracted;
  try {
    extracted = await extractPdfText(pdfBytes);
  } catch (err) {
    return fail(`PDF could not be read: ${err.message}`);
  }

  const pages = extracted.pages;
  if (!pages.some((p) => p.items.length > 0)) {
    return fail('No text found — this PDF may be a scanned image, not a CAD export.');
  }

  const issues = [];
  try {
    if (includeRules) issues.push(...evaluateRules(pages, rulesConfig));
  } catch (err) {
    return fail(`Could not evaluate rules: ${err.message}`);
  }
  if (includeSpelling) issues.push(...locatedSpellingIssues(pages, spellInstance, spellingConfig));

  let annotatedBytes;
  try {
    annotatedBytes = await annotatePdf(originalBytes, issues);
  } catch (err) {
    return fail(`Could not write annotations: ${err.message}`, { issueCount: issues.length });
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
