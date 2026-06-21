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

test('importing an invalid rules file shows an alert and leaves rules/dropdown unchanged', async () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  let alertMessage = null;
  global.alert = (msg) => {
    alertMessage = msg;
  };

  const optionsBefore = [...root.querySelectorAll('#ruleSelect option')].map((o) => o.value);

  const badRules = {
    project: [],
    spelling: { language: 'en', customDictionary: [], ignore: [] },
    titleBlockRegion: { corner: 'bottom-right', widthPct: 30, heightPct: 25 },
    rules: [
      { id: 'badOne', category: 'formatting', label: 'Bad', message: 'msg', severity: 'critical', enabled: true },
    ],
  };
  const fakeFile = { text: () => Promise.resolve(JSON.stringify(badRules)) };

  const importInput = root.querySelector('#importRules');
  Object.defineProperty(importInput, 'files', { value: [fakeFile], configurable: true });

  const changeEvent = new window.Event('change');
  importInput.dispatchEvent(changeEvent);

  // The handler is async; wait for its microtasks (file.text() + import) to settle.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(typeof alertMessage, 'string');
  assert.ok(alertMessage.length > 0);

  const optionsAfter = [...root.querySelectorAll('#ruleSelect option')].map((o) => o.value);
  assert.deepEqual(optionsAfter, optionsBefore);
  assert.ok(app.store.getRule('badOne') == null);
});

test('a second handleFiles call while one is in progress is ignored and does not corrupt drawingResults', async () => {
  setupDom();
  const root = document.getElementById('app');

  // A worker whose postMessage resolves on a later microtask, leaving a real
  // window where a concurrent handleFiles call could race in before the
  // first call finishes its loop.
  function createDelayedWorker() {
    return {
      postMessage(msg) {
        const self = this;
        setTimeout(() => {
          self.onmessage({
            data: { jobId: msg.jobId, result: { fileName: msg.fileName, pass: true, issues: [], counts: { error: 0, warn: 0 } } },
          });
        }, 0);
      },
      terminate() {},
    };
  }

  const app = initApp(root, { createWorker: createDelayedWorker });

  let alertMessage = null;
  global.alert = (msg) => {
    alertMessage = msg;
  };

  const file1 = { name: 'a.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
  const file2 = { name: 'b.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };

  const firstCall = app.handleFiles([file1]);
  // Second call happens while the first is still mid-batch (busy === true).
  const secondCall = app.handleFiles([file2]);

  await Promise.all([firstCall, secondCall]);

  // The second call should have been rejected via the busy guard, with user feedback,
  // and should not have touched shared state.
  assert.equal(typeof alertMessage, 'string');
  assert.ok(alertMessage.length > 0);

  const summaryRows = root.querySelectorAll('#summaryTable tbody tr');
  assert.equal(summaryRows.length, 1);
});

test('handleFiles ignores stray messages that do not match the expected jobId', async () => {
  setupDom();
  const root = document.getElementById('app');

  // Simulates pdfjs-dist's internal Worker handshake message leaking onto the
  // same real Worker postMessage channel the app uses: a stray, jobId-less
  // message arrives before the real result for the job. The fix must match on
  // jobId and ignore the stray message rather than resolving with it.
  const fakeWorker = {
    postMessage(msg) {
      this.onmessage({ data: { sourceName: 'worker', targetName: 'main', action: 'ready', data: null } });
      this.onmessage({
        data: { jobId: msg.jobId, result: { fileName: msg.fileName, pass: true, issues: [], counts: { error: 0, warn: 0 } } },
      });
    },
    terminate() {},
  };

  const app = initApp(root, { createWorker: () => fakeWorker });
  const file = { name: 'a.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };

  await app.handleFiles([file]);

  const rows = [...root.querySelectorAll('#summaryTable tbody tr')];
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes('PASS'));
});

test('handleFiles ignores a stray message with a mismatched jobId across multiple files', async () => {
  setupDom();
  const root = document.getElementById('app');

  // Two files processed sequentially on one reused worker. The first file's
  // postMessage call sends a stray message carrying a jobId that belongs to
  // neither job before sending its own real result -- the resolution for
  // file 'a.pdf' must wait for the message whose jobId === 'a.pdf', not
  // resolve on the stray one.
  const fakeWorker = {
    postMessage(msg) {
      this.onmessage({ data: { jobId: 'unrelated-job', result: { fileName: 'unrelated.pdf', pass: false, issues: [], counts: { error: 0, warn: 0 } } } });
      this.onmessage({
        data: { jobId: msg.jobId, result: { fileName: msg.fileName, pass: true, issues: [], counts: { error: 0, warn: 0 } } },
      });
    },
    terminate() {},
  };

  const app = initApp(root, { createWorker: () => fakeWorker });
  const file1 = { name: 'a.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
  const file2 = { name: 'b.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };

  await app.handleFiles([file1, file2]);

  const rows = [...root.querySelectorAll('#summaryTable tbody tr')];
  assert.equal(rows.length, 2);
  assert.ok(rows[0].textContent.includes('a.pdf'));
  assert.ok(rows[0].textContent.includes('PASS'));
  assert.ok(rows[1].textContent.includes('b.pdf'));
  assert.ok(rows[1].textContent.includes('PASS'));
});
