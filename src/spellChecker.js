// Builds the lower-cased custom-dictionary and ignore lookup sets once, so the
// per-word check below is a couple of cheap Set hits.
export function spellingSets({ customDictionary = [], ignore = [] } = {}) {
  return {
    customSet: new Set(customDictionary.map((w) => w.toLowerCase())),
    ignoreSet: new Set(ignore.map((w) => w.toLowerCase())),
  };
}

// Shared spelling predicate: strips a raw token down to letters (plus ' and -),
// skips it if it isn't a real word or is in the custom/ignore lists, and asks
// the spell instance whether it's correct. Returns the cleaned word when it is
// a misspelling, or null otherwise.
export function misspelledWord(rawText, spellInstance, { customSet, ignoreSet }) {
  const clean = rawText.replace(/[^A-Za-z'-]/g, '');
  if (!clean || !/[A-Za-z]/.test(clean)) return null;
  const lower = clean.toLowerCase();
  if (customSet.has(lower) || ignoreSet.has(lower)) return null;
  if (spellInstance.correct(clean)) return null;
  return clean;
}

export function checkSpelling(words, spellInstance, config = {}) {
  const sets = spellingSets(config);
  const issues = [];
  for (const w of words) {
    if (misspelledWord(w.text, spellInstance, sets)) {
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
export function findMisspellings(words, spellInstance, config = {}) {
  const sets = spellingSets(config);
  const byWord = new Map();

  for (const w of words) {
    const clean = misspelledWord(w.text, spellInstance, sets);
    if (!clean) continue;

    const lower = clean.toLowerCase();
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
