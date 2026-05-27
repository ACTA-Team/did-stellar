/**
 * Verify a proof-of-control signature against a resolved DID Document.
 *
 * Algorithm per spec v0.1 §6.5, executed in the exact order the spec
 * mandates (the timestamp check fires before the signature verification
 * to prevent attackers wasting verifier CPU on stale challenges).
 *
 * The verifier is intentionally pluggable:
 *
 *  - The DID Document is passed in (the caller has already resolved it).
 *  - Nonce deduplication is a verifier responsibility — the SDK is
 *    stateless and does not maintain a nonce store. The caller passes
 *    `isNonceFresh` to plug their own (Redis, in-memory, etc.).
 */

import { verifyAsync } from '@noble/ed25519';
import { base64urlnopad } from '@scure/base';

import { DidError, type DidErrorCode } from '../errors';
import { decodeMultikey } from '../multikey';

import { jcsCanonicalize } from './jcs';

import type { PoCChallenge } from './challenge';
import type { DidDocument } from '../document/types';

/** Default ±window for the timestamp check (5 minutes per §6.5 step 2). */
export const DEFAULT_TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

export interface VerifyProofOfControlArgs {
  readonly challenge: PoCChallenge;
  /** Signature in base64url-without-padding form (§6.4). */
  readonly signature: string;
  /** DID Document, as returned by {@link resolveDidStellar}. */
  readonly didDocument: DidDocument;
  /** Verifier's own domain. The challenge.domain MUST equal this. */
  readonly expectedDomain: string;
  /**
   * Optional callback to assert the nonce has not been seen before for
   * the same DID within the deduplication window. Default: always-true
   * (caller takes responsibility).
   */
  readonly isNonceFresh?: (nonce: string, did: string) => boolean | Promise<boolean>;
  /** Override the ±timestamp window (default 5 minutes). */
  readonly timestampWindowMs?: number;
  /** Override `Date.now()` for deterministic tests. */
  readonly now?: () => number;
}

export interface VerifyProofOfControlResult {
  readonly valid: boolean;
  /** Populated when `valid === false`. */
  readonly reason?: DidError;
  /** The verificationMethod fragment that produced a successful signature, if any. */
  readonly matchedKeyId?: string;
}

/**
 * Verify a proof-of-control. Returns a structured result instead of
 * throwing so the verifier can record failures (audit / abuse
 * detection) without needing a try/catch.
 */
export async function verifyProofOfControl(
  args: VerifyProofOfControlArgs
): Promise<VerifyProofOfControlResult> {
  const now = args.now ?? Date.now;
  const windowMs = args.timestampWindowMs ?? DEFAULT_TIMESTAMP_WINDOW_MS;

  // 1. Timestamp window (BEFORE signature check, per §6.5 / §7.5).
  const tsMs = Date.parse(args.challenge.timestamp);
  if (!Number.isFinite(tsMs)) {
    return reason(
      'challenge_invalid',
      `unparseable challenge.timestamp: ${args.challenge.timestamp}`
    );
  }
  if (Math.abs(now() - tsMs) > windowMs) {
    return reason('challenge_expired', `challenge.timestamp outside ±${windowMs}ms window`);
  }

  // 2. Domain match.
  if (args.challenge.domain !== args.expectedDomain) {
    return reason(
      'challenge_domain_mismatch',
      `challenge.domain (${args.challenge.domain}) does not match verifier domain (${args.expectedDomain})`
    );
  }

  // 3. Nonce dedup.
  if (args.isNonceFresh) {
    const fresh = await args.isNonceFresh(args.challenge.nonce, args.challenge.did);
    if (!fresh) {
      return reason('challenge_nonce_invalid', `nonce ${args.challenge.nonce} has been reused`);
    }
  }

  // 4. DID Document must be active and match the challenge.
  if (args.didDocument.id !== args.challenge.did) {
    return reason(
      'challenge_invalid',
      `challenge.did (${args.challenge.did}) does not match didDocument.id (${args.didDocument.id})`
    );
  }
  if (args.didDocument.authentication.length === 0) {
    // A tombstone (or a non-conformant document) — no key to verify against.
    return reason('did_deactivated', `${args.didDocument.id} has no active authentication keys`);
  }

  // 5. Canonicalise the challenge with JCS.
  const message = jcsCanonicalize({
    did: args.challenge.did,
    domain: args.challenge.domain,
    nonce: args.challenge.nonce,
    timestamp: args.challenge.timestamp,
  });

  // 6. Decode the signature once.
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64urlnopad.decode(args.signature);
  } catch (cause) {
    return reason('signature_invalid', 'signature is not valid base64url-nopad', cause);
  }

  // 7. Try every authentication key. Success on first match.
  for (const ref of args.didDocument.authentication) {
    const vm = args.didDocument.verificationMethod.find((m) => m.id === ref);
    if (!vm) continue;
    let publicKey: Uint8Array;
    try {
      const decoded = decodeMultikey(vm.publicKeyMultibase);
      if (decoded.curve !== 'Ed25519') continue; // PoC only uses Ed25519 keys.
      publicKey = decoded.publicKey;
    } catch {
      continue; // Skip malformed entries; try the next one.
    }
    try {
      const ok = await verifyAsync(signatureBytes, message, publicKey);
      if (ok) return { valid: true, matchedKeyId: vm.id };
    } catch {
      // verifyAsync throws on malformed signature length; try next key.
    }
  }

  return reason('signature_invalid', 'no authentication key verified the signature');
}

function reason(code: DidErrorCode, message: string, cause?: unknown): VerifyProofOfControlResult {
  return {
    valid: false,
    reason: new DidError(code, message, cause === undefined ? {} : { cause }),
  };
}
