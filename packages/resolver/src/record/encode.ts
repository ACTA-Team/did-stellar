/**
 * Encode a {@link DidRecordInput} as a Soroban `ScVal` matching the
 * `DidRecord` struct layout.
 *
 * Soroban serialises a `#[contracttype]` struct as `ScMap` with one
 * `ScMapEntry` per field, keyed by the snake_case field name as
 * `ScSymbol`. **Entries MUST be sorted lexicographically by key**, or
 * the host will reject the value as `ScErrors::ContractType`.
 *
 * This module is the only place that knows about the Soroban field
 * ordering. Keep the entries in alphabetical order when adding fields.
 */

import { xdr } from '@stellar/stellar-sdk';

import { addressScVal, bytesN32ScVal, optionScVal, stringScVal, u32ScVal } from '../internal/scval';
import { hexToBytes } from '../utils/hex';

import type { DidKey, DidRecordInput, DidService } from './types';

const entry = (key: string, val: xdr.ScVal): xdr.ScMapEntry =>
  new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });

const keyEntry = (k: DidKey): xdr.ScVal =>
  xdr.ScVal.scvMap([entry('public_key_multibase', stringScVal(k.publicKeyMultibase))]);

const serviceEntry = (s: DidService): xdr.ScVal =>
  xdr.ScVal.scvMap([
    // Alphabetical: id_suffix, service_endpoint, service_type
    entry('id_suffix', stringScVal(s.idSuffix)),
    entry('service_endpoint', stringScVal(s.serviceEndpoint)),
    entry('service_type', stringScVal(s.serviceType)),
  ]);

/**
 * Encode a `DidRecordInput` as a Soroban `ScVal`.
 *
 * Bookkeeping fields are filled with placeholders accepted by the
 * contract — `version=1`, `created_ledger=0`, `updated_ledger=0`,
 * `deactivated=false`. The contract overwrites every one of them inside
 * `register` (and ignores them entirely inside `update`), so the values
 * sent here are immaterial except that they MUST type-check.
 */
export function encodeDidRecord(input: DidRecordInput): xdr.ScVal {
  return xdr.ScVal.scvMap([
    // Alphabetical order on snake_case keys.
    entry('assertion_method', xdr.ScVal.scvVec(input.assertionMethod.map(keyEntry))),
    entry('authentication', xdr.ScVal.scvVec(input.authentication.map(keyEntry))),
    entry('controller', addressScVal(input.controller)),
    entry('created_ledger', u32ScVal(0)),
    entry('deactivated', xdr.ScVal.scvBool(false)),
    entry('key_agreement', xdr.ScVal.scvVec(input.keyAgreement.map(keyEntry))),
    entry(
      'metadata_hash',
      optionScVal(
        input.metadataHash !== undefined ? bytesN32ScVal(hexToBytes(input.metadataHash)) : null
      )
    ),
    entry(
      'metadata_uri',
      optionScVal(input.metadataUri !== undefined ? stringScVal(input.metadataUri) : null)
    ),
    entry('services', xdr.ScVal.scvVec(input.services.map(serviceEntry))),
    entry('updated_ledger', u32ScVal(0)),
    entry('version', u32ScVal(1)),
  ]);
}
