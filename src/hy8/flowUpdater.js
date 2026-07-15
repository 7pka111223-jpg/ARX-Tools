// Applies design-flow updates (from a pasted/CSV flow list keyed by culvert
// name) to an HY-8 doc: DISCHARGERANGE and the 11 DISCHARGEXYDESIGN_Y rows.

import { cmsToCfs } from './units.js';
import { patchValues } from './hy8File.js';

// Two columns (name, flow in m3/s) separated by tab/comma/semicolon/space
// runs. Lines whose second token isn't numeric (e.g. a header row) are
// ignored, as are blank lines.
export function parseFlowInput(text) {
  const result = [];
  const lines = String(text).split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const tokens = line.split(/[\t,;]+|\s+/).filter(Boolean);
    if (tokens.length < 2) continue;
    const [name, flowStr] = tokens;
    const flowCms = Number(flowStr);
    if (!Number.isFinite(flowCms)) continue;
    result.push({ name, flowCms });
  }
  return result;
}

// 11 values evenly spaced 0..maxCfs, with the slot nearest designCfs
// replaced by the exact design value.
function regenerateDesignY(maxCfs, designCfs, count) {
  const step = maxCfs / (count - 1);
  const values = Array.from({ length: count }, (_, i) => i * step);
  let nearestIdx = 0;
  let nearestDist = Infinity;
  values.forEach((v, i) => {
    const d = Math.abs(v - designCfs);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  });
  values[nearestIdx] = designCfs;
  return values;
}

export function applyFlows(doc, flows) {
  const byName = new Map();
  for (const crossing of doc.crossings) {
    const culvertName = crossing.culverts[0].name;
    if (culvertName) byName.set(culvertName.trim().toLowerCase(), crossing);
  }

  const edits = [];
  const updated = [];
  const unmatchedNames = [];

  for (const { name, flowCms } of flows) {
    const crossing = byName.get(String(name).trim().toLowerCase());
    if (!crossing) {
      unmatchedNames.push(name);
      continue;
    }

    const designCfs = cmsToCfs(flowCms);
    const maxCfs = cmsToCfs(flowCms + 5);
    const minCfs = 0;

    edits.push({ lineIndex: crossing.dischargeRangeLine, floats: [minCfs, designCfs, maxCfs] });

    const yValues = regenerateDesignY(maxCfs, designCfs, crossing.dischargeXYDesignYLines.length);
    crossing.dischargeXYDesignYLines.forEach((lineIndex, i) => {
      edits.push({ lineIndex, floats: [yValues[i]] });
    });

    updated.push(crossing.culverts[0].name);
  }

  return { doc: patchValues(doc, edits), updated, unmatchedNames };
}
