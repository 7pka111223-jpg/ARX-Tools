// Builds the .xlsx workbooks for the HY-8 report extraction (two sheets:
// hydraulic results + geometric data) and for the threshold checks, both with
// red conditional formatting on the values that exceed their thresholds.

import { buildWorkbook } from './xlsxWriter.js';
import { DEFAULT_THRESHOLDS } from './checks.js';

// Round to a fixed precision but keep the cell numeric so Excel's conditional
// formatting can evaluate it. null/NaN become '' (blank cell).
function n(v, digits = 3) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return Number(v.toFixed(digits));
}

const HYD_HEADER = [
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

const GEO_HEADER = [
  'Culvert Name',
  'Number of barrels',
  'Cell width (m)',
  'Cell height (m)',
  'Cover (m)',
  'Slope (m/m)',
  'Upstream invert elevation (m)',
  'Downstream invert elevation (m)',
  'Culvert length (m)',
  'Skew (deg)',
];

// reportRows: rows from reportExtract.extractReportResults (hydraulic, SI).
// geomByName: Map<nameLower, geometry row> from geometry.geometryByName.
export function buildReportExcel(reportRows, geomByName, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const hydRows = [HYD_HEADER];
  const geoRows = [GEO_HEADER];
  for (const r of reportRows) {
    hydRows.push([
      r.name,
      n(r.designFlowCms),
      n(r.hwElevationM),
      n(r.hwOverD),
      n(r.normalDepthM),
      n(r.inletControlDepthM),
      n(r.outletControlDepthM),
      n(r.outletVelocityMs),
      r.error || '',
    ]);
    const g = geomByName.get((r.name || '').trim().toLowerCase());
    if (g) {
      geoRows.push([
        g.name,
        g.barrels,
        n(g.cellWidthM),
        n(g.cellHeightM),
        n(g.coverM),
        n(g.slope, 4),
        n(g.usilM),
        n(g.dsilM),
        n(g.lengthM),
        n(g.skewDeg),
      ]);
    }
  }

  const hydRules = [
    { col: 3, operator: 'greaterThan', formula: t.hwOverDMax }, // HW/D
    { col: 7, operator: 'greaterThan', formula: t.outletVelocityMaxMs }, // outlet velocity
  ];
  const geoRules = [{ col: 4, operator: 'lessThan', formula: t.coverMinM }]; // cover

  return buildWorkbook([
    { name: 'Hydraulic Results', rows: hydRows, rules: hydRules },
    { name: 'Geometric Data', rows: geoRows, rules: geoRules },
  ]);
}

const CHECK_HEADER = [
  'Culvert Name',
  'Cover (m)',
  'HW/D',
  'Outlet velocity (m/s)',
  'Result',
];

// checkRows: rows from checks.runChecks.
export function buildChecksExcel(checkRows, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const rows = [CHECK_HEADER];
  for (const r of checkRows) {
    rows.push([
      r.name,
      n(r.cover.value),
      n(r.hwOverD.value),
      n(r.velocity.value),
      r.anyFail ? 'FLAGGED' : r.anyMissing ? 'incomplete' : 'OK',
    ]);
  }
  const rules = [
    { col: 1, operator: 'lessThan', formula: t.coverMinM }, // cover
    { col: 2, operator: 'greaterThan', formula: t.hwOverDMax }, // HW/D
    { col: 3, operator: 'greaterThan', formula: t.outletVelocityMaxMs }, // outlet velocity
  ];
  return buildWorkbook([{ name: 'Checks', rows, rules }]);
}
