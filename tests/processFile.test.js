import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processFile, toExtractionIssue } from '../src/processFile.js';
import { makeFixturePdf } from './fixtures/makeFixturePdf.js';

const region = { corner: 'bottom-right', widthPct: 30, heightPct: 25 };
const rulesConfig = {
  project: [],
  titleBlockRegion: region,
  spelling: { customDictionary: [], ignore: [] },
  rules: [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true }],
};
const fakeSpell = { correct: () => true }; // accept all words; spelling isn't under test here

test('happy path: valid title block and clean spelling produces a passing result', async () => {
  const bytes = await makeFixturePdf();
  const result = await processFile('drawing.pdf', bytes, rulesConfig, fakeSpell);
  assert.equal(result.fileName, 'drawing.pdf');
  assert.equal(result.pass, true);
});

test('rule violations are reported as issues with pass=false', async () => {
  const bytes = await makeFixturePdf(); // has "DWG NO: AB-123" which matches the pattern...
  const badRules = { ...rulesConfig, rules: [{ ...rulesConfig.rules[0], pattern: '^ZZ-999$' }] };
  const result = await processFile('drawing.pdf', bytes, badRules, fakeSpell);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((i) => i.ruleId === 'dwgNo'));
});

test('a PDF with no extractable text returns a single noText error issue', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const result = await processFile('blank.pdf', bytes, rulesConfig, fakeSpell);
  assert.equal(result.pass, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].ruleId, 'noText');
});

test('corrupt bytes return a single corrupt error issue instead of throwing', async () => {
  const result = await processFile('garbage.pdf', new Uint8Array([1, 2, 3]), rulesConfig, fakeSpell);
  assert.equal(result.pass, false);
  assert.equal(result.issues[0].ruleId, 'corrupt');
});

test('toExtractionIssue maps an ENCRYPTED-coded error to an encrypted issue', () => {
  const err = new Error('needs password');
  err.code = 'ENCRYPTED';
  const issue = toExtractionIssue(err);
  assert.equal(issue.ruleId, 'encrypted');
  assert.equal(issue.severity, 'error');
});

test('an invalid formatting rule regex returns a clean config error instead of throwing', async () => {
  const bytes = await makeFixturePdf();
  const badRules = {
    ...rulesConfig,
    rules: [{ id: 'badFormat', category: 'formatting', label: 'Bad', find: '(', valid: '.*', severity: 'error', enabled: true }],
  };
  const result = await processFile('drawing.pdf', bytes, badRules, fakeSpell);
  assert.equal(result.pass, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].category, 'config');
  assert.equal(result.issues[0].ruleId, 'invalidRules');
  assert.match(result.issues[0].message, /Could not evaluate rules/);
});

test('a drawing-number-style token containing digits is never passed to the spell checker', async () => {
  const bytes = await makeFixturePdf(); // contains "DWG NO: AB-123"
  const strictSpell = { correct: () => false }; // would flag everything if reached
  const result = await processFile('drawing.pdf', bytes, rulesConfig, strictSpell);
  const spellingFoundTexts = result.issues.filter((i) => i.category === 'spelling').map((i) => i.foundText);
  assert.ok(!spellingFoundTexts.includes('AB-123'));
});

test('rule violations and spelling issues can both appear together with correct pass/counts', async () => {
  const bytes = await makeFixturePdf(); // "DWG NO: AB-123" / "REV: A"
  const badRules = { ...rulesConfig, rules: [{ ...rulesConfig.rules[0], pattern: '^ZZ-999$' }] };
  const flagOneWordSpell = { correct: (word) => word.toUpperCase() !== 'DWG' };
  const result = await processFile('drawing.pdf', bytes, badRules, flagOneWordSpell);

  assert.equal(result.pass, false);
  const ruleIssue = result.issues.find((i) => i.ruleId === 'dwgNo');
  const spellIssue = result.issues.find((i) => i.category === 'spelling');
  assert.ok(ruleIssue, 'expected a rule violation issue');
  assert.ok(spellIssue, 'expected a spelling issue');
  assert.equal(spellIssue.foundText, 'DWG');
  assert.equal(result.counts.error, result.issues.filter((i) => i.severity === 'error').length);
  assert.equal(result.counts.warn, result.issues.filter((i) => i.severity === 'warn').length);
  assert.ok(result.counts.error >= 1);
  assert.ok(result.counts.warn >= 1);
});
