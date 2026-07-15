// Applies CSV-sourced geometry/elevation/cells data to every mapped pair.
// Pure and headless (no UI): used by both the browser tool and tests.

import { mToFt } from './units.js';
import { patchValues, readFloats } from './hy8File.js';

// mode is the mapping mode used to produce `pairs` ('name' or 'station').
// The label field NOT used for matching gets overwritten from the CSV:
// name mode -> crossing station label (STARTCROSSING/ENDCROSSING) becomes
// the CSV Station string; station mode -> culvert name
// (STARTCULVERT/ENDCULVERT) becomes the CSV Name.
export function applyGeometryImport(doc, pairs, mode = 'name') {
  const edits = [];

  for (const { csvRow, crossing, culvert } of pairs) {
    const usilFt = mToFt(csvRow.usilM);
    const dsilFt = mToFt(csvRow.dsilM);
    const lengthFt = mToFt(csvRow.lengthM);
    const spanFt = mToFt(csvRow.widthM);
    const riseFt = mToFt(csvRow.riseM);

    edits.push({ lineIndex: culvert.invertDataLine, floats: [0, usilFt, lengthFt, dsilFt] });

    const barrel = readFloats(doc, culvert.barrelDataLine);
    edits.push({ lineIndex: culvert.barrelDataLine, floats: [spanFt, riseFt, barrel[2], barrel[3]] });

    edits.push({ lineIndex: culvert.numberOfBarrelsLine, ints: [csvRow.cells] });

    const channelGeom = readFloats(doc, crossing.channelGeometryLine);
    edits.push({
      lineIndex: crossing.channelGeometryLine,
      floats: [channelGeom[0], channelGeom[1], channelGeom[2], channelGeom[3], dsilFt],
    });

    for (const lineIndex of crossing.twRatingCurveLines) {
      const row = readFloats(doc, lineIndex);
      edits.push({ lineIndex, floats: [dsilFt, row[1], row[2], row[3]] });
    }

    if (mode === 'station') {
      edits.push({ lineIndex: culvert.startLine, quoted: csvRow.name });
      edits.push({ lineIndex: culvert.endLine, quoted: csvRow.name });
    } else {
      edits.push({ lineIndex: crossing.startLine, quoted: csvRow.stationRaw });
      edits.push({ lineIndex: crossing.endLine, quoted: csvRow.stationRaw });
    }
  }

  return patchValues(doc, edits);
}
