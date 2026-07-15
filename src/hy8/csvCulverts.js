// Parser for the culvert schedule CSV (Table1.csv-style export).
//
// Row 1 is a banner, row 2 is the header, subsequent rows are data. Columns
// are located by header name (not position) so column order/extras don't
// matter. The file may contain non-UTF-8 bytes (mojibake degree symbol) in
// columns this tool never reads; the tokenizer only cares about comma/quote
// structure, so it tolerates that without special-casing it.

import { parseStationMeters } from './units.js';

function parseCsv(text) {
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
  return header.findIndex((h) => h.trim() === name);
}

export function parseCulvertCsv(text) {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length < 2) return [];

  const header = rows[1];
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
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((f) => f.trim() === '')) continue;
    const name = row[col.name]?.trim();
    if (!name) continue;
    const stationRaw = row[col.station]?.trim() ?? '';
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
