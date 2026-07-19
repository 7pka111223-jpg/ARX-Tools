import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8, readFloats } from '../src/hy8/hy8File.js';
import { parseFlowInput, applyFlows } from '../src/hy8/flowUpdater.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');

test('parseFlowInput handles tab/comma/space separated pairs and skips a header', () => {
  const rows = parseFlowInput('Name,Flow (cms)\nCU-JSS-01, 10\nCU-JSS-02\t5.5\nCU-JSS-03 3\n\n');
  assert.deepEqual(rows, [
    { name: 'CU-JSS-01', flowCms: 10 },
    { name: 'CU-JSS-02', flowCms: 5.5 },
    { name: 'CU-JSS-03', flowCms: 3 },
  ]);
});

test('parseFlowInput ignores blank lines and malformed rows', () => {
  const rows = parseFlowInput('\n  \nCU-JSS-01 10\njust-a-name\n');
  assert.deepEqual(rows, [{ name: 'CU-JSS-01', flowCms: 10 }]);
});

test('applyFlows sets DISCHARGERANGE and regenerates DISCHARGEXYDESIGN_Y for CU-JSS-01, 10 cms', () => {
  const doc = parseHy8(fixture);
  const crossing = doc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-01');

  const { doc: patched, updated, unmatchedNames } = applyFlows(doc, [{ name: 'CU-JSS-01', flowCms: 10 }]);

  assert.deepEqual(updated, ['CU-JSS-01']);
  assert.deepEqual(unmatchedNames, []);

  const range = readFloats(patched, crossing.dischargeRangeLine);
  assert.equal(range[0].toFixed(6), '0.000000');
  assert.equal(range[1].toFixed(6), '353.146667');
  assert.equal(range[2].toFixed(6), '529.720001');

  const yValues = crossing.dischargeXYDesignYLines.map((idx) => readFloats(patched, idx)[0]);
  assert.equal(yValues.length, 11);
  assert.equal(yValues[0].toFixed(6), '0.000000');
  assert.equal(yValues[10].toFixed(6), '529.720001');
  assert.ok(yValues.includes(353.146667));
  // Evenly spaced except for the one slot replaced by the exact design value.
  const step = 529.720001 / 10;
  const nonDesignSlots = yValues.filter((v) => v !== 353.146667);
  nonDesignSlots.forEach((v, i) => {
    const expectedIdx = yValues.indexOf(v);
    assert.ok(Math.abs(v - expectedIdx * step) < 0.001);
  });
});

test('applyFlows changes only DISCHARGERANGE and DISCHARGEXYDESIGN_Y lines for the targeted culvert', () => {
  const doc = parseHy8(fixture);
  const { doc: patched } = applyFlows(doc, [{ name: 'CU-JSS-01', flowCms: 10 }]);

  const changedIndices = [];
  for (let i = 0; i < doc.lines.length; i++) {
    if (doc.lines[i] !== patched.lines[i]) changedIndices.push(i);
  }
  const crossing = doc.crossings.find((c) => c.culverts[0].name === 'CU-JSS-01');
  // A patched line whose new value happens to format identically to the old
  // one (e.g. the 0.000000 slot) produces no textual diff, so this is a
  // subset check rather than exact equality.
  const allowed = new Set([crossing.dischargeRangeLine, ...crossing.dischargeXYDesignYLines]);
  for (const idx of changedIndices) {
    assert.ok(allowed.has(idx), `unexpected change at line ${idx}`);
  }
  assert.ok(changedIndices.includes(crossing.dischargeRangeLine));
});

test('applyFlows reports unmatched names without touching the doc', () => {
  const doc = parseHy8(fixture);
  const { doc: patched, updated, unmatchedNames } = applyFlows(doc, [{ name: 'NOT-A-CULVERT', flowCms: 3 }]);
  assert.deepEqual(updated, []);
  assert.deepEqual(unmatchedNames, ['NOT-A-CULVERT']);
  assert.deepEqual(patched.lines, doc.lines);
});
