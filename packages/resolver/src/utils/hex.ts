/**
 * Hex encoding helpers.
 *
 * The SDK only deals with one hex shape: the lowercase 64-char form of a
 * SHA-256 digest (`metadataHash`). These helpers exist so the validation
 * happens once at the boundary and never re-runs downstream.
 */

import { DidError } from '../errors';

import type { Hex32 } from './branded';

const HEX32_REGEX = /^[0-9a-f]{64}$/;

/** Type guard for the lowercase 64-char hex shape. */
export function isHex32(s: string): s is Hex32 {
  return typeof s === 'string' && HEX32_REGEX.test(s);
}

/**
 * Assert / brand a candidate hex string as {@link Hex32}. Throws
 * `unknown` (a generic invalid-input code) if it doesn't match.
 */
export function asHex32(s: string): Hex32 {
  if (!isHex32(s)) {
    throw new DidError('unknown', `expected 64-char lowercase hex (Hex32), got: ${s}`);
  }
  return s;
}

/** Decode a hex string to bytes. Length is not enforced here. */
export function hexToBytes(s: string): Uint8Array {
  if (s.length % 2 !== 0) {
    throw new DidError('unknown', `hex string must have even length, got ${s.length}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new DidError(
        'unknown',
        `invalid hex digit at offset ${i * 2}: ${s.slice(i * 2, i * 2 + 2)}`
      );
    }
    out[i] = byte;
  }
  return out;
}

/** Encode bytes as a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}
