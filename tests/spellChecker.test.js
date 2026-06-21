import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSpelling } from '../src/spellChecker.js';

const fakeSpell = {
  known: new Set(['clarifier', 'tank', 'the', 'pump']),
  correct(word) {
    return this.known.has(word.toLowerCase());
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
