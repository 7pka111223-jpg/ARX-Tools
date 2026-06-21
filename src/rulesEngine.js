import { locateFieldsOnPage } from './titleBlockLocator.js';
import { escapeRegex } from './util.js';

export function evaluateFieldRules(pages, fieldRules, region) {
  const issues = [];
  for (const p of pages) {
    const fields = locateFieldsOnPage(p, fieldRules, region);
    for (const rule of fieldRules) {
      const result = fields[rule.id];
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

export function evaluateProjectRules(pages, project, region) {
  const firstPage = pages[0];
  if (!firstPage) return [];
  const requiredFields = Object.entries(project)
    .filter(([, expected]) => expected)
    .map(([id, expected]) => ({ id, category: 'project', label: id, pattern: `^${escapeRegex(expected)}$` }));
  if (requiredFields.length === 0) return [];

  const fields = locateFieldsOnPage(firstPage, requiredFields, region);
  const issues = [];
  for (const f of requiredFields) {
    const result = fields[f.id];
    if (!result.found || !result.valid) {
      issues.push({
        category: 'project', severity: 'error', ruleId: f.id,
        foundText: result.value, page: firstPage.pageNumber,
        message: `Project field "${f.id}" expected "${project[f.id]}" but found "${result.value ?? '(missing)'}"`,
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
