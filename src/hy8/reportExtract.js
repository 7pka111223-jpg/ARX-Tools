// Cross-references an HY-8 report's per-culvert summary tables (docx.js)
// with the .hy8 project file: for every culvert, finds the table row at the
// project's design flow and extracts the hydraulic results, always output
// in SI. The report itself may be in either display unit system — units are
// detected from the column headers ("(cms)"/"(m)" vs "(cfs)"/"(ft)").

import { readFloats } from './hy8File.js';
import { ftToM, cfsToCms } from './units.js';
import { csvField } from './csvUtil.js';

function findColumn(header, label) {
  return header.findIndex((h) => h.toLowerCase().startsWith(label.toLowerCase()));
}

// HY-8 marks some values with a trailing '*' (e.g. "0.0*" when outlet
// control was not computed); strip any trailing non-numeric marker.
function parseValue(cell) {
  const m = /^-?\d+(?:\.\d+)?/.exec(String(cell).trim());
  return m ? Number(m[0]) : NaN;
}

function detectUnits(header) {
  const joined = header.join(' ').toLowerCase();
  if (joined.includes('(cfs)') || joined.includes('(ft)')) return 'us';
  return 'si';
}

export function extractReportResults(tables, doc) {
  const tableByName = new Map();
  for (const t of tables) tableByName.set(t.name.trim().toLowerCase(), t);

  const rows = [];
  for (const crossing of doc.crossings) {
    const culvert = crossing.culverts[0];
    const name = (culvert.name || '').trim();
    const designCms = cfsToCms(readFloats(doc, crossing.dischargeRangeLine)[1]);

    const base = { name, designFlowCms: designCms };
    const table = tableByName.get(name.toLowerCase());
    if (!table) {
      rows.push({ ...base, error: 'no summary table in the report for this culvert' });
      continue;
    }
    tableByName.delete(name.toLowerCase());

    const col = {
      flow: findColumn(table.header, 'Total Discharge'),
      hwElev: findColumn(table.header, 'Headwater Elevation'),
      inletControl: findColumn(table.header, 'Inlet Control Depth'),
      outletControl: findColumn(table.header, 'Outlet Control Depth'),
      hwOverD: findColumn(table.header, 'HW / D'),
      normalDepth: findColumn(table.header, 'Normal Depth'),
      outletVelocity: findColumn(table.header, 'Outlet Velocity'),
    };
    const missing = Object.entries(col).filter(([, i]) => i === -1).map(([k]) => k);
    if (missing.length) {
      rows.push({ ...base, error: `report table is missing column(s): ${missing.join(', ')}` });
      continue;
    }

    const units = detectUnits(table.header);
    const toM = units === 'us' ? ftToM : (x) => x;
    const designInReportUnits = units === 'us' ? designCms / 0.028316846592 : designCms;

    let best = null;
    for (const r of table.rows) {
      const flow = parseValue(r[col.flow]);
      if (Number.isNaN(flow)) continue;
      const dist = Math.abs(flow - designInReportUnits);
      if (!best || dist < best.dist) best = { row: r, dist, flow };
    }
    // The report prints flows to 2 decimals; anything further off than
    // rounding (or 0.5% of the design flow) means the design row isn't there.
    if (!best || best.dist > Math.max(0.05, designInReportUnits * 0.005)) {
      rows.push({ ...base, error: `design flow ${designCms.toFixed(2)} m³/s not found among the report's flow rows` });
      continue;
    }

    const r = best.row;
    rows.push({
      ...base,
      hwElevationM: toM(parseValue(r[col.hwElev])),
      hwOverD: parseValue(r[col.hwOverD]),
      normalDepthM: toM(parseValue(r[col.normalDepth])),
      inletControlDepthM: toM(parseValue(r[col.inletControl])),
      outletControlDepthM: toM(parseValue(r[col.outletControl])),
      outletVelocityMs: units === 'us' ? parseValue(r[col.outletVelocity]) * 0.3048 : parseValue(r[col.outletVelocity]),
      error: null,
    });
  }

  // Tables whose culvert isn't in the .hy8 file at all.
  for (const t of tableByName.values()) {
    rows.push({ name: t.name, designFlowCms: null, error: 'table has no matching culvert in the .hy8 file' });
  }
  return rows;
}

function num(v, digits = 3) {
  return v === null || v === undefined || Number.isNaN(v) ? '' : v.toFixed(digits);
}

export function generateReportCsv(rows) {
  const header = [
    'Culvert Name',
    'Design flow (m3/s)',
    'Headwater elevation (m)',
    'HW/D',
    'Normal depth (m)',
    'Inlet control depth (m)',
    'Outlet control depth (m)',
    'Outlet velocity (m/s)',
    'Note',
  ];
  const lines = [header];
  for (const r of rows) {
    lines.push([
      r.name,
      num(r.designFlowCms),
      num(r.hwElevationM),
      num(r.hwOverD),
      num(r.normalDepthM),
      num(r.inletControlDepthM),
      num(r.outletControlDepthM),
      num(r.outletVelocityMs),
      r.error || '',
    ]);
  }
  return lines.map((row) => row.map(csvField).join(',')).join('\r\n');
}
