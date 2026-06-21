import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initApp } from '../../src/ui/app.js';
import { DEFAULT_RULES } from '../../src/rulesStore.js';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  global.URL = dom.window.URL;
  return dom;
}

test('renders one dropdown option per default rule', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  const options = root.querySelectorAll('#ruleSelect option');
  assert.equal(options.length, DEFAULT_RULES.rules.length);
});

test('selecting a rule populates the editor fields', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  const select = root.querySelector('#ruleSelect');
  select.value = 'dwgNo';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(root.querySelector('#ruleLabel').value, 'DWG NO');
  assert.equal(root.querySelector('#rulePattern').value, '^[A-Z]{2}-\\d{3}$');
});

test('saving a new rule id adds it to the dropdown', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  root.querySelector('#ruleId').value = 'myNewRule';
  root.querySelector('#ruleCategory').value = 'formatting';
  root.querySelector('#ruleLabel').value = 'My new rule';
  root.querySelector('#ruleFind').value = '\\d';
  root.querySelector('#ruleValid').value = '^x$';
  root.querySelector('#ruleMessage').value = 'msg';
  root.querySelector('#saveRule').dispatchEvent(new window.Event('click'));

  const ids = [...root.querySelectorAll('#ruleSelect option')].map((o) => o.value);
  assert.ok(ids.includes('myNewRule'));
});

test('removing the selected rule takes it out of the dropdown', () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  const select = root.querySelector('#ruleSelect');
  select.value = 'dwgNo';
  select.dispatchEvent(new window.Event('change'));
  root.querySelector('#removeRule').dispatchEvent(new window.Event('click'));

  const ids = [...root.querySelectorAll('#ruleSelect option')].map((o) => o.value);
  assert.ok(!ids.includes('dwgNo'));
  assert.equal(app.store.getRule('dwgNo'), null);
});

test('saving a rule with an invalid regex shows an alert and leaves the dropdown unchanged', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  let alertMessage = null;
  global.alert = (msg) => {
    alertMessage = msg;
  };

  root.querySelector('#ruleId').value = 'badRegexRule';
  root.querySelector('#ruleCategory').value = 'formatting';
  root.querySelector('#ruleLabel').value = 'Bad regex rule';
  root.querySelector('#ruleFind').value = '(';
  root.querySelector('#ruleValid').value = '^x$';
  root.querySelector('#ruleMessage').value = 'msg';
  root.querySelector('#saveRule').dispatchEvent(new window.Event('click'));

  const ids = [...root.querySelectorAll('#ruleSelect option')].map((o) => o.value);
  assert.ok(!ids.includes('badRegexRule'));
  assert.equal(typeof alertMessage, 'string');
  assert.ok(alertMessage.length > 0);
});
