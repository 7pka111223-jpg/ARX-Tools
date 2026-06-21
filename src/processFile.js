import { extractPdfText } from './pdfExtractor.js';
import { evaluateRules } from './rulesEngine.js';
import { checkSpelling } from './spellChecker.js';
import { buildDrawingResult } from './resultsModel.js';

export function toExtractionIssue(err) {
  if (err.code === 'ENCRYPTED') {
    return { category: 'extraction', severity: 'error', ruleId: 'encrypted', foundText: null, page: null, message: 'PDF is password-protected and could not be read.' };
  }
  return { category: 'extraction', severity: 'error', ruleId: 'corrupt', foundText: null, page: null, message: `PDF could not be read: ${err.message}` };
}

function splitWords(text, page) {
  return text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, page }));
}

export async function processFile(fileName, pdfBytes, rulesConfig, spellInstance) {
  let extracted;
  try {
    extracted = await extractPdfText(pdfBytes);
  } catch (err) {
    return buildDrawingResult(fileName, [toExtractionIssue(err)]);
  }

  const pages = extracted.pages;
  const hasText = pages.some((p) => p.items.length > 0);
  if (!hasText) {
    return buildDrawingResult(fileName, [{
      category: 'extraction', severity: 'error', ruleId: 'noText', foundText: null, page: null,
      message: 'No text found — this PDF may be a scanned image, not a CAD export.',
    }]);
  }

  const ruleIssues = evaluateRules(pages, rulesConfig);
  const words = pages.flatMap((p) => p.items.flatMap((it) => splitWords(it.text, p.pageNumber)));
  const spellIssues = checkSpelling(words, spellInstance, rulesConfig.spelling);

  return buildDrawingResult(fileName, [...ruleIssues, ...spellIssues]);
}
