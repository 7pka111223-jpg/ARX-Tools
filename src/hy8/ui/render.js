import { escapeHtml } from '../../util.js';
import { FIELD_LABELS } from '../fieldLabels.js';

export function renderMappingRow(pair) {
  return `<tr><td>${escapeHtml(pair.csvRow.name)}</td><td>${escapeHtml(pair.csvRow.stationRaw)}</td><td>${escapeHtml(pair.culvert.name || '')}</td><td>${escapeHtml(pair.crossing.name || '')}</td></tr>`;
}

export function renderUnmatchedCsvRow(row) {
  return `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.stationRaw)}</td></tr>`;
}

export function renderUnmatchedHy8Row(crossing) {
  return `<tr><td>${escapeHtml(crossing.culverts[0].name || '')}</td><td>${escapeHtml(crossing.name || '')}</td></tr>`;
}

// Values are shown entirely in SI, even though the .hy8 file itself always
// stores US customary units — hy8ValueSI is differ.js's SI-converted twin of
// the raw hy8Value, computed for exactly this purpose.
function formatValue(field, value) {
  if (typeof value !== 'number') return escapeHtml(String(value));
  return field === 'cells' ? String(value) : value.toFixed(6);
}

function numCell(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

export function renderSummaryTable(rows) {
  const body = rows
    .map((r) => {
      if (r.error) {
        return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.crossingName)}</td><td>${numCell(r.designFlowCms)}</td><td colspan="6" class="hint">${escapeHtml(r.error)}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.crossingName)}</td><td>${numCell(r.designFlowCms)}</td><td>${numCell(r.hwOverD)}</td><td>${numCell(r.normalDepthM)}</td><td>${numCell(r.criticalDepthM)}</td><td>${numCell(r.hwElevationM)}</td><td>${numCell(r.outletVelocityMs)}</td><td>${escapeHtml(r.control || '—')}</td></tr>`;
    })
    .join('');
  return `<table class="diff-table" id="summaryResultTable">
    <thead><tr><th>Culvert</th><th>Crossing</th><th>Q (m³/s)</th><th>HW/D</th><th>Normal depth (m)</th><th>Critical depth (m)</th><th>HW elevation (m)</th><th>Outlet velocity (m/s)</th><th>Control</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderFullAnalysis(crossings) {
  return crossings
    .map((c) => {
      const label = `${c.name}${c.crossingName ? ` (${c.crossingName})` : ''}`;
      if (c.error) {
        return `<details class="analysis-block"><summary>${escapeHtml(label)} — ${escapeHtml(c.error)}</summary></details>`;
      }
      const body = c.rows
        .map(
          (r) =>
            `<tr${r.isDesign ? ' class="is-design"' : ''}><td>${numCell(r.flowCms)}${r.isDesign ? ' ★' : ''}</td><td>${numCell(r.hwElevationM)}</td><td>${numCell(r.hwOverD)}</td><td>${numCell(r.inletControlDepthM)}</td><td>${numCell(r.outletControlDepthM)}</td><td>${numCell(r.normalDepthM)}</td><td>${numCell(r.criticalDepthM)}</td><td>${numCell(r.outletDepthM)}</td><td>${numCell(r.outletVelocityMs)}</td><td>${escapeHtml(r.control || '—')}</td></tr>`
        )
        .join('');
      return `<details class="analysis-block"><summary>${escapeHtml(label)}</summary>
      <table class="diff-table analysis-table">
        <thead><tr><th>Q (m³/s)</th><th>HW elev (m)</th><th>HW/D</th><th>Inlet ctrl (m)</th><th>Outlet ctrl (m)</th><th>Normal depth (m)</th><th>Critical depth (m)</th><th>Outlet depth (m)</th><th>Outlet velocity (m/s)</th><th>Control</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </details>`;
    })
    .join('');
}

export function renderReportTable(rows) {
  const body = rows
    .map((r) => {
      if (r.error) {
        return `<tr><td>${escapeHtml(r.name)}</td><td>${numCell(r.designFlowCms)}</td><td colspan="6" class="hint">${escapeHtml(r.error)}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(r.name)}</td><td>${numCell(r.designFlowCms)}</td><td>${numCell(r.hwElevationM)}</td><td>${numCell(r.hwOverD)}</td><td>${numCell(r.normalDepthM)}</td><td>${numCell(r.inletControlDepthM)}</td><td>${numCell(r.outletControlDepthM)}</td><td>${numCell(r.outletVelocityMs)}</td></tr>`;
    })
    .join('');
  return `<table class="diff-table" id="reportResultTable">
    <thead><tr><th>Culvert</th><th>Q (m³/s)</th><th>HW elevation (m)</th><th>HW/D</th><th>Normal depth (m)</th><th>Inlet control depth (m)</th><th>Outlet control depth (m)</th><th>Outlet velocity (m/s)</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Preview of the parsed project-creator culvert list — everything in SI.
// Slope-mode rows show the derived inverts (DSIL 0, USIL = slope × length).
export function renderCreatorTable(culverts) {
  const body = culverts
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.name)}</td><td>${numCell(c.flowCms)}</td><td>${String(c.cells)}</td><td>${numCell(c.widthM)}</td><td>${numCell(c.riseM)}</td><td>${numCell(c.lengthM)}</td><td>${numCell(c.usilM)}</td><td>${numCell(c.dsilM)}</td><td>${numCell(c.crestM)}</td><td>${escapeHtml(c.invertSource === 'slope' ? 'slope' : 'USIL/DSIL')}</td></tr>`
    )
    .join('');
  return `<table class="diff-table" id="creatorResultTable">
    <thead><tr><th>Culvert</th><th>Q (m³/s)</th><th>Cells</th><th>Width (m)</th><th>Rise (m)</th><th>Length (m)</th><th>USIL (m)</th><th>DSIL (m)</th><th>Roadway crest (m)</th><th>Inverts from</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// One value + pass/fail cell for the checks table. Failing cells get the
// .check-fail class (red); values that couldn't be judged show a dash.
function checkCell(judgement, digits = 3) {
  if (judgement.pass === null) return '<td class="check-na">—</td>';
  const cls = judgement.pass ? 'check-ok' : 'check-fail';
  return `<td class="${cls}">${numCell(judgement.value, digits)}</td>`;
}

export function renderChecksTable(rows, thresholds) {
  const body = rows
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td>${checkCell(r.cover)}${checkCell(r.hwOverD)}${checkCell(r.velocity)}<td>${
          r.anyFail ? '<span class="check-fail">FLAGGED</span>' : r.anyMissing ? '<span class="check-na">incomplete</span>' : '<span class="check-ok">OK</span>'
        }</td></tr>`
    )
    .join('');
  return `<table class="diff-table" id="checksResultTable">
    <thead><tr>
      <th>Culvert</th>
      <th>Cover (m) — min ${thresholds.coverMinM}</th>
      <th>HW/D — max ${thresholds.hwOverDMax}</th>
      <th>Outlet velocity (m/s) — max ${thresholds.outletVelocityMaxMs}</th>
      <th>Result</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderDiffSection(culvertLabel, diffs) {
  const rows = diffs
    .map(
      (d) =>
        `<tr><td>${escapeHtml(FIELD_LABELS[d.field] || d.field)}</td><td>${formatValue(d.field, d.csvValue)}</td><td>${formatValue(d.field, d.hy8ValueSI)}</td></tr>`
    )
    .join('');
  return `<div class="diff-block">
    <h4>${escapeHtml(culvertLabel)}</h4>
    <table class="diff-table">
      <thead><tr><th>Field</th><th>CSV (SI)</th><th>HY-8 (SI)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
