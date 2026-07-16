import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticalDepth, normalDepth, inletControlHW, outletControlHW, analyzeBoxCulvert } from '../src/hy8/hydraulics.js';

// Reference: 8.2021 ft (2.5 m) square box, one barrel.

test('criticalDepth matches the rectangular-section formula', () => {
  // yc = (q'^2 / g)^(1/3); q' = 100 cfs / 8.2021 ft = 12.192 cfs/ft
  // yc = (12.192^2 / 32.2)^(1/3) = 1.6607 ft
  const yc = criticalDepth(100, 8.2021, 8.2021);
  assert.equal(yc.toFixed(4), Math.cbrt(((100 / 8.2021) ** 2) / 32.2).toFixed(4));
  assert.ok(yc > 1.6 && yc < 1.7);
});

test('criticalDepth is capped at the rise', () => {
  assert.equal(criticalDepth(10000, 8.2021, 8.2021), 8.2021);
});

test('normalDepth satisfies Manning equation at the returned depth', () => {
  const q = 100;
  const b = 8.2021;
  const n = 0.015;
  const s = 0.009;
  const y = normalDepth(q, b, 8.2021, n, s);
  const area = b * y;
  const radius = area / (b + 2 * y);
  const qAtY = (1.486 / n) * area * Math.pow(radius, 2 / 3) * Math.sqrt(s);
  assert.ok(Math.abs(qAtY - q) < 0.01, `Manning capacity at yn should equal q (got ${qAtY})`);
});

test('normalDepth returns null for non-positive slope and caps at the rise when over capacity', () => {
  assert.equal(normalDepth(100, 8.2021, 8.2021, 0.015, 0), null);
  assert.equal(normalDepth(100, 8.2021, 8.2021, 0.015, -0.01), null);
  assert.equal(normalDepth(1e6, 8.2021, 8.2021, 0.015, 0.009), 8.2021);
});

test('inletControlHW submerged form matches the HDS-5 equation directly', () => {
  // Pick q so Q/(A*sqrt(D)) > 4.0 (fully submerged): ratio = 5
  const b = 8.2021;
  const d = 8.2021;
  const area = b * d;
  const q = 5 * area * Math.sqrt(d);
  const s = 0.009;
  const expected = d * (0.04 * 25 + 0.8 - 0.5 * s);
  assert.equal(inletControlHW(q, b, d, s).toFixed(6), expected.toFixed(6));
});

test('inletControlHW is continuous and increasing across the transition zone', () => {
  const b = 8.2021;
  const d = 8.2021;
  const area = b * d;
  const at = (ratio) => inletControlHW(ratio * area * Math.sqrt(d), b, d, 0.009);
  assert.ok(at(3.4) < at(3.6));
  assert.ok(at(3.6) < at(3.9));
  assert.ok(at(3.9) < at(4.1));
});

test('outletControlHW equals ho + H - LS computed by hand', () => {
  const b = 8.2021;
  const d = 8.2021;
  const n = 0.015;
  const L = 237.2;
  const s = 0.009;
  const q = 500;
  const area = b * d;
  const R = area / (2 * (b + d));
  const v = q / area;
  const H = (1 + 0.5 + (29 * n * n * L) / Math.pow(R, 4 / 3)) * ((v * v) / (2 * 32.2));
  const yc = criticalDepth(q, b, d);
  const ho = Math.max(0, (yc + d) / 2);
  const expected = ho + H - L * s;
  assert.equal(outletControlHW(q, b, d, n, L, s, 0).toFixed(6), expected.toFixed(6));
});

test('analyzeBoxCulvert produces a coherent result for a CU-JSS-01-like culvert', () => {
  // CU-JSS-01 post-import: 6 barrels of 2.5m box, L=72.3m, USIL -355.29m,
  // DSIL -355.94m (all in ft here), design flow 10 cms = 353.147 cfs.
  const r = analyzeBoxCulvert({
    qTotal: 353.146667,
    span: 8.2021,
    rise: 8.2021,
    barrels: 6,
    n: 0.015,
    length: 237.204724,
    usil: -1165.649606,
    dsil: -1167.782152,
    twElevation: -1167.782152,
  });

  assert.ok(['inlet', 'outlet'].includes(r.control));
  assert.ok(r.hwDepth > 0, 'headwater depth must be positive');
  assert.ok(r.hwDepth < r.qPerBarrel, 'sanity ceiling');
  assert.equal(r.hwElevation.toFixed(6), (-1165.649606 + r.hwDepth).toFixed(6));
  assert.equal(r.hwOverD.toFixed(6), (r.hwDepth / 8.2021).toFixed(6));
  // ~58.9 cfs per barrel in a 8.2 ft box is a shallow flow: depths under 2 ft.
  assert.ok(r.criticalDepth > 0 && r.criticalDepth < 2);
  assert.ok(r.normalDepth > 0 && r.normalDepth < 2);
  assert.ok(r.outletVelocity > 0);
  // Steep slope (yn < yc) means supercritical: outlet faster than critical velocity.
  const vc = r.qPerBarrel / (8.2021 * r.criticalDepth);
  if (r.normalDepth < r.criticalDepth) assert.ok(r.outletVelocity >= vc - 1e-9);
});

test('analyzeBoxCulvert splits flow across barrels', () => {
  const base = {
    qTotal: 353.146667,
    span: 8.2021,
    rise: 8.2021,
    n: 0.015,
    length: 237.204724,
    usil: 0,
    dsil: -2.13,
    twElevation: -2.13,
  };
  const one = analyzeBoxCulvert({ ...base, barrels: 1 });
  const six = analyzeBoxCulvert({ ...base, barrels: 6 });
  assert.equal(six.qPerBarrel.toFixed(6), (one.qPerBarrel / 6).toFixed(6));
  assert.ok(six.hwDepth < one.hwDepth, 'more barrels must lower the headwater');
});
