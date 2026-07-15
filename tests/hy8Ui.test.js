import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { initApp } from '../src/hy8/ui/app.js';
import { serializeHy8 } from '../src/hy8/hy8File.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  return dom;
}

function makeApp() {
  setupDom();
  const root = document.getElementById('app');
  const downloads = [];
  const app = initApp(root, { download: (name, text) => downloads.push({ name, text }) });
  return { root, app, downloads };
}

test('loading both files computes a name-mode mapping by default', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  assert.equal(app.state.mapResult.pairs.length, 83);
  assert.equal(app.state.mapResult.unmatchedHy8.length, 1);
  assert.equal(root.querySelector('#mappingTable tbody').children.length, 83);
  assert.equal(root.querySelector('#unmatchedHy8Table tbody').children.length, 1);
  assert.ok(root.querySelector('#mappingSummary').textContent.includes('83 matched'));
  assert.equal(root.querySelector('#importBtn').disabled, false);
});

test('switching to station mode recomputes the mapping with the tolerance field shown', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#modeStation').checked = true;
  root.querySelector('#modeStation').dispatchEvent(new window.Event('change'));

  assert.equal(app.state.mode, 'station');
  assert.notEqual(root.querySelector('#toleranceField').style.display, 'none');
  // Station mode at the default 15m tolerance matches far fewer than all 83.
  assert.ok(app.state.mapResult.pairs.length < 83);
  assert.ok(app.state.mapResult.pairs.length > 0);
});

test('the differences panel lists CU-JSS-01 with a USIL difference', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  const diffHtml = root.querySelector('#diffContainer').innerHTML;
  assert.ok(diffHtml.includes('CU-JSS-01'));
  assert.ok(diffHtml.includes('USIL'));
});

test('flow textarea reports unmatched names', () => {
  const { root, app } = makeApp();
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  const flowText = root.querySelector('#flowText');
  flowText.value = 'CU-JSS-01, 10\nNOT-A-CULVERT, 3';
  flowText.dispatchEvent(new window.Event('input'));

  assert.match(root.querySelector('#flowUnmatched').textContent, /NOT-A-CULVERT/);
});

test('Import & download produces a file whose geometry matches the headless pipeline', () => {
  const { root, app, downloads } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#flowText').value = 'CU-JSS-01, 10';
  root.querySelector('#flowText').dispatchEvent(new window.Event('input'));

  root.querySelector('#importBtn').dispatchEvent(new window.Event('click'));

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_1_updated.hy8');
  assert.ok(downloads[0].text.startsWith('HY8PROJECTFILE80\r\n'));
  assert.ok(downloads[0].text.endsWith('ENDPROJECTFILE'));
  assert.ok(root.querySelector('#statusMsg').textContent.includes('83 culvert(s) updated'));
  assert.ok(root.querySelector('#statusMsg').textContent.includes('1 flow(s) applied'));
});

test('Import & download is a no-op with a status message when nothing is mapped yet', () => {
  const { root, downloads } = makeApp();
  root.querySelector('#importBtn').dispatchEvent(new window.Event('click'));
  assert.equal(downloads.length, 0);
});
