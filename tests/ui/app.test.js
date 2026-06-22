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

function ruleRowIds(root) {
  return [...root.querySelectorAll('#ruleList .rule-row')].map((r) => r.dataset.ruleId);
}

test('renders one rule row per default rule', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  assert.equal(root.querySelectorAll('#ruleList .rule-row').length, DEFAULT_RULES.rules.length);
});

test('clicking a rule\'s Edit button populates the editor fields and locks the id', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  root.querySelector('.rule-edit-btn[data-rule-id="dwgNo"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(root.querySelector('#ruleLabel').value, 'DWG NO');
  assert.equal(root.querySelector('#rulePattern').value, '^[A-Z]{2}-\\d{3}$');
  // The id is locked to the rule being edited so saving modifies it in place.
  assert.equal(root.querySelector('#ruleId').value, 'dwgNo');
  assert.equal(root.querySelector('#ruleId').readOnly, true);
});

test('saving a new rule id adds it to the rule list', () => {
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

  assert.ok(ruleRowIds(root).includes('myNewRule'));
});

test('editing an existing rule and saving updates it in place (no duplicate row)', () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  root.querySelector('.rule-edit-btn[data-rule-id="dwgNo"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  root.querySelector('#ruleLabel').value = 'DRAWING NUMBER';
  root.querySelector('#saveRule').dispatchEvent(new window.Event('click'));

  // Exactly one row for dwgNo, and the stored rule reflects the new label.
  assert.equal(ruleRowIds(root).filter((id) => id === 'dwgNo').length, 1);
  assert.equal(app.store.getRule('dwgNo').label, 'DRAWING NUMBER');
});

test('clicking a rule\'s Delete button removes it from the list and the store', () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  root.querySelector('.rule-delete-btn[data-rule-id="dwgNo"]').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.ok(!ruleRowIds(root).includes('dwgNo'));
  assert.equal(app.store.getRule('dwgNo'), null);
});

