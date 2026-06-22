import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spellCheckFile } from '../src/spellCheckFile.js';
import { makeMisspellingPdf, makeFixturePdf } from './fixtures/makeFixturePdf.js';

// Knows "tank" but not "clarifeir"; suggests the correct spelling for the latter.
const fakeSpell = {
  correct: (w) => w.toLowerCase() === 'tank',
  suggest: (w) => (w.toLowerCase() === 'clarifeir' ? ['clarifier'] : []),
};

test('flags a misspelled word and returns its suggested correction', async () => {
  const bytes = await makeMisspellingPdf();
  const result = await spellCheckFile('drawing.pdf', bytes, { customDictionary: [], ignore: [] }, fakeSpell);
  assert.equal(result.fileName, 'drawing.pdf');
  assert.equal(result.error, null);
  const clarifeir = result.misspellings.find((m) => m.word === 'clarifeir');
  assert.ok(clarifeir, 'expected "clarifeir" to be flagged');
  assert.deepEqual(clarifeir.suggestions, ['clarifier']);
  assert.deepEqual(clarifeir.pages, [1]);
  // The correctly spelled word is not reported.
  assert.ok(!result.misspellings.some((m) => m.word === 'tank'));
});

test('a digit-bearing token is never treated as a misspelling', async () => {
  const bytes = await makeFixturePdf(); // contains "DWG NO: AB-123"
  const strictSpell = { correct: () => false, suggest: () => [] };
  const result = await spellCheckFile('drawing.pdf', bytes, {}, strictSpell);
  assert.ok(!result.misspellings.some((m) => /\d/.test(m.word)));
});

test('a PDF with no extractable text returns an error and no misspellings', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const result = await spellCheckFile('blank.pdf', bytes, {}, fakeSpell);
  assert.equal(result.misspellings.length, 0);
  assert.match(result.error, /No text found/);
});

test('corrupt bytes return an error instead of throwing', async () => {
  const result = await spellCheckFile('garbage.pdf', new Uint8Array([1, 2, 3]), {}, fakeSpell);
  assert.equal(result.misspellings.length, 0);
  assert.match(result.error, /could not be read/i);
});
