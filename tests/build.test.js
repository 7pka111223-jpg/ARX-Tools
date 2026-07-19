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
  // No reference to any EXTERNAL script/style/resource -> fully self-contained.
  // A data: URI (e.g. an inline favicon) carries no network dependency, so it
  // is deliberately allowed; anything else (http(s):, protocol-relative, or a
  // relative/absolute path to a second file) is not.
  assert.ok(!/<script[^>]+src=(?!["']?data:)/.test(html));
  assert.ok(!/<link[^>]+href=(?!["']?data:)/.test(html));
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

test('npm run build also produces a self-contained dist/hy8-importer.html', () => {
  execFileSync('node', ['build.js'], { stdio: 'inherit' });
  assert.ok(existsSync('dist/hy8-importer.html'));
  const html = readFileSync('dist/hy8-importer.html', 'utf8');
  assert.ok(html.includes('<title>HY-8 CSV Importer</title>'));
  assert.ok(!html.includes('__APP_CODE__'));
  assert.ok(html.includes('initHy8ImporterApp'));
  // Same self-contained criteria as drawing-checker.html: no external
  // script/style src (an inline SVG's xmlns="http://www.w3.org/2000/svg" is
  // a namespace declaration, not a network request, so it's not flagged).
  assert.ok(!/<script[^>]+src=(?!["']?data:)/.test(html));
  assert.ok(!/<link[^>]+href=(?!["']?data:)/.test(html));
  assert.equal((html.match(/<\/script/gi) || []).length, 1);
});
