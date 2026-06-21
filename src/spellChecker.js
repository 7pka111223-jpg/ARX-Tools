export function checkSpelling(words, spellInstance, { customDictionary = [], ignore = [] } = {}) {
  const customSet = new Set(customDictionary.map((w) => w.toLowerCase()));
  const ignoreSet = new Set(ignore.map((w) => w.toLowerCase()));
  const issues = [];

  for (const w of words) {
    const clean = w.text.replace(/[^A-Za-z'-]/g, '');
    if (!clean || !/[A-Za-z]/.test(clean)) continue;
    const lower = clean.toLowerCase();
    if (customSet.has(lower) || ignoreSet.has(lower)) continue;
    if (!spellInstance.correct(clean)) {
      issues.push({
        category: 'spelling',
        severity: 'warn',
        ruleId: 'spelling',
        foundText: w.text,
        page: w.page,
        message: `Possible misspelling: "${w.text}"`,
      });
    }
  }
  return issues;
}
