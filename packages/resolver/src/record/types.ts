/**
 * TypeScript counterparts of the Soroban structs defined in
 * `contracts-acta/contracts/did-stellar-registry/src/model.rs`.
 *
 * Two views of the same data are exposed:
 *
 * - {@link DidRecordInput} — what an integrator constructs before
 *   submitting `register` or `update`. Bookkeeping fields are omitted
 *   because the contract overwrites them.
 *
 * - {@link DidRecord} — what the SDK returns after decoding a record from
 *   the ledger. All bookkeeping fields are present.
 */

/** Single public-key entry. `publicKeyMultibase` is the W3C Multikey form. */
export interface DidKey {
  /** Multikey string, e.g. `z6Mk...` (Ed25519) or `z6LS...` (X25519). */
  readonly publicKeyMultibase: string;
}

/** A service endpoint published in the DID Document. */
export interface DidService {
  /** Lowercase alphanumeric + hyphen. Used as `{did}#service-{idSuffix}`. */
  readonly idSuffix: string;
  /** Free string; mapped to `type` in the DID Document. */
  readonly serviceType: string;
  /** Absolute HTTPS URL. Validated at the SDK boundary. */
  readonly serviceEndpoint: string;
}

/**
 * Caller-supplied fields for {@link DidRecord}. `version`, `createdLedger`,
 * `updatedLedger` and `deactivated` are intentionally absent — they are
 * owned by the contract and any value the caller passes would be ignored.
 */
export interface DidRecordInput {
  /** Stellar `G...` account that authorises mutations. */
  readonly controller: string;
  /** 1–3 authentication keys (required minimum 1). */
  readonly authentication: readonly DidKey[];
  /** 0–3 assertion-method keys. */
  readonly assertionMethod: readonly DidKey[];
  /** 0–1 key-agreement key. */
  readonly keyAgreement: readonly DidKey[];
  /** 0–3 services. */
  readonly services: readonly DidService[];
  /** Optional HTTPS URI to extended off-chain metadata. Validated when present. */
  readonly metadataUri?: string;
  /**
   * Optional SHA-256 of the metadata payload, as 64 lowercase hex
   * characters. The contract rejects a hash without `metadataUri`.
   */
  readonly metadataHash?: string;
}

/**
 * Full on-chain record as decoded from the registry. Contains both the
 * caller-supplied fields and the contract-managed bookkeeping fields.
 */
export interface DidRecord extends DidRecordInput {
  /** Mutation counter. Starts at 1, increments on every successful mutation. */
  readonly version: number;
  /** Ledger sequence at registration. Immutable after `register`. */
  readonly createdLedger: number;
  /** Ledger sequence of the most recent successful mutation. */
  readonly updatedLedger: number;
  /** One-way deactivation flag. */
  readonly deactivated: boolean;
}

// --- Contract bounds (mirror of contracts-acta/.../model.rs) ----------------

export const MAX_KEY_MULTIBASE_LEN = 128;
export const MIN_KEY_COUNT_AUTH = 1;
export const MAX_KEY_COUNT_AUTH = 3;
export const MAX_KEY_COUNT_ASSERT = 3;
export const MAX_KEY_COUNT_AGREEMENT = 1;
export const MAX_SERVICE_COUNT = 3;
export const MAX_SERVICE_ID_LEN = 32;
export const MAX_SERVICE_TYPE_LEN = 64;
export const MAX_URL_LEN = 255;
export const METADATA_HASH_LEN = 32;

/** Frozen view of every contract bound. Useful for UI input validation. */
export const DID_RECORD_LIMITS = Object.freeze({
  MAX_KEY_MULTIBASE_LEN,
  MIN_KEY_COUNT_AUTH,
  MAX_KEY_COUNT_AUTH,
  MAX_KEY_COUNT_ASSERT,
  MAX_KEY_COUNT_AGREEMENT,
  MAX_SERVICE_COUNT,
  MAX_SERVICE_ID_LEN,
  MAX_SERVICE_TYPE_LEN,
  MAX_URL_LEN,
  METADATA_HASH_LEN,
} as const);
