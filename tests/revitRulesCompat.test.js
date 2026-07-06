import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRulesStore, DEFAULT_RULES } from '../src/rulesStore.js';

// The Revit checker (revit/DrawingChecker.extension) shares the rules JSON
// schema with this tool so one rules file drives both. These tests lock that
// contract: the Revit tool's bundled defaults must import cleanly here, and
// the shared parts must stay identical to this tool's DEFAULT_RULES.

const revitDefaultsPath = new URL(
  '../revit/DrawingChecker.extension/lib/drawingchecker/data/default_rules.json',
  import.meta.url
);

test('the Revit checker default rules import cleanly into the web rules store', () => {
  const store = createRulesStore();
  store.importRules(readFileSync(revitDefaultsPath, 'utf8'));
  assert.equal(store.listRules().length, DEFAULT_RULES.rules.length);
});

test('the shared schema parts match the web DEFAULT_RULES exactly', () => {
  const revitDefaults = JSON.parse(readFileSync(revitDefaultsPath, 'utf8'));
  for (const key of ['project', 'spelling', 'titleBlockRegion', 'rules']) {
    assert.deepEqual(revitDefaults[key], DEFAULT_RULES[key], `mismatch in "${key}"`);
  }
});

test('a rules file exported by the web tool round-trips the revit block', () => {
  const store = createRulesStore();
  store.importRules(readFileSync(revitDefaultsPath, 'utf8'));
  const reExported = JSON.parse(store.exportRules());
  assert.ok(reExported.revit, 'revit block must survive import/export');
  assert.equal(reExported.revit.skipViewsNotOnSheets, true);
});
