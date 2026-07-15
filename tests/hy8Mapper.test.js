import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8 } from '../src/hy8/hy8File.js';
import { parseCulvertCsv } from '../src/hy8/csvCulverts.js';
import { mapCulverts } from '../src/hy8/mapper.js';
import { diffPair } from '../src/hy8/differ.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

function load() {
  return { doc: parseHy8(hy8Fixture), rows: parseCulvertCsv(csvFixture) };
}

test('name mode maps all 83 CSV rows, leaving CU-JSS-38 unmatched on the HY-8 side', () => {
  const { doc, rows } = load();
  const { pairs, unmatchedCsv, unmatchedHy8 } = mapCulverts(rows, doc, { mode: 'name' });
  assert.equal(pairs.length, 83);
  assert.equal(unmatchedCsv.length, 0);
  assert.equal(unmatchedHy8.length, 1);
  assert.equal(unmatchedHy8[0].culverts[0].name, 'CU-JSS-38');
});

test('name mode is case-insensitive and trims whitespace', () => {
  const { doc, rows } = load();
  const tweaked = rows.map((r) => (r.name === 'CU-JSS-01' ? { ...r, name: '  cu-jss-01  ' } : r));
  const { pairs } = mapCulverts(tweaked, doc, { mode: 'name' });
  const pair = pairs.find((p) => p.culvert.name === 'CU-JSS-01');
  assert.ok(pair);
});

test('station mode with 15m tolerance pairs 1+409 with 1+410', () => {
  const { doc, rows } = load();
  const { pairs } = mapCulverts(rows, doc, { mode: 'station', toleranceM: 15 });
  const pair = pairs.find((p) => p.csvRow.name === 'CU-JSS-10');
  assert.ok(pair, 'CU-JSS-10 (CSV station 1+409) should match an HY-8 crossing within 15m');
  assert.equal(pair.crossing.name, '1+410');
});

test('station mode matches CU-JSS-01 (-2+-601 vs -2+592, 9m apart) within default tolerance', () => {
  const { doc, rows } = load();
  const { pairs, unmatchedCsv } = mapCulverts(rows, doc, { mode: 'station', toleranceM: 15 });
  const pair = pairs.find((p) => p.csvRow.name === 'CU-JSS-01');
  assert.ok(pair, 'CU-JSS-01 should be matched at 9m, within the 15m tolerance');
  assert.equal(pair.crossing.name, '-2+592');
  assert.ok(!unmatchedCsv.find((r) => r.name === 'CU-JSS-01'));
});

test('station mode leaves far-apart rows unmatched, each side used at most once', () => {
  const { doc, rows } = load();
  const { pairs, unmatchedCsv, unmatchedHy8 } = mapCulverts(rows, doc, { mode: 'station', toleranceM: 15 });
  const usedCsv = new Set(pairs.map((p) => p.csvRow));
  const usedHy8 = new Set(pairs.map((p) => p.crossing));
  assert.equal(usedCsv.size, pairs.length);
  assert.equal(usedHy8.size, pairs.length);
  assert.equal(pairs.length + unmatchedCsv.length, rows.length);
  assert.equal(pairs.length + unmatchedHy8.length, doc.crossings.length);
});

test('diffPair on CU-JSS-01 reports USIL as different but not span/rise', () => {
  const { doc, rows } = load();
  const { pairs } = mapCulverts(rows, doc, { mode: 'name' });
  const pair = pairs.find((p) => p.culvert.name === 'CU-JSS-01');
  const diffs = diffPair(pair, doc, 'name');

  const fields = diffs.map((d) => d.field);
  assert.ok(fields.includes('USIL'));
  const usil = diffs.find((d) => d.field === 'USIL');
  assert.equal(usil.csvValue, -355.29);
  assert.equal(usil.hy8Value, 16.404199);
  // hy8ValueSI is the SI-converted twin of hy8Value, for SI-only display.
  assert.equal(usil.hy8ValueSI.toFixed(6), (16.404199 * 0.3048).toFixed(6));

  assert.ok(!fields.includes('span'));
  assert.ok(!fields.includes('rise'));
  assert.ok(!fields.includes('length'));
  assert.ok(!fields.includes('cells'));
});

test('diffPair reports the station label difference in name mode', () => {
  const { doc, rows } = load();
  const { pairs } = mapCulverts(rows, doc, { mode: 'name' });
  const pair = pairs.find((p) => p.culvert.name === 'CU-JSS-01');
  const diffs = diffPair(pair, doc, 'name');
  const station = diffs.find((d) => d.field === 'station');
  assert.ok(station);
  assert.equal(station.csvValue, '-2+-601');
  assert.equal(station.hy8Value, '-2+592');
});
