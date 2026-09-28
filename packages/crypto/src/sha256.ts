/**
 * Real SHA-256 hashing, isomorphic between Node (>=18) and browsers.
 * Both environments expose the WebCrypto API on `globalThis.crypto`,
 * so a single implementation serves the API, the web app and tests.
 */

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error(
    'WebCrypto (globalThis.crypto.subtle) is unavailable. Node >= 18 or a modern browser is required.'
  );
}

const HEX_RE = /^(0x)?[0-9a-fA-F]+$/;

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!HEX_RE.test(clean) || clean.length % 2 !== 0) {
    throw new Error(`Invalid hex string: ${hex.slice(0, 32)}…`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** SHA-256 of raw bytes → 32-byte digest. */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  // Copy into a fresh ArrayBuffer so Node Buffers with offsets hash correctly.
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

/** SHA-256 → lowercase hex digest (no 0x prefix). */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return bytesToHex(await sha256(data));
}

/** Normalize a 32-byte hex digest into a 0x-prefixed bytes32 string. */
export function toBytes32(hexDigest: string): `0x${string}` {
  const clean = hexDigest.startsWith('0x') ? hexDigest.slice(2) : hexDigest;
  if (!HEX_RE.test(clean) || clean.length !== 64) {
    throw new Error(`Expected a 32-byte hex digest, got ${clean.length / 2} bytes`);
  }
  return `0x${clean.toLowerCase()}` as `0x${string}`;
}
