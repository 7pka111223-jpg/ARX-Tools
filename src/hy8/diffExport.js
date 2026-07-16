// Exports the full differences report (across every mapped pair) as a CSV,
// entirely in SI units.

import { diffPair } from './differ.js';
import { FIELD_LABELS } from './fieldLabels.js';
import { csvField } from './csvUtil.js';

function formatValue(field, value) {
  if (typeof value !== 'number') return value;
  return field === 'cells' ? String(value) : value.toFixed(6);
}

export function generateDifferencesCsv(pairs, doc, mode = 'name') {
  const header = ['Culvert', 'Crossing', 'Field', 'CSV value (SI)', 'HY-8 value (SI)'];
  const rows = [header];

  for (const pair of pairs) {
    for (const d of diffPair(pair, doc, mode)) {
      rows.push([
        pair.culvert.name || '',
        pair.crossing.name || '',
        FIELD_LABELS[d.field] || d.field,
        formatValue(d.field, d.csvValue),
        formatValue(d.field, d.hy8ValueSI),
      ]);
    }
  }

  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}
