import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8 } from '../src/hy8/hy8File.js';
import { parseCulvertCsv } from '../src/hy8/csvCulverts.js';
import { mapCulverts } from '../src/hy8/mapper.js';
import { diffPair } from '../src/hy8/differ.js';
import { generateDifferencesCsv } from '../src/hy8/diffExport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

function load() {
  const doc = parseHy8(hy8Fixture);
  const rows = parseCulvertCsv(csvFixture);
  return { doc, ...mapCulverts(rows, doc, { mode: 'name' }) };
}

test('generateDifferencesCsv has the expected header', () => {
  const { doc, pairs } = load();
  const csv = generateDifferencesCsv(pairs, doc, 'name');
  const [header] = csv.split('\r\n');
  assert.equal(header, 'Culvert,Crossing,Field,CSV value (SI),HY-8 value (SI)');
});

test('generateDifferencesCsv row count matches the total diff count across all pairs', () => {
  const { doc, pairs } = load();
  const csv = generateDifferencesCsv(pairs, doc, 'name');
  const lines = csv.split('\r\n');
  const dataRows = lines.length - 1;

  const expectedTotal = pairs.reduce((sum, pair) => sum + diffPair(pair, doc, 'name').length, 0);
  assert.equal(dataRows, expectedTotal);
  assert.ok(expectedTotal > 0);
});

test('generateDifferencesCsv reports CU-JSS-01 USIL entirely in SI (no feet anywhere)', () => {
  const { doc, pairs } = load();
  const csv = generateDifferencesCsv(pairs, doc, 'name');
  const usilRow = csv.split('\r\n').find((line) => line.startsWith('CU-JSS-01,') && line.includes(',USIL,'));
  assert.ok(usilRow, 'expected a CU-JSS-01 USIL row');

  // A leading '-' triggers this module's CSV-formula-injection escaping
  // (a literal leading single quote, same convention as reportExporter.js),
  // so strip it before parsing the field back as a number.
  const fields = usilRow.split(',').map((f) => f.replace(/^'/, ''));
  assert.equal(fields[0], 'CU-JSS-01');
  assert.equal(Number(fields[3]).toFixed(2), '-355.29'); // CSV value (SI)
  // HY-8 value (SI) should be the SI-converted twin, not the raw ~16.4 ft value.
  const hy8Si = Number(fields[4]);
  assert.ok(Math.abs(hy8Si - 5.0) < 0.5, `expected an SI elevation near 5 m, got ${hy8Si}`);
});

test('generateDifferencesCsv formats the cells field as a plain integer, not 6 decimals', () => {
  const { doc, pairs } = load();
  // Force a cells mismatch to exercise the field's formatting.
  const pair = { ...pairs[0], csvRow: { ...pairs[0].csvRow, cells: pairs[0].csvRow.cells + 1 } };
  const csv = generateDifferencesCsv([pair], doc, 'name');
  const cellsRow = csv.split('\r\n').find((line) => line.includes(',Cells / barrels,'));
  assert.ok(cellsRow);
  assert.ok(!cellsRow.includes('.000000'));
});

test('generateDifferencesCsv escapes values that look like CSV formulas', () => {
  const { doc, pairs } = load();
  const pair = { ...pairs[0], csvRow: { ...pairs[0].csvRow, name: '=1+1' } };
  const csv = generateDifferencesCsv([pair], doc, 'station');
  assert.ok(csv.includes("'=1+1") || !csv.includes('=1+1,'));
});
