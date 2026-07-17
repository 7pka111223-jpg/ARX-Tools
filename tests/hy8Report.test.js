import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8 } from '../src/hy8/hy8File.js';
import { parseDocxSummaryTables } from '../src/hy8/docx.js';
import { extractReportResults, generateReportCsv } from '../src/hy8/reportExtract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const docxBuf = readFileSync(join(__dirname, 'fixtures/hy8/Section_3_report.docx'));
const hy8Text = readFileSync(join(__dirname, 'fixtures/hy8/Section_3.hy8'), 'utf8');

function docxArrayBuffer() {
  return docxBuf.buffer.slice(docxBuf.byteOffset, docxBuf.byteOffset + docxBuf.byteLength);
}

test('parseDocxSummaryTables finds all 44 captioned summary tables', async () => {
  const tables = await parseDocxSummaryTables(docxArrayBuffer());
  assert.equal(tables.length, 44);
  const names = tables.map((t) => t.name);
  assert.ok(names.includes('CU-JAS-06'));
  assert.ok(names.includes('366.84')); // culvert genuinely named this in the project
  // 13-column header, as HY-8 writes it.
  assert.equal(tables[0].header.length, 13);
  assert.equal(tables[0].header[0], 'Total Discharge (cms)');
  assert.equal(tables[0].header[2], 'Headwater Elevation (m)');
  assert.ok(tables[0].rows.length >= 11);
});

test('extractReportResults pulls the design-flow row for every culvert', async () => {
  const tables = await parseDocxSummaryTables(docxArrayBuffer());
  const doc = parseHy8(hy8Text);
  const rows = extractReportResults(tables, doc);

  assert.equal(rows.length, 44);
  const extracted = rows.filter((r) => !r.error);
  assert.equal(extracted.length, 44, `notes: ${rows.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`).join('; ')}`);
});

test('CU-JAS-06 extraction matches the known design-flow row (7.71 cms)', async () => {
  const tables = await parseDocxSummaryTables(docxArrayBuffer());
  const doc = parseHy8(hy8Text);
  const rows = extractReportResults(tables, doc);
  const r = rows.find((x) => x.name === 'CU-JAS-06');

  // Hand-read from the report's table row at 7.71 cms:
  // HW elev 182.36, IC 1.66, OC 0.0*, HW/D 0.20, yn 0.67, v 4.51
  assert.equal(r.error, null);
  assert.equal(r.designFlowCms.toFixed(2), '7.71');
  assert.equal(r.hwElevationM.toFixed(2), '182.36');
  assert.equal(r.inletControlDepthM.toFixed(2), '1.66');
  assert.equal(r.outletControlDepthM, 0); // "0.0*" — asterisk marker stripped
  assert.equal(r.hwOverD.toFixed(2), '0.20');
  assert.equal(r.normalDepthM.toFixed(2), '0.67');
  assert.equal(r.outletVelocityMs.toFixed(2), '4.51');
});

test('a culvert missing from the report is flagged, not dropped', async () => {
  const tables = (await parseDocxSummaryTables(docxArrayBuffer())).filter((t) => t.name !== 'CU-JAS-06');
  const doc = parseHy8(hy8Text);
  const rows = extractReportResults(tables, doc);
  const r = rows.find((x) => x.name === 'CU-JAS-06');
  assert.ok(r.error && r.error.includes('no summary table'));
});

test('a US-units report converts to SI on extraction', async () => {
  const doc = parseHy8(hy8Text);
  const crossing = doc.crossings[0];
  const designCfs = 272.27608; // CU-JAS-06's stored design flow
  const table = {
    name: crossing.culverts[0].name,
    header: [
      'Total Discharge (cfs)',
      'Culvert Discharge (cfs)',
      'Headwater Elevation (ft)',
      'Inlet Control Depth (ft)',
      'Outlet Control Depth (ft)',
      'HW / D (ft)',
      'Flow Type',
      'Normal Depth (ft)',
      'Critical Depth (ft)',
      'Outlet Depth (ft)',
      'Tailwater Depth (ft)',
      'Outlet Velocity (ft/s)',
      'Tailwater Velocity (ft/s)',
    ],
    rows: [[String(designCfs), String(designCfs), '598.29', '5.45', '0.0*', '0.20', '1-S2n', '2.20', '3.25', '2.23', '0.00', '14.80', '0.00']],
  };
  const rows = extractReportResults([table], doc);
  const r = rows.find((x) => x.name === table.name);
  assert.equal(r.error, null);
  assert.equal(r.hwElevationM.toFixed(2), (598.29 * 0.3048).toFixed(2));
  assert.equal(r.hwOverD.toFixed(2), '0.20'); // dimensionless — no conversion
  assert.equal(r.outletVelocityMs.toFixed(3), (14.8 * 0.3048).toFixed(3));
});

test('generateReportCsv writes one SI row per culvert with the requested columns', async () => {
  const tables = await parseDocxSummaryTables(docxArrayBuffer());
  const doc = parseHy8(hy8Text);
  const rows = extractReportResults(tables, doc);
  const csv = generateReportCsv(rows);
  const lines = csv.split('\r\n');
  assert.equal(
    lines[0],
    'Culvert Name,Design flow (m3/s),Headwater elevation (m),HW/D,Normal depth (m),Inlet control depth (m),Outlet control depth (m),Outlet velocity (m/s),Note'
  );
  assert.equal(lines.length, 45); // header + 44 culverts
  const cu06 = lines.find((l) => l.startsWith('CU-JAS-06,'));
  assert.ok(cu06.includes('182.360'));
  assert.ok(cu06.includes('4.510'));
});
