import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeRegex, escapeHtml } from '../src/util.js';

test('escapeRegex escapes regex special characters', () => {
  assert.equal(escapeRegex('AB-123'), 'AB\\-123');
  assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
});

test('escapeHtml escapes html special characters', () => {
  assert.equal(escapeHtml('<a> & "b" \'c\''), '&lt;a&gt; &amp; &quot;b&quot; &#39;c&#39;');
});

test('escapeHtml stringifies non-strings', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
});