test('the New rule button resets the editor out of edit mode', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });
  root.querySelector('.rule-edit-btn[data-rule-id="dwgNo"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(root.querySelector('#ruleId').readOnly, true);

  root.querySelector('#newRule').dispatchEvent(new window.Event('click'));
  assert.equal(root.querySelector('#ruleId').value, '');
  assert.equal(root.querySelector('#ruleId').readOnly, false);
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

  assert.ok(!ruleRowIds(root).includes('badRegexRule'));
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

  const idsBefore = ruleRowIds(root);

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

  assert.deepEqual(ruleRowIds(root), idsBefore);
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

test('the spelling check runs a spelling-only worker pass and renders misspellings with suggestions', async () => {
  setupDom();
  const root = document.getElementById('app');

  // A worker that branches on the message mode: a spelling pass returns
  // misspellings-with-suggestions; the default full pass returns a clean result.
  const fakeWorker = {
    postMessage(msg) {
      const result = msg.mode === 'spelling'
        ? { fileName: msg.fileName, error: null, misspellings: [{ word: 'clarifeir', pages: [1], suggestions: ['clarifier'] }] }
        : { fileName: msg.fileName, pass: true, issues: [], counts: { error: 0, warn: 0 } };
      this.onmessage({ data: { jobId: msg.jobId, result } });
    },
    terminate() {},
  };

  const app = initApp(root, { createWorker: () => fakeWorker });
  const file = { name: 'a.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };

  // The full pass records the file selection that the spelling pass reuses.
  await app.handleFiles([file]);
  await app.handleSpellCheck();

  const spellTable = root.querySelector('#spellTable');
  assert.ok(spellTable.textContent.includes('clarifeir'));
  assert.ok(spellTable.textContent.includes('clarifier'));
});

test('the spelling check warns and does nothing when no files have been added', async () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  let alertMessage = null;
  global.alert = (msg) => { alertMessage = msg; };

  await app.handleSpellCheck();

  assert.equal(typeof alertMessage, 'string');
  assert.ok(alertMessage.length > 0);
  assert.equal(root.querySelectorAll('#spellTable tbody tr').length, 0);
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

test('the rules check runs a rules-only worker pass and renders the result independent of spelling', async () => {
  setupDom();
  const root = document.getElementById('app');

  // A worker that branches on the message mode: a rules pass returns a
  // failing result (so it's distinguishable from the full pass below).
  const fakeWorker = {
    postMessage(msg) {
      const result = msg.mode === 'rules'
        ? { fileName: msg.fileName, pass: false, issues: [{ category: 'titleBlock', severity: 'error', ruleId: 'dwgNo', foundText: 'ZZ-999', page: 1, message: 'bad' }], counts: { error: 1, warn: 0 } }
        : { fileName: msg.fileName, pass: true, issues: [], counts: { error: 0, warn: 0 } };
      this.onmessage({ data: { jobId: msg.jobId, result } });
    },
    terminate() {},
  };

  const app = initApp(root, { createWorker: () => fakeWorker });
  const file = { name: 'a.pdf', arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };

  // The full pass records the file selection that the rules pass reuses.
  await app.handleFiles([file]);
  await app.handleRuleCheck();

  const rulesTable = root.querySelector('#rulesTable');
  assert.ok(rulesTable.textContent.includes('a.pdf'));
  assert.ok(rulesTable.textContent.includes('FAIL'));
  // The full-check summary table is untouched by the rules-only pass.
  const summaryTable = root.querySelector('#summaryTable');
  assert.ok(summaryTable.textContent.includes('PASS'));
});

test('the rules check warns and does nothing when no files have been added', async () => {
  setupDom();
  const root = document.getElementById('app');
  const app = initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  let alertMessage = null;
  global.alert = (msg) => { alertMessage = msg; };

  await app.handleRuleCheck();

  assert.equal(typeof alertMessage, 'string');
  assert.ok(alertMessage.length > 0);
  assert.equal(root.querySelectorAll('#rulesTable tbody tr').length, 0);
});

test('typing a pattern and a matching sample value shows a live "Matches" result', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const pattern = root.querySelector('#rulePattern');
  const value = root.querySelector('#patternTestValue');
  pattern.value = '^[A-Z]{2}-\\d{3}$';
  pattern.dispatchEvent(new window.Event('input'));
  value.value = 'AB-123';
  value.dispatchEvent(new window.Event('input'));

  const result = root.querySelector('#patternTestResult');
  assert.match(result.textContent, /Matches/);
  assert.ok(!/Does not match/.test(result.textContent));
});

test('an invalid pattern regex shows an inline error in the live tester instead of throwing', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const pattern = root.querySelector('#rulePattern');
  const value = root.querySelector('#patternTestValue');
  pattern.value = '(';
  pattern.dispatchEvent(new window.Event('input'));
  value.value = 'anything';
  value.dispatchEvent(new window.Event('input'));

  assert.match(root.querySelector('#patternTestResult').textContent, /Invalid regex/);
});

test('clicking a pattern preset chip fills the Pattern field and updates the live tester', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  root.querySelector('#patternTestValue').value = 'AB-123';
  const chip = [...root.querySelectorAll('#patternPresets .preset-chip')].find((b) => b.textContent.includes('AB-123)'));
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(root.querySelector('#rulePattern').value, '^[A-Z]{2}-\\d{3}$');
  assert.match(root.querySelector('#patternTestResult').textContent, /Matches/);
});

test('clicking a format preset chip fills the Find/Valid fields and updates the live match list', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  root.querySelector('#formatTestValue').value = 'Issued 01/02/2024';
  const chip = root.querySelector('#formatPresets .preset-chip');
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(root.querySelector('#ruleFind').value, '\\d{1,2}/\\d{1,2}/\\d{2,4}');
  assert.equal(root.querySelector('#ruleValid').value, '^\\d{4}-\\d{2}-\\d{2}$');
  assert.ok(root.querySelector('#formatTestMatches').textContent.includes('01/02/2024'));
});

