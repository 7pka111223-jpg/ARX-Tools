import { createRulesStore, DEFAULT_RULES } from '../rulesStore.js';
import { aggregateResults } from '../resultsModel.js';
import { generateCsv, generateHtmlReport } from '../reportExporter.js';
import { renderSummaryRow, renderRuleRow } from './render.js';

export function initApp(root, { createWorker = () => window.__createWorker() } = {}) {
  const store = createRulesStore(DEFAULT_RULES);
  let drawingResults = [];
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
        <div class="field">
          <label for="rulePattern">Pattern <span class="field-hint">(titleBlock / revision — exact value must match)</span></label>
          <input type="text" id="rulePattern" placeholder="^[A-Z]{2}-\\d{3}$">
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
  const ruleList = root.querySelector('#ruleList');
  const ruleIdInput = root.querySelector('#ruleId');
  const ruleEditorTitle = root.querySelector('#ruleEditorTitle');

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
    if (typeof root.querySelector('#ruleEditor').scrollIntoView === 'function') {
      root.querySelector('#ruleEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function refreshSummary() {
    summaryBody.innerHTML = drawingResults.map(renderSummaryRow).join('');
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

  return { store, handleFiles, refreshSummary, refreshRuleList };
}

function downloadFile(name, content, mime) {
  // When embedded in the ARX Tools shell, route through the host so the
  // user's chosen download folder (File System Access API) is honored.
  try {
    if (window.parent && window.parent !== window && typeof window.parent.__saveOutputFile === 'function') {
      window.parent.__saveOutputFile(name, content, mime);
      return;
    }
  } catch (e) { /* cross-origin or unavailable: fall back to a normal download */ }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
