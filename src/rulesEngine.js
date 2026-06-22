import {
  findPatternMatches,
  longestLiteralStem,
  findLabeledFieldOnPages,
  findStemOnPages,
  itemBox,
} from './titleBlockLocator.js';
import { escapeRegex } from './util.js';

// A literal stem shorter than this is too generic to reliably locate a near
// miss (e.g. a lone "-"), so we don't use it for annotation placement.
const MIN_STEM_LENGTH = 3;

// True if any text anywhere in the document satisfies the rule's pattern.
// This is the whole check for a pattern rule: the value just has to exist
// somewhere on the drawing, regardless of label or title-block position.
function patternMatchesAnywhere(pages, pattern) {
  return pages.some((p) => findPatternMatches(p, pattern).length > 0);
}

// When a pattern rule fails, try to point at the offending text so an
// annotation can be attached to it: first the value next to a matching
// label (if the rule has one), then any text that begins with the pattern's
// fixed literal stem. Returns { text, box, page } or null if nothing
// suitable is on the page.
function locateNearMiss(pages, rule, siblingFields) {
  if (rule.label) {
    const labeled = findLabeledFieldOnPages(pages, rule, siblingFields);
    if (labeled && labeled.value != null) {
      return { text: labeled.value, box: labeled.box, page: labeled.page };
    }
  }
  const stem = longestLiteralStem(rule.pattern);
  if (stem.length >= MIN_STEM_LENGTH) {
    const hit = findStemOnPages(pages, stem);
    if (hit) return hit;
  }
  return null;
}

function fieldIssue(rule, miss) {
  const base = { category: rule.category, severity: rule.severity, ruleId: rule.id };
  if (miss && miss.text != null) {
    return {
      ...base,
      foundText: miss.text,
      page: miss.page ?? null,
      box: miss.box,
      message: `Field "${rule.label}" value "${miss.text}" does not match the required pattern`,
    };
  }
  return { ...base, foundText: null, page: null, message: `Required field "${rule.label}" was not found on the drawing` };
}

export function evaluateFieldRules(pages, fieldRules) {
  const issues = [];
  for (const rule of fieldRules) {
    if (rule.pattern) {
      // The value must exist somewhere on the drawing - no label or region
      // needed. Only when it's missing do we hunt for a near miss to flag.
      if (patternMatchesAnywhere(pages, rule.pattern)) continue;
      issues.push(fieldIssue(rule, locateNearMiss(pages, rule, fieldRules)));
    } else {
      // Presence-only rule (no pattern): confirm the label appears, with a
      // value beside it, anywhere in the document.
      const found = findLabeledFieldOnPages(pages, rule, fieldRules);
      if (found && found.value != null) continue;
      issues.push(fieldIssue(rule, null));
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
          const item = p.items.find((it) => it.text && it.text.includes(match[0]));
          issues.push({
            category: 'formatting', severity: rule.severity || 'warn', ruleId: rule.id,
            foundText: match[0], page: p.pageNumber, box: item ? itemBox(item) : undefined,
            message: rule.message,
          });
        }
      }
    }
  }
  return issues;
}

export function evaluateProjectRules(pages, projectFields) {
  const required = projectFields
    .filter((f) => f.value)
    .map((f) => ({
      id: f.id,
      category: 'project',
      label: f.label,
      pattern: `^${escapeRegex(f.value)}$`,
      severity: 'error',
      expected: f.value,
    }));
  if (required.length === 0) return [];

  const issues = [];
  for (const f of required) {
    if (patternMatchesAnywhere(pages, f.pattern)) continue;
    const miss = locateNearMiss(pages, f, required);
    issues.push({
      category: 'project', severity: 'error', ruleId: f.id,
      foundText: miss?.text ?? null, page: miss?.page ?? null, box: miss?.box,
      message: `Project field "${f.label}" expected "${f.expected}" but found "${miss?.text ?? '(missing)'}"`,
    });
  }
  return issues;
}

export function evaluateRules(pages, rulesConfig) {
  const enabledRules = rulesConfig.rules.filter((r) => r.enabled);
  const titleBlockRules = enabledRules.filter((r) => r.category === 'titleBlock');
  const revisionRules = enabledRules.filter((r) => r.category === 'revision');
  const formattingRules = enabledRules.filter((r) => r.category === 'formatting');

  return [
    ...evaluateProjectRules(pages, rulesConfig.project),
    // titleBlock + revision share one pass so their labels disambiguate each
    // other when locating a near miss for a failing rule.
    ...evaluateFieldRules(pages, [...titleBlockRules, ...revisionRules]),
    ...evaluateFormattingRules(pages, formattingRules),
  ];
}
