import { extractPdfText } from './pdfExtractor.js';
import { evaluateRules } from './rulesEngine.js';
import { checkSpelling } from './spellChecker.js';
import { buildDrawingResult } from './resultsModel.js';
import { splitWords } from './util.js';

export function toExtractionIssue(err) {
  if (err.code === 'ENCRYPTED') {
    return { category: 'extraction', severity: 'error', ruleId: 'encrypted', foundText: null, page: null, message: 'PDF is password-protected and could not be read.' };
  }
  return { category: 'extraction', severity: 'error', ruleId: 'corrupt', foundText: null, page: null, message: `PDF could not be read: ${err.message}` };
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

  let ruleIssues;
  let spellIssues;
  try {
    ruleIssues = evaluateRules(pages, rulesConfig);
    const words = pages
      .flatMap((p) => p.items.flatMap((it) => splitWords(it.text, p.pageNumber)))
      .filter((w) => !/\d/.test(w.text));
    spellIssues = checkSpelling(words, spellInstance, rulesConfig.spelling);
  } catch (err) {
    return buildDrawingResult(fileName, [{
      category: 'config', severity: 'error', ruleId: 'invalidRules', foundText: null, page: null,
      message: `Could not evaluate rules: ${err.message}`,
    }]);
  }

  return buildDrawingResult(fileName, [...ruleIssues, ...spellIssues]);
}
