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
