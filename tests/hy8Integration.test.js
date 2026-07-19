import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8, serializeHy8, readFloats, readQuoted, readInt } from '../src/hy8/hy8File.js';
import { parseCulvertCsv } from '../src/hy8/csvCulverts.js';
import { mapCulverts } from '../src/hy8/mapper.js';
import { applyGeometryImport } from '../src/hy8/applyImport.js';
import { applyFlows } from '../src/hy8/flowUpdater.js';
import { mToFt, cmsToCfs } from '../src/hy8/units.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

const SAMPLE_NAMES = ['CU-JSS-01', 'CU-JSS-10', 'CU-JSS-80'];
const SAMPLE_FLOWS_CMS = { 'CU-JSS-01': 10, 'CU-JSS-10': 4, 'CU-JSS-80': 7.5 };

function runPipeline() {
  const doc = parseHy8(hy8Fixture);
  const csvRows = parseCulvertCsv(csvFixture);
  const { pairs } = mapCulverts(csvRows, doc, { mode: 'name' });

  const samplePairs = pairs.filter((p) => SAMPLE_NAMES.includes(p.culvert.name));
  assert.equal(samplePairs.length, 3, 'expected all 3 sample culverts to be present and mapped');

  const geometryPatched = applyGeometryImport(doc, samplePairs, 'name');

  const flows = SAMPLE_NAMES.map((name) => ({ name, flowCms: SAMPLE_FLOWS_CMS[name] }));
  const { doc: finalDoc, updated, unmatchedNames } = applyFlows(geometryPatched, flows);

  return { originalDoc: doc, finalDoc, samplePairs, updated, unmatchedNames };
}

test('headless pipeline: only the 3 sample culverts change, everything else is byte-identical', () => {
  const { originalDoc, finalDoc } = runPipeline();
  assert.equal(originalDoc.lines.length, finalDoc.lines.length);

  const touchedLineSets = originalDoc.crossings
    .filter((c) => SAMPLE_NAMES.includes(c.culverts[0].name))
    .map((c) => {
      const culvert = c.culverts[0];
      return new Set([
        c.startLine,
        c.endLine,
        c.dischargeRangeLine,
        ...c.dischargeXYDesignYLines,
        c.channelGeometryLine,
        ...c.twRatingCurveLines,
        c.roadwayShapeLine,
        c.roadWidthLine,
        c.surfaceLine,
        c.roadwaySecDataLine,
        ...c.roadwayPointLines,
        culvert.startLine,
        culvert.endLine,
        culvert.invertDataLine,
        culvert.barrelDataLine,
        culvert.numberOfBarrelsLine,
      ]);
    });
  const allowedLines = new Set(touchedLineSets.flatMap((s) => [...s]));

  const changedIndices = [];
  for (let i = 0; i < originalDoc.lines.length; i++) {
    if (originalDoc.lines[i] !== finalDoc.lines[i]) changedIndices.push(i);
  }
  for (const idx of changedIndices) {
    assert.ok(allowedLines.has(idx), `unexpected change outside the 3 sample culverts at line ${idx}: ${finalDoc.lines[idx]}`);
  }
  assert.ok(changedIndices.length > 0);
});

test('CU-JSS-01 INVERTDATA matches SI->US conversion of the CSV row to 6 d.p.', () => {
  const { finalDoc, samplePairs } = runPipeline();
  const pair = samplePairs.find((p) => p.culvert.name === 'CU-JSS-01');
  const invert = readFloats(finalDoc, pair.culvert.invertDataLine);

  const expectedUsil = mToFt(-355.29);
  const expectedOutlet = mToFt(72.3);
  const expectedDsil = mToFt(-355.94);

  assert.equal(invert[0], 0);
  assert.equal(invert[1].toFixed(6), expectedUsil.toFixed(6));
  assert.equal(invert[2].toFixed(6), expectedOutlet.toFixed(6));
  assert.equal(invert[3].toFixed(6), expectedDsil.toFixed(6));

  // Sanity-check against the plan's hand-derived approximate values.
  assert.ok(Math.abs(invert[1] - -1165.649606) < 1e-6);
  assert.ok(Math.abs(invert[3] - -1167.782152) < 1e-6);
});

test('CU-JSS-01 crossing name becomes the CSV station string in both STARTCROSSING and ENDCROSSING', () => {
  const { finalDoc, samplePairs } = runPipeline();
  const pair = samplePairs.find((p) => p.culvert.name === 'CU-JSS-01');
  assert.equal(readQuoted(finalDoc, pair.crossing.startLine), '-2+-601');
  assert.equal(readQuoted(finalDoc, pair.crossing.endLine), '-2+-601');
});

