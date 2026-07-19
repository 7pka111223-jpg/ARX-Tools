// Threshold checks on the analysis results: cover, HW/D, and outlet velocity.
// Each check has a direction — cover is a minimum (flag when below), HW/D and
// outlet velocity are maxima (flag when above). Defaults come from the design
// review criteria the user asked for and can be overridden in the UI.

export const DEFAULT_THRESHOLDS = {
  coverMinM: 1, // minimum fill cover over the culvert (m)
  hwOverDMax: 1, // maximum headwater-to-rise ratio
  outletVelocityMaxMs: 4.5, // maximum outlet velocity (m/s)
};

// A single value/threshold comparison. `pass` is null when the value is
// missing (nothing to judge) so the UI can show "—" rather than a false flag.
function judge(value, threshold, direction) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return { value: null, threshold, direction, pass: null };
  }
  const pass = direction === 'min' ? value >= threshold : value <= threshold;
  return { value, threshold, direction, pass };
}

// hydraulicByName: Map<nameLower, { hwOverD, outletVelocityMs }> (from the
//   report extraction or the computed summary).
// geomByName: Map<nameLower, { coverM, ... }> (from geometry.js).
// Rows are produced for every geometry culvert, in file order.
export function runChecks(geomByName, hydraulicByName, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const rows = [];
  for (const [key, geom] of geomByName) {
    const hyd = hydraulicByName.get(key) || {};
    const cover = judge(geom.coverM, t.coverMinM, 'min');
    const hwOverD = judge(hyd.hwOverD ?? null, t.hwOverDMax, 'max');
    const velocity = judge(hyd.outletVelocityMs ?? null, t.outletVelocityMaxMs, 'max');
    const checks = [cover, hwOverD, velocity];
    const anyFail = checks.some((c) => c.pass === false);
    const anyMissing = checks.some((c) => c.pass === null);
    rows.push({
      name: geom.name,
      crossingName: geom.crossingName,
      cover,
      hwOverD,
      velocity,
      anyFail,
      anyMissing,
    });
  }
  return rows;
}

// Count of culverts with at least one failing check.
export function countFailures(rows) {
  return rows.filter((r) => r.anyFail).length;
}
