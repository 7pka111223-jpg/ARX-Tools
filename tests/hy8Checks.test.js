import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8 } from '../src/hy8/hy8File.js';
import { buildHy8Project } from '../src/hy8/hy8Writer.js';
import { extractGeometry, geometryByName } from '../src/hy8/geometry.js';
import { runChecks, countFailures, DEFAULT_THRESHOLDS } from '../src/hy8/checks.js';
import { buildReportExcel, buildChecksExcel } from '../src/hy8/excelReports.js';
import { parseXlsxRows } from '../src/hy8/xlsx.js';
import { unzip } from '../src/hy8/zip.js';
import { mToFt } from '../src/hy8/units.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// A created file has a known standard roadway, so cover is exactly 2 m.
function createdDoc() {
  return parseHy8(
    buildHy8Project(
      [
        { name: 'CU-A', flowCms: 10, cells: 2, widthM: 2.5, riseM: 2.5, lengthM: 72.3, usilM: 5.2, dsilM: 4.85 },
        { name: 'CU-B', flowCms: 5, cells: 1, widthM: 1.5, riseM: 1.5, lengthM: 40, usilM: 0.2, dsilM: 0 },
      ],
      { now: 0, makeGuid: () => '00000000-0000-4000-8000-000000000000' }
    )
  );
}

test('extractGeometry reads cover, slope, inverts and reports skew as 0', () => {
  const geom = extractGeometry(createdDoc());
  assert.equal(geom.length, 2);

  const a = geom[0];
  assert.equal(a.name, 'CU-A');
  assert.equal(a.barrels, 2);
  assert.equal(a.cellWidthM.toFixed(3), '2.500');
  assert.equal(a.cellHeightM.toFixed(3), '2.500');
  assert.equal(a.coverM.toFixed(3), '2.000'); // standard 2 m cover
  assert.equal(a.usilM.toFixed(3), '5.200');
  assert.equal(a.dsilM.toFixed(3), '4.850');
  assert.equal(a.lengthM.toFixed(3), '72.300');
  assert.equal(a.slope.toFixed(6), ((5.2 - 4.85) / 72.3).toFixed(6));
  assert.equal(a.skewDeg, 0);
});

test('extractGeometry reads cover from an arbitrary loaded file', () => {
  const doc = parseHy8(hy8Fixture);
  const byName = geometryByName(doc);
  const g = byName.get('cu-jss-01');
  // Section_1 CU-JSS-01: roadway crest 54.790026 ft, USIL 16.404199 ft,
  // rise 8.2021 ft -> cover = 54.790026 - 16.404199 - 8.2021 ft.
  const expectedCoverM = (54.790026 - 16.404199 - 8.2021) / mToFt(1);
  assert.equal(g.coverM.toFixed(3), expectedCoverM.toFixed(3));
  assert.ok(g.coverM > 1);
});

test('runChecks flags cover below, HW/D above, and velocity above their thresholds', () => {
  const geomByName = new Map([
    ['c1', { name: 'C1', crossingName: '', coverM: 0.5 }], // cover fails (min 1)
    ['c2', { name: 'C2', crossingName: '', coverM: 2.0 }], // cover ok
    ['c3', { name: 'C3', crossingName: '', coverM: 1.5 }],
  ]);
  const hydByName = new Map([
    ['c1', { hwOverD: 0.8, outletVelocityMs: 3.0 }], // ok/ok
    ['c2', { hwOverD: 1.4, outletVelocityMs: 5.2 }], // both fail
    ['c3', { hwOverD: 1.0, outletVelocityMs: 4.5 }], // exactly at threshold -> pass
  ]);
  const rows = runChecks(geomByName, hydByName);

  const c1 = rows.find((r) => r.name === 'C1');
  assert.equal(c1.cover.pass, false);
  assert.equal(c1.hwOverD.pass, true);
  assert.equal(c1.velocity.pass, true);
  assert.equal(c1.anyFail, true);

  const c2 = rows.find((r) => r.name === 'C2');
  assert.equal(c2.cover.pass, true);
  assert.equal(c2.hwOverD.pass, false);
  assert.equal(c2.velocity.pass, false);
  assert.equal(c2.anyFail, true);

  // At-threshold values pass (min uses >=, max uses <=).
  const c3 = rows.find((r) => r.name === 'C3');
  assert.equal(c3.hwOverD.pass, true);
  assert.equal(c3.velocity.pass, true);
  assert.equal(c3.anyFail, false);

  assert.equal(countFailures(rows), 2);
});

