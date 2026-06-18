/**
 * Client-side validation of {@link DidRecordInput}.
 *
 * Mirrors `validate_record` in
 * `contracts-acta/contracts/did-stellar-registry/src/contract.rs`. The
 * intent is to reject malformed input before paying for a Soroban
 * simulation, while preserving the contract's authoritative rules: every
 * code raised here corresponds 1:1 to a `RegistryError` so consumers
 * never need to branch on whether the rejection came from the SDK or
 * from the chain.
 */

import { StrKey } from '@stellar/stellar-sdk';

import { DidError } from '../errors';
import { decodeMultikey } from '../multikey';
import { isHex32 } from '../utils/hex';
import { isHttpsUrl } from '../utils/url';

import {
  MAX_KEY_COUNT_AGREEMENT,
  MAX_KEY_COUNT_ASSERT,
  MAX_KEY_COUNT_AUTH,
  MAX_KEY_MULTIBASE_LEN,
  MAX_SERVICE_COUNT,
  MAX_SERVICE_ID_LEN,
  MAX_SERVICE_TYPE_LEN,
  MAX_URL_LEN,
  METADATA_HASH_LEN,
  MIN_KEY_COUNT_AUTH,
} from './types';

import type { DidKey, DidRecordInput, DidService } from './types';

const SERVICE_ID_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Full validation pass over a {@link DidRecordInput}. Throws on the
 * first violation found. Returns nothing on success.
 *
 * Side-effect free; pure with respect to its input.
 */
export function validateDidRecordInput(input: DidRecordInput): void {
  // --- Controller ---
  if (!StrKey.isValidEd25519PublicKey(input.controller)) {
    throw new DidError(
      'controller_invalid',
      `controller must be a classic Stellar account (G...), got: ${input.controller}`
    );
  }

  // --- Key counts ---
  const authLen = input.authentication.length;
  if (authLen < MIN_KEY_COUNT_AUTH || authLen > MAX_KEY_COUNT_AUTH) {
    throw new DidError(
      'invalid_auth_key_count',
      `authentication must contain between ${MIN_KEY_COUNT_AUTH} and ${MAX_KEY_COUNT_AUTH} keys, got ${authLen}`
    );
  }
  if (input.assertionMethod.length > MAX_KEY_COUNT_ASSERT) {
    throw new DidError(
      'invalid_assertion_key_count',
      `assertionMethod must contain at most ${MAX_KEY_COUNT_ASSERT} keys, got ${input.assertionMethod.length}`
    );
  }
  if (input.keyAgreement.length > MAX_KEY_COUNT_AGREEMENT) {
    throw new DidError(
      'invalid_key_agreement_count',
      `keyAgreement must contain at most ${MAX_KEY_COUNT_AGREEMENT} key(s), got ${input.keyAgreement.length}`
    );
  }
  if (input.services.length > MAX_SERVICE_COUNT) {
    throw new DidError(
      'invalid_service_count',
      `services must contain at most ${MAX_SERVICE_COUNT} entries, got ${input.services.length}`
    );
  }

  // --- Per-key validation + intra-relationship duplicates ---
  // The same publicKeyMultibase MAY appear across distinct verification
  // relationships (e.g. `authentication` and `assertionMethod`): each
  // relationship gets its own fragment ID in the emitted DID Document, so
  // W3C DID Core 1.1 §3.2's uniqueness requirement on `id` is satisfied
  // even when the underlying key material is reused. This mirrors the
  // contract's `validate_record` after the cross-relation check was
  // removed during the v0.1 audit.
  validateKeysNoDuplicates(input.authentication);
  validateKeysNoDuplicates(input.assertionMethod);
  validateKeysNoDuplicates(input.keyAgreement);

  // --- Services ---
  for (const s of input.services) validateService(s);

  // --- Metadata URI ---
  if (input.metadataUri !== undefined && !isHttpsUrl(input.metadataUri)) {
    throw new DidError(
      'metadata_uri_invalid',
      `metadataUri must be an absolute https:// URL (max ${MAX_URL_LEN} chars), got: ${String(input.metadataUri)}`
    );
  }

  // --- Metadata consistency: hash without URI is orphaned ---
  if (input.metadataHash !== undefined && input.metadataUri === undefined) {
    throw new DidError(
      'metadata_inconsistent',
      'metadataHash is present but metadataUri is absent; an integrity hash without a URI is meaningless'
    );
  }
  if (input.metadataHash !== undefined && !isHex32(input.metadataHash)) {
    throw new DidError(
      'metadata_inconsistent',
      `metadataHash must be a ${METADATA_HASH_LEN}-byte SHA-256 expressed as 64 lowercase hex characters`
    );
  }
}

function validateKeysNoDuplicates(keys: readonly DidKey[]): void {
  const seen = new Set<string>();
  for (const k of keys) {
    validateKey(k);
    if (seen.has(k.publicKeyMultibase)) {
      throw new DidError(
        'duplicate_key',
        `duplicate publicKeyMultibase within the same relationship: ${k.publicKeyMultibase}`
      );
    }
    seen.add(k.publicKeyMultibase);
  }
}

function validateKey(key: DidKey): void {
  const len = key.publicKeyMultibase.length;
  if (len === 0) {
    throw new DidError('key_empty', 'publicKeyMultibase must not be empty');
  }
  if (len > MAX_KEY_MULTIBASE_LEN) {
    throw new DidError(
      'key_too_long',
      `publicKeyMultibase exceeds ${MAX_KEY_MULTIBASE_LEN} chars (got ${len})`
    );
  }
  // Multibase parse — surfaces multikey_unsupported / multibase_invalid
  // if the bytes are malformed. This is more strict than the contract
  // (which only enforces the length bounds) but it catches typos at
  // ingest, which is what an SDK is for.
  decodeMultikey(key.publicKeyMultibase);
}

function validateService(s: DidService): void {
  if (s.idSuffix.length === 0 || s.idSuffix.length > MAX_SERVICE_ID_LEN) {
    throw new DidError(
      s.idSuffix.length > MAX_SERVICE_ID_LEN ? 'service_id_too_long' : 'service_id_invalid_format',
      `service.idSuffix length must be in [1, ${MAX_SERVICE_ID_LEN}], got ${s.idSuffix.length}`
    );
  }
  if (!SERVICE_ID_REGEX.test(s.idSuffix)) {
    throw new DidError(
      'service_id_invalid_format',
      `service.idSuffix must match ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$, got: ${s.idSuffix}`
    );
  }
  if (s.serviceType.length === 0) {
    throw new DidError('service_type_empty', 'service.serviceType must not be empty');
  }
  if (s.serviceType.length > MAX_SERVICE_TYPE_LEN) {
    throw new DidError(
      'service_type_too_long',
      `service.serviceType exceeds ${MAX_SERVICE_TYPE_LEN} chars (got ${s.serviceType.length})`
    );
  }
  if (!isHttpsUrl(s.serviceEndpoint)) {
    throw new DidError(
      'service_endpoint_invalid',
      `service.serviceEndpoint must be an absolute https:// URL (max ${MAX_URL_LEN} chars), got: ${String(s.serviceEndpoint)}`
    );
  }
}
