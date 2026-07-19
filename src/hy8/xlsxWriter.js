// Minimal .xlsx writer — dependency-free, offline — used to generate the
// downloadable project-creator template. An .xlsx is a ZIP of XML parts;
// entries are stored uncompressed (ZIP method 0), which every unzipper —
// including this repo's zip.js reader — accepts, so no compressor is needed.
// Strings are written as inline strings (no sharedStrings part).

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnLetter(index) {
  let s = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

// Conditional-formatting XML for a sheet. Each rule flags cells in one column
// whose value is greater/less than a constant threshold, using the single red
// differential format (dxfId 0) defined in styles.xml.
function conditionalFormattingXml(rules, rowCount) {
  if (!rules || !rules.length || rowCount < 2) return '';
  return rules
    .map((rule, i) => {
      const colLetter = columnLetter(rule.col);
      const first = rule.firstDataRow || 2;
      const last = rule.lastDataRow || rowCount;
      if (last < first) return '';
      const sqref = `${colLetter}${first}:${colLetter}${last}`;
      return (
        `<conditionalFormatting sqref="${sqref}">` +
        `<cfRule type="cellIs" dxfId="0" priority="${i + 1}" operator="${rule.operator}">` +
        `<formula>${rule.formula}</formula></cfRule></conditionalFormatting>`
      );
    })
    .join('');
}

function sheetXml(rows, rules) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === undefined || value === '') return '';
          const ref = `${columnLetter(c)}${r + 1}`;
          if (typeof value === 'number' && Number.isFinite(value)) {
            return `<c r="${ref}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  // conditionalFormatting must follow sheetData in the worksheet schema.
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData>` +
    conditionalFormattingXml(rules, rows.length) +
    '</worksheet>'
  );
}

// A single differential format (dxfId 0): light-red fill + dark-red text,
// Excel's standard "bad" highlight, referenced by every conditional rule.
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<dxfs count="1"><dxf><font><color rgb="FF9C0006"/></font>' +
  '<fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>' +
  '</styleSheet>';

function contentTypesXml(sheetCount) {
  const overrides = [];
  for (let i = 1; i <= sheetCount; i++) {
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    overrides.join('') +
    '</Types>'
  );
}

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

// Sheets take rId1..rIdN; styles takes rId(N+1).
function workbookRelsXml(sheetCount) {
  const rels = [];
  for (let i = 1; i <= sheetCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`
    );
  }
  rels.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
  );
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels.join('') +
    '</Relationships>'
  );
}

function workbookXml(sheetNames) {
  const sheets = sheetNames
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

// -- Stored-entry ZIP writer --

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(v) {
  return [v & 0xff, (v >>> 8) & 0xff];
}

function u32(v) {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

function zipStored(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data);
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0),
    ]);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length),
        ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      nameBytes
    );
    chunks.push(header, nameBytes, data);
    offset += header.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(centralStart), ...u16(0),
  ]);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const chunk of [...chunks, ...central, eocd]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

// sheets: [{ name, rows, rules? }] — one or more worksheets. Each rows is a
// (string | number | null)[][] grid (inline strings). rules is an optional
// array of conditional-formatting rules { col, operator, formula,
// firstDataRow?, lastDataRow? } that highlight out-of-threshold cells red.
export function buildWorkbook(sheets) {
  const entries = [
    ['[Content_Types].xml', contentTypesXml(sheets.length)],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', workbookXml(sheets.map((s) => s.name))],
    ['xl/_rels/workbook.xml.rels', workbookRelsXml(sheets.length)],
    ['xl/styles.xml', STYLES_XML],
  ];
  sheets.forEach((sheet, i) => {
    entries.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows, sheet.rules)]);
  });
  return zipStored(entries);
}

// rows: (string | number | null)[][] — single worksheet convenience wrapper.
export function buildXlsx(rows, sheetName = 'Sheet1') {
  return buildWorkbook([{ name: sheetName, rows }]);
}

// The downloadable culvert-list template for the "Create new HY-8" tab.
// Column names match the creatorRows.js parser; the two example rows show
// the two invert modes (direct USIL/DSIL vs slope).
export const CREATOR_TEMPLATE_ROWS = [
  ['Fill one row per culvert (SI units). Give USIL & DSIL, or leave both blank and give a Slope (m/m) — then DSIL is taken as 0 and USIL = slope × length. Delete the two example rows before importing.'],
  ['Name', 'Design Flow (m3/s)', 'Cells', 'Width (m)', 'Rise (m)', 'Length (m)', 'USIL (m)', 'DSIL (m)', 'Slope (m/m)'],
  ['CU-EX-01', 10, 2, 2.5, 2.5, 72.3, 5.2, 4.85, ''],
  ['CU-EX-02', 5, 1, 1.5, 1.5, 40, '', '', 0.005],
];

export function buildCreatorTemplateXlsx() {
  return buildXlsx(CREATOR_TEMPLATE_ROWS, 'Culverts');
}
