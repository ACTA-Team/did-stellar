/**
 * `did:stellar` identifier primitives.
 *
 * Implements the canonical syntax (spec v0.1 §2):
 *
 *     did:stellar:{network}:{didId}
 *     network = "mainnet" | "testnet"
 *     didId   = 26 chars base32 lowercase no-padding (16 raw bytes)
 *
 * This module is the only place in the SDK that knows how to mint, parse
 * and serialise a DID string. The contract stores the raw 16 bytes
 * (`BytesN<16>`); the SDK is responsible for the base32 ↔ bytes mapping.
 */

import { decodeBase32Lower, encodeBase32Lower } from './base32';
import { DidError } from './errors';
import type { NetworkType } from './network';
import { isNetworkType } from './network';

/** Number of bytes in the raw `didId`. Fixed at 16 per spec §2.3. */
export const DID_ID_BYTES = 16;
/** Number of characters in the base32 representation of `didId`. */
export const DID_ID_LENGTH = 26;

/** Canonical regex per spec §2.2. Lowercase only. */
export const DID_STELLAR_REGEX = /^did:stellar:(mainnet|testnet):([a-z2-7]{26})$/;

/** Regex for the bare `didId` (no `did:stellar:network:` prefix). */
export const DID_ID_REGEX = /^[a-z2-7]{26}$/;

/**
 * Generate a fresh `didId`.
 *
 * Returns 16 cryptographically random bytes. Use {@link encodeDidId} to
 * obtain the canonical base32 representation, or
 * {@link buildDidStellarFromBytes} to assemble the full DID in one step.
 *
 * Implementation notes: defers to `globalThis.crypto.getRandomValues`,
 * which is available in Node 18+ and every modern browser. Throws if no
 * Web Crypto is available — that environment cannot host a conformant
 * implementation, so failing fast is preferable to silently weakening
 * randomness.
 */
export function generateDidIdBytes(): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.getRandomValues !== 'function') {
    throw new DidError(
      'unknown',
      'Web Crypto API (crypto.getRandomValues) is not available in this environment'
    );
  }
  const bytes = new Uint8Array(DID_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Generate a fresh `didId` and return the canonical base32 string. */
export function generateDidId(): string {
  return encodeBase32Lower(generateDidIdBytes());
}

/** Encode 16 raw bytes as the canonical 26-character base32 string. */
export function encodeDidId(bytes: Uint8Array): string {
  if (bytes.length !== DID_ID_BYTES) {
    throw new DidError(
      'did_id_invalid',
      `didId must be ${DID_ID_BYTES} bytes, got ${bytes.length}`
    );
  }
  return encodeBase32Lower(bytes);
}

/** Decode a canonical 26-character base32 `didId` back to 16 raw bytes. */
export function decodeDidId(s: string): Uint8Array {
  if (!DID_ID_REGEX.test(s)) {
    throw new DidError(
      'did_id_invalid',
      `didId must match ${DID_ID_REGEX.source}, got: ${s}`
    );
  }
  const bytes = decodeBase32Lower(s);
  if (bytes.length !== DID_ID_BYTES) {
    throw new DidError(
      'did_id_invalid',
      `decoded didId is ${bytes.length} bytes, expected ${DID_ID_BYTES}`
    );
  }
  return bytes;
}

/** Compose the full DID from a base32 `didId`. */
export function buildDidStellar(network: NetworkType, didId: string): string {
  if (!isNetworkType(network)) {
    throw new DidError('network_invalid', `network must be mainnet or testnet, got: ${String(network)}`);
  }
  if (!DID_ID_REGEX.test(didId)) {
    throw new DidError('did_id_invalid', `didId must match ${DID_ID_REGEX.source}, got: ${didId}`);
  }
  return `did:stellar:${network}:${didId}`;
}

/** Compose the full DID from raw bytes. Convenience around {@link encodeDidId}. */
export function buildDidStellarFromBytes(network: NetworkType, didIdBytes: Uint8Array): string {
  return buildDidStellar(network, encodeDidId(didIdBytes));
}

/** Parsed components of a canonical `did:stellar:...` identifier. */
export interface ParsedDidStellar {
  network: NetworkType;
  didId: string;
  didIdBytes: Uint8Array;
}

/**
 * Parse a `did:stellar:...` string into its components. Throws
 * {@link DidError} `did_invalid` for any malformed input. The DID MUST be
 * lowercase — the spec is explicit (§2.4) that no case folding is
 * performed at parse time.
 */
export function parseDidStellar(did: string): ParsedDidStellar {
  if (typeof did !== 'string') {
    throw new DidError('did_invalid', `DID must be a string, got: ${typeof did}`);
  }
  const match = DID_STELLAR_REGEX.exec(did);
  if (!match) {
    throw new DidError(
      'did_invalid',
      `DID does not match ${DID_STELLAR_REGEX.source}: ${did}`
    );
  }
  const network = match[1] as NetworkType;
  const didId = match[2];
  if (didId === undefined) {
    throw new DidError('did_invalid', `unreachable: regex matched but capture group 2 missing for ${did}`);
  }
  const didIdBytes = decodeDidId(didId);
  return { network, didId, didIdBytes };
}

/** Non-throwing variant. Useful for input validation in UI layers. */
export function isValidDidStellar(did: string): boolean {
  if (typeof did !== 'string') return false;
  const match = DID_STELLAR_REGEX.exec(did);
  if (!match || match[2] === undefined) return false;
  try {
    decodeDidId(match[2]);
    return true;
  } catch {
    return false;
  }
}
