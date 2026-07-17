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

test('inletControlHW at low flow equals the form-1 regression (HY-8 behavior)', () => {
  // CU-JAS-06 at its design flow: HY-8's table value is the pure form-1
  // regression — hc + K*(Q/(A sqrt(D)))^M * D - 0.5*S*D.
  const q = 272.27608;
  const b = 8.2021;
  const d = 8.2021;
  const s = (592.847769 - 588.845144) / 282.480315;
  const yc = criticalDepth(q, b, d);
  const vc = q / (b * yc);
  const hc = yc + (vc * vc) / (2 * 32.2);
  const ratio = q / (b * d * Math.sqrt(d));
  const expected = hc + (0.061 * Math.pow(ratio, 0.75) - 0.5 * s) * d;
  assert.equal(inletControlHW(q, b, d, s).toFixed(6), expected.toFixed(6));
  // HY-8's printed value for this row is 1.66 m.
  assert.ok(Math.abs(inletControlHW(q, b, d, s) * 0.3048 - 1.66) < 0.01);
});

test('inletControlHW deep submergence follows the orifice extension (HY-8 rows 50-80 cms)', () => {
  // CU-JAS-06 geometry; HY-8's inlet control depths: 50->10.83, 80->25.76 m.
  const b = 8.2021;
  const d = 8.2021;
  const s = (592.847769 - 588.845144) / 282.480315;
  const CFS = 35.31466672148859;
  assert.ok(Math.abs(inletControlHW(50 * CFS, b, d, s) * 0.3048 - 10.83) < 0.1);
  assert.ok(Math.abs(inletControlHW(80 * CFS, b, d, s) * 0.3048 - 25.76) < 0.2);
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

test('outletControlHW is 0 on a steep low-tailwater barrel (HY-8 prints "0.0*")', () => {
  // Steep (yn < yc): HY-8 does not compute outlet control at all there, so
  // inlet control governs by construction.
  const q = 353.146667 / 6;
  assert.equal(outletControlHW(q, 8.2021, 8.2021, 0.015, 237.2, 0.008991, 0), 0);
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
  assert.ok(Math.abs(ftToM(r.hwElevation) - -354.68) < 0.03, `HW elev ${ftToM(r.hwElevation)} should be within 3 cm of -354.68`);
  assert.ok(Math.abs(ftToM(r.outletVelocity) - 2.38) < 0.02, `outlet velocity ${ftToM(r.outletVelocity)} should be within 0.02 of 2.38`);
});

test('analyzeBoxCulvert matches the HY-8 report rows for CU-JAS-06 below overtopping', () => {
  // Section_3 report, CU-JAS-06 (single 2.5 m barrel, L=86.1 m, S=1.42%):
  // HY-8's own summary table rows [Q cms, HW elev m, outlet velocity m/s].
  // Rows at 90/100 cms are excluded: HY-8 diverts flow over the roadway
  // there, which this method deliberately does not model.
  const CFS = 35.31466672148859;
  const geom = {
    span: 8.2021,
    rise: 8.2021,
    barrels: 1,
    n: 0.015,
    length: 282.480315,
    usil: 592.847769,
    dsil: 588.845144,
    twElevation: 588.845144,
  };
  const hy8Rows = [
    [7.71, 182.36, 4.51],
    [20.0, 183.97, 5.74],
    [30.0, 185.68, 6.28],
    [40.0, 188.09, 6.92],
    [50.0, 191.53, 8.0],
    [60.0, 195.74, 9.6],
    [70.0, 200.72, 11.2],
    [80.0, 206.46, 12.8],
  ];
  const ftToM = (x) => x * 0.3048;
  for (const [qCms, hwElevM, vMs] of hy8Rows) {
    const r = analyzeBoxCulvert({ ...geom, qTotal: qCms * CFS });
    assert.ok(
      Math.abs(ftToM(r.hwElevation) - hwElevM) < 0.2,
      `Q=${qCms}: HW elev ${ftToM(r.hwElevation).toFixed(2)} should be within 0.2 m of HY-8's ${hwElevM}`
    );
    assert.ok(
      Math.abs(ftToM(r.outletVelocity) - vMs) < 0.25,
      `Q=${qCms}: outlet velocity ${ftToM(r.outletVelocity).toFixed(2)} should be within 0.25 of HY-8's ${vMs}`
    );
  }
});

test('analyzeBoxCulvert returns a zero row at zero flow', () => {
  const r = analyzeBoxCulvert({
    qTotal: 0,
    span: 8.2021,
    rise: 8.2021,
    barrels: 1,
    n: 0.015,
    length: 282.5,
    usil: 592.85,
    dsil: 588.85,
    twElevation: 588.85,
  });
  assert.equal(r.hwDepth, 0);
  assert.equal(r.hwElevation, 592.85);
  assert.equal(r.outletVelocity, 0);
  assert.equal(r.control, null);
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
