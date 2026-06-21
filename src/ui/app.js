import { createRulesStore, DEFAULT_RULES } from '../rulesStore.js';
import { aggregateResults } from '../resultsModel.js';
import { generateCsv, generateHtmlReport } from '../reportExporter.js';
import { renderSummaryRow, renderRuleOption } from './render.js';

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
      <div class="rules-layout">
        <div class="rules-list">
          <select id="ruleSelect" size="8"></select>
          <div class="toolbar" style="margin-top:8px">
            <button id="removeRule" class="btn btn-danger">Remove selected</button>
          </div>
          <hr class="divider">
          <div class="field">
            <label for="importRules">Import rules file</label>
            <input type="file" id="importRules" accept=".json">
          </div>
          <button id="exportRules" class="btn">Export current rules</button>
        </div>

        <div id="ruleEditor">
          <div class="field-row">
            <div class="field">
              <label for="ruleId">Rule ID</label>
              <input type="text" id="ruleId" placeholder="e.g. dwgNo">
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
      </div>
    </section>
  `;

  const fileInput = root.querySelector('#fileInput');
  const dropZone = root.querySelector('#dropZone');
  const progress = root.querySelector('#progress');
  const summaryBody = root.querySelector('#summaryTable tbody');
  const ruleSelect = root.querySelector('#ruleSelect');

  function refreshRuleDropdown() {
    ruleSelect.innerHTML = store.listRules().map(renderRuleOption).join('');
  }
  refreshRuleDropdown();

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

  ruleSelect.addEventListener('change', () => {
    const rule = store.getRule(ruleSelect.value);
    if (!rule) return;
    root.querySelector('#ruleId').value = rule.id;
    root.querySelector('#ruleCategory').value = rule.category;
    root.querySelector('#ruleLabel').value = rule.label || '';
    root.querySelector('#rulePattern').value = rule.pattern || '';
    root.querySelector('#ruleFind').value = rule.find || '';
    root.querySelector('#ruleValid').value = rule.valid || '';
    root.querySelector('#ruleMessage').value = rule.message || '';
    root.querySelector('#ruleSeverity').value = rule.severity;
    root.querySelector('#ruleEnabled').checked = rule.enabled;
  });

  root.querySelector('#saveRule').addEventListener('click', () => {
    const id = root.querySelector('#ruleId').value.trim();
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
    refreshRuleDropdown();
  });

  root.querySelector('#removeRule').addEventListener('click', () => {
    if (ruleSelect.value) {
      store.removeRule(ruleSelect.value);
      refreshRuleDropdown();
    }
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
    refreshRuleDropdown();
  });

  return { store, handleFiles, refreshSummary, refreshRuleDropdown };
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
