// Minimal .xlsx reader — dependency-free, offline. An .xlsx file is a ZIP of
// XML parts; this reads the first worksheet into a dense string[][] grid.
// Deflated entries are inflated with the platform-native DecompressionStream
// ('deflate-raw'), available in Chromium/Edge/Safari 16.4+ and Node 18+, so
// no library needs to be vendored. Cell values come back as raw strings
// (numbers unformatted), which is exactly what the CSV pipeline expects.
// Not supported: legacy .xls (BIFF), encrypted workbooks, date formatting.

function readU16(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8);
}
function readU32(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

async function inflateRaw(compressed) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  // Errors (e.g. corrupt data) surface through reader.read(); swallow the
  // duplicate rejections on the writer promises so they aren't unhandled.
  writer.write(compressed).catch(() => {});
  writer.close().catch(() => {});

  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}

// Returns Map<fileName, Uint8Array> of the zip's entries.
async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  // End-of-central-directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file (zip directory not found)');
  const entryCount = readU16(bytes, eocd + 10);
  let off = readU32(bytes, eocd + 16);

  const decoder = new TextDecoder();
  const files = new Map();
  for (let e = 0; e < entryCount; e++) {
    if (readU32(bytes, off) !== 0x02014b50) throw new Error('Corrupt .xlsx (bad central directory)');
    const method = readU16(bytes, off + 10);
    const compSize = readU32(bytes, off + 20);
    const nameLen = readU16(bytes, off + 28);
    const extraLen = readU16(bytes, off + 30);
    const commentLen = readU16(bytes, off + 32);
    const localOff = readU32(bytes, off + 42);
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen));

    // Local header: name/extra lengths there may differ from the directory's.
    const lNameLen = readU16(bytes, localOff + 26);
    const lExtraLen = readU16(bytes, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflateRaw(data));
    else throw new Error(`Unsupported zip compression method ${method}`);

    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

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
  const files = await unzip(arrayBuffer);
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
