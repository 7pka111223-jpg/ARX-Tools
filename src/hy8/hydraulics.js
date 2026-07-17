// FHWA HDS-5 culvert hydraulics for BOX culverts, computed in US customary
// units (the .hy8 file's native units — feet, cfs), following HY-8's method:
//
//  - Inlet control: the HDS-5 Chart 8 nomograph regression equations,
//    exactly as HY-8 evaluates them (validated against HY-8's own summary
//    table for CU-JAS-06: headwater elevations match within ~0.01-0.07 m
//    across the non-overtopping flow range, exactly at several rows).
//  - Outlet control: gradually-varied-flow water-surface profile through the
//    barrel (direct step). On a steep barrel with low tailwater HY-8 does
//    not compute outlet control at all (its tables print "0.0*"), so this
//    reports 0 there and inlet control governs. Full-flow friction is used
//    only when the tailwater submerges the crown or the profile reaches it.
//  - Outlet velocity: from the depth the profile actually reaches at the
//    outlet — normal depth on steep barrels (S2 profile), max(yc, TW) on
//    mild ones — matching HY-8's reported outlet velocity.
//
// Fixed assumptions (every culvert in the source project matches them):
// box barrels only, square-edge headwall inlet (Chart 8/Scale 2, ke = 0.5),
// constant tailwater. Roadway overtopping is NOT modeled: at flows where
// HY-8 diverts part of the discharge over the road, HY-8's headwater flattens
// at the roadway crest while this method keeps rising with the full flow.

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

function frictionSlope(qPerBarrel, span, n, y) {
  const area = span * y;
  const radius = area / (span + 2 * y);
  const v = qPerBarrel / area;
  const term = (n * v) / (MANNING_KU * Math.pow(radius, 2 / 3));
  return term * term;
}

function froudeSq(qPerBarrel, span, y) {
  const v = qPerBarrel / (span * y);
  return (v * v) / (G * y);
}

// Energy-based headwater: depth + velocity head + entrance loss at depth y.
function energyHead(qPerBarrel, span, y) {
  const v = qPerBarrel / (span * y);
  return y + ((1 + KE) * v * v) / (2 * G);
}

// Inlet-control headwater depth (ft above inlet invert): HDS-5 nomograph
// regression — form-1 unsubmerged below Q/(A·sqrt(D)) = 3.5, submerged above
// 4.0, linear transition between. This is exactly what HY-8 evaluates
// (verified row-by-row against its summary table for CU-JAS-06).
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

  let hw;
  if (ratio <= 3.5) hw = unsubmerged();
  else if (ratio >= 4.0) hw = submerged();
  else {
    const t = (ratio - 3.5) / 0.5;
    hw = unsubmerged() * (1 - t) + submerged() * t;
  }

  // Deep submergence: beyond HW/D = 3 the fitted parabola falls under HY-8,
  // which extrapolates as orifice flow. Anchor an orifice curve (head above
  // the opening's center) at the parabola's own HW/D = 3 point — this
  // reproduces HY-8's deep-submerged rows within ~0.15 m (verified against
  // the CU-JAS-06 summary table at 50-80 m³/s).
  if (hw > 3 * rise) {
    const ratio3 = Math.sqrt((3 - IC.Y - slopeTerm) / IC.c);
    const q3 = ratio3 * area * Math.sqrt(rise);
    const cd = q3 / (area * Math.sqrt(2 * G * 2.5 * rise));
    const v = qPerBarrel / (cd * area);
    hw = rise / 2 + (v * v) / (2 * G);
  }
  return hw;
}

// Full-flow outlet control (barrel pressurized): HW = ho + H - L*S with
// H = (1 + ke + 29 n^2 L / R^1.33) V^2/2g. Only valid flowing full — used
// when the tailwater is above the crown (or a profile reaches the crown).
export function outletControlFullFlow(qPerBarrel, span, rise, n, length, slope, twDepth) {
  const area = span * rise;
  const radius = area / (2 * (span + rise));
  const velocity = qPerBarrel / area;
  const H = (1 + KE + (29 * n * n * length) / Math.pow(radius, 4 / 3)) * ((velocity * velocity) / (2 * G));
  const yc = criticalDepth(qPerBarrel, span, rise);
  const ho = Math.max(twDepth, (yc + rise) / 2);
  return ho + H - length * slope;
}

// Direct-step subcritical profile from the outlet (x = L) upstream to the
// inlet (x = 0), starting at depth yStart. Returns { yInlet, fullAt } where
// fullAt is the distance from the inlet at which the profile reached the
// crown (barrel goes full), or null if it never did.
function upstreamProfile(qPerBarrel, span, rise, n, slope, length, yStart) {
  const yc = criticalDepth(qPerBarrel, span, rise);
  const steps = 400;
  const dx = length / steps;
  let y = Math.max(yStart, yc * 1.001);
  let x = length;
  while (x > 0) {
    const sf = frictionSlope(qPerBarrel, span, n, y);
    const fr2 = froudeSq(qPerBarrel, span, y);
    const denom = 1 - fr2;
    // Depth pinned near critical (profile can't drop below it upstream).
    const dydx = Math.abs(denom) < 1e-6 ? 0 : (slope - sf) / denom;
    y -= dydx * dx; // moving upstream: x decreases
    x -= dx;
    if (y <= yc) y = yc * 1.001;
    if (y >= rise) return { yInlet: rise, fullAt: x };
  }
  return { yInlet: y, fullAt: null };
}

