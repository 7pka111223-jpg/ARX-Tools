import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpelling, findMisspellings } from '../src/spellChecker.js';

const fakeSpell = {
  known: new Set(['clarifier', 'tank', 'the', 'pump']),
  correct(word) {
    return this.known.has(word.toLowerCase());
  },
  suggest(word) {
    return word.toLowerCase() === 'clarifeir' ? ['clarifier'] : [];
  },
};

test('flags a word the dictionary does not know', () => {
  const issues = checkSpelling([{ text: 'clarifeir', page: 1 }], fakeSpell, {});
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'spelling');
  assert.equal(issues[0].severity, 'warn');
  assert.equal(issues[0].foundText, 'clarifeir');
  assert.equal(issues[0].page, 1);
});

test('does not flag a word in the custom dictionary', () => {
  const issues = checkSpelling([{ text: 'headworks', page: 1 }], fakeSpell, { customDictionary: ['headworks'] });
  assert.equal(issues.length, 0);
});

test('does not flag a word in the ignore list', () => {
  const issues = checkSpelling([{ text: 'clarifeir', page: 1 }], fakeSpell, { ignore: ['clarifeir'] });
  assert.equal(issues.length, 0);
});

test('does not flag known words', () => {
  const issues = checkSpelling([{ text: 'tank', page: 1 }, { text: 'pump', page: 1 }], fakeSpell, {});
  assert.equal(issues.length, 0);
});

test('skips empty/punctuation-only tokens', () => {
  const issues = checkSpelling([{ text: '-', page: 1 }, { text: '', page: 1 }], fakeSpell, {});
  assert.equal(issues.length, 0);
});

test('findMisspellings returns a misspelled word with its suggested corrections', () => {
  const found = findMisspellings([{ text: 'clarifeir', page: 1 }], fakeSpell, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].word, 'clarifeir');
  assert.deepEqual(found[0].pages, [1]);
  assert.deepEqual(found[0].suggestions, ['clarifier']);
});

test('findMisspellings de-duplicates a word and collects every page it appears on', () => {
  const found = findMisspellings(
    [{ text: 'clarifeir', page: 3 }, { text: 'clarifeir', page: 1 }, { text: 'tank', page: 1 }],
    fakeSpell,
    {}
  );
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].pages, [1, 3]);
});

test('findMisspellings honours the custom dictionary and ignore list', () => {
  assert.equal(findMisspellings([{ text: 'clarifeir', page: 1 }], fakeSpell, { customDictionary: ['clarifeir'] }).length, 0);
  assert.equal(findMisspellings([{ text: 'clarifeir', page: 1 }], fakeSpell, { ignore: ['clarifeir'] }).length, 0);
});

test('findMisspellings tolerates a spell instance without suggest()', () => {
  const noSuggest = { correct: () => false };
  const found = findMisspellings([{ text: 'clarifeir', page: 1 }], noSuggest, {});
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].suggestions, []);
});
