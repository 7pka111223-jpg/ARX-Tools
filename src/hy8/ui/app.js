import { parseHy8, serializeHy8 } from '../hy8File.js';
import { parseCulvertCsv } from '../csvCulverts.js';
import { mapCulverts } from '../mapper.js';
import { diffPair } from '../differ.js';
import { parseFlowInput, applyFlows } from '../flowUpdater.js';
import { applyGeometryImport } from '../applyImport.js';
import { renderMappingRow, renderUnmatchedCsvRow, renderUnmatchedHy8Row, renderDiffSection } from './render.js';

export function initApp(root, { download = defaultDownload } = {}) {
  const state = {
    csvFileName: null,
    hy8FileName: null,
    csvRows: [],
    hy8Doc: null,
    mode: 'name',
    toleranceM: 15,
    mapResult: { pairs: [], unmatchedCsv: [], unmatchedHy8: [] },
  };

  root.innerHTML = `
    <section class="card">
      <div class="card__header">
        <h2 class="card__title">1. Load files</h2>
        <span class="card__hint">Nothing is uploaded — files are read locally in this browser</span>
      </div>
      <div class="field">
        <label for="csvInput">Culvert schedule CSV (SI units)</label>
        <input type="file" id="csvInput" accept=".csv">
        <span class="field-hint" id="csvFileLabel">No file loaded</span>
      </div>
      <div class="field">
        <label for="hy8Input">HY-8 project file (.hy8, US units)</label>
        <input type="file" id="hy8Input" accept=".hy8">
        <span class="field-hint" id="hy8FileLabel">No file loaded</span>
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">2. Mapping mode</h2>
      </div>
      <div class="field-row">
        <label class="field-checkbox"><input type="radio" name="mapMode" id="modeName" checked> Match by culvert name</label>
        <label class="field-checkbox"><input type="radio" name="mapMode" id="modeStation"> Match by nearest station</label>
      </div>
      <div class="field" id="toleranceField" style="display:none">
        <label for="tolerance">Station tolerance (m)</label>
        <input type="number" id="tolerance" value="15" min="0" step="1">
      </div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">3. Mapping preview</h2>
      </div>
      <p id="mappingSummary" class="hint">Load both a CSV and a .hy8 file to compute the mapping.</p>
      <table id="mappingTable">
        <thead><tr><th>CSV name</th><th>CSV station</th><th>HY-8 culvert</th><th>HY-8 crossing</th></tr></thead>
        <tbody></tbody>
      </table>
      <h3 class="card__title">Unmatched CSV rows</h3>
      <table id="unmatchedCsvTable">
        <thead><tr><th>Name</th><th>Station</th></tr></thead>
        <tbody></tbody>
      </table>
      <h3 class="card__title">Unmatched HY-8 crossings</h3>
      <table id="unmatchedHy8Table">
        <thead><tr><th>Culvert</th><th>Crossing</th></tr></thead>
        <tbody></tbody>
      </table>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">4. Differences</h2>
        <span class="card__hint">Fields that would change on import (tolerance 0.01 ft)</span>
      </div>
      <div id="diffContainer"></div>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">5. Design flows (optional)</h2>
        <span class="card__hint">Paste "name, flow (m3/s)" pairs, or load a small CSV — max = design + 5, min = 0</span>
      </div>
      <textarea id="flowText" rows="6" placeholder="CU-JSS-01, 10"></textarea>
      <div class="field">
        <label for="flowFileInput">Or load a flow CSV</label>
        <input type="file" id="flowFileInput" accept=".csv,.txt">
      </div>
      <p id="flowUnmatched" class="hint"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">6. Import &amp; download</h2>
      </div>
      <button id="importBtn" class="btn btn-primary" disabled>Import &amp; download updated .hy8</button>
      <p id="statusMsg" class="status"></p>
      <p class="hint">No data leaves this browser — the CSV and HY-8 file are read and written entirely client-side.</p>
    </section>
  `;

  const els = {
    csvInput: root.querySelector('#csvInput'),
    csvFileLabel: root.querySelector('#csvFileLabel'),
    hy8Input: root.querySelector('#hy8Input'),
    hy8FileLabel: root.querySelector('#hy8FileLabel'),
    modeName: root.querySelector('#modeName'),
    modeStation: root.querySelector('#modeStation'),
    tolerance: root.querySelector('#tolerance'),
    toleranceField: root.querySelector('#toleranceField'),
    mappingSummary: root.querySelector('#mappingSummary'),
    mappingTable: root.querySelector('#mappingTable tbody'),
    unmatchedCsvTable: root.querySelector('#unmatchedCsvTable tbody'),
    unmatchedHy8Table: root.querySelector('#unmatchedHy8Table tbody'),
    diffContainer: root.querySelector('#diffContainer'),
    flowText: root.querySelector('#flowText'),
    flowFileInput: root.querySelector('#flowFileInput'),
    flowUnmatched: root.querySelector('#flowUnmatched'),
    importBtn: root.querySelector('#importBtn'),
    statusMsg: root.querySelector('#statusMsg'),
  };

  function recomputeMapping() {
    state.mapResult =
      state.hy8Doc && state.csvRows.length
        ? mapCulverts(state.csvRows, state.hy8Doc, { mode: state.mode, toleranceM: state.toleranceM })
        : { pairs: [], unmatchedCsv: [], unmatchedHy8: [] };
    render();
  }

  function updateFlowPreview() {
    if (!state.hy8Doc) {
      els.flowUnmatched.textContent = '';
      return;
    }
    const flows = parseFlowInput(els.flowText.value);
    if (!flows.length) {
      els.flowUnmatched.textContent = '';
      return;
    }
    const names = new Set(state.hy8Doc.crossings.map((c) => (c.culverts[0].name || '').trim().toLowerCase()));
    const unmatched = flows.filter((f) => !names.has(String(f.name).trim().toLowerCase()));
    els.flowUnmatched.textContent = unmatched.length
      ? `Warning: ${unmatched.length} flow name(s) not found in the HY-8 file: ${unmatched.map((f) => f.name).join(', ')}`
      : `${flows.length} flow row(s) parsed, all names matched.`;
  }

  function render() {
    const { pairs, unmatchedCsv, unmatchedHy8 } = state.mapResult;
    els.mappingSummary.textContent =
      state.hy8Doc && state.csvRows.length
        ? `${pairs.length} matched, ${unmatchedCsv.length} CSV row(s) unmatched, ${unmatchedHy8.length} HY-8 crossing(s) unmatched.`
        : 'Load both a CSV and a .hy8 file to compute the mapping.';
    els.mappingTable.innerHTML = pairs.map(renderMappingRow).join('');
    els.unmatchedCsvTable.innerHTML = unmatchedCsv.map(renderUnmatchedCsvRow).join('');
    els.unmatchedHy8Table.innerHTML = unmatchedHy8.map(renderUnmatchedHy8Row).join('');

    if (pairs.length && state.hy8Doc) {
      const blocks = [];
      for (const pair of pairs) {
        const diffs = diffPair(pair, state.hy8Doc, state.mode);
        if (diffs.length) blocks.push(renderDiffSection(pair.culvert.name || pair.crossing.name || '', diffs));
      }
      els.diffContainer.innerHTML = blocks.length ? blocks.join('') : '<p class="hint">No differences found for the mapped pairs.</p>';
    } else {
      els.diffContainer.innerHTML = '';
    }

    updateFlowPreview();
    els.importBtn.disabled = pairs.length === 0;
  }

  function setCsvText(text, fileName) {
    state.csvFileName = fileName;
    els.csvFileLabel.textContent = fileName;
    state.csvRows = parseCulvertCsv(text);
    recomputeMapping();
  }

  function setHy8Text(text, fileName) {
    state.hy8FileName = fileName;
    els.hy8FileLabel.textContent = fileName;
    state.hy8Doc = parseHy8(text);
    recomputeMapping();
  }

  function runImport() {
    if (!state.hy8Doc || !state.mapResult.pairs.length) {
      els.statusMsg.textContent = 'Load a CSV and a .hy8 file and compute a mapping before importing.';
      els.statusMsg.className = 'status status--error';
      return;
    }
    let doc = applyGeometryImport(state.hy8Doc, state.mapResult.pairs, state.mode);

    const flows = parseFlowInput(els.flowText.value);
    let flowResult = { updated: [], unmatchedNames: [] };
    if (flows.length) {
      const applied = applyFlows(doc, flows);
      doc = applied.doc;
      flowResult = applied;
    }

    const outputText = serializeHy8(doc);
    const outName = downloadName(state.hy8FileName);
    download(outName, outputText);

    els.statusMsg.textContent =
      `Downloaded ${outName} — ${state.mapResult.pairs.length} culvert(s) updated` +
      (flows.length ? `, ${flowResult.updated.length} flow(s) applied` : '') +
      (flowResult.unmatchedNames.length ? ` (${flowResult.unmatchedNames.length} flow name(s) unmatched)` : '') +
      '.';
    els.statusMsg.className = 'status status--success';
  }

  els.csvInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(reader.result, file.name);
    reader.readAsText(file, 'iso-8859-1');
  });

  els.hy8Input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setHy8Text(reader.result, file.name);
    reader.readAsText(file);
  });

  els.modeName.addEventListener('change', () => {
    if (!els.modeName.checked) return;
    state.mode = 'name';
    els.toleranceField.style.display = 'none';
    recomputeMapping();
  });
  els.modeStation.addEventListener('change', () => {
    if (!els.modeStation.checked) return;
    state.mode = 'station';
    els.toleranceField.style.display = '';
    recomputeMapping();
  });
  els.tolerance.addEventListener('input', () => {
    const v = Number(els.tolerance.value);
    state.toleranceM = Number.isFinite(v) && v >= 0 ? v : 15;
    if (state.mode === 'station') recomputeMapping();
  });

  els.flowText.addEventListener('input', () => updateFlowPreview());
  els.flowFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      els.flowText.value = reader.result;
      updateFlowPreview();
    };
    reader.readAsText(file);
  });

  els.importBtn.addEventListener('click', () => {
    try {
      runImport();
    } catch (err) {
      els.statusMsg.textContent = `Import failed: ${err.message}`;
      els.statusMsg.className = 'status status--error';
    }
  });

  render();

  return { state, setCsvText, setHy8Text, recomputeMapping, runImport };
}

function downloadName(originalName) {
  const base = (originalName || 'Section').replace(/\.hy8$/i, '');
  return `${base}_updated.hy8`;
}

function defaultDownload(name, text) {
  const blob = new Blob([text], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
