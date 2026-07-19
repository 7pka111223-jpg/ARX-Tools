import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXlsx, buildCreatorTemplateXlsx, CREATOR_TEMPLATE_ROWS } from '../src/hy8/xlsxWriter.js';
import { parseXlsxRows } from '../src/hy8/xlsx.js';
import { parseCreatorRows } from '../src/hy8/creatorRows.js';
import { buildHy8Project } from '../src/hy8/hy8Writer.js';
import { parseHy8, readFloats, readInt, readQuoted } from '../src/hy8/hy8File.js';
import { buildComputedSummary } from '../src/hy8/summary.js';
import { mToFt, cmsToCfs } from '../src/hy8/units.js';

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('the generated .xlsx template round-trips through our own reader', async () => {
  const grid = await parseXlsxRows(toArrayBuffer(buildCreatorTemplateXlsx()));
  assert.equal(grid[1][0], 'Name');
  assert.equal(grid[1][8], 'Slope (m/m)');
  assert.equal(grid[2][0], 'CU-EX-01');
  assert.equal(Number(grid[2][1]), 10);
  assert.equal(Number(grid[3][8]), 0.005);
});

test('buildXlsx escapes XML special characters in strings', async () => {
  const grid = await parseXlsxRows(toArrayBuffer(buildXlsx([['a<b>&"c"', 1.5]])));
  assert.equal(grid[0][0], 'a<b>&"c"');
  assert.equal(Number(grid[0][1]), 1.5);
});

test('parseCreatorRows reads both invert modes from the template examples', () => {
  const { culverts, errors } = parseCreatorRows(CREATOR_TEMPLATE_ROWS.map((r) => r.map(String)));
  assert.deepEqual(errors, []);
  assert.equal(culverts.length, 2);

  const direct = culverts[0];
  assert.equal(direct.name, 'CU-EX-01');
  assert.equal(direct.invertSource, 'inverts');
  assert.equal(direct.usilM, 5.2);
  assert.equal(direct.dsilM, 4.85);
  assert.equal(direct.crestM, 5.2 + 2.5 + 2);

  // Slope mode: DSIL = 0, USIL = slope × length.
  const sloped = culverts[1];
  assert.equal(sloped.name, 'CU-EX-02');
  assert.equal(sloped.invertSource, 'slope');
  assert.equal(sloped.dsilM, 0);
  assert.equal(sloped.usilM.toFixed(6), (0.005 * 40).toFixed(6));
  assert.equal(sloped.crestM.toFixed(6), (0.2 + 1.5 + 2).toFixed(6));
});

test('parseCreatorRows flags bad rows without dropping the good ones', () => {
  const header = ['Name', 'Design Flow (m3/s)', 'Cells', 'Width (m)', 'Rise (m)', 'Length (m)', 'USIL (m)', 'DSIL (m)', 'Slope (m/m)'];
  const { culverts, errors } = parseCreatorRows([
    header,
    ['OK-1', '3', '1', '2', '2', '30', '10', '9.8', ''],
    ['NO-INVERTS', '3', '1', '2', '2', '30', '', '', ''],
    ['HALF-INVERTS', '3', '1', '2', '2', '30', '10', '', ''],
    ['OK-1', '3', '1', '2', '2', '30', '10', '9.8', ''],
    ['BAD-SIZE', '3', '1', '0', '2', '30', '10', '9.8', ''],
  ]);
  assert.equal(culverts.length, 1);
  assert.equal(culverts[0].name, 'OK-1');
  assert.equal(errors.length, 4);
  assert.ok(errors.find((e) => e.name === 'NO-INVERTS').message.includes('slope'));
  assert.ok(errors.find((e) => e.name === 'HALF-INVERTS').message.includes('both'));
  assert.ok(errors.find((e) => e.name === 'OK-1').message.includes('duplicate'));
  assert.ok(errors.find((e) => e.name === 'BAD-SIZE').message.includes('positive'));
});

const SAMPLE = [
  { name: 'CU-NEW-01', flowCms: 10, cells: 2, widthM: 2.5, riseM: 2.5, lengthM: 72.3, usilM: 5.2, dsilM: 4.85 },
  { name: 'CU-NEW-02', flowCms: 5, cells: 1, widthM: 1.5, riseM: 1.5, lengthM: 40, usilM: 0.2, dsilM: 0 },
];

function buildSample() {
  let n = 0;
  return buildHy8Project(SAMPLE, {
    now: Date.UTC(2026, 6, 19),
    makeGuid: () => `00000000-0000-4000-8000-00000000000${n++}`,
  });
}

