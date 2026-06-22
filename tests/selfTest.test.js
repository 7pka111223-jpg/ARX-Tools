import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTest } from '../src/selfTest.js';

test('all synthetic cases match their expected pass/fail outcome', () => {
  const result = runSelfTest();
  assert.equal(result.allPassed, true, JSON.stringify(result.results, null, 2));
  assert.ok(result.results.length >= 2);
});

test('each case result reports its name and ok flag', () => {
  const result = runSelfTest();
  for (const r of result.results) {
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.issues));
  }
});

test('issues content is correct for each synthetic case, independent of the ok flag', () => {
  const result = runSelfTest();
  const [complete, missingDwgNo, malformedDwgNo] = result.results;

  assert.equal(complete.name, 'complete title block passes');
  assert.equal(complete.issues.length, 0, JSON.stringify(complete.issues, null, 2));

  assert.equal(missingDwgNo.name, 'missing drawing number fails');
  const missingDwgNoIssue = missingDwgNo.issues.find((i) => i.ruleId === 'dwgNo');
  assert.ok(missingDwgNoIssue, JSON.stringify(missingDwgNo.issues, null, 2));
  assert.ok(missingDwgNoIssue.message.includes('not found'), missingDwgNoIssue.message);

  assert.equal(malformedDwgNo.name, 'malformed drawing number fails');
  const malformedDwgNoIssue = malformedDwgNo.issues.find((i) => i.ruleId === 'dwgNo');
  assert.ok(malformedDwgNoIssue, JSON.stringify(malformedDwgNo.issues, null, 2));
  assert.equal(malformedDwgNoIssue.foundText, '12345');
});
