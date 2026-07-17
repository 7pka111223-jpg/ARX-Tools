import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseXlsxRows, rowsToText } from '../src/hy8/xlsx.js';
import { rowsToCulverts, parseCulvertCsv } from '../src/hy8/csvCulverts.js';
import { makeXlsx } from './helpers/makeXlsx.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

const HEADER = ['Name', 'Comment', 'Station', 'Type', 'Cells', 'Diameter (mm)', 'Width (m)', 'Rise (m)', 'Length (m)', 'Slope (%)', 'Skewness', 'USIL (m)', 'DSIL (m)'];

test('parseXlsxRows reads a generated workbook back as a grid', async () => {
  const buf = makeXlsx([
    ['Culverts Data', '', ''],
    ['Name', 'Station', 'Cells'],
    ['CU-01', '1+409', 2],
  ]);
  const rows = await parseXlsxRows(buf);
  assert.equal(rows[1][0], 'Name');
  assert.equal(rows[2][0], 'CU-01');
  assert.equal(rows[2][1], '1+409');
  assert.equal(Number(rows[2][2]), 2);
});

test('parseXlsxRows handles XML entities and empty cells', async () => {
  const buf = makeXlsx([
    ['Name', 'Station', 'Note'],
    ['CU-<01>', '0+-887', ''],
  ]);
  const rows = await parseXlsxRows(buf);
  assert.equal(rows[1][0], 'CU-<01>');
  assert.equal(rows[1][1], '0+-887');
});

test('an .xlsx culvert schedule parses to the same culverts as the CSV equivalent', async () => {
  const buf = makeXlsx([
    ['Culverts Data', '', '', '', '', '', '', '', '', '', '', '', ''],
    HEADER,
    ['CU-JSS-01', '-', '-2+-601', 'Box', 6, '-', 2.5, 2.5, 72.3, 0.9, 30.2, -355.29, -355.94],
  ]);
  const culverts = rowsToCulverts(await parseXlsxRows(buf));
  assert.equal(culverts.length, 1);
  const c = culverts[0];
  assert.equal(c.name, 'CU-JSS-01');
  assert.equal(c.stationM, -2601);
  assert.equal(c.cells, 6);
  assert.equal(c.widthM, 2.5);
  assert.equal(c.lengthM, 72.3);
  assert.equal(c.usilM, -355.29);
  assert.equal(c.dsilM, -355.94);

  // Same values the CSV fixture yields for that culvert.
  const fromCsv = parseCulvertCsv(csvFixture).find((r) => r.name === 'CU-JSS-01');
  assert.deepEqual(c, fromCsv);
});

test('rowsToCulverts finds the header row even without a banner row', () => {
  const rows = [HEADER, ['CU-X', '-', '1+000', 'Box', 1, '-', 1.5, 1.5, 20, 1, 0, -10, -10.2]];
  const culverts = rowsToCulverts(rows);
  assert.equal(culverts.length, 1);
  assert.equal(culverts[0].name, 'CU-X');
  assert.equal(culverts[0].stationM, 1000);
});

test('rowsToText flattens a flow sheet for the textarea, skipping blank rows', async () => {
  const buf = makeXlsx([
    ['Name', 'Flow (cms)'],
    ['CU-JSS-01', 10],
    ['', ''],
    ['CU-JSS-02', 5.5],
  ]);
  const text = rowsToText(await parseXlsxRows(buf));
  assert.equal(text, 'Name,Flow (cms)\nCU-JSS-01,10\nCU-JSS-02,5.5');
});

test('parseXlsxRows rejects a non-zip file with a clear error', async () => {
  const buf = new TextEncoder().encode('this is not a zip').buffer;
  await assert.rejects(() => parseXlsxRows(buf), /Not a valid \.xlsx/);
});