test('buildHy8Project output has the HY-8 file frame (CRLF, no trailing newline)', () => {
  const text = buildSample();
  assert.ok(text.startsWith('HY8PROJECTFILE80\r\n\r\nUNITS'));
  assert.ok(text.endsWith('ENDPROJECTFILE'));
  assert.ok(!text.includes('\n\n')); // pure CRLF — no bare LF pairs
  const numCrossings = /NUMCROSSINGS\s+(\d+)/.exec(text);
  assert.equal(numCrossings[1], '2');
});

test('buildHy8Project output parses with parseHy8 and stores US-unit values', () => {
  const doc = parseHy8(buildSample());
  assert.equal(doc.crossings.length, 2);

  const crossing = doc.crossings[0];
  const culvert = crossing.culverts[0];
  assert.equal(crossing.name, 'CU-NEW-01');
  assert.equal(culvert.name, 'CU-NEW-01');
  assert.equal(culvert.culvertShape, 2); // box

  const invert = readFloats(doc, culvert.invertDataLine);
  assert.equal(invert[1].toFixed(6), mToFt(5.2).toFixed(6));
  assert.equal(invert[2].toFixed(6), mToFt(72.3).toFixed(6));
  assert.equal(invert[3].toFixed(6), mToFt(4.85).toFixed(6));

  const barrel = readFloats(doc, culvert.barrelDataLine);
  assert.equal(barrel[0].toFixed(6), mToFt(2.5).toFixed(6));
  assert.equal(barrel[1].toFixed(6), mToFt(2.5).toFixed(6));
  assert.equal(barrel[2], 0.015);
  assert.equal(readInt(doc, culvert.numberOfBarrelsLine), 2);

  const range = readFloats(doc, crossing.dischargeRangeLine);
  assert.equal(range[1].toFixed(6), cmsToCfs(10).toFixed(6));
  assert.equal(range[2].toFixed(6), cmsToCfs(15).toFixed(6));
  assert.equal(crossing.dischargeXYDesignYLines.length, 11);

  // Constant tailwater at the outlet invert, 12 rating-curve rows.
  assert.equal(readFloats(doc, crossing.channelGeometryLine)[4].toFixed(6), mToFt(4.85).toFixed(6));
  assert.equal(crossing.twRatingCurveLines.length, 12);
  for (const lineIndex of crossing.twRatingCurveLines) {
    assert.equal(readFloats(doc, lineIndex)[0].toFixed(6), mToFt(4.85).toFixed(6));
  }

  assert.equal(readQuoted(doc, crossing.startLine), 'CU-NEW-01');
  assert.equal(readQuoted(doc, crossing.endLine), 'CU-NEW-01');
});

test('created crossings carry the standard roadway', () => {
  const doc = parseHy8(buildSample());
  for (const [i, spec] of SAMPLE.entries()) {
    const crossing = doc.crossings[i];
    const crestFt = mToFt(spec.usilM + spec.riseM + 2);
    assert.equal(readInt(doc, crossing.roadwayShapeLine), 1); // constant elevation
    assert.equal(readInt(doc, crossing.surfaceLine), 1); // paved
    assert.equal(readFloats(doc, crossing.roadWidthLine)[0].toFixed(6), mToFt(8).toFixed(6));
    assert.deepEqual(
      readFloats(doc, crossing.roadwaySecDataLine).map((v) => v.toFixed(6)),
      ['0.000000', crestFt.toFixed(6)]
    );
    assert.equal(crossing.roadwayPointLines.length, 1);
    assert.deepEqual(
      readFloats(doc, crossing.roadwayPointLines[0]).map((v) => v.toFixed(6)),
      [mToFt(20).toFixed(6), crestFt.toFixed(6)]
    );
  }
});

test('a created project is analyzable by the in-browser HDS-5 summary', () => {
  const doc = parseHy8(buildSample());
  const rows = buildComputedSummary(doc);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.error, null);
    assert.ok(Number.isFinite(row.hwElevationM));
    assert.ok(Number.isFinite(row.outletVelocityMs));
    assert.ok(row.hwOverD > 0);
  }
});

test('keyword column layout matches HY-8 (values start at column 22)', () => {
  const text = buildSample();
  for (const line of text.split('\r\n')) {
    const m = /^([A-Z][A-Z0-9_]*)\s/.exec(line);
    if (!m || line.trim() === m[1]) continue;
    const valueStart = line.length - line.slice(m[1].length).trimStart().length;
    assert.equal(valueStart, Math.max(21, m[1].length + 1), `bad padding on: ${JSON.stringify(line)}`);
  }
});
