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

// Like checkSpelling, but tailored for the standalone spelling report: it
// de-duplicates each misspelled word, records every page it appears on, and
// asks the spell instance for suggested corrections. Returns one entry per
// distinct (case-insensitive) misspelled word:
//   { word, pages: number[], suggestions: string[] }
export function findMisspellings(words, spellInstance, { customDictionary = [], ignore = [] } = {}) {
  const customSet = new Set(customDictionary.map((w) => w.toLowerCase()));
  const ignoreSet = new Set(ignore.map((w) => w.toLowerCase()));
  const byWord = new Map();

  for (const w of words) {
    const clean = w.text.replace(/[^A-Za-z'-]/g, '');
    if (!clean || !/[A-Za-z]/.test(clean)) continue;
    const lower = clean.toLowerCase();
    if (customSet.has(lower) || ignoreSet.has(lower)) continue;
    if (spellInstance.correct(clean)) continue;

    let entry = byWord.get(lower);
    if (!entry) {
      // Compute suggestions once per distinct word. Guard for spell instances
      // (e.g. test doubles) that don't implement suggest().
      const suggestions = typeof spellInstance.suggest === 'function' ? spellInstance.suggest(clean) : [];
      entry = { word: clean, pages: new Set(), suggestions };
      byWord.set(lower, entry);
    }
    if (w.page != null) entry.pages.add(w.page);
  }

  return [...byWord.values()].map((e) => ({
    word: e.word,
    pages: [...e.pages].sort((a, b) => a - b),
    suggestions: e.suggestions,
  }));
}
