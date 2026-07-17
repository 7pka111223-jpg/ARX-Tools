import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  criticalDepth,
  normalDepth,
  inletControlHW,
  outletControlHW,
  outletControlFullFlow,
  analyzeBoxCulvert,
} from '../src/hy8/hydraulics.js';

// Reference: 8.2021 ft (2.5 m) square box, one barrel.

test('criticalDepth matches the rectangular-section formula', () => {
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
  // ratio = 5 (fully submerged): the regression dominates the energy floor.
  const b = 8.2021;
  const d = 8.2021;
  const area = b * d;
  const q = 5 * area * Math.sqrt(d);
  const s = 0.009;
  const expected = d * (0.04 * 25 + 0.8 - 0.5 * s);
  assert.equal(inletControlHW(q, b, d, s).toFixed(6), expected.toFixed(6));
});

test('inletControlHW at low flow equals the energy-based value (HY-8 behavior)', () => {
  // CU-JSS-01 per barrel: the regression sits below yc + 1.5*Vc^2/2g there.
  const q = 353.146667 / 6;
  const b = 8.2021;
  const d = 8.2021;
  const yc = criticalDepth(q, b, d);
  const vc = q / (b * yc);
  const expected = yc + (1.5 * vc * vc) / (2 * 32.2);
  assert.equal(inletControlHW(q, b, d, 0.008991).toFixed(6), expected.toFixed(6));
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

test('outletControlFullFlow equals ho + H - LS computed by hand', () => {
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
  assert.equal(outletControlFullFlow(q, b, d, n, L, s, 0).toFixed(6), expected.toFixed(6));
});

test('outletControlHW on a steep low-tailwater barrel equals the inlet energy head', () => {
  // Steep (yn < yc): downstream conditions cannot raise the pool, so the
  // profile-based outlet control collapses to yc + (1+ke) Vc^2/2g.
  const q = 353.146667 / 6;
  const b = 8.2021;
  const d = 8.2021;
  const yc = criticalDepth(q, b, d);
  const vc = q / (b * yc);
  const expected = yc + (1.5 * vc * vc) / (2 * 32.2);
  assert.equal(outletControlHW(q, b, d, 0.015, 237.2, 0.008991, 0).toFixed(6), expected.toFixed(6));
});

test('outletControlHW grows with culvert length on a horizontal barrel (friction via profile)', () => {
  // Horizontal slope: backwater profile accumulates friction, so a longer
  // barrel must produce a higher outlet-control headwater.
  const q = 200;
  const hwShort = outletControlHW(q, 8.2021, 8.2021, 0.015, 50, 0, 0);
  const hwLong = outletControlHW(q, 8.2021, 8.2021, 0.015, 500, 0, 0);
  assert.ok(hwLong > hwShort, `${hwLong} should exceed ${hwShort}`);
});

test('outletControlHW uses the full-flow equation when tailwater submerges the crown', () => {
  const q = 500;
  const tw = 10; // above the 8.2 ft rise
  const viaDispatch = outletControlHW(q, 8.2021, 8.2021, 0.015, 237.2, 0.009, tw);
  const direct = outletControlFullFlow(q, 8.2021, 8.2021, 0.015, 237.2, 0.009, tw);
  assert.equal(viaDispatch, direct);
});

test('analyzeBoxCulvert matches HY-8 for CU-JSS-01 (verified against real HY-8 output)', () => {
  // HY-8 (Windows, user-verified): HW elev -354.68 m, inlet control, 2.38 m/s.
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
  const ftToM = (x) => x * 0.3048;
  assert.equal(r.control, 'inlet');
  assert.ok(Math.abs(ftToM(r.hwElevation) - -354.68) < 0.02, `HW elev ${ftToM(r.hwElevation)} should be within 2 cm of -354.68`);
  assert.ok(Math.abs(ftToM(r.outletVelocity) - 2.38) < 0.02, `outlet velocity ${ftToM(r.outletVelocity)} should be within 0.02 of 2.38`);
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

test('outlet velocity approaches the normal-depth velocity on a long steep barrel', () => {
  const q = 353.146667 / 6;
  const b = 8.2021;
  const yn = normalDepth(q, b, 8.2021, 0.015, 0.008991);
  const r = analyzeBoxCulvert({
    qTotal: 353.146667,
    span: b,
    rise: 8.2021,
    barrels: 6,
    n: 0.015,
    length: 237.204724,
    usil: -1165.649606,
    dsil: -1167.782152,
    twElevation: -1167.782152,
  });
  const vAtYn = q / (b * yn);
  assert.ok(Math.abs(r.outletVelocity - vAtYn) / vAtYn < 0.02, `${r.outletVelocity} vs ${vAtYn}`);
});
