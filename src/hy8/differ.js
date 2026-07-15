// Reports only the fields that differ between a mapped CSV row and its
// matched HY-8 crossing/culvert. Comparison happens in US units (the file's
// native storage), but every diff also carries hy8ValueSI so callers that
// only ever want to show SI never have to touch a foot/cfs number.

import { mToFt, ftToM } from './units.js';
import { readFloats, readInt } from './hy8File.js';

const TOL_FT = 0.01;

function numericDiff(field, csvValueM, hy8ValueFt) {
  const csvValueUS = mToFt(csvValueM);
  if (Math.abs(csvValueUS - hy8ValueFt) <= TOL_FT) return null;
  return { field, csvValue: csvValueM, hy8Value: hy8ValueFt, csvValueUS, hy8ValueSI: ftToM(hy8ValueFt) };
}

// mode is the mapping mode used to produce `pair` ('name' or 'station'); the
// label field diffed is whichever mode was NOT used to make the match.
export function diffPair(pair, doc, mode = 'name') {
  const { csvRow, crossing, culvert } = pair;
  const diffs = [];

  const invert = readFloats(doc, culvert.invertDataLine); // [inletSta, USIL, outletSta, DSIL]
  const barrel = readFloats(doc, culvert.barrelDataLine); // [span, rise, n1, n2]
  const cells = readInt(doc, culvert.numberOfBarrelsLine);
  const channelGeom = readFloats(doc, crossing.channelGeometryLine);
  const twRow0 = readFloats(doc, crossing.twRatingCurveLines[0]);

  const pushNumeric = (field, csvValueM, hy8ValueFt) => {
    const diff = numericDiff(field, csvValueM, hy8ValueFt);
    if (diff) diffs.push(diff);
  };

  pushNumeric('USIL', csvRow.usilM, invert[1]);
  pushNumeric('DSIL', csvRow.dsilM, invert[3]);
  pushNumeric('length', csvRow.lengthM, invert[2]);
  pushNumeric('span', csvRow.widthM, barrel[0]);
  pushNumeric('rise', csvRow.riseM, barrel[1]);
  pushNumeric('channelInvertElevation', csvRow.dsilM, channelGeom[4]);
  pushNumeric('tailwaterElevation', csvRow.dsilM, twRow0[0]);

  if (Number(csvRow.cells) !== cells) {
    // Dimensionless — no unit conversion, so hy8ValueSI === hy8Value.
    diffs.push({ field: 'cells', csvValue: csvRow.cells, hy8Value: cells, csvValueUS: csvRow.cells, hy8ValueSI: cells });
  }

  if (mode === 'station') {
    const csvName = csvRow.name.trim();
    const hy8Name = (culvert.name || '').trim();
    if (csvName.toLowerCase() !== hy8Name.toLowerCase()) {
      diffs.push({ field: 'name', csvValue: csvName, hy8Value: hy8Name, csvValueUS: csvName, hy8ValueSI: hy8Name });
    }
  } else {
    const csvStation = csvRow.stationRaw.trim();
    const hy8Station = (crossing.name || '').trim();
    if (csvStation !== hy8Station) {
      diffs.push({ field: 'station', csvValue: csvStation, hy8Value: hy8Station, csvValueUS: csvStation, hy8ValueSI: hy8Station });
    }
  }

  return diffs;
}
