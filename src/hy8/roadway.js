// Roadway-data policy shared by the importer, the differences panel, and
// the project creator. Every crossing gets the same standard roadway:
// constant roadway elevation, paved surface, crest length 20 m, top width
// 8 m, and a crest elevation of USIL + rise + 2 m of cover — all stored in
// the file in feet like everything else.

import { mToFt } from './units.js';

export const ROADWAY_COVER_M = 2;
export const ROADWAY_CREST_LENGTH_M = 20;
export const ROADWAY_TOP_WIDTH_M = 8;
export const ROADWAY_SHAPE_CONSTANT = 1; // HY-8 "Constant Roadway Elevation"
export const ROADWAY_SURFACE_PAVED = 1; // HY-8 "Paved"

export function crestElevationM(usilM, riseM) {
  return usilM + riseM + ROADWAY_COVER_M;
}

// patchValues() edits that normalize a crossing's roadway block to the
// standard roadway for the given schedule USIL/rise (SI). The section data
// point sits at station 0 and every ROADWAYPOINT at station = crest length,
// so the profile is a flat crest of the standard length whatever the
// original station count was.
export function roadwayEdits(crossing, usilM, riseM) {
  const crestFt = mToFt(crestElevationM(usilM, riseM));
  const edits = [];
  if (crossing.roadwayShapeLine !== -1) edits.push({ lineIndex: crossing.roadwayShapeLine, ints: [ROADWAY_SHAPE_CONSTANT] });
  if (crossing.surfaceLine !== -1) edits.push({ lineIndex: crossing.surfaceLine, ints: [ROADWAY_SURFACE_PAVED] });
  if (crossing.roadWidthLine !== -1) edits.push({ lineIndex: crossing.roadWidthLine, floats: [mToFt(ROADWAY_TOP_WIDTH_M)] });
  if (crossing.roadwaySecDataLine !== -1) edits.push({ lineIndex: crossing.roadwaySecDataLine, floats: [0, crestFt] });
  for (const lineIndex of crossing.roadwayPointLines) {
    edits.push({ lineIndex, floats: [mToFt(ROADWAY_CREST_LENGTH_M), crestFt] });
  }
  return edits;
}
