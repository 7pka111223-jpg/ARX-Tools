import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { initApp } from '../src/hy8/ui/app.js';
import { serializeHy8 } from '../src/hy8/hy8File.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;
  return dom;
}

function makeApp() {
  setupDom();
  const root = document.getElementById('app');
  const downloads = [];
  const app = initApp(root, { download: (name, text, mime) => downloads.push({ name, text, mime }) });
  return { root, app, downloads };
}

test('loading both files computes a name-mode mapping by default', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  assert.equal(app.state.mapResult.pairs.length, 83);
  assert.equal(app.state.mapResult.unmatchedHy8.length, 1);
  assert.equal(root.querySelector('#mappingTable tbody').children.length, 83);
  assert.equal(root.querySelector('#unmatchedHy8Table tbody').children.length, 1);
  assert.ok(root.querySelector('#mappingSummary').textContent.includes('83 matched'));
  assert.equal(root.querySelector('#importBtn').disabled, false);
});

test('switching to station mode recomputes the mapping with the tolerance field shown', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#modeStation').checked = true;
  root.querySelector('#modeStation').dispatchEvent(new window.Event('change'));

  assert.equal(app.state.mode, 'station');
  assert.notEqual(root.querySelector('#toleranceField').style.display, 'none');
  // Station mode at the default 15m tolerance matches far fewer than all 83.
  assert.ok(app.state.mapResult.pairs.length < 83);
  assert.ok(app.state.mapResult.pairs.length > 0);
});

test('the differences panel lists CU-JSS-01 with a USIL difference, shown entirely in SI', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  const diffTable = root.querySelector('#diffContainer table.diff-table');
  assert.ok(diffTable);
  const headerText = diffTable.querySelector('thead').textContent;
  assert.ok(headerText.includes('CSV (SI)'));
  assert.ok(headerText.includes('HY-8 (SI)'));
  assert.ok(!headerText.includes('US'));

  const diffHtml = root.querySelector('#diffContainer').innerHTML;
  assert.ok(diffHtml.includes('CU-JSS-01'));
  assert.ok(diffHtml.includes('USIL'));
  // The raw HY-8 feet value (16.404199) must never appear — only its SI twin.
  assert.ok(!diffHtml.includes('16.404199'));
});

test('the export-differences button is enabled once a mapping with diffs exists, and disabled with none loaded', () => {
  const { root, app } = makeApp();
  assert.equal(root.querySelector('#exportDiffsBtn').disabled, true);

  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');
  assert.equal(root.querySelector('#exportDiffsBtn').disabled, false);
});

test('clicking export differences downloads a SI-only CSV named after the .hy8 file', () => {
  const { root, app, downloads } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#exportDiffsBtn').dispatchEvent(new window.Event('click'));

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_1_differences.csv');
  assert.equal(downloads[0].mime, 'text/csv');
  assert.ok(downloads[0].text.startsWith('Culvert,Crossing,Field,CSV value (SI),HY-8 value (SI)'));
  assert.ok(downloads[0].text.includes('CU-JSS-01'));
  assert.ok(!downloads[0].text.includes('16.404199'));
  assert.ok(root.querySelector('#diffStatusMsg').textContent.includes('Section_1_differences.csv'));
});

test('flow textarea reports unmatched names', () => {
  const { root, app } = makeApp();
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  const flowText = root.querySelector('#flowText');
  flowText.value = 'CU-JSS-01, 10\nNOT-A-CULVERT, 3';
  flowText.dispatchEvent(new window.Event('input'));

  assert.match(root.querySelector('#flowUnmatched').textContent, /NOT-A-CULVERT/);
});

test('Import & download produces a file whose geometry matches the headless pipeline', () => {
  const { root, app, downloads } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#flowText').value = 'CU-JSS-01, 10';
  root.querySelector('#flowText').dispatchEvent(new window.Event('input'));

  root.querySelector('#importBtn').dispatchEvent(new window.Event('click'));

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_1_updated.hy8');
  assert.ok(downloads[0].text.startsWith('HY8PROJECTFILE80\r\n'));
  assert.ok(downloads[0].text.endsWith('ENDPROJECTFILE'));
  assert.ok(root.querySelector('#statusMsg').textContent.includes('83 culvert(s) updated'));
  assert.ok(root.querySelector('#statusMsg').textContent.includes('1 flow(s) applied'));
});

test('Import & download is a no-op with a status message when nothing is mapped yet', () => {
  const { root, downloads } = makeApp();
  root.querySelector('#importBtn').dispatchEvent(new window.Event('click'));
  assert.equal(downloads.length, 0);
});

