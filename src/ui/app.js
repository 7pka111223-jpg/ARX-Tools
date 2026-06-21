import { createRulesStore, DEFAULT_RULES } from '../rulesStore.js';
import { aggregateResults } from '../resultsModel.js';
import { generateCsv, generateHtmlReport } from '../reportExporter.js';
import { renderSummaryRow, renderRuleOption } from './render.js';

export function initApp(root, { createWorker = () => window.__createWorker() } = {}) {
  const store = createRulesStore(DEFAULT_RULES);
  let drawingResults = [];
  let busy = false;

  root.innerHTML = `
    <div id="dropZone">Drag PDF files here or <input type="file" id="fileInput" multiple accept=".pdf"></div>
    <progress id="progress" value="0" max="1" style="width:100%"></progress>
    <table id="summaryTable"><thead><tr><th>File</th><th>Result</th><th>Errors</th><th>Warnings</th></tr></thead><tbody></tbody></table>
    <div>
      <button id="exportHtml">Export HTML report</button>
      <button id="exportCsv">Export CSV</button>
      <button id="runSelfTest">Run self-test</button>
    </div>
    <h2>Rules</h2>
    <select id="ruleSelect"></select>
    <button id="removeRule">Remove selected rule</button>
    <button id="exportRules">Export rules</button>
    <input type="file" id="importRules" accept=".json">
    <div id="ruleEditor">
      <input type="text" id="ruleId" placeholder="id">
      <select id="ruleCategory">
        <option value="titleBlock">titleBlock</option>
        <option value="revision">revision</option>
        <option value="formatting">formatting</option>
      </select>
      <input type="text" id="ruleLabel" placeholder="label">
      <input type="text" id="rulePattern" placeholder="pattern (titleBlock/revision)">
      <input type="text" id="ruleFind" placeholder="find regex (formatting)">
      <input type="text" id="ruleValid" placeholder="valid regex (formatting)">
      <input type="text" id="ruleMessage" placeholder="message">
      <select id="ruleSeverity"><option value="error">error</option><option value="warn">warn</option></select>
      <label><input type="checkbox" id="ruleEnabled" checked> enabled</label>
      <button id="saveRule">Save rule</button>
    </div>
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
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
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
