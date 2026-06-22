// Pure helpers behind the rule editor's live "try it" testers, so users get
// immediate feedback on whether a pattern actually matches the kind of value
// they intend (drawing numbers, revisions, dates, ...) before saving the rule.

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