test('CU-JSS-01 span/rise/cells/channel/tailwater/flow all reflect the CSV row', () => {
  const { finalDoc, samplePairs } = runPipeline();
  const pair = samplePairs.find((p) => p.culvert.name === 'CU-JSS-01');
  const { crossing, culvert } = pair;

  const barrel = readFloats(finalDoc, culvert.barrelDataLine);
  assert.equal(barrel[0].toFixed(6), mToFt(2.5).toFixed(6));
  assert.equal(barrel[1].toFixed(6), mToFt(2.5).toFixed(6));
  // Manning's n (last two BARRELDATA fields) must be preserved, not overwritten.
  assert.equal(barrel[2], 0.015);
  assert.equal(barrel[3], 0.015);

  assert.equal(readInt(finalDoc, culvert.numberOfBarrelsLine), 6);

  const channelGeom = readFloats(finalDoc, crossing.channelGeometryLine);
  assert.equal(channelGeom[4].toFixed(6), mToFt(-355.94).toFixed(6));

  for (const lineIndex of crossing.twRatingCurveLines) {
    const row = readFloats(finalDoc, lineIndex);
    assert.equal(row[0].toFixed(6), mToFt(-355.94).toFixed(6));
  }

  const range = readFloats(finalDoc, crossing.dischargeRangeLine);
  assert.equal(range[0].toFixed(6), '0.000000');
  assert.equal(range[1].toFixed(6), cmsToCfs(10).toFixed(6));
  assert.equal(range[2].toFixed(6), cmsToCfs(15).toFixed(6));
});

test('CU-JSS-01 roadway becomes the standard roadway (crest = USIL + rise + 2 m)', () => {
  const { finalDoc, samplePairs } = runPipeline();
  const pair = samplePairs.find((p) => p.culvert.name === 'CU-JSS-01');
  const { crossing } = pair;

  // CSV row: USIL -355.29, rise 2.5 -> crest -350.79 m; length 20 m, width 8 m.
  const crestFt = mToFt(-355.29 + 2.5 + 2);
  const secData = readFloats(finalDoc, crossing.roadwaySecDataLine);
  assert.equal(secData[0].toFixed(6), '0.000000');
  assert.equal(secData[1].toFixed(6), crestFt.toFixed(6));

  for (const lineIndex of crossing.roadwayPointLines) {
    const point = readFloats(finalDoc, lineIndex);
    assert.equal(point[0].toFixed(6), mToFt(20).toFixed(6));
    assert.equal(point[1].toFixed(6), crestFt.toFixed(6));
  }

  assert.equal(readFloats(finalDoc, crossing.roadWidthLine)[0].toFixed(6), mToFt(8).toFixed(6));
  assert.equal(readInt(finalDoc, crossing.roadwayShapeLine), 1); // constant roadway elevation
  assert.equal(readInt(finalDoc, crossing.surfaceLine), 1); // paved
});

test('NUMCROSSINGS and the untouched CU-JSS-38 crossing are unchanged', () => {
  const { originalDoc, finalDoc } = runPipeline();
  const numCrossingsLine = originalDoc.lines.findIndex((l) => l.startsWith('NUMCROSSINGS'));
  assert.equal(finalDoc.lines[numCrossingsLine], originalDoc.lines[numCrossingsLine]);

  const cu38 = originalDoc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-38');
  for (let i = cu38.startLine; i <= cu38.endLine; i++) {
    assert.equal(finalDoc.lines[i], originalDoc.lines[i], `CU-JSS-38 line ${i} should be untouched`);
  }
});

test('serializeHy8 of the final doc preserves CRLF and the no-trailing-newline ending', () => {
  const { finalDoc } = runPipeline();
  const text = serializeHy8(finalDoc);
  assert.ok(text.startsWith('HY8PROJECTFILE80\r\n'));
  assert.ok(text.endsWith('ENDPROJECTFILE'));
  assert.ok(!text.endsWith('\r\n'));
});

test('applyFlows matched all 3 sample names with no unmatched names', () => {
  const { updated, unmatchedNames } = runPipeline();
  assert.deepEqual(updated.sort(), [...SAMPLE_NAMES].sort());
  assert.deepEqual(unmatchedNames, []);
});
