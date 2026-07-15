import { escapeHtml } from '../../util.js';

export function renderMappingRow(pair) {
  return `<tr><td>${escapeHtml(pair.csvRow.name)}</td><td>${escapeHtml(pair.csvRow.stationRaw)}</td><td>${escapeHtml(pair.culvert.name || '')}</td><td>${escapeHtml(pair.crossing.name || '')}</td></tr>`;
}

export function renderUnmatchedCsvRow(row) {
  return `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.stationRaw)}</td></tr>`;
}

export function renderUnmatchedHy8Row(crossing) {
  return `<tr><td>${escapeHtml(crossing.culverts[0].name || '')}</td><td>${escapeHtml(crossing.name || '')}</td></tr>`;
}

const FIELD_LABELS = {
  USIL: 'USIL',
  DSIL: 'DSIL',
  length: 'Length / outlet station',
  span: 'Span',
  rise: 'Rise',
  cells: 'Cells / barrels',
  channelInvertElevation: 'Channel invert elevation',
  tailwaterElevation: 'Constant tailwater elevation',
  station: 'Station label',
  name: 'Culvert name',
};

function formatValue(value) {
  return typeof value === 'number' ? value.toFixed(6) : escapeHtml(String(value));
}

export function renderDiffSection(culvertLabel, diffs) {
  const rows = diffs
    .map(
      (d) =>
        `<tr><td>${escapeHtml(FIELD_LABELS[d.field] || d.field)}</td><td>${formatValue(d.csvValue)}</td><td>${formatValue(d.csvValueUS)}</td><td>${formatValue(d.hy8Value)}</td></tr>`
    )
    .join('');
  return `<div class="diff-block">
    <h4>${escapeHtml(culvertLabel)}</h4>
    <table class="diff-table">
      <thead><tr><th>Field</th><th>CSV (SI)</th><th>CSV → US</th><th>HY-8 (US)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
