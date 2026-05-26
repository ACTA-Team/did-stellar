/**
 * Typed error hierarchy for `@acta-team/did-stellar`.
 *
 * Every error thrown by the SDK is an instance of {@link DidError} with a
 * stable {@link DidErrorCode} string. Consumers branch on `err.code`, never
 * on `err.message`.
 *
 * Codes fall into three groups:
 *
 * 1. **Client-side validation** (`did_*`, `key_*`, `service_*`,
 *    `metadata_*`, `*_invalid`, `*_too_long`, `*_required`). Surfaced when
 *    the SDK rejects an input before reaching the network. Mirror of the
 *    contract's `RegistryError` so an integrator that catches a
 *    pre-flight error and a chain error gets the same code string.
 *
 * 2. **Contract errors** (same set as group 1, raised when the contract
 *    returns the matching `RegistryError`). Mapped by
 *    {@link fromContractErrorMessage}.
 *
 * 3. **Transport** (`rpc_*`, `tx_*`, `http_*`). Surface failures of the
 *    Stellar RPC, transaction submission, or the optional HTTP client.
 */

/** Stable string identifier for any error this SDK throws. */
export type DidErrorCode =
  // --- Identifier / DID syntax ---
  | 'did_invalid'
  | 'did_id_invalid'
  | 'network_invalid'
  // --- Contract registry errors (mirror of RegistryError 1..20) ---
  | 'did_already_exists'
  | 'did_not_found'
  | 'version_mismatch'
  | 'did_deactivated'
  | 'invalid_auth_key_count'
  | 'invalid_assertion_key_count'
  | 'invalid_key_agreement_count'
  | 'invalid_service_count'
  | 'duplicate_key'
  | 'key_too_long'
  | 'key_empty'
  | 'service_type_too_long'
  | 'service_id_too_long'
  | 'service_id_invalid_format'
  | 'service_endpoint_invalid'
  | 'metadata_uri_invalid'
  | 'no_proposed_admin'
  | 'service_type_empty'
  | 'version_overflow'
  | 'metadata_inconsistent'
  // --- Client-side only ---
  | 'controller_invalid'
  | 'multibase_invalid'
  | 'multikey_unsupported'
  | 'contract_id_invalid'
  | 'rpc_url_invalid'
  | 'expected_version_required'
  // --- Proof of Control ---
  | 'challenge_invalid'
  | 'challenge_expired'
  | 'challenge_nonce_invalid'
  | 'challenge_domain_mismatch'
  | 'signature_invalid'
  // --- Transport ---
  | 'rpc_error'
  | 'tx_simulation_failed'
  | 'tx_submission_failed'
  | 'http_error'
  | 'unknown';

export interface DidErrorOptions {
  /** Original cause, preserved for diagnostics. Never serialised. */
  cause?: unknown;
  /** Free-form structured diagnostic payload (HTTP status, on-chain version, etc.). */
  details?: Readonly<Record<string, unknown>>;
}

/**
 * The single error class thrown by this SDK.
 *
 * Tagged with `name: 'DidError'` so `err.name === 'DidError'` works across
 * realm boundaries (bundlers, workers) where `instanceof` may fail.
 */
export class DidError extends Error {
  public override readonly name = 'DidError' as const;
  public readonly code: DidErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: DidErrorCode, message: string, options: DidErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Discriminator. Useful for narrowing across realm boundaries. */
  static is(value: unknown): value is DidError {
    return (
      value instanceof DidError ||
      (typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'DidError')
    );
  }
}

/**
 * Numeric Soroban contract error → SDK error code.
 *
 * Keep in lockstep with `contracts-acta/contracts/did-stellar-registry/src/errors.rs`.
 * Adding a new variant requires updating both ends and bumping the SDK
 * minor.
 */
const CONTRACT_ERROR_CODES: Readonly<Record<number, DidErrorCode>> = Object.freeze({
  1: 'did_already_exists',
  2: 'did_not_found',
  3: 'version_mismatch',
  4: 'did_deactivated',
  5: 'invalid_auth_key_count',
  6: 'invalid_assertion_key_count',
  7: 'invalid_key_agreement_count',
  8: 'invalid_service_count',
  9: 'duplicate_key',
  10: 'key_too_long',
  11: 'key_empty',
  12: 'service_type_too_long',
  13: 'service_id_too_long',
  14: 'service_id_invalid_format',
  15: 'service_endpoint_invalid',
  16: 'metadata_uri_invalid',
  17: 'no_proposed_admin',
  18: 'service_type_empty',
  19: 'version_overflow',
  20: 'metadata_inconsistent',
});

/**
 * Returns the SDK code for a given on-chain `RegistryError` number, or
 * `'unknown'` if the number is not part of the published v0.1 ABI.
 */
export function contractErrorCodeFromNumber(n: number): DidErrorCode {
  return CONTRACT_ERROR_CODES[n] ?? 'unknown';
}

/**
 * Extract a {@link DidError} from a Soroban error message. Soroban surfaces
 * contract errors as strings of shape `Error(Contract, #<n>)`. Returns
 * `null` when the message does not look like a contract error so callers
 * can fall back to a generic mapping.
 */
export function fromContractErrorMessage(err: unknown): DidError | null {
  const message = extractMessage(err);
  if (!message) return null;

  const match = /Error\(Contract,\s*#(\d+)\)/.exec(message);
  if (!match || match[1] === undefined) return null;

  const num = Number.parseInt(match[1], 10);
  if (!Number.isFinite(num)) return null;

  const code = contractErrorCodeFromNumber(num);
  return new DidError(code, `did-stellar-registry rejected the call: ${code} (#${num})`, {
    cause: err,
    details: { contractErrorNumber: num },
  });
}

function extractMessage(err: unknown): string | null {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return null;
}