test('Compute summary renders one row per crossing with SI hydraulic results', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#flowText').value = 'CU-JSS-01, 10';
  root.querySelector('#flowText').dispatchEvent(new window.Event('input'));

  assert.equal(root.querySelector('#computeSummaryBtn').disabled, false);
  root.querySelector('#computeSummaryBtn').dispatchEvent(new window.Event('click'));

  const table = root.querySelector('#summaryResultTable');
  assert.ok(table, 'summary table should render');
  assert.equal(table.querySelectorAll('tbody tr').length, 84);
  assert.ok(table.querySelector('thead').textContent.includes('HW/D'));
  assert.ok(table.querySelector('thead').textContent.includes('Critical depth (m)'));
  assert.ok(root.querySelector('#summaryStatusMsg').textContent.includes('84 culvert(s) analyzed'));
  assert.equal(root.querySelector('#exportSummaryBtn').disabled, false);
});

test('Extract summary on the unanalyzed fixture flags rows instead of inventing numbers', () => {
  const { root, app } = makeApp();
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#extractSummaryBtn').dispatchEvent(new window.Event('click'));

  const table = root.querySelector('#summaryResultTable');
  assert.ok(table);
  assert.equal(table.querySelectorAll('tbody tr').length, 84);
});

test('Export summary downloads a SI CSV named after the .hy8 file', () => {
  const { root, app, downloads } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#computeSummaryBtn').dispatchEvent(new window.Event('click'));
  root.querySelector('#exportSummaryBtn').dispatchEvent(new window.Event('click'));

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_1_summary.csv');
  assert.equal(downloads[0].mime, 'text/csv');
  assert.ok(downloads[0].text.startsWith('Culvert,Crossing,Design flow (m3/s),HW/D,Normal depth (m),Critical depth (m)'));
  assert.ok(downloads[0].text.includes('CU-JSS-01'));
});

test('setCsvRows (the .xlsx path) feeds the same mapping pipeline as CSV text', async () => {
  const { makeXlsx } = await import('./helpers/makeXlsx.js');
  const { parseXlsxRows } = await import('../src/hy8/xlsx.js');
  const { root, app } = makeApp();

  const buf = makeXlsx([
    ['Name', 'Comment', 'Station', 'Type', 'Cells', 'Diameter (mm)', 'Width (m)', 'Rise (m)', 'Length (m)', 'Slope (%)', 'Skew', 'USIL (m)', 'DSIL (m)'],
    ['CU-JSS-01', '-', '-2+-601', 'Box', 6, '-', 2.5, 2.5, 72.3, 0.9, 30.2, -355.29, -355.94],
  ]);
  app.setCsvRows(await parseXlsxRows(buf), 'Table1.xlsx');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  assert.equal(app.state.mapResult.pairs.length, 1);
  assert.equal(app.state.mapResult.pairs[0].culvert.name, 'CU-JSS-01');
  assert.ok(root.querySelector('#csvFileLabel').textContent.includes('Table1.xlsx'));
});

test('DOCX report extraction renders the design-flow results and exports CSV', async () => {
  const { readFileSync } = await import('node:fs');
  const docxBuf = readFileSync(join(__dirname, 'fixtures/hy8/Section_3_report.docx'));
  const hy8Section3 = readFileSync(join(__dirname, 'fixtures/hy8/Section_3.hy8'), 'utf8');

  const { root, app, downloads } = makeApp();
  assert.equal(root.querySelector('#docxInput').disabled, true, 'docx input requires a loaded .hy8');

  app.setHy8Text(hy8Section3, 'Section_3.hy8');
  assert.equal(root.querySelector('#docxInput').disabled, false);

  await app.setReportDocx(docxBuf.buffer.slice(docxBuf.byteOffset, docxBuf.byteOffset + docxBuf.byteLength), 'Section_3_report.docx');

  const table = root.querySelector('#reportResultTable');
  assert.ok(table, 'report table should render');
  assert.equal(table.querySelectorAll('tbody tr').length, 44);
  assert.ok(root.querySelector('#reportStatusMsg').textContent.includes('44 culvert(s) extracted'));

  root.querySelector('#exportReportBtn').dispatchEvent(new window.Event('click'));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_3_report_results.csv');
  assert.ok(downloads[0].text.startsWith('Culvert Name,Design flow (m3/s),Headwater elevation (m),HW/D'));
  assert.ok(downloads[0].text.includes('CU-JAS-06'));
});