test('typing an example value and its variable part auto-fills Pattern and shows an explanation', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  const variable = root.querySelector('#patternVariable');
  example.value = 'J2501-JPD-EBH-DG-20103';
  example.dispatchEvent(new window.Event('input'));
  variable.value = '20103';
  variable.dispatchEvent(new window.Event('input'));

  assert.equal(root.querySelector('#rulePattern').value, '^J2501\\-JPD\\-EBH\\-DG\\-\\d{5}$');
  const resultText = root.querySelector('#patternBuilderResult').textContent;
  assert.match(resultText, /J2501-JPD-EBH-DG-/);
  assert.match(resultText, /5 digits/);
  // The live pattern tester underneath also picks up the auto-filled pattern.
  assert.match(root.querySelector('#patternTestResult').textContent, /Type a sample value/i);
});

test('the build-from-example result reflects in the live "try it" tester once a sample value is added', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  root.querySelector('#patternExample').value = 'J2501-JPD-EBH-DG-20103';
  root.querySelector('#patternExample').dispatchEvent(new window.Event('input'));
  root.querySelector('#patternVariable').value = '20103';
  root.querySelector('#patternVariable').dispatchEvent(new window.Event('input'));

  const value = root.querySelector('#patternTestValue');
  value.value = 'J2501-JPD-EBH-DG-20104';
  value.dispatchEvent(new window.Event('input'));

  assert.match(root.querySelector('#patternTestResult').textContent, /Matches/);
});

test('an empty variable part shows guidance text and leaves Pattern untouched', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  example.value = 'J2501-JPD-EBH-DG-20103';
  example.dispatchEvent(new window.Event('input'));

  assert.equal(root.querySelector('#rulePattern').value, '');
  assert.match(root.querySelector('#patternBuilderResult').textContent, /changes between drawings/i);
});

test('a variable part not found in the example shows an error and leaves Pattern untouched', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  const variable = root.querySelector('#patternVariable');
  example.value = 'J2501-JPD-EBH-DG-20103';
  example.dispatchEvent(new window.Event('input'));
  variable.value = '99999';
  variable.dispatchEvent(new window.Event('input'));

  assert.equal(root.querySelector('#rulePattern').value, '');
  assert.match(root.querySelector('#patternBuilderResult').textContent, /not found/i);
});

test('a variable part that appears more than once shows a warning alongside the explanation', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  const variable = root.querySelector('#patternVariable');
  example.value = 'AB-001-AB';
  example.dispatchEvent(new window.Event('input'));
  variable.value = 'AB';
  variable.dispatchEvent(new window.Event('input'));

  const resultText = root.querySelector('#patternBuilderResult').textContent;
  assert.match(resultText, /more than once/);
  assert.equal(root.querySelector('#rulePattern').value, '^[A-Z]{2}\\-001\\-AB$');
});

test('clicking a pattern preset chip clears the build-from-example fields and result', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  const variable = root.querySelector('#patternVariable');
  example.value = 'J2501-JPD-EBH-DG-20103';
  example.dispatchEvent(new window.Event('input'));
  variable.value = '20103';
  variable.dispatchEvent(new window.Event('input'));

  const chip = [...root.querySelectorAll('#patternPresets .preset-chip')].find((b) => b.textContent.includes('AB-123)'));
  chip.dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(example.value, '');
  assert.equal(variable.value, '');
  assert.equal(root.querySelector('#patternBuilderResult').innerHTML, '');
  assert.equal(root.querySelector('#rulePattern').value, '^[A-Z]{2}-\\d{3}$');
});

test('entering edit mode clears any in-progress build-from-example fields', () => {
  setupDom();
  const root = document.getElementById('app');
  initApp(root, { createWorker: () => ({ postMessage() {}, terminate() {} }) });

  const example = root.querySelector('#patternExample');
  example.value = 'leftover value';
  example.dispatchEvent(new window.Event('input'));

  root.querySelector('.rule-edit-btn[data-rule-id="dwgNo"]').dispatchEvent(new window.Event('click', { bubbles: true }));

  assert.equal(example.value, '');
  assert.equal(root.querySelector('#patternVariable').value, '');
});
