// Reader for HY-8's "Culvert Analysis Report" .docx: pulls out each
// per-culvert "Culvert Summary Table" as a text grid. A .docx is a ZIP with
// the document body in word/document.xml; each summary table is preceded by
// a caption paragraph like "Table 12 - Culvert Summary Table: CU-JAS-20".

import { unzip, decodeXmlEntities } from './zip.js';

const CAPTION_RE = /Culvert Summary Table:\s*(.+?)\s*$/;

function textOf(fragment) {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(fragment))) out += decodeXmlEntities(m[1]);
  return out;
}

function parseTable(tblXml) {
  const rows = [];
  const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  const cellRe = /<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tblXml))) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[0]))) cells.push(textOf(cellMatch[0]).trim());
    rows.push(cells);
  }
  return rows;
}

// Returns [{ name, header, rows }] — one entry per captioned summary table;
// header is the column-title row, rows are the data rows below it.
export async function parseDocxSummaryTables(arrayBuffer) {
  const files = await unzip(arrayBuffer, '.docx');
  const documentXml = files.get('word/document.xml');
  if (!documentXml) throw new Error('Not a valid .docx file (word/document.xml missing)');
  const xml = new TextDecoder().decode(documentXml);

  // Walk paragraphs and tables in document order; a caption paragraph names
  // the table that follows it. Paragraphs inside table cells are consumed as
  // part of the table match, so they can't be mistaken for captions.
  const tables = [];
  let pendingName = null;
  const blockRe = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = blockRe.exec(xml))) {
    const block = m[0];
    if (block.startsWith('<w:tbl>')) {
      if (pendingName) {
        const grid = parseTable(block);
        if (grid.length >= 2) tables.push({ name: pendingName, header: grid[0], rows: grid.slice(1) });
        pendingName = null;
      }
    } else {
      const caption = CAPTION_RE.exec(textOf(block));
      if (caption) pendingName = caption[1];
    }
  }
  return tables;
}
