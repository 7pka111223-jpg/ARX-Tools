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
