// Minimal .xlsx reader — dependency-free, offline. An .xlsx file is a ZIP of
// XML parts; this reads the first worksheet into a dense string[][] grid.
// Cell values come back as raw strings (numbers unformatted), which is
// exactly what the CSV pipeline expects. Not supported: legacy .xls (BIFF),
// encrypted workbooks, date formatting.

import { unzip, decodeXmlEntities } from './zip.js';

// Concatenated text of all <t> runs in an <si> or <is> fragment.
function textRuns(fragment) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(fragment))) out += m[1] === undefined ? '' : decodeXmlEntities(m[1]);
  return out;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) strings.push(textRuns(m[1]));
  return strings;
}

function columnIndex(cellRef) {
  let col = 0;
  for (const ch of cellRef) {
    if (ch >= 'A' && ch <= 'Z') col = col * 26 + (ch.charCodeAt(0) - 64);
    else break;
  }
  return col - 1;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2] || '';
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const col = refMatch ? columnIndex(refMatch[1]) : cells.length;
      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const type = typeMatch ? typeMatch[1] : 'n';

      let value = '';
      if (type === 'inlineStr') {
        value = textRuns(inner);
      } else {
        const vMatch = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        const raw = vMatch ? decodeXmlEntities(vMatch[1]) : '';
        value = type === 's' ? sharedStrings[Number(raw)] ?? '' : raw;
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    rows.push(cells);
  }
  return rows;
}

// Reads the first worksheet of an .xlsx ArrayBuffer as a string[][] grid.
export async function parseXlsxRows(arrayBuffer) {
  const files = await unzip(arrayBuffer, '.xlsx');
  const decoder = new TextDecoder();

  const sheetNames = [...files.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  if (!sheetNames.length) throw new Error('No worksheet found in the .xlsx file');

  const shared = parseSharedStrings(files.has('xl/sharedStrings.xml') ? decoder.decode(files.get('xl/sharedStrings.xml')) : '');
  return parseSheet(decoder.decode(files.get(sheetNames[0])), shared);
}

// Flattens a sheet grid into "a,b,c" text lines (for the flow-input textarea).
export function rowsToText(rows) {
  return rows
    .filter((r) => r.some((f) => String(f).trim() !== ''))
    .map((r) => r.join(','))
    .join('\n');
}
