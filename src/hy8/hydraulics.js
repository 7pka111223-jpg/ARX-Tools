// Approximate FHWA HDS-5 culvert hydraulics for BOX culverts, computed in
// US customary units (the .hy8 file's native units — feet, cfs).
//
// This mirrors the method HY-8 itself implements, but it is an independent
// implementation: results are labelled approximate and should be spot-checked
// against HY-8 (task for the user on Windows). Assumptions, fixed for this
// tool because every culvert in the source project matches them:
//   - Box barrels (CULVERTSHAPE 2) only; other shapes are reported unsupported.
//   - Conventional inlet, square edge with headwall (INLETTYPE 1):
//     HDS-5 Chart 8 / Scale 2 coefficients, entrance loss ke = 0.5.
//   - Constant tailwater (TAILWATERTYPE 6), read from TWRATINGCURVE row 1.
//   - No roadway-overtopping check (HW is reported even if above the road).

const G = 32.2; // ft/s^2
const MANNING_KU = 1.486; // US Manning's constant

// HDS-5 Chart 8, Scale 2 (90-degree headwall, square edges), equation form 1.
const IC = { K: 0.061, M: 0.75, c: 0.04, Y: 0.8 };
const KE = 0.5;

// Critical depth in a rectangular section, capped at the rise (HY-8 caps too).
export function criticalDepth(qPerBarrel, span, rise) {
  const unitQ = qPerBarrel / span;
  const yc = Math.cbrt((unitQ * unitQ) / G);
  return Math.min(yc, rise);
}

// Normal depth via Manning's equation in a rectangular section, bisection
// solve. Returns null on non-positive slope (undefined there), capped at the
// rise otherwise (full flow).
export function normalDepth(qPerBarrel, span, rise, n, slope) {
  if (slope <= 0) return null;
  const capacity = (y) => {
    const area = span * y;
    const radius = area / (span + 2 * y);
    return (MANNING_KU / n) * area * Math.pow(radius, 2 / 3) * Math.sqrt(slope);
  };
  if (capacity(rise) < qPerBarrel) return rise;
  let lo = 1e-9;
  let hi = rise;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (capacity(mid) < qPerBarrel) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// Inlet-control headwater depth (ft above inlet invert). HDS-5 nomograph
// equations: form-1 unsubmerged below Q/(A*sqrt(D)) = 3.5, submerged above
// 4.0, linear transition between.
export function inletControlHW(qPerBarrel, span, rise, slope) {
  const area = span * rise;
  const ratio = qPerBarrel / (area * Math.sqrt(rise));
  const slopeTerm = -0.5 * slope;

  const unsubmerged = () => {
    const yc = criticalDepth(qPerBarrel, span, rise);
    const vc = qPerBarrel / (span * yc);
    const criticalHead = yc + (vc * vc) / (2 * G);
    return rise * (criticalHead / rise + IC.K * Math.pow(ratio, IC.M) + slopeTerm);
  };
  const submerged = () => rise * (IC.c * ratio * ratio + IC.Y + slopeTerm);

  if (ratio <= 3.5) return unsubmerged();
  if (ratio >= 4.0) return submerged();
  const t = (ratio - 3.5) / 0.5;
  return unsubmerged() * (1 - t) + submerged() * t;
}

// Outlet-control headwater depth (ft above inlet invert), full-flow friction
// method: HW = ho + H - L*S, with ho = max(tailwater depth, (yc + D)/2) and
// H = (1 + ke + 29 n^2 L / R^1.33) * V^2 / 2g.
export function outletControlHW(qPerBarrel, span, rise, n, length, slope, twDepth) {
  const area = span * rise;
  const radius = area / (2 * (span + rise));
  const velocity = qPerBarrel / area;
  const H = (1 + KE + (29 * n * n * length) / Math.pow(radius, 4 / 3)) * ((velocity * velocity) / (2 * G));
  const yc = criticalDepth(qPerBarrel, span, rise);
  const ho = Math.max(twDepth, (yc + rise) / 2);
  return ho + H - length * slope;
}

// Full analysis of one box culvert at flow qTotal (cfs, all barrels).
// Geometry in ft. Returns US-unit results; caller converts for display.
export function analyzeBoxCulvert({ qTotal, span, rise, barrels, n, length, usil, dsil, twElevation }) {
  const qPerBarrel = qTotal / Math.max(barrels, 1);
  const slope = length > 0 ? (usil - dsil) / length : 0;
  const twDepth = Math.max(0, (twElevation ?? dsil) - dsil);

  const yc = criticalDepth(qPerBarrel, span, rise);
  const yn = normalDepth(qPerBarrel, span, rise, n, slope);

  const hwInlet = inletControlHW(qPerBarrel, span, rise, slope);
  const hwOutlet = outletControlHW(qPerBarrel, span, rise, n, length, slope, twDepth);
  const control = hwInlet >= hwOutlet ? 'inlet' : 'outlet';
  const hwDepth = Math.max(hwInlet, hwOutlet);

  // Outlet depth: inlet control flows at normal depth; outlet control at
  // max(critical, tailwater), both capped at the rise.
  const outletDepth =
    control === 'inlet' && yn !== null ? Math.min(yn, rise) : Math.min(Math.max(yc, twDepth), rise);
  const outletVelocity = qPerBarrel / (span * outletDepth);

  return {
    qTotal,
    qPerBarrel,
    slope,
    control,
    hwDepth,
    hwElevation: usil + hwDepth,
    hwOverD: hwDepth / rise,
    normalDepth: yn,
    criticalDepth: yc,
    outletDepth,
    outletVelocity,
  };
}
