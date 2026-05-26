/**
 * Proof-of-Control challenge constructor.
 *
 * The challenge is a 4-field JSON object (§6.2). The verifier MUST
 * generate it server-side and present it to the wallet for signing.
 * This helper enforces the field shape so that, regardless of who built
 * the challenge, every implementation produces a byte-identical JCS
 * output for the same logical content.
 */

import { DidError } from '../errors';
import { isValidDidStellar } from '../identifier';

/** Wire shape of a proof-of-control challenge (§6.2). */
export interface PoCChallenge {
  readonly did: string;
  readonly domain: string;
  /** 16 bytes CSPRNG as lowercase hex, exactly 32 characters. */
  readonly nonce: string;
  /** ISO 8601 UTC, e.g. `2026-04-26T12:34:56Z`. */
  readonly timestamp: string;
}

/** Input shape for {@link buildChallenge}. `timestamp` defaults to now (UTC). */
export interface BuildChallengeArgs {
  readonly did: string;
  readonly domain: string;
  readonly nonce: string;
  readonly timestamp?: string;
}

const NONCE_REGEX = /^[0-9a-f]{32}$/;
const ISO_8601_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Construct a {@link PoCChallenge}. Validates every field per §6.2 and
 * throws {@link DidError} `challenge_invalid` on any violation.
 */
export function buildChallenge(args: BuildChallengeArgs): PoCChallenge {
  if (!isValidDidStellar(args.did)) {
    throw new DidError('challenge_invalid', `challenge.did is not a valid did:stellar identifier: ${args.did}`);
  }
  if (typeof args.domain !== 'string' || args.domain.length === 0) {
    throw new DidError('challenge_invalid', 'challenge.domain must be a non-empty string');
  }
  if (!NONCE_REGEX.test(args.nonce)) {
    throw new DidError('challenge_nonce_invalid', `challenge.nonce must be 32 lowercase hex chars, got: ${args.nonce}`);
  }
  const timestamp = args.timestamp ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  if (!ISO_8601_UTC_REGEX.test(timestamp)) {
    throw new DidError('challenge_invalid', `challenge.timestamp must be ISO 8601 UTC (...Z), got: ${timestamp}`);
  }
  return { did: args.did, domain: args.domain, nonce: args.nonce, timestamp };
}

/**
 * Generate a fresh CSPRNG nonce in the §6.2 format (16 bytes → 32 hex
 * chars). Useful for verifiers that build challenges in-process.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
