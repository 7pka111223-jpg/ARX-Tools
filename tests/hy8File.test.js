import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8, serializeHy8, patchValues, readFloats, readQuoted } from '../src/hy8/hy8File.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures/hy8/Section_1.hy8');
const fixture = readFileSync(FIXTURE_PATH, 'utf8');

test('serializeHy8(parseHy8(fixture)) round-trips byte-for-byte', () => {
  const doc = parseHy8(fixture);
  assert.equal(serializeHy8(doc), fixture);
});

test('parseHy8 finds all 84 crossings with NUMCROSSINGS', () => {
  const doc = parseHy8(fixture);
  assert.equal(doc.crossings.length, 84);
  const numCrossingsLine = doc.lines.find((l) => l.startsWith('NUMCROSSINGS'));
  assert.match(numCrossingsLine, /NUMCROSSINGS\s+84/);
});

test('parseHy8 locates CU-JSS-01 crossing/culvert with expected values', () => {
  const doc = parseHy8(fixture);
  const crossing = doc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-01');
  assert.ok(crossing);
  assert.equal(crossing.name, '-2+592');
  assert.equal(readQuoted(doc, crossing.startLine), '-2+592');
  assert.equal(readQuoted(doc, crossing.endLine), '-2+592');

  const culvert = crossing.culverts[0];
  assert.deepEqual(readFloats(doc, culvert.invertDataLine), [0, 16.404199, 237.204724, 14.271654]);
  assert.deepEqual(readFloats(doc, culvert.barrelDataLine), [8.2021, 8.2021, 0.015, 0.015]);

  assert.equal(crossing.dischargeXYDesignCount, 11);
  assert.equal(crossing.dischargeXYDesignYLines.length, 11);
  assert.equal(crossing.numRatingCurveValue, 12);
  assert.equal(crossing.twRatingCurveLines.length, 12);
});

test('patchValues on INVERTDATA changes only that line', () => {
  const doc = parseHy8(fixture);
  const crossing = doc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-01');
  const lineIdx = crossing.culverts[0].invertDataLine;

  const patched = patchValues(doc, [{ lineIndex: lineIdx, floats: [0, -1165.649606, 237.204724, -1167.782152] }]);

  assert.equal(patched.lines.length, doc.lines.length);
  const changedIndices = [];
  for (let i = 0; i < doc.lines.length; i++) {
    if (patched.lines[i] !== doc.lines[i]) changedIndices.push(i);
  }
  assert.deepEqual(changedIndices, [lineIdx]);
  assert.deepEqual(readFloats(patched, lineIdx), [0, -1165.649606, 237.204724, -1167.782152]);

  // Untouched fields on neighboring lines are unaffected.
  assert.equal(patched.lines[lineIdx - 1], doc.lines[lineIdx - 1]);
  assert.equal(patched.lines[lineIdx + 1], doc.lines[lineIdx + 1]);

  // Keyword + padding preserved exactly.
  assert.ok(patched.lines[lineIdx].startsWith('INVERTDATA           '));
});

test('patchValues on a quoted name field replaces only the quoted text', () => {
  const doc = parseHy8(fixture);
  const crossing = doc.crossings[0];
  const patched = patchValues(doc, [{ lineIndex: crossing.startLine, quoted: '1+000' }]);
  assert.equal(readQuoted(patched, crossing.startLine), '1+000');
  assert.equal(patched.lines[crossing.endLine], doc.lines[crossing.endLine]);
});

test('patchValues on an integer field (NUMBEROFBARRELS) replaces only the count', () => {
  const doc = parseHy8(fixture);
  const crossing = doc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-01');
  const lineIdx = crossing.culverts[0].numberOfBarrelsLine;
  assert.equal(doc.lines[lineIdx].trim(), 'NUMBEROFBARRELS      6');
  const patched = patchValues(doc, [{ lineIndex: lineIdx, ints: [3] }]);
  assert.equal(patched.lines[lineIdx].trim(), 'NUMBEROFBARRELS      3');
});

test('serializeHy8 has no trailing CRLF, matching the source file', () => {
  const doc = parseHy8(fixture);
  assert.ok(fixture.endsWith('ENDPROJECTFILE'));
  assert.ok(!fixture.endsWith('\r\n'));
  assert.ok(serializeHy8(doc).endsWith('ENDPROJECTFILE'));
});
