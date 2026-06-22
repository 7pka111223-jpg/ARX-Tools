import { createRulesStore, DEFAULT_RULES } from '../rulesStore.js';
import { aggregateResults } from '../resultsModel.js';
import { generateCsv, generateHtmlReport, generateSpellingCsv, generateSpellingHtmlReport } from '../reportExporter.js';
import { renderSummaryRow, renderRuleRow, renderSpellingRows } from './render.js';
import { testPattern, testFormat } from './patternTester.js';
import { escapeHtml } from '../util.js';

export function initApp(root, { createWorker = () => window.__createWorker() } = {}) {
  const store = createRulesStore(DEFAULT_RULES);
  let drawingResults = [];
  let spellingResults = [];
  let ruleCheckResults = [];
  // Retain the File objects from the last selection so the standalone spelling
  // and rules checks can re-read them (the full-check pass transfers each
  // file's bytes to the worker, but the File objects themselves remain
  // re-readable).
  let lastFiles = [];
  let busy = false;

  root.innerHTML = `
    <section class="card">
      <div id="dropZone">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0-12 4 4m-4-4-4 4"/><path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/></svg>
        <span class="drop-label">Drag PDF drawings here</span>
        <span class="drop-sub">or choose files from your computer — nothing leaves this machine</span>
        <input type="file" id="fileInput" multiple accept=".pdf">
        <label class="btn btn-primary btn-file-label" for="fileInput">Choose Files</label>
      </div>
      <progress id="progress" value="0" max="1"></progress>
      <table id="summaryTable">
        <thead><tr><th>File</th><th>Result</th><th>Errors</th><th>Warnings</th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="toolbar">
        <button id="exportHtml" class="btn">Export HTML report</button>
        <button id="exportCsv" class="btn">Export CSV</button>
        <button id="runSelfTest" class="btn">Run self-test</button>
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">Spelling check</h2>
        <span class="card__hint">Run a dedicated spelling-only pass and export each misspelling with suggested corrections</span>
      </div>
      <button id="checkSpelling" class="btn btn-primary">Check spelling</button>
      <progress id="spellProgress" value="0" max="1"></progress>
      <table id="spellTable">
        <thead><tr><th>File</th><th>Misspelling</th><th>Page(s)</th><th>Suggestions</th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="toolbar">
        <button id="exportSpellHtml" class="btn">Export spelling report (HTML)</button>
        <button id="exportSpellCsv" class="btn">Export spelling CSV</button>
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">Rules check</h2>
        <span class="card__hint">Run a dedicated title-block / revision / formatting pass, independent of spelling</span>
      </div>
      <button id="checkRules" class="btn btn-primary">Check rules</button>
      <progress id="rulesProgress" value="0" max="1"></progress>
      <table id="rulesTable">
        <thead><tr><th>File</th><th>Result</th><th>Errors</th><th>Warnings</th></tr></thead>
        <tbody></tbody>
      </table>
      <div class="toolbar">
        <button id="exportRulesHtml" class="btn">Export rules report (HTML)</button>
        <button id="exportRulesCsv" class="btn">Export rules CSV</button>
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">Rules</h2>
        <span class="card__hint">Add, edit, or remove checks — no JSON editing required</span>
      </div>

      <div id="ruleList" class="rule-list" aria-label="Active rules"></div>

      <div class="rules-toolbar">
        <div class="field rules-toolbar__import">
          <label for="importRules">Import rules file</label>
          <input type="file" id="importRules" accept=".json">
        </div>
        <button id="exportRules" class="btn">Export current rules</button>
      </div>

      <div id="ruleEditor" class="rule-editor">
        <div class="rule-editor__header">
          <h3 id="ruleEditorTitle" class="rule-editor__title">Add a new rule</h3>
          <button id="newRule" type="button" class="btn btn-sm">New rule</button>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="ruleId">Rule ID</label>
            <input type="text" id="ruleId" placeholder="e.g. dwgNo">
            <span class="field-hint">Locked while editing an existing rule.</span>
          </div>
          <div class="field">
            <label for="ruleCategory">Category</label>
            <select id="ruleCategory">
              <option value="titleBlock">titleBlock</option>
              <option value="revision">revision</option>
              <option value="formatting">formatting</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="ruleLabel">Label on drawing</label>
          <input type="text" id="ruleLabel" placeholder="e.g. DWG NO">
        </div>

        <details class="pattern-help">
          <summary>Need help writing a pattern?</summary>
          <ul>
            <li><code>^</code> and <code>$</code> anchor the start/end of the value — always include both so e.g. <code>AB-123-EXTRA</code> isn't wrongly accepted as <code>AB-123</code>.</li>
            <li><code>[A-Z]</code> one uppercase letter; <code>[A-Z]{2}</code> exactly two uppercase letters.</li>
            <li><code>\d</code> one digit; <code>\d{3}</code> exactly three digits; <code>\d+</code> one or more digits.</li>
            <li><code>-</code> a literal hyphen between parts (e.g. between the prefix and the number).</li>
            <li><code>.*</code> matches anything — use it when a field just needs to be non-empty.</li>
            <li><strong>Pattern</strong> (titleBlock / revision / project): the value found on the drawing must match this whole pattern.</li>
            <li><strong>Find / Valid</strong> (formatting): <em>Find</em> locates candidate text anywhere on the drawing (e.g. anything that looks like a date); <em>Valid</em> says which of those finds are acceptable — anything found that doesn't match Valid gets flagged.</li>
          </ul>
        </details>

        <div class="field">
          <label for="rulePattern">Pattern <span class="field-hint">(titleBlock / revision — exact value must match)</span></label>
          <input type="text" id="rulePattern" placeholder="^[A-Z]{2}-\\d{3}$">
        </div>
        <div class="preset-row" id="patternPresets">
          <button type="button" class="preset-chip" data-pattern="^[A-Z]{2}-\\d{3}$">Drawing no. (AB-123)</button>
          <button type="button" class="preset-chip" data-pattern="^[A-Z]{2}-\\d{4}$">Drawing no. (AB-1234)</button>
          <button type="button" class="preset-chip" data-pattern="^[A-Z]$">Revision letter (A)</button>
          <button type="button" class="preset-chip" data-pattern="^\\d+$">Revision number (1)</button>
          <button type="button" class="preset-chip" data-pattern="^\\d{4}-\\d{2}-\\d{2}$">ISO date (2024-01-15)</button>
          <button type="button" class="preset-chip" data-pattern="^[A-Z]{2,3}$">Initials (JS)</button>
          <button type="button" class="preset-chip" data-pattern=".*">Any non-empty value</button>
        </div>
        <div class="pattern-tester">
          <input type="text" id="patternTestValue" placeholder="Try it: type a sample value, e.g. AB-123">
          <span id="patternTestResult" class="test-result"></span>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="ruleFind">Find regex <span class="field-hint">(formatting)</span></label>
            <input type="text" id="ruleFind" placeholder="\\d{1,2}/\\d{1,2}/\\d{2,4}">
          </div>
          <div class="field">
            <label for="ruleValid">Valid regex <span class="field-hint">(formatting)</span></label>
            <input type="text" id="ruleValid" placeholder="^\\d{4}-\\d{2}-\\d{2}$">
          </div>
        </div>
        <div class="preset-row" id="formatPresets">
          <button type="button" class="preset-chip" data-find="\\d{1,2}/\\d{1,2}/\\d{2,4}" data-valid="^\\d{4}-\\d{2}-\\d{2}$">US date → ISO</button>
        </div>
        <div class="pattern-tester">
          <input type="text" id="formatTestValue" placeholder="Try it: type a sample line, e.g. Issued 01/02/2024">
        </div>
        <p id="formatTestMatches" class="format-test-matches"></p>

        <div class="field">
          <label for="ruleMessage">Message shown when this rule fails</label>
          <input type="text" id="ruleMessage" placeholder="e.g. Use ISO date format (YYYY-MM-DD)">
        </div>
        <div class="field-row">
          <div class="field">
            <label for="ruleSeverity">Severity</label>
            <select id="ruleSeverity"><option value="error">error</option><option value="warn">warn</option></select>
          </div>
          <div class="field field-checkbox" style="margin-top:22px">
            <input type="checkbox" id="ruleEnabled" checked>
            <label for="ruleEnabled" style="margin:0">Enabled</label>
          </div>
        </div>
        <button id="saveRule" class="btn btn-primary">Save rule</button>
      </div>
    </section>
  `;

  const fileInput = root.querySelector('#fileInput');
  const dropZone = root.querySelector('#dropZone');
  const progress = root.querySelector('#progress');
  const summaryBody = root.querySelector('#summaryTable tbody');
  const checkSpellingBtn = root.querySelector('#checkSpelling');
  const spellProgress = root.querySelector('#spellProgress');
  const spellBody = root.querySelector('#spellTable tbody');
  const checkRulesBtn = root.querySelector('#checkRules');
  const rulesProgress = root.querySelector('#rulesProgress');
  const rulesBody = root.querySelector('#rulesTable tbody');
  const ruleList = root.querySelector('#ruleList');
  const ruleIdInput = root.querySelector('#ruleId');
  const ruleEditorTitle = root.querySelector('#ruleEditorTitle');
  const rulePatternInput = root.querySelector('#rulePattern');
  const ruleFindInput = root.querySelector('#ruleFind');
  const ruleValidInput = root.querySelector('#ruleValid');
  const patternTestValue = root.querySelector('#patternTestValue');
  const patternTestResult = root.querySelector('#patternTestResult');
  const formatTestValue = root.querySelector('#formatTestValue');
  const formatTestMatches = root.querySelector('#formatTestMatches');

  // Tracks which existing rule the editor is currently modifying.
  // null means the editor is in "add a new rule" mode.
  let editingId = null;

  function refreshRuleList() {
    const rules = store.listRules();
    ruleList.innerHTML = rules.length
      ? rules.map(renderRuleRow).join('')
      : '<p class="rules-empty">No rules yet. Add one below.</p>';
  }
  refreshRuleList();

  function setAddMode() {
    editingId = null;
    ruleEditorTitle.textContent = 'Add a new rule';
    ruleIdInput.readOnly = false;
    ruleIdInput.value = '';
    root.querySelector('#ruleCategory').value = 'titleBlock';
    root.querySelector('#ruleLabel').value = '';
    root.querySelector('#rulePattern').value = '';
    root.querySelector('#ruleFind').value = '';
    root.querySelector('#ruleValid').value = '';
    root.querySelector('#ruleMessage').value = '';
    root.querySelector('#ruleSeverity').value = 'error';
    root.querySelector('#ruleEnabled').checked = true;
    patternTestValue.value = '';
    formatTestValue.value = '';
    refreshPatternTest();
    refreshFormatTest();
  }

  function setEditMode(rule) {
    editingId = rule.id;
    ruleEditorTitle.textContent = `Editing rule: ${rule.label || rule.id}`;
    ruleIdInput.value = rule.id;
    ruleIdInput.readOnly = true;
    root.querySelector('#ruleCategory').value = rule.category;
    root.querySelector('#ruleLabel').value = rule.label || '';
    root.querySelector('#rulePattern').value = rule.pattern || '';
    root.querySelector('#ruleFind').value = rule.find || '';
    root.querySelector('#ruleValid').value = rule.valid || '';
    root.querySelector('#ruleMessage').value = rule.message || '';
    root.querySelector('#ruleSeverity').value = rule.severity;
    root.querySelector('#ruleEnabled').checked = rule.enabled;
    patternTestValue.value = '';
    formatTestValue.value = '';
    refreshPatternTest();
    refreshFormatTest();
    if (typeof root.querySelector('#ruleEditor').scrollIntoView === 'function') {
      root.querySelector('#ruleEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function refreshSummary() {
    summaryBody.innerHTML = drawingResults.map(renderSummaryRow).join('');
  }

  function refreshSpelling() {
    spellBody.innerHTML = spellingResults.map(renderSpellingRows).join('');
  }

  function refreshRulesCheck() {
    rulesBody.innerHTML = ruleCheckResults.map(renderSummaryRow).join('');
  }

  // Live "try it" feedback for the Pattern field, re-run on every keystroke in
  // either the pattern itself or the sample value (see patternTester.js).
  function refreshPatternTest() {
    const pattern = rulePatternInput.value;
    const value = patternTestValue.value;
    if (!pattern) {
      patternTestResult.textContent = '';
      patternTestResult.className = 'test-result';
      return;
    }
    if (!value) {
      patternTestResult.textContent = 'Type a sample value above to test it';
      patternTestResult.className = 'test-result test-result--neutral';
      return;
    }
    const { ok, error } = testPattern(pattern, value);
    if (error) {
      patternTestResult.textContent = `Invalid regex: ${error}`;
      patternTestResult.className = 'test-result test-result--bad';
    } else {
      patternTestResult.textContent = ok ? '✓ Matches' : '✗ Does not match';
      patternTestResult.className = `test-result ${ok ? 'test-result--ok' : 'test-result--bad'}`;
    }
  }

  // Live "try it" feedback for the Find/Valid pair, showing every substring
  // Find would flag plus whether Valid would accept it (see patternTester.js).
  function refreshFormatTest() {
    const find = ruleFindInput.value;
    const valid = ruleValidInput.value;
    const text = formatTestValue.value;
    if (!find || !valid) {
      formatTestMatches.innerHTML = '';
      return;
    }
    if (!text) {
      formatTestMatches.innerHTML = '<span class="test-result test-result--neutral">Type a sample line above to test it</span>';
      return;
    }
    const { matches, error } = testFormat(find, valid, text);
    if (error) {
      formatTestMatches.innerHTML = `<span class="test-result test-result--bad">Invalid regex: ${escapeHtml(error)}</span>`;
      return;
    }
    if (matches.length === 0) {
      formatTestMatches.innerHTML = '<span class="test-result test-result--neutral">No matches found in that sample</span>';
      return;
    }
    formatTestMatches.innerHTML = matches
      .map((m) => `<code class="${m.ok ? 'test-result--ok' : 'test-result--bad'}">${escapeHtml(m.text)}</code>`)
      .join(' ');
  }

  async function handleFiles(files) {
    if (busy) {
      alert('A batch is already being processed — please wait for it to finish.');
      return;
    }
    busy = true;
    fileInput.disabled = true;
    try {
      const pdfFiles = [...files].filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      // Remember the selection so the standalone spelling check can reuse it.
      lastFiles = pdfFiles;
      progress.max = pdfFiles.length || 1;
      progress.value = 0;
      drawingResults = [];
      const worker = createWorker();
      try {
        for (const file of pdfFiles) {
          const pdfBytes = new Uint8Array(await file.arrayBuffer());
          const result = await new Promise((resolve) => {
            worker.onmessage = (e) => {
              if (e.data && e.data.jobId === file.name) {
                resolve(e.data.result);
              }
            };
            worker.postMessage({ fileName: file.name, pdfBytes, rulesConfig: store.getRules(), jobId: file.name }, [pdfBytes.buffer]);
          });
          drawingResults.push(result);
          progress.value += 1;
          refreshSummary();
        }
      } finally {
        worker.terminate();
      }
    } finally {
      busy = false;
      fileInput.disabled = false;
    }
  }

  async function handleSpellCheck() {
    if (busy) {
      alert('A batch is already being processed — please wait for it to finish.');
      return;
    }
    if (lastFiles.length === 0) {
      alert('Add PDF drawings first, then run the spelling check.');
      return;
    }
    busy = true;
    checkSpellingBtn.disabled = true;
    try {
      spellProgress.max = lastFiles.length || 1;
      spellProgress.value = 0;
      spellingResults = [];
      const spellingConfig = store.getRules().spelling;
      const worker = createWorker();
      try {
        for (const file of lastFiles) {
          const pdfBytes = new Uint8Array(await file.arrayBuffer());
          const result = await new Promise((resolve) => {
            worker.onmessage = (e) => {
              if (e.data && e.data.jobId === file.name) {
                resolve(e.data.result);
              }
            };
            worker.postMessage({ mode: 'spelling', fileName: file.name, pdfBytes, spellingConfig, jobId: file.name }, [pdfBytes.buffer]);
          });
          spellingResults.push(result);
          spellProgress.value += 1;
          refreshSpelling();
        }
      } finally {
        worker.terminate();
      }
    } finally {
      busy = false;
      checkSpellingBtn.disabled = false;
    }
  }

  async function handleRuleCheck() {
    if (busy) {
      alert('A batch is already being processed — please wait for it to finish.');
      return;
    }
    if (lastFiles.length === 0) {
      alert('Add PDF drawings first, then run the rules check.');
      return;
    }
    busy = true;
    checkRulesBtn.disabled = true;
    try {
      rulesProgress.max = lastFiles.length || 1;
      rulesProgress.value = 0;
      ruleCheckResults = [];
      const rulesConfig = store.getRules();
      const worker = createWorker();
      try {
        for (const file of lastFiles) {
          const pdfBytes = new Uint8Array(await file.arrayBuffer());
          const result = await new Promise((resolve) => {
            worker.onmessage = (e) => {
              if (e.data && e.data.jobId === file.name) {
                resolve(e.data.result);
              }
            };
            worker.postMessage({ mode: 'rules', fileName: file.name, pdfBytes, rulesConfig, jobId: file.name }, [pdfBytes.buffer]);
          });
          ruleCheckResults.push(result);
          rulesProgress.value += 1;
          refreshRulesCheck();
        }
      } finally {
        worker.terminate();
      }
    } finally {
      busy = false;
      checkRulesBtn.disabled = false;
    }
  }

  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
  dropZone.addEventListener('dragover', (e) => e.preventDefault());
  dropZone.addEventListener('dragenter', () => dropZone.classList.add('is-dragover'));
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
    handleFiles(e.dataTransfer.files);
  });

  root.querySelector('#exportHtml').addEventListener('click', () => {
    downloadFile('drawing-check-report.html', generateHtmlReport(aggregateResults(drawingResults)), 'text/html');
  });
  root.querySelector('#exportCsv').addEventListener('click', () => {
    downloadFile('drawing-check-report.csv', generateCsv(aggregateResults(drawingResults)), 'text/csv');
  });
  checkSpellingBtn.addEventListener('click', () => handleSpellCheck());
  root.querySelector('#exportSpellHtml').addEventListener('click', () => {
    downloadFile('spelling-report.html', generateSpellingHtmlReport(spellingResults), 'text/html');
  });
  root.querySelector('#exportSpellCsv').addEventListener('click', () => {
    downloadFile('spelling-report.csv', generateSpellingCsv(spellingResults), 'text/csv');
  });
  checkRulesBtn.addEventListener('click', () => handleRuleCheck());
  root.querySelector('#exportRulesHtml').addEventListener('click', () => {
    downloadFile('rules-check-report.html', generateHtmlReport(aggregateResults(ruleCheckResults), 'Rules Check Report'), 'text/html');
  });
  root.querySelector('#exportRulesCsv').addEventListener('click', () => {
    downloadFile('rules-check-report.csv', generateCsv(aggregateResults(ruleCheckResults)), 'text/csv');
  });
  root.querySelector('#runSelfTest').addEventListener('click', async () => {
    const { runSelfTest } = await import('../selfTest.js');
    const result = runSelfTest();
    alert(result.allPassed ? 'Self-test passed' : `Self-test FAILED:\n${JSON.stringify(result.results, null, 2)}`);
  });

  // Per-row Edit / Delete, handled via event delegation so they keep working
  // after the list is re-rendered.
  ruleList.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.rule-edit-btn');
    if (editBtn) {
      const rule = store.getRule(editBtn.dataset.ruleId);
      if (rule) setEditMode(rule);
      return;
    }
    const deleteBtn = e.target.closest('.rule-delete-btn');
    if (deleteBtn) {
      const id = deleteBtn.dataset.ruleId;
      store.removeRule(id);
      if (editingId === id) setAddMode();
      refreshRuleList();
    }
  });

  root.querySelector('#newRule').addEventListener('click', () => setAddMode());

  root.querySelector('#saveRule').addEventListener('click', () => {
    // In edit mode the ID is fixed to the rule being modified; in add mode it
    // comes from the (editable) ID field.
    const id = editingId ?? ruleIdInput.value.trim();
    if (!id) return;
    const rule = {
      id,
      category: root.querySelector('#ruleCategory').value,
      label: root.querySelector('#ruleLabel').value,
      pattern: root.querySelector('#rulePattern').value || undefined,
      find: root.querySelector('#ruleFind').value || undefined,
      valid: root.querySelector('#ruleValid').value || undefined,
      message: root.querySelector('#ruleMessage').value,
      severity: root.querySelector('#ruleSeverity').value,
      enabled: root.querySelector('#ruleEnabled').checked,
    };
    try {
      if (store.getRule(id)) store.updateRule(id, rule);
      else store.addRule(rule);
    } catch (err) {
      alert(err.message);
      return;
    }
    refreshRuleList();
    setAddMode();
  });

  root.querySelector('#exportRules').addEventListener('click', () => {
    downloadFile('rules.json', store.exportRules(), 'application/json');
  });

  root.querySelector('#importRules').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.importRules(await file.text());
    } catch (err) {
      alert(err.message);
      return;
    }
    setAddMode();
    refreshRuleList();
  });

  [rulePatternInput, patternTestValue].forEach((el) => el.addEventListener('input', refreshPatternTest));
  [ruleFindInput, ruleValidInput, formatTestValue].forEach((el) => el.addEventListener('input', refreshFormatTest));

  root.querySelector('#patternPresets').addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    rulePatternInput.value = chip.dataset.pattern;
    rulePatternInput.focus();
    refreshPatternTest();
  });

  root.querySelector('#formatPresets').addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip');
    if (!chip) return;
    ruleFindInput.value = chip.dataset.find;
    ruleValidInput.value = chip.dataset.valid;
    ruleFindInput.focus();
    refreshFormatTest();
  });

  return {
    store,
    handleFiles,
    handleSpellCheck,
    handleRuleCheck,
    refreshSummary,
    refreshSpelling,
    refreshRulesCheck,
    refreshRuleList,
  };
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
