// CSV export of the per-culvert summary table (SI units).

import { csvField } from './csvUtil.js';

function num(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? '' : v.toFixed(digits);
}

export function generateSummaryCsv(rows, source) {
  const header = [
    'Culvert',
    'Crossing',
    'Design flow (m3/s)',
    'HW/D',
    'Normal depth (m)',
    'Critical depth (m)',
    'Headwater elevation (m)',
    'Outlet velocity (m/s)',
    'Control',
    'Source',
    'Note',
  ];
  const lines = [header];
  for (const r of rows) {
    lines.push([
      r.name,
      r.crossingName,
      num(r.designFlowCms),
      num(r.hwOverD),
      num(r.normalDepthM),
      num(r.criticalDepthM),
      num(r.hwElevationM),
      num(r.outletVelocityMs),
      r.control || '',
      source,
      r.error || '',
    ]);
  }
  return lines.map((row) => row.map(csvField).join(',')).join('\r\n');
}
