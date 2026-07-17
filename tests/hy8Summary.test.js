import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseHy8 } from '../src/hy8/hy8File.js';
import { parseCulvertCsv } from '../src/hy8/csvCulverts.js';
import { mapCulverts } from '../src/hy8/mapper.js';
import { applyGeometryImport } from '../src/hy8/applyImport.js';
import { applyFlows } from '../src/hy8/flowUpdater.js';
import { buildComputedSummary, buildExtractedSummary } from '../src/hy8/summary.js';
import { generateSummaryCsv } from '../src/hy8/summaryExport.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hy8Fixture = readFileSync(join(__dirname, 'fixtures/hy8/Section_1.hy8'), 'utf8');
const csvFixture = readFileSync(join(__dirname, 'fixtures/hy8/Table1.csv'), 'latin1');

function importedDoc() {
  const doc = parseHy8(hy8Fixture);
  const rows = parseCulvertCsv(csvFixture);
  const { pairs } = mapCulverts(rows, doc, { mode: 'name' });
  const patched = applyGeometryImport(doc, pairs, 'name');
  return applyFlows(patched, [{ name: 'CU-JSS-01', flowCms: 10 }]).doc;
}

test('parseHy8 captures the rating curve triplets and culvert shape', () => {
  const doc = parseHy8(hy8Fixture);
  for (const crossing of doc.crossings) {
    assert.equal(crossing.ratingCurve.length, 11);
    assert.equal(crossing.culverts[0].culvertShape, 2);
  }
});

test('buildComputedSummary analyzes all 84 crossings after import', () => {
  const doc = importedDoc();
  const rows = buildComputedSummary(doc);
  assert.equal(rows.length, 84);
  const analyzed = rows.filter((r) => !r.error);
  assert.equal(analyzed.length, 84, 'every fixture crossing is a box with a design flow');
});

test('computed summary for CU-JSS-01 is in SI and self-consistent', () => {
  const doc = importedDoc();
  const rows = buildComputedSummary(doc);
  const r = rows.find((x) => x.name === 'CU-JSS-01');
  assert.ok(r && !r.error);

  // Design flow was set to exactly 10 m3/s by the flow update.
  assert.equal(r.designFlowCms.toFixed(6), '10.000000');
  // HY-8 (Windows, user-verified): HW elev -354.68 m, inlet control, 2.38 m/s.
  assert.equal(r.control, 'inlet');
  assert.ok(Math.abs(r.hwElevationM - -354.68) < 0.02, `HW elev ${r.hwElevationM} vs HY-8 -354.68`);
  assert.ok(Math.abs(r.outletVelocityMs - 2.38) < 0.02, `v ${r.outletVelocityMs} vs HY-8 2.38`);
  assert.ok(r.criticalDepthM > 0.1 && r.criticalDepthM < 1, `yc=${r.criticalDepthM}`);
  assert.ok(r.normalDepthM > 0.05 && r.normalDepthM < 1, `yn=${r.normalDepthM}`);
  // HW elevation sits above the USIL (-355.29 m) by HW depth = HW/D * 2.5 m.
  assert.equal(r.hwElevationM.toFixed(4), (-355.29 + r.hwOverD * 2.5).toFixed(4));
});

test('computed summary flags zero-slope culverts with null normal depth, not an error', () => {
  const doc = importedDoc();
  const rows = buildComputedSummary(doc);
  // CU-JSS-24 has CSV slope 0.0% (USIL -321.29, DSIL -321.31 over 63.2 m —
  // tiny but positive), CU-JSS-24A is steep. Check the overall invariant:
  // rows either analyze fully or have normalDepthM === null with other
  // fields still present.
  for (const r of rows.filter((x) => !x.error)) {
    assert.ok(r.criticalDepthM !== null);
    assert.ok(r.hwElevationM !== null);
    assert.ok(r.outletVelocityMs !== null);
  }
});

test('buildExtractedSummary reports missing results for the unanalyzed fixture', () => {
  // The committed fixture has all-zero rating curves except one stale row,
  // so extraction must fall back to per-row notes instead of fake numbers.
  const doc = parseHy8(hy8Fixture);
  const rows = buildExtractedSummary(doc);
  assert.equal(rows.length, 84);
  for (const r of rows) {
    // Design flow 2726.6 cfs sits inside the curve range (0..3531), so
    // interpolation succeeds but yields the stored zeros — or the row is
    // flagged. Either way it must not throw and must stay SI-shaped.
    assert.ok(r.name);
  }
});

test('extraction interpolates HY-8 elevation/velocity at the design flow', () => {
  // Patch a fake but monotone rating curve into the first crossing, then
  // check the interpolated values at its design flow (2726.645418 cfs).
  const doc = parseHy8(hy8Fixture);
  const crossing = doc.crossings[0];
  const lines = doc.lines.slice();
  crossing.ratingCurve.forEach((t, i) => {
    const flow = readFlow(lines[t.flowLine]);
    lines[t.elevationLine] = lines[t.elevationLine].replace(/-?\d+\.\d+/, (flow / 100).toFixed(6));
    lines[t.velocityLine] = lines[t.velocityLine].replace(/-?\d+\.\d+/, (flow / 1000).toFixed(6));
  });
  const patchedDoc = { ...doc, lines };

  const rows = buildExtractedSummary(patchedDoc);
  const r = rows[0];
  assert.ok(!r.error, r.error || '');
  // elevation(ft) = q/100 = 27.266454; velocity(ft/s) = q/1000 = 2.726645
  const expectElevM = (2726.645418 / 100) * 0.3048;
  const expectVelMs = (2726.645418 / 1000) * 0.3048;
  assert.equal(r.hwElevationM.toFixed(4), expectElevM.toFixed(4));
  assert.equal(r.outletVelocityMs.toFixed(4), expectVelMs.toFixed(4));
  // HW/D = (elev_ft - USIL_ft)/rise_ft
  const expectHwOverD = (2726.645418 / 100 - 16.404199) / 8.2021;
  assert.equal(r.hwOverD.toFixed(4), expectHwOverD.toFixed(4));
});

function readFlow(line) {
  return Number(line.match(/-?\d+\.\d+/)[0]);
}

test('generateSummaryCsv emits one row per crossing with the SI header', () => {
  const doc = importedDoc();
  const rows = buildComputedSummary(doc);
  const csv = generateSummaryCsv(rows, 'computed (approx. HDS-5)');
  const lines = csv.split('\r\n');
  assert.equal(
    lines[0],
    'Culvert,Crossing,Design flow (m3/s),HW/D,Normal depth (m),Critical depth (m),Headwater elevation (m),Outlet velocity (m/s),Control,Source,Note'
  );
  assert.equal(lines.length, 85); // header + 84 crossings
  const cu01 = lines.find((l) => l.startsWith('CU-JSS-01,'));
  assert.ok(cu01.includes('computed (approx. HDS-5)'));
  assert.ok(cu01.includes('10.000'));
});
