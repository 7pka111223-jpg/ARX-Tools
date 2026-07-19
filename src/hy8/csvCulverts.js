// Parser for the culvert schedule CSV (Table1.csv-style export).
//
// Row 1 is a banner, row 2 is the header, subsequent rows are data. Columns
// are located by header name (not position) so column order/extras don't
// matter. The file may contain non-UTF-8 bytes (mojibake degree symbol) in
// columns this tool never reads; the tokenizer only cares about comma/quote
// structure, so it tolerates that without special-casing it.

import { parseStationMeters } from './units.js';

// Tokenizes CSV text into a raw string grid. Exported for other CSV inputs
// (e.g. the project-creator culvert list) so quoting/CRLF handling stays in
// one place.
export function parseCsvGrid(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function findColumn(header, name) {
  return header.findIndex((h) => String(h).trim() === name);
}

// Maps a raw row grid (from CSV or an Excel sheet) to culvert objects. The
// header row is located by content — the row containing both "Name" and
// "Station" — so a banner row (or none at all) works either way.
export function rowsToCulverts(rows) {
  const headerIdx = rows.findIndex((r) => findColumn(r, 'Name') !== -1 && findColumn(r, 'Station') !== -1);
  if (headerIdx === -1) return [];

  const header = rows[headerIdx];
  const col = {
    name: findColumn(header, 'Name'),
    station: findColumn(header, 'Station'),
    cells: findColumn(header, 'Cells'),
    width: findColumn(header, 'Width (m)'),
    rise: findColumn(header, 'Rise (m)'),
    length: findColumn(header, 'Length (m)'),
    usil: findColumn(header, 'USIL (m)'),
    dsil: findColumn(header, 'DSIL (m)'),
  };

  const result = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((f) => String(f).trim() === '')) continue;
    const name = row[col.name] !== undefined ? String(row[col.name]).trim() : '';
    if (!name) continue;
    const stationRaw = row[col.station] !== undefined ? String(row[col.station]).trim() : '';
    result.push({
      name,
      stationRaw,
      stationM: parseStationMeters(stationRaw),
      cells: Number(row[col.cells]),
      widthM: Number(row[col.width]),
      riseM: Number(row[col.rise]),
      lengthM: Number(row[col.length]),
      usilM: Number(row[col.usil]),
      dsilM: Number(row[col.dsil]),
    });
  }
  return result;
}

export function parseCulvertCsv(text) {
  const rows = parseCsvGrid(text).filter((r) => !(r.length === 1 && r[0] === ''));
  return rowsToCulverts(rows);
}
