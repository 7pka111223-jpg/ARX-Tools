// Minimal ZIP reader shared by the .xlsx and .docx parsers — both formats
// are ZIP archives of XML parts. Deflated entries are inflated with the
// platform-native DecompressionStream ('deflate-raw'), available in
// Chromium/Edge/Safari 16.4+ and Node 18+, so nothing needs vendoring.

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

// Returns Map<fileName, Uint8Array> of the archive's entries.
// errorLabel names the expected format in error messages (e.g. '.xlsx').
export async function unzip(arrayBuffer, errorLabel = 'zip') {
  const bytes = new Uint8Array(arrayBuffer);
  // End-of-central-directory record: scan backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readU32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`Not a valid ${errorLabel} file (zip directory not found)`);
  const entryCount = readU16(bytes, eocd + 10);
  let off = readU32(bytes, eocd + 16);

  const decoder = new TextDecoder();
  const files = new Map();
  for (let e = 0; e < entryCount; e++) {
    if (readU32(bytes, off) !== 0x02014b50) throw new Error(`Corrupt ${errorLabel} file (bad central directory)`);
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

export function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