test('loading a culvert schedule after the DOCX re-extracts HW/D with the schedule rise', async () => {
  const { readFileSync } = await import('node:fs');
  const docxBuf = readFileSync(join(__dirname, 'fixtures/hy8/Section_3_report.docx'));
  const hy8Section3 = readFileSync(join(__dirname, 'fixtures/hy8/Section_3.hy8'), 'utf8');

  const { app } = makeApp();
  app.setHy8Text(hy8Section3, 'Section_3.hy8');
  await app.setReportDocx(docxBuf.buffer.slice(docxBuf.byteOffset, docxBuf.byteOffset + docxBuf.byteLength), 'Section_3_report.docx');

  const before = app.state.reportRows.find((r) => r.name === 'CU-JAS-06').hwOverD;
  assert.equal(before.toFixed(3), (1.66 / 2.5001).toFixed(3)); // BARRELDATA fallback

  // A schedule with a different rise for CU-JAS-06 must re-derive HW/D.
  app.setCsvRows(
    [
      ['Name', 'Station', 'Cells', 'Width (m)', 'Rise (m)', 'Length (m)', 'USIL (m)', 'DSIL (m)'],
      ['CU-JAS-06', '1+000', '1', '2.5', '2.0', '86.1', '180.70', '179.48'],
    ],
    'schedule.csv'
  );
  const after = app.state.reportRows.find((r) => r.name === 'CU-JAS-06').hwOverD;
  assert.equal(after.toFixed(3), (1.66 / 2.0).toFixed(3));
});

test('loading a new .hy8 clears a stale report extraction', async () => {
  const { readFileSync } = await import('node:fs');
  const docxBuf = readFileSync(join(__dirname, 'fixtures/hy8/Section_3_report.docx'));
  const hy8Section3 = readFileSync(join(__dirname, 'fixtures/hy8/Section_3.hy8'), 'utf8');

  const { root, app } = makeApp();
  app.setHy8Text(hy8Section3, 'Section_3.hy8');
  await app.setReportDocx(docxBuf.buffer.slice(docxBuf.byteOffset, docxBuf.byteOffset + docxBuf.byteLength), 'Section_3_report.docx');
  assert.ok(root.querySelector('#reportResultTable'));

  app.setHy8Text(hy8Fixture, 'Section_1.hy8');
  assert.equal(root.querySelector('#reportResultTable'), null);
  assert.equal(root.querySelector('#exportReportBtn').disabled, true);
});

test('Analyze all crossings renders collapsible per-crossing flow tables and exports CSV', async () => {
  const { readFileSync } = await import('node:fs');
  const hy8Section3 = readFileSync(join(__dirname, 'fixtures/hy8/Section_3.hy8'), 'utf8');

  const { root, app, downloads } = makeApp();
  assert.equal(root.querySelector('#analyzeAllBtn').disabled, true);
  app.setHy8Text(hy8Section3, 'Section_3.hy8');
  assert.equal(root.querySelector('#analyzeAllBtn').disabled, false);

  root.querySelector('#analyzeAllBtn').dispatchEvent(new window.Event('click'));

  const blocks = root.querySelectorAll('#analysisContainer details.analysis-block');
  assert.equal(blocks.length, 44);
  assert.ok(root.querySelector('#summaryStatusMsg').textContent.includes('44 crossing(s)'));
  // Each expanded table has 11 flow rows, one highlighted as the design flow.
  const firstTable = blocks[0].querySelector('table');
  assert.equal(firstTable.querySelectorAll('tbody tr').length, 11);
  assert.equal(firstTable.querySelectorAll('tbody tr.is-design').length, 1);

  root.querySelector('#exportAnalysisBtn').dispatchEvent(new window.Event('click'));
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, 'Section_3_full_analysis.csv');
  assert.ok(downloads[0].text.startsWith('Culvert,Crossing,Flow (m3/s),Design flow?'));
});

test('changing the mapping clears a stale summary', () => {
  const { root, app } = makeApp();
  app.setCsvText(csvFixture, 'Table1.csv');
  app.setHy8Text(hy8Fixture, 'Section_1.hy8');

  root.querySelector('#computeSummaryBtn').dispatchEvent(new window.Event('click'));
  assert.ok(root.querySelector('#summaryResultTable'));

  root.querySelector('#modeStation').checked = true;
  root.querySelector('#modeStation').dispatchEvent(new window.Event('change'));

  assert.equal(root.querySelector('#summaryResultTable'), null);
  assert.equal(root.querySelector('#exportSummaryBtn').disabled, true);
});
