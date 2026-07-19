// Per-culvert geometric data in SI, read from a loaded .hy8 doc. Used by the
// checks tab and the geometric sheet of the report Excel export.
//
// Cover is the fill depth over the culvert crown at the upstream (higher)
// end: roadway crest elevation − (USIL + cell height). The controlling crest
// is the lowest point of the roadway profile (its overtopping crest). Skew
// is not stored anywhere in the .hy8 project format, so it is reported as 0°.

import { readFloats, readInt } from './hy8File.js';
import { ftToM } from './units.js';

// Lowest roadway-profile elevation (ft) for a crossing, or null if the file
// has no roadway section for it.
function roadwayCrestFt(doc, crossing) {
  const elevs = [];
  if (crossing.roadwaySecDataLine !== -1) {
    const v = readFloats(doc, crossing.roadwaySecDataLine)[1];
    if (Number.isFinite(v)) elevs.push(v);
  }
  for (const lineIndex of crossing.roadwayPointLines) {
    const v = readFloats(doc, lineIndex)[1];
    if (Number.isFinite(v)) elevs.push(v);
  }
  return elevs.length ? Math.min(...elevs) : null;
}

export function extractGeometryRow(doc, crossing) {
  const culvert = crossing.culverts[0];
  const invert = readFloats(doc, culvert.invertDataLine); // [inletSta, USIL, outletSta, DSIL]
  const barrel = readFloats(doc, culvert.barrelDataLine); // [span, rise, n1, n2]

  const usilM = ftToM(invert[1]);
  const dsilM = ftToM(invert[3]);
  const lengthM = ftToM(invert[2] - invert[0]);
  const cellWidthM = ftToM(barrel[0]);
  const cellHeightM = ftToM(barrel[1]);

  const crestFt = roadwayCrestFt(doc, crossing);
  const coverM = crestFt === null ? null : ftToM(crestFt) - (usilM + cellHeightM);
  const slope = lengthM > 0 ? (usilM - dsilM) / lengthM : null;

  return {
    name: (culvert.name || crossing.name || '').trim(),
    crossingName: (crossing.name || '').trim(),
    barrels: readInt(doc, culvert.numberOfBarrelsLine) || 1,
    cellWidthM,
    cellHeightM,
    coverM,
    slope,
    usilM,
    dsilM,
    lengthM,
    // HY-8 does not store a culvert/roadway skew angle in the project file.
    skewDeg: 0,
  };
}

export function extractGeometry(doc) {
  return doc.crossings.map((crossing) => extractGeometryRow(doc, crossing));
}

// name(lowercased) -> geometry row, for cross-referencing with hydraulic rows.
export function geometryByName(doc) {
  const map = new Map();
  for (const row of extractGeometry(doc)) map.set(row.name.toLowerCase(), row);
  return map;
}
