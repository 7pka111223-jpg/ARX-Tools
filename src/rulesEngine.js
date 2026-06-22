import { locateFieldsOnPage, scanPageForPattern } from './titleBlockLocator.js';
import { escapeRegex } from './util.js';

export function evaluateFieldRules(pages, fieldRules, region) {
  const issues = [];
  for (const p of pages) {
    const fields = locateFieldsOnPage(p, fieldRules, region);
    for (const rule of fieldRules) {
      const result = fields[rule.id];
      if (result.found && (!rule.pattern || result.valid)) continue;

      // The label-based lookup above only finds a field whose exact label
      // text sits inside the configured title-block region right next to
      // the value. Real drawings vary - the title block isn't always in
      // that region, and label wording differs - so before reporting a
      // field as missing or invalid, fall back to scanning the WHOLE page
      // for any text that satisfies the rule's pattern on its own.
      if (rule.pattern && scanPageForPattern(p, rule.pattern) !== null) continue;

      if (!result.found) {
        issues.push({
          category: rule.category, severity: rule.severity, ruleId: rule.id,
          foundText: null, page: p.pageNumber,
          message: `Missing required field "${rule.label}"`,
        });
      } else if (rule.pattern && !result.valid) {
        issues.push({
          category: rule.category, severity: rule.severity, ruleId: rule.id,
          foundText: result.value, page: p.pageNumber,
          message: `Field "${rule.label}" value "${result.value}" does not match expected format`,
        });
      }
    }
  }
  return issues;
}

export function evaluateFormattingRules(pages, formattingRules) {
  const issues = [];
  for (const rule of formattingRules) {
    if (!rule.enabled) continue;
    // `rule.find`/`rule.valid` are assumed to be pre-validated regex strings; a malformed
    // pattern here throws a SyntaxError that propagates out of evaluateRules uncaught. This is
    // deliberately deferred to the future rules-management task that will own regex validation.
    const findRe = new RegExp(rule.find, 'g');
    const validRe = new RegExp(rule.valid);
    for (const p of pages) {
      const text = p.items.map((it) => it.text).join(' ');
      for (const match of text.matchAll(findRe)) {
        if (!validRe.test(match[0])) {
          issues.push({
            category: 'formatting', severity: rule.severity || 'warn', ruleId: rule.id,
            foundText: match[0], page: p.pageNumber, message: rule.message,
          });
        }
      }
    }
  }
  return issues;
}

export function evaluateProjectRules(pages, projectFields, region) {
  const firstPage = pages[0];
  if (!firstPage) return [];
  const requiredFields = projectFields
    .filter((f) => f.value)
    .map((f) => ({ id: f.id, category: 'project', label: f.label, pattern: `^${escapeRegex(f.value)}$` }));
  if (requiredFields.length === 0) return [];

  const fields = locateFieldsOnPage(firstPage, requiredFields, region);
  const issues = [];
  for (const f of requiredFields) {
    const result = fields[f.id];
    if (!result.found || !result.valid) {
      // Same fallback as evaluateFieldRules: the expected text might be on
      // the page but outside the configured region, or not directly next
      // to a recognized label, so check the whole page before giving up.
      if (scanPageForPattern(firstPage, f.pattern) !== null) continue;
      const original = projectFields.find((pf) => pf.id === f.id);
      issues.push({
        category: 'project', severity: 'error', ruleId: f.id,
        foundText: result.value, page: firstPage.pageNumber,
        message: `Project field "${f.label}" expected "${original.value}" but found "${result.value ?? '(missing)'}"`,
      });
    }
  }
  return issues;
}

export function evaluateRules(pages, rulesConfig) {
  const region = rulesConfig.titleBlockRegion;
  const enabledRules = rulesConfig.rules.filter((r) => r.enabled);
  const titleBlockRules = enabledRules.filter((r) => r.category === 'titleBlock');
  const revisionRules = enabledRules.filter((r) => r.category === 'revision');
  const formattingRules = enabledRules.filter((r) => r.category === 'formatting');

  return [
    ...evaluateProjectRules(pages, rulesConfig.project, region),
    ...evaluateFieldRules(pages, titleBlockRules, region),
    ...evaluateFieldRules(pages, revisionRules, region),
    ...evaluateFormattingRules(pages, formattingRules),
  ];
}
