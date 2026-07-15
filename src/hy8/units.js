// SI -> US unit conversions and station-string parsing for the HY-8 importer.

export const M_TO_FT = 1 / 0.3048;
export const CMS_TO_CFS = 1 / (0.3048 * 0.3048 * 0.3048);

export function mToFt(x) {
  return x * M_TO_FT;
}

export function cmsToCfs(x) {
  return x * CMS_TO_CFS;
}

// Chainage/station strings of the form "X+YYY" (e.g. "12+727", "-2+592").
// Value = major*1000 + minor. A leading '-' on the major part, OR a '-'
// immediately after the '+' (e.g. "0+-887", "-2+-601"), marks the whole
// chainage negative — the two are not independent signs that could cancel.
const STATION_RE = /^\s*(-)?(\d+)\+(-)?(\d+)\s*$/;

export function parseStationMeters(str) {
  const m = STATION_RE.exec(String(str));
  if (!m) return null;
  const [, leadingMinus, majorStr, midMinus, minorStr] = m;
  const magnitude = Number(majorStr) * 1000 + Number(minorStr);
  const negative = Boolean(leadingMinus) || Boolean(midMinus);
  return negative ? -magnitude : magnitude;
}