// Supercritical S2 profile from critical depth at the inlet (x = 0)
// downstream to the outlet (x = L); the depth decreases toward normal depth.
// Returns the depth at the outlet.
function downstreamS2Profile(qPerBarrel, span, rise, n, slope, length) {
  const yc = criticalDepth(qPerBarrel, span, rise);
  const yn = normalDepth(qPerBarrel, span, rise, n, slope);
  const steps = 400;
  const dx = length / steps;
  let y = yc * 0.999;
  for (let x = 0; x < length; x += dx) {
    const sf = frictionSlope(qPerBarrel, span, n, y);
    const fr2 = froudeSq(qPerBarrel, span, y);
    const denom = 1 - fr2;
    const dydx = Math.abs(denom) < 1e-6 ? 0 : (slope - sf) / denom;
    y += dydx * dx;
    if (yn !== null && y <= yn) return yn; // asymptote reached
    if (y >= yc) y = yc * 0.999;
  }
  return y;
}

// Outlet-control headwater depth (ft above inlet invert), profile-based.
export function outletControlHW(qPerBarrel, span, rise, n, length, slope, twDepth) {
  const yc = criticalDepth(qPerBarrel, span, rise);
  const yn = normalDepth(qPerBarrel, span, rise, n, slope);

  if (twDepth >= rise) {
    return outletControlFullFlow(qPerBarrel, span, rise, n, length, slope, twDepth);
  }

  if (yn !== null && yn < yc && twDepth <= yc) {
    // Steep barrel, low tailwater: flow runs supercritical, downstream
    // conditions can't raise the pool. HY-8 doesn't compute outlet control
    // here at all (its tables print "0.0*"), so inlet control governs.
    return 0;
  }

  // Mild / horizontal barrel (or submerged-outlet steep): backwater profile
  // from max(yc, TW) at the outlet up to the inlet.
  const { yInlet, fullAt } = upstreamProfile(qPerBarrel, span, rise, n, slope, length, Math.max(yc, twDepth));
  if (fullAt !== null) {
    // Crown reached: remaining length flows full — friction at full-flow
    // slope, minus the bed drop over that reach.
    const area = span * rise;
    const vFull = qPerBarrel / area;
    const sfFull = frictionSlope(qPerBarrel, span, n, rise * 0.9999);
    return rise + (sfFull - slope) * fullAt + ((1 + KE) * vFull * vFull) / (2 * G);
  }
  return energyHead(qPerBarrel, span, yInlet);
}

// Depth of flow at the outlet, per the governing profile.
function outletDepth(qPerBarrel, span, rise, n, length, slope, twDepth) {
  if (twDepth >= rise) return rise;
  const yc = criticalDepth(qPerBarrel, span, rise);
  const yn = normalDepth(qPerBarrel, span, rise, n, slope);
  if (yn !== null && yn < yc && twDepth <= yc) {
    // Steep: S2 profile accelerates from critical at the inlet toward normal.
    return downstreamS2Profile(qPerBarrel, span, rise, n, slope, length);
  }
  return Math.min(Math.max(yc, twDepth), rise);
}

// Full analysis of one box culvert at flow qTotal (cfs, all barrels).
// Geometry in ft. Returns US-unit results; caller converts for display.
export function analyzeBoxCulvert({ qTotal, span, rise, barrels, n, length, usil, dsil, twElevation }) {
  const qPerBarrel = qTotal / Math.max(barrels, 1);
  const slope = length > 0 ? (usil - dsil) / length : 0;
  const twDepth = Math.max(0, (twElevation ?? dsil) - dsil);

  if (!(qPerBarrel > 0)) {
    // Zero flow: dry barrel, pool at the inlet invert (HY-8's zero row).
    return {
      qTotal: 0,
      qPerBarrel: 0,
      slope,
      control: null,
      hwDepth: 0,
      hwElevation: usil,
      hwOverD: 0,
      inletControlDepth: 0,
      outletControlDepth: 0,
      normalDepth: 0,
      criticalDepth: 0,
      outletDepth: 0,
      outletVelocity: 0,
    };
  }

  const yc = criticalDepth(qPerBarrel, span, rise);
  const yn = normalDepth(qPerBarrel, span, rise, n, slope);

  const hwInlet = inletControlHW(qPerBarrel, span, rise, slope);
  const hwOutlet = outletControlHW(qPerBarrel, span, rise, n, length, slope, twDepth);
  const control = hwInlet >= hwOutlet ? 'inlet' : 'outlet';
  const hwDepth = Math.max(hwInlet, hwOutlet);

  const yOut = outletDepth(qPerBarrel, span, rise, n, length, slope, twDepth);
  const outletVelocity = qPerBarrel / (span * yOut);

  return {
    qTotal,
    qPerBarrel,
    slope,
    control,
    hwDepth,
    hwElevation: usil + hwDepth,
    hwOverD: hwDepth / rise,
    inletControlDepth: hwInlet,
    outletControlDepth: hwOutlet,
    normalDepth: yn,
    criticalDepth: yc,
    outletDepth: yOut,
    outletVelocity,
  };
}
