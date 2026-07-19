import { parseHy8, serializeHy8 } from '../hy8File.js';
import { parseCulvertCsv, rowsToCulverts } from '../csvCulverts.js';
import { parseXlsxRows, rowsToText } from '../xlsx.js';
import { mapCulverts } from '../mapper.js';
import { diffPair } from '../differ.js';
import { generateDifferencesCsv } from '../diffExport.js';
import { parseFlowInput, applyFlows } from '../flowUpdater.js';
import { applyGeometryImport } from '../applyImport.js';
import { buildComputedSummary, buildExtractedSummary, buildFullAnalysis } from '../summary.js';
import { generateSummaryCsv, generateFullAnalysisCsv } from '../summaryExport.js';
import { parseDocxSummaryTables } from '../docx.js';
import { extractReportResults, generateReportCsv } from '../reportExtract.js';
import {
  renderMappingRow,
  renderUnmatchedCsvRow,
  renderUnmatchedHy8Row,
  renderDiffSection,
  renderSummaryTable,
  renderReportTable,
  renderFullAnalysis,
} from './render.js';

export function initApp(root, { download = defaultDownload } = {}) {
  const state = {
    csvFileName: null,
    hy8FileName: null,
    csvRows: [],
    hy8Doc: null,
    mode: 'name',
    toleranceM: 15,
    mapResult: { pairs: [], unmatchedCsv: [], unmatchedHy8: [] },
    summaryRows: null,
    summarySource: null,
    reportRows: null,
    reportTables: null,
    reportFileName: null,
    fullAnalysis: null,
  };

  root.innerHTML = `
    <section class="card">
      <div class="card__header">
        <h2 class="card__title">1. Load files</h2>
        <span class="card__hint">Nothing is uploaded — files are read locally in this browser</span>
      </div>
      <div class="field">
        <label for="csvInput">Culvert schedule — CSV or Excel .xlsx (SI units)</label>
        <input type="file" id="csvInput" accept=".csv,.xlsx">
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
        <span class="card__hint">All values shown in SI — fields that would change on import (tolerance ~0.003 m)</span>
      </div>
      <div id="diffContainer"></div>
      <button id="exportDiffsBtn" class="btn" disabled>Export differences as CSV</button>
      <p id="diffStatusMsg" class="status"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">5. Design flows (optional)</h2>
        <span class="card__hint">Paste "name, flow (m3/s)" pairs, or load a small CSV — max = design + 5, min = 0</span>
      </div>
      <textarea id="flowText" rows="6" placeholder="CU-JSS-01, 10"></textarea>
      <div class="field">
        <label for="flowFileInput">Or load a flow file (CSV or Excel .xlsx)</label>
        <input type="file" id="flowFileInput" accept=".csv,.txt,.xlsx">
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

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">7. Culvert summary (SI)</h2>
        <span class="card__hint">HW/D, normal &amp; critical depth, headwater elevation, outlet velocity per culvert</span>
      </div>
      <div class="field-row">
        <button id="computeSummaryBtn" class="btn" disabled>Compute summary (approx. HDS-5)</button>
        <button id="extractSummaryBtn" class="btn" disabled>Extract HY-8 results from loaded file</button>
        <button id="exportSummaryBtn" class="btn" disabled>Export summary as CSV</button>
      </div>
      <div class="field-row">
        <button id="analyzeAllBtn" class="btn" disabled>Analyze all crossings (full flow table)</button>
        <button id="exportAnalysisBtn" class="btn" disabled>Export full analysis as CSV</button>
      </div>
      <div id="analysisContainer"></div>
      <p class="hint" id="summaryHint">Compute runs an approximate FHWA HDS-5 analysis (box culverts,
        square-edge headwall inlet) on the imported geometry and design flows — spot-check against HY-8.
        Extract reads HY-8's own results from a .hy8 file that HY-8 has analyzed and saved.</p>
      <div id="summaryContainer"></div>
      <p id="summaryStatusMsg" class="status"></p>
    </section>

    <section class="card">
      <div class="card__header">
        <h2 class="card__title">8. HY-8 report extraction (DOCX)</h2>
        <span class="card__hint">Pull each culvert's design-flow results out of an HY-8 culvert analysis report</span>
      </div>
      <div class="field">
        <label for="docxInput">HY-8 culvert analysis report (.docx)</label>
        <input type="file" id="docxInput" accept=".docx" disabled>
        <span class="field-hint">Load the matching .hy8 file first — the design flow for each culvert is read from it.
          HW/D is computed as max(inlet, outlet control depth) ÷ rise (rise from the loaded culvert
          schedule, or the .hy8 file if no schedule is loaded), not taken from the report's HW/D column.</span>
      </div>
      <button id="exportReportBtn" class="btn" disabled>Export report results as CSV</button>
      <div id="reportContainer"></div>
      <p id="reportStatusMsg" class="status"></p>
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
    exportDiffsBtn: root.querySelector('#exportDiffsBtn'),
    diffStatusMsg: root.querySelector('#diffStatusMsg'),
    flowText: root.querySelector('#flowText'),
    flowFileInput: root.querySelector('#flowFileInput'),
    flowUnmatched: root.querySelector('#flowUnmatched'),
    importBtn: root.querySelector('#importBtn'),
    statusMsg: root.querySelector('#statusMsg'),
    computeSummaryBtn: root.querySelector('#computeSummaryBtn'),
    extractSummaryBtn: root.querySelector('#extractSummaryBtn'),
    exportSummaryBtn: root.querySelector('#exportSummaryBtn'),
    summaryContainer: root.querySelector('#summaryContainer'),
    summaryStatusMsg: root.querySelector('#summaryStatusMsg'),
    analyzeAllBtn: root.querySelector('#analyzeAllBtn'),
    exportAnalysisBtn: root.querySelector('#exportAnalysisBtn'),
    analysisContainer: root.querySelector('#analysisContainer'),
    docxInput: root.querySelector('#docxInput'),
    exportReportBtn: root.querySelector('#exportReportBtn'),
    reportContainer: root.querySelector('#reportContainer'),
    reportStatusMsg: root.querySelector('#reportStatusMsg'),
  };

  function recomputeMapping() {
    state.mapResult =
      state.hy8Doc && state.csvRows.length
        ? mapCulverts(state.csvRows, state.hy8Doc, { mode: state.mode, toleranceM: state.toleranceM })
        : { pairs: [], unmatchedCsv: [], unmatchedHy8: [] };
    // Inputs changed, so any previously computed summary/analysis is stale.
    state.summaryRows = null;
    state.summarySource = null;
    state.fullAnalysis = null;
    els.analysisContainer.innerHTML = '';
    els.summaryStatusMsg.textContent = '';
    // A schedule change alters the rises used for the report's HW/D —
    // re-extract an already-loaded report with the fresh values.
    if (state.reportTables && state.hy8Doc) runReportExtraction();
    render();
    renderSummary();
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

    let totalDiffs = 0;
    if (pairs.length && state.hy8Doc) {
      const blocks = [];
      for (const pair of pairs) {
        const diffs = diffPair(pair, state.hy8Doc, state.mode);
        totalDiffs += diffs.length;
        if (diffs.length) blocks.push(renderDiffSection(pair.culvert.name || pair.crossing.name || '', diffs));
      }
      els.diffContainer.innerHTML = blocks.length ? blocks.join('') : '<p class="hint">No differences found for the mapped pairs.</p>';
    } else {
      els.diffContainer.innerHTML = '';
    }

    updateFlowPreview();
    els.importBtn.disabled = pairs.length === 0;
    els.exportDiffsBtn.disabled = totalDiffs === 0;
    els.computeSummaryBtn.disabled = !state.hy8Doc;
    els.extractSummaryBtn.disabled = !state.hy8Doc;
    els.exportSummaryBtn.disabled = !state.summaryRows;
    els.analyzeAllBtn.disabled = !state.hy8Doc;
    els.exportAnalysisBtn.disabled = !state.fullAnalysis;
    els.docxInput.disabled = !state.hy8Doc;
    els.exportReportBtn.disabled = !state.reportRows;
  }

  function renderSummary() {
    els.summaryContainer.innerHTML = state.summaryRows ? renderSummaryTable(state.summaryRows) : '';
    els.exportSummaryBtn.disabled = !state.summaryRows;
  }

  function setCsvText(text, fileName) {
    state.csvFileName = fileName;
    els.csvFileLabel.textContent = fileName;
    state.csvRows = parseCulvertCsv(text);
    recomputeMapping();
  }

  function setCsvRows(rows, fileName) {
    state.csvFileName = fileName;
    els.csvFileLabel.textContent = fileName;
    state.csvRows = rowsToCulverts(rows);
    recomputeMapping();
  }

  function setHy8Text(text, fileName) {
    state.hy8FileName = fileName;
    els.hy8FileLabel.textContent = fileName;
    state.hy8Doc = parseHy8(text);
    // Any previously extracted report belonged to the old file.
    state.reportRows = null;
    state.reportTables = null;
    state.reportFileName = null;
    els.reportContainer.innerHTML = '';
    els.reportStatusMsg.textContent = '';
    recomputeMapping();
  }

  // The imported doc: geometry patches for the current mapping plus any
  // pasted flows. When nothing is mapped, this is the loaded file as-is
  // (still useful for analyzing an already-complete .hy8).
  function buildUpdatedDoc() {
    let doc = state.hy8Doc;
    if (state.mapResult.pairs.length) {
      doc = applyGeometryImport(doc, state.mapResult.pairs, state.mode);
    }
    const flows = parseFlowInput(els.flowText.value);
    let flowResult = { updated: [], unmatchedNames: [] };
    if (flows.length) {
      const applied = applyFlows(doc, flows);
      doc = applied.doc;
      flowResult = applied;
    }
    return { doc, flows, flowResult };
  }

  function runImport() {
    if (!state.hy8Doc || !state.mapResult.pairs.length) {
      els.statusMsg.textContent = 'Load a CSV and a .hy8 file and compute a mapping before importing.';
      els.statusMsg.className = 'status status--error';
      return;
    }
    const { doc, flows, flowResult } = buildUpdatedDoc();

    const outputText = serializeHy8(doc);
    const outName = downloadName(state.hy8FileName, '_updated.hy8');
    download(outName, outputText, 'application/octet-stream');

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
    if (/\.xlsx$/i.test(file.name)) {
      reader.onload = () => {
        parseXlsxRows(reader.result)
          .then((rows) => setCsvRows(rows, file.name))
          .catch((err) => {
            els.csvFileLabel.textContent = `Could not read ${file.name}: ${err.message}`;
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => setCsvText(reader.result, file.name);
      reader.readAsText(file, 'iso-8859-1');
    }
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
    if (/\.xlsx$/i.test(file.name)) {
      reader.onload = () => {
        parseXlsxRows(reader.result)
          .then((rows) => {
            els.flowText.value = rowsToText(rows);
            updateFlowPreview();
          })
          .catch((err) => {
            els.flowUnmatched.textContent = `Could not read ${file.name}: ${err.message}`;
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        els.flowText.value = reader.result;
        updateFlowPreview();
      };
      reader.readAsText(file);
    }
  });

  els.importBtn.addEventListener('click', () => {
    try {
      runImport();
    } catch (err) {
      els.statusMsg.textContent = `Import failed: ${err.message}`;
      els.statusMsg.className = 'status status--error';
    }
  });

  els.exportDiffsBtn.addEventListener('click', () => {
    try {
      const csv = generateDifferencesCsv(state.mapResult.pairs, state.hy8Doc, state.mode);
      const name = downloadName(state.hy8FileName, '_differences.csv');
      download(name, csv, 'text/csv');
      els.diffStatusMsg.textContent = `Downloaded ${name}.`;
      els.diffStatusMsg.className = 'status status--success';
    } catch (err) {
      els.diffStatusMsg.textContent = `Export failed: ${err.message}`;
      els.diffStatusMsg.className = 'status status--error';
    }
  });

  function setSummary(rows, source, label) {
    state.summaryRows = rows;
    state.summarySource = source;
    renderSummary();
    const analyzed = rows.filter((r) => !r.error).length;
    const skipped = rows.length - analyzed;
    els.summaryStatusMsg.textContent =
      `${label}: ${analyzed} culvert(s) analyzed` + (skipped ? `, ${skipped} skipped (see notes in rows)` : '') + '.';
    els.summaryStatusMsg.className = 'status status--success';
  }

  els.computeSummaryBtn.addEventListener('click', () => {
    try {
      const { doc } = buildUpdatedDoc();
      setSummary(buildComputedSummary(doc), 'computed (approx. HDS-5)', 'Computed after import');
    } catch (err) {
      els.summaryStatusMsg.textContent = `Analysis failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.extractSummaryBtn.addEventListener('click', () => {
    try {
      setSummary(buildExtractedSummary(state.hy8Doc), 'extracted from HY-8 file', 'Extracted from loaded file');
    } catch (err) {
      els.summaryStatusMsg.textContent = `Extraction failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.exportSummaryBtn.addEventListener('click', () => {
    try {
      const csv = generateSummaryCsv(state.summaryRows, state.summarySource);
      const name = downloadName(state.hy8FileName, '_summary.csv');
      download(name, csv, 'text/csv');
      els.summaryStatusMsg.textContent = `Downloaded ${name}.`;
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Export failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.analyzeAllBtn.addEventListener('click', () => {
    try {
      const { doc } = buildUpdatedDoc();
      state.fullAnalysis = buildFullAnalysis(doc);
      els.analysisContainer.innerHTML = renderFullAnalysis(state.fullAnalysis);
      els.exportAnalysisBtn.disabled = false;
      const analyzed = state.fullAnalysis.filter((c) => !c.error).length;
      const skipped = state.fullAnalysis.length - analyzed;
      els.summaryStatusMsg.textContent =
        `Analyzed ${analyzed} crossing(s) across their full flow range` +
        (skipped ? `, ${skipped} skipped` : '') + ' — ★ marks the design flow. Click a crossing to expand its table.';
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Analysis failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  els.exportAnalysisBtn.addEventListener('click', () => {
    try {
      const csv = generateFullAnalysisCsv(state.fullAnalysis);
      const name = downloadName(state.hy8FileName, '_full_analysis.csv');
      download(name, csv, 'text/csv');
      els.summaryStatusMsg.textContent = `Downloaded ${name}.`;
      els.summaryStatusMsg.className = 'status status--success';
    } catch (err) {
      els.summaryStatusMsg.textContent = `Export failed: ${err.message}`;
      els.summaryStatusMsg.className = 'status status--error';
    }
  });

  // Extracts the design-flow results from an HY-8 report .docx, using the
  // loaded .hy8 (not the imported copy) — the report was generated from it.
  function runReportExtraction() {
    state.reportRows = extractReportResults(state.reportTables, state.hy8Doc, { csvRows: state.csvRows });
    els.reportContainer.innerHTML = renderReportTable(state.reportRows);
    els.exportReportBtn.disabled = false;
    const extracted = state.reportRows.filter((r) => !r.error).length;
    const flagged = state.reportRows.length - extracted;
    els.reportStatusMsg.textContent =
      `${state.reportFileName}: ${extracted} culvert(s) extracted at their design flow` +
      (flagged ? `, ${flagged} flagged (see notes)` : '') + '.';
    els.reportStatusMsg.className = 'status status--success';
  }

  async function setReportDocx(arrayBuffer, fileName) {
    if (!state.hy8Doc) {
      els.reportStatusMsg.textContent = 'Load the matching .hy8 file first.';
      els.reportStatusMsg.className = 'status status--error';
      return;
    }
    const tables = await parseDocxSummaryTables(arrayBuffer);
    if (!tables.length) throw new Error('no "Culvert Summary Table" found in this document');
    state.reportTables = tables;
    state.reportFileName = fileName;
    runReportExtraction();
  }

  els.docxInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setReportDocx(reader.result, file.name).catch((err) => {
        els.reportStatusMsg.textContent = `Could not read ${file.name}: ${err.message}`;
        els.reportStatusMsg.className = 'status status--error';
      });
    };
    reader.readAsArrayBuffer(file);
  });

  els.exportReportBtn.addEventListener('click', () => {
    try {
      const csv = generateReportCsv(state.reportRows);
      const name = downloadName(state.hy8FileName, '_report_results.csv');
      download(name, csv, 'text/csv');
      els.reportStatusMsg.textContent = `Downloaded ${name}.`;
      els.reportStatusMsg.className = 'status status--success';
    } catch (err) {
      els.reportStatusMsg.textContent = `Export failed: ${err.message}`;
      els.reportStatusMsg.className = 'status status--error';
    }
  });

  render();

  return { state, setCsvText, setCsvRows, setHy8Text, setReportDocx, recomputeMapping, runImport };
}

function downloadName(originalName, suffix) {
  const base = (originalName || 'Section').replace(/\.[^./\\]+$/, '');
  return `${base}${suffix}`;
}

function defaultDownload(name, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
