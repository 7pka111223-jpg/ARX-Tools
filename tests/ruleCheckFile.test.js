import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleCheckFile } from '../src/ruleCheckFile.js';
import { makeFixturePdf } from './fixtures/makeFixturePdf.js';

const region = { corner: 'bottom-right', widthPct: 30, heightPct: 25 };
const rulesConfig = {
  project: [],
  titleBlockRegion: region,
  spelling: { customDictionary: [], ignore: [] },
  rules: [{ id: 'dwgNo', category: 'titleBlock', label: 'DWG NO', pattern: '^[A-Z]{2}-\\d{3}$', severity: 'error', enabled: true }],
};

test('happy path: a valid title block produces a passing result', async () => {
  const bytes = await makeFixturePdf();
  const result = await ruleCheckFile('drawing.pdf', bytes, rulesConfig);
  assert.equal(result.fileName, 'drawing.pdf');
  assert.equal(result.pass, true);
});

test('rule violations are reported as issues with pass=false', async () => {
  const bytes = await makeFixturePdf(); // has "DWG NO: AB-123" which matches the pattern...
  const badRules = { ...rulesConfig, rules: [{ ...rulesConfig.rules[0], pattern: '^ZZ-999$' }] };
  const result = await ruleCheckFile('drawing.pdf', bytes, badRules);
  assert.equal(result.pass, false);
  assert.ok(result.issues.some((i) => i.ruleId === 'dwgNo'));
});

test('the result never contains spelling issues, even with misspelled text', async () => {
  const bytes = await makeFixturePdf();
  const result = await ruleCheckFile('drawing.pdf', bytes, rulesConfig);
  assert.ok(!result.issues.some((i) => i.category === 'spelling'));
});

test('a PDF with no extractable text returns a single noText error issue', async () => {
  const bytes = await makeFixturePdf({ withText: false });
  const result = await ruleCheckFile('blank.pdf', bytes, rulesConfig);
  assert.equal(result.pass, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].ruleId, 'noText');
});

test('corrupt bytes return a single corrupt error issue instead of throwing', async () => {
  const result = await ruleCheckFile('garbage.pdf', new Uint8Array([1, 2, 3]), rulesConfig);
  assert.equal(result.pass, false);
  assert.equal(result.issues[0].ruleId, 'corrupt');
});

test('an invalid formatting rule regex returns a clean config error instead of throwing', async () => {
  const bytes = await makeFixturePdf();
  const badRules = {
    ...rulesConfig,
    rules: [{ id: 'badFormat', category: 'formatting', label: 'Bad', find: '(', valid: '.*', severity: 'error', enabled: true }],
  };
  const result = await ruleCheckFile('drawing.pdf', bytes, badRules);
  assert.equal(result.pass, false);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].category, 'config');
  assert.equal(result.issues[0].ruleId, 'invalidRules');
  assert.match(result.issues[0].message, /Could not evaluate rules/);
});
