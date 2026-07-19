// Builds the per-culvert summary table (SI units) two ways:
//  - buildComputedSummary: runs the approximate HDS-5 hydraulics in
//    hydraulics.js on every crossing's current geometry + design flow.
//  - buildExtractedSummary: reads HY-8's own computed results from the
//    RATINGCURVE blocks of a file that HY-8 has analyzed and saved,
//    interpolating headwater elevation / outlet velocity at the design flow.
//    (Normal and critical depth are not stored in the file, so those two
//    columns are always computed from geometry.)

import { readFloats, readInt } from './hy8File.js';
import { ftToM, cfsToCms } from './units.js';
import { analyzeBoxCulvert, normalDepth, criticalDepth } from './hydraulics.js';

const BOX_SHAPE = 2;

function readGeometry(doc, crossing) {
  const culvert = crossing.culverts[0];
  const invert = readFloats(doc, culvert.invertDataLine); // [inletSta, USIL, outletSta, DSIL]
  const barrel = readFloats(doc, culvert.barrelDataLine); // [span, rise, n1, n2]
  const range = readFloats(doc, crossing.dischargeRangeLine); // [min, design, max]
  const twRow = readFloats(doc, crossing.twRatingCurveLines[0]);
  return {
    name: culvert.name || crossing.name || '',
    crossingName: crossing.name || '',
    shape: culvert.culvertShape,
    qTotal: range[1],
    span: barrel[0],
    rise: barrel[1],
    n: barrel[2],
    barrels: readInt(doc, culvert.numberOfBarrelsLine) || 1,
    usil: invert[1],
    dsil: invert[3],
    length: invert[2] - invert[0],
    twElevation: twRow ? twRow[0] : invert[3],
  };
}

function toSiRow(geom, us) {
  return {
    name: geom.name,
    crossingName: geom.crossingName,
    designFlowCms: cfsToCms(geom.qTotal),
    hwOverD: us.hwOverD,
    normalDepthM: us.normalDepth === null ? null : ftToM(us.normalDepth),
    criticalDepthM: ftToM(us.criticalDepth),
    hwElevationM: us.hwElevation === null ? null : ftToM(us.hwElevation),
    outletVelocityMs: us.outletVelocity === null ? null : ftToM(us.outletVelocity),
    control: us.control,
    error: null,
  };
}

function unsupportedRow(geom, message) {
  return {
    name: geom.name,
    crossingName: geom.crossingName,
    designFlowCms: cfsToCms(geom.qTotal),
    hwOverD: null,
    normalDepthM: null,
    criticalDepthM: null,
    hwElevationM: null,
    outletVelocityMs: null,
    control: null,
    error: message,
  };
}

export function buildComputedSummary(doc) {
  return doc.crossings.map((crossing) => {
    const geom = readGeometry(doc, crossing);
    if (geom.shape !== BOX_SHAPE) return unsupportedRow(geom, 'unsupported culvert shape (box only)');
    if (!(geom.qTotal > 0)) return unsupportedRow(geom, 'no design flow set');
    return toSiRow(geom, analyzeBoxCulvert(geom));
  });
}

// Full performance table per crossing — the analysis run at every flow in
// the crossing's DISCHARGEXYDESIGN list (the same flows HY-8's own summary
// tables use: min to max with the design flow in place).
export function buildFullAnalysis(doc) {
  return doc.crossings.map((crossing) => {
    const geom = readGeometry(doc, crossing);
    const base = { name: geom.name, crossingName: geom.crossingName, designFlowCms: cfsToCms(geom.qTotal) };
    if (geom.shape !== BOX_SHAPE) return { ...base, error: 'unsupported culvert shape (box only)', rows: [] };

    const flows = crossing.dischargeXYDesignYLines
      .map((lineIndex) => readFloats(doc, lineIndex)[0])
      .filter((q, i, arr) => i === 0 || q !== arr[i - 1]); // drop consecutive duplicates
    if (!flows.some((q) => q > 0)) return { ...base, error: 'no flow list in the file', rows: [] };

    const rows = flows.map((qTotal) => {
      const us = analyzeBoxCulvert({ ...geom, qTotal });
      return {
        flowCms: cfsToCms(qTotal),
        isDesign: Math.abs(qTotal - geom.qTotal) < 1e-6,
        hwElevationM: ftToM(us.hwElevation),
        hwOverD: us.hwOverD,
        inletControlDepthM: ftToM(us.inletControlDepth),
        outletControlDepthM: ftToM(us.outletControlDepth),
        normalDepthM: us.normalDepth === null ? null : ftToM(us.normalDepth),
        criticalDepthM: ftToM(us.criticalDepth),
        outletDepthM: ftToM(us.outletDepth),
        outletVelocityMs: ftToM(us.outletVelocity),
        control: us.control,
      };
    });
    return { ...base, error: null, rows };
  });
}

// Linear interpolation of HY-8's stored rating curve at flow q (cfs).
// Returns null when the curve is missing or q is outside its range.
function interpolateRating(doc, crossing, q) {
  const points = crossing.ratingCurve
    .map((t) => ({
      flow: readFloats(doc, t.flowLine)[0],
      elevation: readFloats(doc, t.elevationLine)[0],
      velocity: readFloats(doc, t.velocityLine)[0],
    }))
    .sort((a, b) => a.flow - b.flow);
  if (!points.length) return null;

  const exact = points.find((p) => Math.abs(p.flow - q) < 1e-3);
  if (exact) return exact;
  const upperIdx = points.findIndex((p) => p.flow > q);
  if (upperIdx <= 0) return null;
  const lower = points[upperIdx - 1];
  const upper = points[upperIdx];
  const t = (q - lower.flow) / (upper.flow - lower.flow);
  return {
    flow: q,
    elevation: lower.elevation + t * (upper.elevation - lower.elevation),
    velocity: lower.velocity + t * (upper.velocity - lower.velocity),
  };
}

export function buildExtractedSummary(doc) {
  return doc.crossings.map((crossing) => {
    const geom = readGeometry(doc, crossing);
    if (geom.shape !== BOX_SHAPE) return unsupportedRow(geom, 'unsupported culvert shape (box only)');
    if (!(geom.qTotal > 0)) return unsupportedRow(geom, 'no design flow set');

    const rating = interpolateRating(doc, crossing, geom.qTotal);
    if (!rating) return unsupportedRow(geom, 'no rating curve results in file (run the analysis in HY-8 and re-save)');

    const qPerBarrel = geom.qTotal / Math.max(geom.barrels, 1);
    const slope = geom.length > 0 ? (geom.usil - geom.dsil) / geom.length : 0;
    const yn = normalDepth(qPerBarrel, geom.span, geom.rise, geom.n, slope);
    const yc = criticalDepth(qPerBarrel, geom.span, geom.rise);

    return toSiRow(geom, {
      hwOverD: (rating.elevation - geom.usil) / geom.rise,
      normalDepth: yn,
      criticalDepth: yc,
      hwElevation: rating.elevation,
      outletVelocity: rating.velocity,
      control: null,
    });
  });
}