test('runChecks marks missing hydraulic values as null (not a failure)', () => {
  const rows = runChecks(
    new Map([['c1', { name: 'C1', crossingName: '', coverM: 2 }]]),
    new Map() // no hydraulic data for C1
  );
  assert.equal(rows[0].hwOverD.pass, null);
  assert.equal(rows[0].velocity.pass, null);
  assert.equal(rows[0].cover.pass, true);
  assert.equal(rows[0].anyFail, false);
  assert.equal(rows[0].anyMissing, true);
});

test('custom thresholds override the defaults', () => {
  const rows = runChecks(
    new Map([['c1', { name: 'C1', crossingName: '', coverM: 1.5 }]]),
    new Map([['c1', { hwOverD: 0.9, outletVelocityMs: 4.0 }]]),
    { coverMinM: 2, hwOverDMax: 0.8, outletVelocityMaxMs: 3.5 }
  );
  assert.equal(rows[0].cover.pass, false); // 1.5 < 2
  assert.equal(rows[0].hwOverD.pass, false); // 0.9 > 0.8
  assert.equal(rows[0].velocity.pass, false); // 4.0 > 3.5
});

test('buildReportExcel writes two sheets our reader can parse', async () => {
  const doc = createdDoc();
  const reportRows = [
    { name: 'CU-A', designFlowCms: 10, hwElevationM: 9.1, hwOverD: 1.3, normalDepthM: 1.2, inletControlDepthM: 3.2, outletControlDepthM: 0, outletVelocityMs: 5.1, error: null },
    { name: 'CU-B', designFlowCms: 5, hwElevationM: 2.0, hwOverD: 0.7, normalDepthM: 0.8, inletControlDepthM: 1.1, outletControlDepthM: 0, outletVelocityMs: 3.0, error: null },
  ];
  const bytes = buildReportExcel(reportRows, geometryByName(doc));

  const files = await unzip(toArrayBuffer(bytes), '.xlsx');
  assert.ok(files.has('xl/worksheets/sheet1.xml'));
  assert.ok(files.has('xl/worksheets/sheet2.xml'));
  assert.ok(files.has('xl/styles.xml'));

  const decoder = new TextDecoder();
  const sheet1 = decoder.decode(files.get('xl/worksheets/sheet1.xml'));
  // Hydraulic sheet: HW/D column D flagged > 1, outlet velocity column H > 4.5.
  assert.ok(sheet1.includes('<conditionalFormatting sqref="D2:D3">'));
  assert.ok(sheet1.includes('operator="greaterThan"'));
  assert.ok(sheet1.includes('<formula>1</formula>'));
  assert.ok(sheet1.includes('sqref="H2:H3"'));
  assert.ok(sheet1.includes('<formula>4.5</formula>'));

  const sheet2 = decoder.decode(files.get('xl/worksheets/sheet2.xml'));
  // Geometric sheet: cover column E flagged < 1.
  assert.ok(sheet2.includes('<conditionalFormatting sqref="E2:E3">'));
  assert.ok(sheet2.includes('operator="lessThan"'));

  // Content round-trips: first sheet = hydraulic, second = geometric.
  const hyd = await parseXlsxRows(toArrayBuffer(bytes)); // reads sheet1
  assert.equal(hyd[0][0], 'Culvert Name');
  assert.equal(hyd[0][3], 'HW/D');
  assert.equal(hyd[1][0], 'CU-A');
  assert.equal(Number(hyd[1][3]), 1.3);
});

test('buildChecksExcel highlights all three checked columns', async () => {
  const bytes = buildChecksExcel([
    { name: 'C1', cover: { value: 0.5 }, hwOverD: { value: 1.3 }, velocity: { value: 5.0 }, anyFail: true, anyMissing: false },
  ]);
  const files = await unzip(toArrayBuffer(bytes), '.xlsx');
  const sheet1 = new TextDecoder().decode(files.get('xl/worksheets/sheet1.xml'));
  assert.ok(sheet1.includes('sqref="B2:B2"')); // cover
  assert.ok(sheet1.includes('sqref="C2:C2"')); // HW/D
  assert.ok(sheet1.includes('sqref="D2:D2"')); // velocity
  const grid = await parseXlsxRows(toArrayBuffer(bytes));
  assert.equal(grid[1][4], 'FLAGGED');
});
