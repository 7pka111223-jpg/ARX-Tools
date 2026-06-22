import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRulesStore, DEFAULT_RULES } from '../src/rulesStore.js';

test('listRules reflects the default rules', () => {
  const store = createRulesStore();
  const list = store.listRules();
  assert.equal(list.length, DEFAULT_RULES.rules.length);
  assert.ok(list.every((r) => 'id' in r && 'category' in r && 'label' in r));
});

test('addRule adds a new rule visible in listRules', () => {
  const store = createRulesStore();
  store.addRule({ id: 'myRule', category: 'formatting', label: 'My rule', find: '\\d', valid: '^x$', message: 'msg' });
  assert.ok(store.listRules().some((r) => r.id === 'myRule'));
  assert.equal(store.getRule('myRule').enabled, true); // default applied
});

test('addRule rejects a duplicate id', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id;
  assert.throws(() => store.addRule({ id, category: 'formatting', label: 'dup' }));
});

test('updateRule changes fields but keeps the id', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id;
  store.updateRule(id, { label: 'Renamed', severity: 'warn' });
  const rule = store.getRule(id);
  assert.equal(rule.id, id);
  assert.equal(rule.label, 'Renamed');
  assert.equal(rule.severity, 'warn');
});

test('updateRule throws for an unknown id', () => {
  const store = createRulesStore();
  assert.throws(() => store.updateRule('nope', { label: 'x' }));
});

test('removeRule removes it from listRules', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id;
  store.removeRule(id);
  assert.ok(!store.listRules().some((r) => r.id === id));
});

test('exportRules then importRules round-trips the rule set', () => {
  const store = createRulesStore();
  store.addRule({ id: 'extra', category: 'formatting', label: 'Extra', find: '\\d', valid: '^x$', message: 'msg' });
  const json = store.exportRules();

  const store2 = createRulesStore();
  store2.importRules(json);
  assert.ok(store2.listRules().some((r) => r.id === 'extra'));
});

test('importRules rejects a malformed rules file', () => {
  const store = createRulesStore();
  assert.throws(() => store.importRules(JSON.stringify({ foo: 'bar' })));
});

test('setProjectFieldValue and dictionary word management', () => {
  const store = createRulesStore();
  store.setProjectFieldValue('name', 'Acme Plant');
  assert.equal(store.getRules().project.find((f) => f.id === 'name').value, 'Acme Plant');

  store.addCustomDictionaryWord('headworks');
  assert.ok(store.getRules().spelling.customDictionary.includes('headworks'));
  store.removeCustomDictionaryWord('headworks');
  assert.ok(!store.getRules().spelling.customDictionary.includes('headworks'));
});

test('importDictionary merges new words and reports how many were added', () => {
  const store = createRulesStore();
  store.addCustomDictionaryWord('headworks');
  const added = store.importDictionary('headworks\nclarifier\nweir\nweir');
  // "headworks" already present and the duplicate "weir" only counts once.
  assert.equal(added, 2);
  const dict = store.getRules().spelling.customDictionary;
  assert.ok(dict.includes('clarifier'));
  assert.ok(dict.includes('weir'));
  assert.equal(dict.filter((w) => w === 'weir').length, 1);
});

test('importDictionary accepts whitespace- or newline-separated words and ignores blanks', () => {
  const store = createRulesStore();
  const added = store.importDictionary('  alpha   beta \n\n  gamma  ');
  assert.equal(added, 3);
  assert.deepEqual(store.getRules().spelling.customDictionary, ['alpha', 'beta', 'gamma']);
});

test('exportDictionary returns one word per line and round-trips through importDictionary', () => {
  const store = createRulesStore();
  store.importDictionary('alpha beta gamma');
  const text = store.exportDictionary();
  assert.equal(text, 'alpha\nbeta\ngamma');

  const store2 = createRulesStore();
  const added = store2.importDictionary(text);
  assert.equal(added, 3);
  assert.deepEqual(store2.getRules().spelling.customDictionary, ['alpha', 'beta', 'gamma']);
});

test('addRule rejects an invalid severity value', () => {
  const store = createRulesStore();
  assert.throws(() => store.addRule({ id: 'badSeverity', category: 'formatting', label: 'x', find: '\\d', valid: '^x$', message: 'm', severity: 'critical' }));
});

test('updateRule rejects setting an invalid severity value', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id;
  assert.throws(() => store.updateRule(id, { severity: 'critical' }));
});

test('addRule rejects a formatting rule with an invalid find regex', () => {
  const store = createRulesStore();
  assert.throws(() => store.addRule({ id: 'badRegex', category: 'formatting', label: 'x', find: '(', valid: '^x$', message: 'm' }));
});

test('addRule rejects a formatting rule with an invalid valid regex', () => {
  const store = createRulesStore();
  assert.throws(() => store.addRule({ id: 'badRegex2', category: 'formatting', label: 'x', find: '\\d', valid: '(', message: 'm' }));
});

test('addRule rejects a titleBlock/revision rule with an invalid pattern regex', () => {
  const store = createRulesStore();
  assert.throws(() => store.addRule({ id: 'badPattern', category: 'titleBlock', label: 'x', pattern: '(' }));
});

test('updateRule rejects an update that introduces an invalid regex', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id; // dwgNo, category titleBlock, has a pattern
  assert.throws(() => store.updateRule(id, { pattern: '(' }));
});

test('getRule returns a clone, not a live reference into the store', () => {
  const store = createRulesStore();
  const id = DEFAULT_RULES.rules[0].id;
  const rule = store.getRule(id);
  rule.label = 'mutated';
  assert.notEqual(store.getRule(id).label, 'mutated');
});

test('importRules rejects a rules file with an invalid severity and leaves previous state intact', () => {
  const store = createRulesStore();
  const before = store.listRules();

  const bad = JSON.parse(store.exportRules());
  bad.rules.push({ id: 'badImportSeverity', category: 'formatting', label: 'x', find: '\\d', valid: '^x$', message: 'm', severity: 'critical', enabled: true });

  assert.throws(() => store.importRules(JSON.stringify(bad)));
  assert.deepEqual(store.listRules(), before);
});

test('importRules rejects a rules file with an invalid regex and leaves previous state intact', () => {
  const store = createRulesStore();
  const before = store.listRules();

  const bad = JSON.parse(store.exportRules());
  bad.rules.push({ id: 'badImportRegex', category: 'titleBlock', label: 'x', pattern: '(', message: 'm', severity: 'error', enabled: true });

  assert.throws(() => store.importRules(JSON.stringify(bad)));
  assert.deepEqual(store.listRules(), before);
});
