/**
 * RFC 4648 base32 encoding, lowercase, **without padding**.
 *
 * Used to encode the 16-byte `didId` as the canonical 26-character base32
 * suffix of a `did:stellar:...` identifier (spec v0.1 §2.3).
 *
 * Thin wrapper around `@scure/base` so the canonicalisation rules
 * (lowercase, no `=` padding) are enforced in a single place and the rest
 * of the SDK never has to remember to call `.toLowerCase()` or strip `=`.
 */

import { base32 } from '@scure/base';

import { DidError } from './errors';

/** Encode bytes as RFC 4648 base32 lowercase without padding. */
export function encodeBase32Lower(bytes: Uint8Array): string {
  // `@scure/base` returns uppercase with `=` padding by default.
  return base32.encode(bytes).replace(/=+$/u, '').toLowerCase();
}

/**
 * Decode an RFC 4648 base32 lowercase string. Tolerates uppercase input and
 * missing padding; both are normalised before delegating to `@scure/base`.
 *
 * Throws {@link DidError} `did_id_invalid` for malformed input.
 */
export function decodeBase32Lower(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length === 0) {
    throw new DidError('did_id_invalid', 'base32 input must be a non-empty string');
  }
  const upper = s.toUpperCase();
  // RFC 4648 base32 always pads to multiples of 8 characters with '='.
  const padded = upper + '='.repeat((8 - (upper.length % 8)) % 8);
  try {
    return base32.decode(padded);
  } catch (cause) {
    throw new DidError('did_id_invalid', `invalid base32 input: ${s}`, { cause });
  }
}
