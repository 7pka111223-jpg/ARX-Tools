// Pure helpers behind the rule editor's live "try it" testers, so users get
// immediate feedback on whether a pattern actually matches the kind of value
// they intend (drawing numbers, revisions, dates, ...) before saving the rule.

import { escapeRegex } from '../util.js';

// titleBlock/revision/project rules require the field's whole value to match
// `pattern` exactly (see rulesEngine.evaluateFieldRules), so the tester
// mirrors that exact semantics rather than a partial/contains match.
export function testPattern(pattern, value) {
  if (!pattern) return { ok: null, error: null };
  try {
    return { ok: new RegExp(pattern).test(value), error: null };
  } catch (err) {
    return { ok: null, error: err.message };
  }
}

// formatting rules scan free text for anything matching `find`, then flag
// each match that does NOT also match `valid` (see
// rulesEngine.evaluateFormattingRules). The tester runs the same two-step
// logic against a sample line of text so users can see exactly which
// substrings would be found and which of those would be flagged.
export function testFormat(find, valid, text) {
  if (!find || !valid) return { matches: [], error: null };
  let findRe;
  let validRe;
  try {
    findRe = new RegExp(find, 'g');
    validRe = new RegExp(valid);
  } catch (err) {
    return { matches: [], error: err.message };
  }
  const matches = [...text.matchAll(findRe)].map((m) => ({ text: m[0], ok: validRe.test(m[0]) }));
  return { matches, error: null };
}

const RUN_CLASS_LABEL = { digit: 'digit', upper: 'uppercase letter', lower: 'lowercase letter' };

function classify(ch) {
  if (/[0-9]/.test(ch)) return 'digit';
  if (/[A-Z]/.test(ch)) return 'upper';
  if (/[a-z]/.test(ch)) return 'lower';
  return 'literal';
}

// Splits text into runs of consecutive same-class characters, e.g.
// "20A-1" -> digit run "20", upper run "A", literal run "-", digit run "1".
function toRuns(text) {
  const runs = [];
  for (const ch of text) {
    const cls = classify(ch);
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.text += ch;
    else runs.push({ cls, text: ch });
  }
  return runs;
}

function runToPattern(run) {
  if (run.cls === 'literal') return escapeRegex(run.text);
  const cls = run.cls === 'digit' ? '\\d' : run.cls === 'upper' ? '[A-Z]' : '[a-z]';
  return run.text.length === 1 ? cls : `${cls}{${run.text.length}}`;
}

function runToDescription(run) {
  if (run.cls === 'literal') return `the text "${run.text}"`;
  const n = run.text.length;
  return `${n} ${RUN_CLASS_LABEL[run.cls]}${n === 1 ? '' : 's'}`;
}

// Turns one concrete example value plus the substring of it that varies
// between drawings into a whole-value-match pattern: everything outside the
// variable substring is kept as fixed literal text, and the variable
// substring itself is converted into a character-class + count for each
// contiguous run of digits/uppercase/lowercase letters it contains (any
// other character inside it, e.g. a hyphen, is kept literal). This lets
// someone who has a real drawing number like "J2501-JPD-EBH-DG-20103" and
// knows only "20103" changes between drawings get a working pattern without
// writing regex by hand.
export function buildPatternFromExample(example, variablePart) {
  if (!example) {
    return { pattern: null, explanation: null, warning: null, error: 'Enter an example value first.' };
  }
  if (!variablePart) {
    return { pattern: null, explanation: null, warning: null, error: 'Enter the part of the example that changes between drawings.' };
  }

  const index = example.indexOf(variablePart);
  if (index === -1) {
    return { pattern: null, explanation: null, warning: null, error: `"${variablePart}" was not found inside the example value.` };
  }
  const warning = example.indexOf(variablePart, index + 1) !== -1
    ? `"${variablePart}" appears more than once in the example — the first occurrence was used.`
    : null;

  const prefix = example.slice(0, index);
  const suffix = example.slice(index + variablePart.length);
  const variableRuns = toRuns(variablePart);

  const pattern = `^${escapeRegex(prefix)}${variableRuns.map(runToPattern).join('')}${escapeRegex(suffix)}$`;

  const parts = [];
  if (prefix) parts.push(`the text "${prefix}"`);
  parts.push(...variableRuns.map(runToDescription));
  if (suffix) parts.push(`the text "${suffix}"`);
  const explanation = `Will match: ${parts.join(' + ')}`;

  return { pattern, explanation, warning, error: null };
}
