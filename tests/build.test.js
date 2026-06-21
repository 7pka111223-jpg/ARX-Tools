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
  // Guard against a `</script` breakout: JSON.stringify (used by build.js to
  // embed the worker/app bundles) does not escape '<', '>', or '/', so a
  // literal "</script" substring inside a future dependency bump's bundled
  // source (or the embedded dictionary text) would prematurely close one of
  // index.template.html's <script> tags and corrupt the page. There should
  // be exactly 2 occurrences -- the two real closing </script> tags from the
  // template's own static markup -- and no extra ones smuggled in via the
  // embedded code/data.
  assert.equal((html.match(/<\/script/gi) || []).length, 2);
});
