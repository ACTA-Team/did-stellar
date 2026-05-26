/**
 * Multikey codec for the verification methods stored on-chain.
 *
 * `did:stellar` v0.1 §5.4 mandates the `Multikey` verification method type
 * with multibase base58btc-encoded keys. v0.1 ships two curves:
 *
 * | Relationship | Curve | Multicodec prefix | Multibase prefix |
 * |---|---|---|---|
 * | `authentication`, `assertionMethod` | Ed25519 (public) | `0xed 0x01` | `z6Mk` |
 * | `keyAgreement`                      | X25519 (public)  | `0xec 0x01` | `z6LS` |
 *
 * The multibase character is always `z` (base58btc) per W3C CID 1.0.
 *
 * This module is intentionally tiny — only what the SDK needs to validate
 * keys at ingest, derive Ed25519 public bytes for signature verification
 * (proof-of-control), and recognise the curve a key belongs to. It does
 * NOT mint keys: key generation belongs to the wallet, not the SDK.
 */

import { base58 } from '@scure/base';

import { DidError } from './errors';

/** Supported Multikey curves in `did:stellar` v0.1. */
export type MultikeyCurve = 'Ed25519' | 'X25519';

/** Multicodec varint prefix bytes, one per supported curve. */
const PREFIX: Readonly<Record<MultikeyCurve, Uint8Array>> = {
  Ed25519: new Uint8Array([0xed, 0x01]),
  X25519: new Uint8Array([0xec, 0x01]),
};

const EXPECTED_KEY_LENGTH = 32;

/**
 * Detect the curve of a multibase key.
 *
 * Returns `null` for valid multibase strings whose prefix is not part of
 * v0.1 (forward-compat with future suites). Throws {@link DidError}
 * `multibase_invalid` only when the input is not parseable at all.
 */
export function detectCurve(publicKeyMultibase: string): MultikeyCurve | null {
  const bytes = decodeMultibaseBase58btc(publicKeyMultibase);
  if (bytes.length < 2) return null;
  if (bytes[0] === 0xed && bytes[1] === 0x01) return 'Ed25519';
  if (bytes[0] === 0xec && bytes[1] === 0x01) return 'X25519';
  return null;
}

/**
 * Decode a multibase base58btc string of shape `z<base58>` and return the
 * multicodec-prefixed bytes. Does not strip the prefix.
 */
export function decodeMultibaseBase58btc(s: string): Uint8Array {
  if (typeof s !== 'string' || s.length < 2 || s[0] !== 'z') {
    throw new DidError(
      'multibase_invalid',
      `expected multibase base58btc string starting with 'z', got: ${String(s)}`
    );
  }
  try {
    return base58.decode(s.slice(1));
  } catch (cause) {
    throw new DidError('multibase_invalid', `invalid base58btc payload in ${s}`, { cause });
  }
}

/**
 * Decode a Multikey public key and return the raw curve point bytes
 * (without the multicodec prefix).
 *
 * Throws:
 * - `multibase_invalid` if the input is not a valid `z<base58>` string.
 * - `multikey_unsupported` if the curve is not Ed25519 nor X25519.
 * - `multikey_unsupported` if the raw key length is not 32 bytes.
 */
export function decodeMultikey(publicKeyMultibase: string): {
  curve: MultikeyCurve;
  publicKey: Uint8Array;
} {
  const bytes = decodeMultibaseBase58btc(publicKeyMultibase);
  const curve = detectCurve(publicKeyMultibase);
  if (curve === null) {
    throw new DidError(
      'multikey_unsupported',
      `unsupported Multikey curve prefix in ${publicKeyMultibase}`
    );
  }
  const prefix = PREFIX[curve];
  const raw = bytes.subarray(prefix.length);
  if (raw.length !== EXPECTED_KEY_LENGTH) {
    throw new DidError(
      'multikey_unsupported',
      `expected ${EXPECTED_KEY_LENGTH}-byte raw key for ${curve}, got ${raw.length}`
    );
  }
  return { curve, publicKey: raw };
}

/**
 * Encode raw public-key bytes as a Multikey base58btc string.
 *
 * Provided for tests, examples, and integrators that need to construct
 * Multikey strings from raw bytes (e.g. wrapping a freshly generated
 * keypair). The SDK itself does not call this in the resolver hot path.
 */
export function encodeMultikey(curve: MultikeyCurve, publicKey: Uint8Array): string {
  if (publicKey.length !== EXPECTED_KEY_LENGTH) {
    throw new DidError(
      'multikey_unsupported',
      `${curve} public key must be ${EXPECTED_KEY_LENGTH} bytes, got ${publicKey.length}`
    );
  }
  const prefix = PREFIX[curve];
  const out = new Uint8Array(prefix.length + publicKey.length);
  out.set(prefix, 0);
  out.set(publicKey, prefix.length);
  return `z${base58.encode(out)}`;
}
