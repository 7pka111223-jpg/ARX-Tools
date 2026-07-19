// CSV export of the per-culvert summary table (SI units).

import { csvField } from './csvUtil.js';

function num(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? '' : v.toFixed(digits);
}

// Full multi-flow analysis: one CSV row per crossing per flow.
export function generateFullAnalysisCsv(crossings) {
  const header = [
    'Culvert',
    'Crossing',
    'Flow (m3/s)',
    'Design flow?',
    'Headwater elevation (m)',
    'HW/D',
    'Inlet control depth (m)',
    'Outlet control depth (m)',
    'Normal depth (m)',
    'Critical depth (m)',
    'Outlet depth (m)',
    'Outlet velocity (m/s)',
    'Control',
    'Note',
  ];
  const lines = [header];
  for (const c of crossings) {
    if (c.error) {
      lines.push([c.name, c.crossingName, '', '', '', '', '', '', '', '', '', '', '', c.error]);
      continue;
    }
    for (const r of c.rows) {
      lines.push([
        c.name,
        c.crossingName,
        num(r.flowCms),
        r.isDesign ? 'yes' : '',
        num(r.hwElevationM),
        num(r.hwOverD),
        num(r.inletControlDepthM),
        num(r.outletControlDepthM),
        num(r.normalDepthM),
        num(r.criticalDepthM),
        num(r.outletDepthM),
        num(r.outletVelocityMs),
        r.control || '',
        '',
      ]);
    }
  }
  return lines.map((row) => row.map(csvField).join(',')).join('\r\n');
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
