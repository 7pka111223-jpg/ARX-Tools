import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

test('npm run build produces a single self-contained HTML file with no leftover placeholders', () => {
  execFileSync('node', ['build.js'], { stdio: 'inherit' });
  assert.ok(existsSync('dist/drawing-checker.html'));
  const html = readFileSync('dist/drawing-checker.html', 'utf8');
  assert.ok(html.includes('<title>Engineering Drawing Checker</title>'));
  assert.ok(!html.includes('__WORKER_CODE__'));
  assert.ok(!html.includes('__APP_CODE__'));
  assert.ok(html.includes('new Worker('));
  // No reference to any external script/style source -> fully self-contained.
  assert.ok(!/<script[^>]+src=/.test(html));
  assert.ok(!/<link[^>]+href=/.test(html));
});
