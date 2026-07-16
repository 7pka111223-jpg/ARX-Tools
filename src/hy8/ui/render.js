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
