/**
 * HTTP error envelope + `DidError` → HTTP mapping.
 *
 * Every endpoint emits the same JSON shape so integrators can branch on
 * `code` consistently:
 *
 * ```json
 * { "code": "version_mismatch", "message": "...", "details": { ... } }
 * ```
 *
 * The mapping table mirrors the contract's `RegistryError` plus the
 * spec-defined DIF resolver errors. Adding a new code here is a CI
 * surface — the SDK's `DidErrorCode` union and this table must stay in
 * lockstep.
 */

import { DidError, type DidErrorCode } from '@acta-team/did-stellar';

export interface HttpErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface HttpError {
  readonly status: number;
  readonly body: HttpErrorBody;
}

/** Static map: SDK code → HTTP status. */
const STATUS_BY_CODE: Readonly<Record<DidErrorCode, number>> = Object.freeze({
  // --- Identifier / DID syntax ---
  did_invalid: 400,
  did_id_invalid: 400,
  network_invalid: 400,
  // --- Contract registry ---
  did_already_exists: 409,
  did_not_found: 404,
  version_mismatch: 409,
  did_deactivated: 410,
  invalid_auth_key_count: 400,
  invalid_assertion_key_count: 400,
  invalid_key_agreement_count: 400,
  invalid_service_count: 400,
  duplicate_key: 400,
  key_too_long: 413,
  key_empty: 400,
  service_type_too_long: 413,
  service_id_too_long: 413,
  service_id_invalid_format: 400,
  service_endpoint_invalid: 400,
  metadata_uri_invalid: 400,
  no_proposed_admin: 404,
  service_type_empty: 400,
  version_overflow: 410,
  metadata_inconsistent: 400,
  // --- Client-side ---
  controller_invalid: 400,
  multibase_invalid: 400,
  multikey_unsupported: 400,
  contract_id_invalid: 500,
  rpc_url_invalid: 500,
  expected_version_required: 400,
  // --- Proof of Control ---
  challenge_invalid: 400,
  challenge_expired: 400,
  challenge_nonce_invalid: 400,
  challenge_domain_mismatch: 400,
  signature_invalid: 400,
  // --- Transport ---
  rpc_error: 502,
  tx_simulation_failed: 502,
  tx_submission_failed: 502,
  http_error: 502,
  // `unknown` is overwhelmingly used by client-side body validation
  // ("body.X must be ..."). Genuine internal errors flow through
  // `httpFromUnknown` and become 500 anyway.
  unknown: 400,
});

export function httpFromDidError(err: DidError): HttpError {
  const status = STATUS_BY_CODE[err.code] ?? 500;
  return {
    status,
    body: {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    },
  };
}

export function httpFromUnknown(err: unknown): HttpError {
  if (DidError.is(err)) return httpFromDidError(err);
  if (err instanceof SyntaxError) {
    return {
      status: 400,
      body: { code: 'invalid_json', message: err.message },
    };
  }
  return {
    status: 500,
    body: {
      code: 'internal_error',
      message: err instanceof Error ? err.message : 'unexpected error',
    },
  };
}
