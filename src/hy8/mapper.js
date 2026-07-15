// Matches CSV culvert rows to HY-8 crossings, either by culvert name or by
// nearest station within a tolerance.

import { parseStationMeters } from './units.js';

export function mapCulverts(csvRows, hy8Doc, { mode = 'name', toleranceM = 15 } = {}) {
  return mode === 'station'
    ? mapByStation(csvRows, hy8Doc.crossings, toleranceM)
    : mapByName(csvRows, hy8Doc.crossings);
}

function mapByName(csvRows, crossings) {
  const byName = new Map();
  for (const crossing of crossings) {
    const culvertName = crossing.culverts[0].name;
    if (culvertName) byName.set(culvertName.trim().toLowerCase(), crossing);
  }

  const pairs = [];
  const unmatchedCsv = [];
  const usedCrossings = new Set();
  for (const csvRow of csvRows) {
    const crossing = byName.get(csvRow.name.trim().toLowerCase());
    if (crossing) {
      pairs.push({ csvRow, crossing, culvert: crossing.culverts[0] });
      usedCrossings.add(crossing);
    } else {
      unmatchedCsv.push(csvRow);
    }
  }
  const unmatchedHy8 = crossings.filter((c) => !usedCrossings.has(c));
  return { pairs, unmatchedCsv, unmatchedHy8 };
}

function mapByStation(csvRows, crossings, toleranceM) {
  const candidates = [];
  for (const csvRow of csvRows) {
    if (csvRow.stationM === null || Number.isNaN(csvRow.stationM)) continue;
    for (const crossing of crossings) {
      const crossingStationM = parseStationMeters(crossing.name);
      if (crossingStationM === null) continue;
      const distance = Math.abs(csvRow.stationM - crossingStationM);
      if (distance <= toleranceM) candidates.push({ csvRow, crossing, distance });
    }
  }
  // Greedy nearest-first assignment: each side matched at most once.
  candidates.sort((a, b) => a.distance - b.distance);

  const usedCsv = new Set();
  const usedCrossings = new Set();
  const pairs = [];
  for (const cand of candidates) {
    if (usedCsv.has(cand.csvRow) || usedCrossings.has(cand.crossing)) continue;
    pairs.push({ csvRow: cand.csvRow, crossing: cand.crossing, culvert: cand.crossing.culverts[0] });
    usedCsv.add(cand.csvRow);
    usedCrossings.add(cand.crossing);
  }
  const unmatchedCsv = csvRows.filter((r) => !usedCsv.has(r));
  const unmatchedHy8 = crossings.filter((c) => !usedCrossings.has(c));
  return { pairs, unmatchedCsv, unmatchedHy8 };
}
