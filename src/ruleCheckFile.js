import { extractPdfText } from './pdfExtractor.js';
import { evaluateRules } from './rulesEngine.js';
import { buildDrawingResult } from './resultsModel.js';
import { toExtractionIssue } from './processFile.js';

// Standalone rules-only pass over a single PDF: title block, revision,
// project, and formatting rules, with no spelling check. Returns the same
// DrawingResult shape as processFile() ({ fileName, pass, issues, counts }),
// so it can reuse the existing summary-row rendering and HTML/CSV exporters.
export async function ruleCheckFile(fileName, pdfBytes, rulesConfig) {
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
  try {
    ruleIssues = evaluateRules(pages, rulesConfig);
  } catch (err) {
    return buildDrawingResult(fileName, [{
      category: 'config', severity: 'error', ruleId: 'invalidRules', foundText: null, page: null,
      message: `Could not evaluate rules: ${err.message}`,
    }]);
  }

  return buildDrawingResult(fileName, ruleIssues);
}
