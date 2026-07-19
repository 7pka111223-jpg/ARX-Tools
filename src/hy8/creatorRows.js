// Parses the filled-in project-creator culvert list (from the downloadable
// template, CSV or Excel) into culvert specs for hy8Writer.js. Inverts can
// be given directly (USIL & DSIL) or via a slope: with a slope, HY-8 gets a
// downstream invert of 0 and an upstream invert of slope × length.

import { crestElevationM } from './roadway.js';

function findColumn(header, name) {
  return header.findIndex((h) => String(h).trim().toLowerCase() === name.toLowerCase());
}

function num(row, col) {
  if (col === -1 || row[col] === undefined || String(row[col]).trim() === '') return null;
  const v = Number(row[col]);
  return Number.isFinite(v) ? v : NaN;
}

// grid: string[][] from CSV or an Excel sheet. The header row is located by
// content (the row containing "Name" and "Width (m)"), so the template's
// banner row — or no banner at all — both work.
export function parseCreatorRows(grid) {
  const headerIdx = grid.findIndex((r) => findColumn(r, 'Name') !== -1 && findColumn(r, 'Width (m)') !== -1);
  if (headerIdx === -1) {
    return { culverts: [], errors: [{ name: '', message: 'no header row found — expected the template\'s "Name" / "Width (m)" columns' }] };
  }

  const header = grid[headerIdx];
  const col = {
    name: findColumn(header, 'Name'),
    flow: findColumn(header, 'Design Flow (m3/s)'),
    cells: findColumn(header, 'Cells'),
    width: findColumn(header, 'Width (m)'),
    rise: findColumn(header, 'Rise (m)'),
    length: findColumn(header, 'Length (m)'),
    usil: findColumn(header, 'USIL (m)'),
    dsil: findColumn(header, 'DSIL (m)'),
    slope: findColumn(header, 'Slope (m/m)'),
    cover: findColumn(header, 'Average Cover (m)') !== -1 ? findColumn(header, 'Average Cover (m)') : findColumn(header, 'Cover (m)'),
  };

  const culverts = [];
  const errors = [];
  const seenNames = new Set();

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((f) => String(f).trim() === '')) continue;
    const name = row[col.name] !== undefined ? String(row[col.name]).trim() : '';
    if (!name) continue;

    const fail = (message) => errors.push({ name, message });

    if (seenNames.has(name.toLowerCase())) {
      fail('duplicate culvert name — names must be unique (flows and reports match by name)');
      continue;
    }

    const widthM = num(row, col.width);
    const riseM = num(row, col.rise);
    const lengthM = num(row, col.length);
    const flowCms = num(row, col.flow) ?? 0;
    const cells = num(row, col.cells) ?? 1;
    const usil = num(row, col.usil);
    const dsil = num(row, col.dsil);
    const slope = num(row, col.slope);
    const coverRaw = num(row, col.cover);
    const coverM = coverRaw !== null && !Number.isNaN(coverRaw) ? coverRaw : undefined;

    if (!(widthM > 0) || !(riseM > 0)) {
      fail('cell width and height must both be positive numbers');
      continue;
    }
    if (!(lengthM > 0)) {
      fail('length must be a positive number');
      continue;
    }
    if (!(flowCms >= 0)) {
      fail('design flow must be a number ≥ 0');
      continue;
    }
    if (!(Number.isInteger(cells) && cells >= 1)) {
      fail('cells must be a whole number ≥ 1');
      continue;
    }

    let usilM;
    let dsilM;
    let invertSource;
    if (usil !== null || dsil !== null) {
      if (usil === null || dsil === null || Number.isNaN(usil) || Number.isNaN(dsil)) {
        fail('give both USIL and DSIL, or leave both blank and give a slope');
        continue;
      }
      usilM = usil;
      dsilM = dsil;
      invertSource = 'inverts';
    } else if (slope !== null && !Number.isNaN(slope)) {
      // Slope mode: downstream invert at 0, upstream from slope × length.
      dsilM = 0;
      usilM = slope * lengthM;
      invertSource = 'slope';
    } else {
      fail('give USIL & DSIL, or a slope');
      continue;
    }

    seenNames.add(name.toLowerCase());
    culverts.push({
      name,
      flowCms,
      cells,
      widthM,
      riseM,
      lengthM,
      usilM,
      dsilM,
      coverM,
      invertSource,
      crestM: crestElevationM(usilM, riseM, coverM),
    });
  }

  return { culverts, errors };
}
