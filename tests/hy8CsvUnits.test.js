import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { M_TO_FT, CMS_TO_CFS, mToFt, cmsToCfs, parseStationMeters } from '../src/hy8/units.js';
import { parseCulvertCsv } from '../src/hy8/csvCulverts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures/hy8/Table1.csv');
// The file is ISO-8859-1 (mojibake degree symbol in unused columns); decode
// losslessly rather than as UTF-8 so no bytes get corrupted or dropped.
const fixture = readFileSync(FIXTURE_PATH, 'latin1');

test('conversion constants and round-trip against fixture values', () => {
  assert.equal(M_TO_FT, 1 / 0.3048);
  assert.equal(CMS_TO_CFS, 1 / (0.3048 * 0.3048 * 0.3048));
  assert.equal(M_TO_FT.toFixed(6), '3.280840');
  assert.equal(CMS_TO_CFS.toFixed(6), '35.314667');
  assert.equal(mToFt(72.3).toFixed(6), '237.204724');
  assert.equal(cmsToCfs(10).toFixed(6), '353.146667');
});

test('parseStationMeters handles the "+-" negative-chainage quirk', () => {
  assert.equal(parseStationMeters('0+-887'), -887);
  assert.equal(parseStationMeters('-2+-601'), -2601);
  assert.equal(parseStationMeters('1+409'), 1409);
  assert.equal(parseStationMeters('-0+887'), -887);
});

test('parseCulvertCsv parses exactly 83 culverts from the fixture', () => {
  const rows = parseCulvertCsv(fixture);
  assert.equal(rows.length, 83);
});

test('parseCulvertCsv CU-JSS-01 row matches known values', () => {
  const rows = parseCulvertCsv(fixture);
  const row = rows.find((r) => r.name === 'CU-JSS-01');
  assert.ok(row);
  assert.equal(row.stationRaw, '-2+-601');
  assert.equal(row.stationM, -2601);
  assert.equal(row.cells, 6);
  assert.equal(row.widthM, 2.5);
  assert.equal(row.riseM, 2.5);
  assert.equal(row.lengthM, 72.3);
  assert.equal(row.usilM, -355.29);
  assert.equal(row.dsilM, -355.94);
});

test('parseCulvertCsv skips the banner row and reads headers by name', () => {
  const rows = parseCulvertCsv(fixture);
  // Every row must have a name and a numeric station.
  for (const row of rows) {
    assert.ok(row.name.length > 0);
    assert.equal(typeof row.stationM, 'number');
    assert.ok(!Number.isNaN(row.stationM));
  }
});
