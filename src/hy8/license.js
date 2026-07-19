// Offline licensing gate for the HY-8 tool. A license key is a compact
// signed token: base64(payload) + "." + base64(RSA-2048 signature), where the
// payload is compact sorted JSON {"exp":"YYYY-MM-DD","m":"<machine id>"}
// signed with EMSA-PKCS1-v1_5 / SHA-256 by the vendor tool
// (tools/hy8_license_admin.py — never shipped to customers). Only the PUBLIC
// modulus lives here, so the page can verify keys but never issue them, and
// everything still runs fully offline (BigInt modular exponentiation + a
// vendored SHA-256 — no WebCrypto, so it also works in JSDOM and old
// file:// contexts).

export const PUBLIC_KEY_MODULUS_HEX =
  'b01e191adcad977d73a31abbc43be21986cf733ed68a5de99b06ff532eb4b3d731bb54b5ef995243a077e665dee1f3e9e54b3596f206ee6f5e41d500bac38dfca0d3ccf4908be808a08ae96949bacb6b3291685b6253c0c3fca2b1fd9e7787161f2dcc1873a4f7f8553154d01535ff3b156c37d04dfd3571c5704468987538d99f40c1d098d8b246ba17911a09da326c2490dd57c657b11e4cd8a442f525d70b548fc84384b96d71a8ae3445b133878a7f2896e21c9e8c3fadbd33d61bc075f16ab3423da6229ceb7ce43c7881f1c7eeebb94d8188f76233e9d4324273f7e13833116dc2ba0e2ddb46a0131ad904621c03a844264131fec52d884988b4502cd5';
export const PUBLIC_KEY_EXPONENT = 65537n;

export const LICENSE_STORAGE_KEY = 'arxHy8LicenseKey';

// ---------------------------------------------------------------------------
// SHA-256 (synchronous, vendored — public-domain style implementation)
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Bytes(bytes) {
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i]);
  return out;
}

function utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

export function sha256Hex(str) {
  return [...sha256Bytes(utf8Bytes(str))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Machine ID — deterministic fingerprint of stable browser/host properties,
// so it survives cache clearing and restarts (but differs across browsers,
// which is the intended per-installation binding).
// ---------------------------------------------------------------------------

export function deriveMachineId(parts) {
  const hex = sha256Hex(parts.map((p) => String(p)).join('|')).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export function browserMachineId() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const scr = typeof screen !== 'undefined' ? screen : {};
  return deriveMachineId([
    nav.platform,
    nav.language,
    nav.hardwareConcurrency,
    nav.deviceMemory,
    scr.width,
    scr.height,
    scr.colorDepth,
    new Date().getTimezoneOffset(),
  ]);
}

// ---------------------------------------------------------------------------
// RSA signature verification (EMSA-PKCS1-v1_5 / SHA-256, BigInt modexp)
// ---------------------------------------------------------------------------

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

const SHA256_DER_PREFIX = '3031300d060960864801650304020105000420';

function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function verifySignature(payloadText, signatureBytes, modulusHex = PUBLIC_KEY_MODULUS_HEX, exponent = PUBLIC_KEY_EXPONENT) {
  const n = BigInt('0x' + modulusHex);
  const keyLen = modulusHex.length / 2;
  if (signatureBytes.length !== keyLen) return false;
  const em = modPow(bytesToBigInt(signatureBytes), exponent, n)
    .toString(16)
    .padStart(keyLen * 2, '0');
  const digestHex = [...sha256Bytes(utf8Bytes(payloadText))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expectedTail = SHA256_DER_PREFIX + digestHex;
  if (!em.startsWith('0001')) return false;
  if (!em.endsWith('00' + expectedTail)) return false;
  // Everything between the 0001 header and the 00 separator must be ff padding.
  const padding = em.slice(4, em.length - expectedTail.length - 2);
  return padding.length >= 16 && /^f+$/.test(padding) && padding.length % 2 === 0 && /^(ff)+$/.test(padding);
}

// ---------------------------------------------------------------------------
// License keys
// ---------------------------------------------------------------------------

function todayIso(now) {
  const d = now ? new Date(now) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Verifies a pasted license key against this machine. Returns
// { valid, reason, expires, machineId } — reason is a user-showable message
// when invalid. Keys are valid through their expiry date (inclusive).
export function verifyLicenseKey(key, machineId, now = null) {
  const cleaned = String(key || '').replace(/\s+/g, '');
  if (!cleaned) return { valid: false, reason: 'no license key entered' };
  const dot = cleaned.indexOf('.');
  if (dot <= 0 || dot === cleaned.length - 1) {
    return { valid: false, reason: 'malformed license key (expected two dot-separated parts)' };
  }
  let payloadText;
  let sigBytes;
  try {
    payloadText = atob(cleaned.slice(0, dot));
    sigBytes = base64ToBytes(cleaned.slice(dot + 1));
  } catch {
    return { valid: false, reason: 'malformed license key (bad encoding)' };
  }
  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return { valid: false, reason: 'malformed license key (bad payload)' };
  }
  if (!verifySignature(payloadText, sigBytes)) {
    return { valid: false, reason: 'invalid license key (signature check failed)' };
  }
  const boundTo = String(payload.m || '').toUpperCase();
  if (boundTo !== 'ANY' && boundTo !== String(machineId).toUpperCase()) {
    return { valid: false, reason: `license key is for machine ${boundTo}, not this machine`, expires: payload.exp };
  }
  if (payload.exp && todayIso(now) > payload.exp) {
    return { valid: false, reason: `license expired on ${payload.exp}`, expires: payload.exp };
  }
  return { valid: true, reason: null, expires: payload.exp || null, machineId: boundTo };
}
