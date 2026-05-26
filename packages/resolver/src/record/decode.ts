/**
 * Decode a `DidRecord` from its on-ledger `ScVal` representation.
 *
 * The inverse of {@link encodeDidRecord}. Used by the resolver after a
 * `getLedgerEntries` round-trip and by the prepare/submit pipeline when
 * surfacing the post-mutation state.
 *
 * Defensive: every field is read by name, missing fields throw a typed
 * error rather than silently producing an undefined-laden record.
 */

import { scValToNative, type xdr } from '@stellar/stellar-sdk';

import { DidError } from '../errors';
import { decodeAddress, decodeOption } from '../internal/scval';
import { bytesToHex } from '../utils/hex';
import { asHttpsUrl } from '../utils/url';
import type { DidKey, DidRecord, DidService } from './types';

/**
 * Decode a `DidRecord` from its `ScMap` representation. Throws
 * `unknown` if any required field is missing or malformed.
 */
export function decodeDidRecord(val: xdr.ScVal): DidRecord {
  if (val.switch().name !== 'scvMap') {
    throw new DidError('unknown', `expected scvMap for DidRecord, got ${val.switch().name}`);
  }
  const map = readScMap(val);

  const controller = decodeAddress(requireKey(map, 'controller'));
  const authentication = readKeyVec(requireKey(map, 'authentication'));
  const assertionMethod = readKeyVec(requireKey(map, 'assertion_method'));
  const keyAgreement = readKeyVec(requireKey(map, 'key_agreement'));
  const services = readServiceVec(requireKey(map, 'services'));

  const metadataUriRaw = decodeOption<string>(requireKey(map, 'metadata_uri'));
  const metadataUri = metadataUriRaw === null ? undefined : asHttpsUrl(metadataUriRaw, 'metadata_uri_invalid');

  const metadataHashBytes = decodeOption<Uint8Array | Buffer>(requireKey(map, 'metadata_hash'));
  const metadataHash =
    metadataHashBytes === null
      ? undefined
      : bytesToHex(
          metadataHashBytes instanceof Uint8Array
            ? metadataHashBytes
            : new Uint8Array(metadataHashBytes)
        );

  const record: DidRecord = {
    controller,
    authentication,
    assertionMethod,
    keyAgreement,
    services,
    ...(metadataUri !== undefined ? { metadataUri } : {}),
    ...(metadataHash !== undefined ? { metadataHash } : {}),
    version: readU32(requireKey(map, 'version')),
    createdLedger: readU32(requireKey(map, 'created_ledger')),
    updatedLedger: readU32(requireKey(map, 'updated_ledger')),
    deactivated: readBool(requireKey(map, 'deactivated')),
  };
  return record;
}

// --- Internal helpers --------------------------------------------------------

function readScMap(val: xdr.ScVal): Map<string, xdr.ScVal> {
  const entries = val.map() ?? [];
  const out = new Map<string, xdr.ScVal>();
  for (const e of entries) {
    const key = e.key();
    if (key.switch().name !== 'scvSymbol') {
      throw new DidError('unknown', `non-symbol map key in DidRecord: ${key.switch().name}`);
    }
    out.set(key.sym().toString(), e.val());
  }
  return out;
}

function requireKey(map: Map<string, xdr.ScVal>, key: string): xdr.ScVal {
  const v = map.get(key);
  if (!v) {
    throw new DidError('unknown', `DidRecord is missing required field: ${key}`);
  }
  return v;
}

function readU32(val: xdr.ScVal): number {
  if (val.switch().name !== 'scvU32') {
    throw new DidError('unknown', `expected scvU32, got ${val.switch().name}`);
  }
  return Number(val.u32());
}

function readBool(val: xdr.ScVal): boolean {
  if (val.switch().name !== 'scvBool') {
    throw new DidError('unknown', `expected scvBool, got ${val.switch().name}`);
  }
  return val.b();
}

function readKeyVec(val: xdr.ScVal): readonly DidKey[] {
  if (val.switch().name !== 'scvVec') {
    throw new DidError('unknown', `expected scvVec for keys, got ${val.switch().name}`);
  }
  return (val.vec() ?? []).map((entry) => {
    const inner = readScMap(entry);
    const multibase: unknown = scValToNative(requireKey(inner, 'public_key_multibase'));
    return { publicKeyMultibase: String(multibase) };
  });
}

function readServiceVec(val: xdr.ScVal): readonly DidService[] {
  if (val.switch().name !== 'scvVec') {
    throw new DidError('unknown', `expected scvVec for services, got ${val.switch().name}`);
  }
  return (val.vec() ?? []).map((entry) => {
    const inner = readScMap(entry);
    return {
      idSuffix: String(scValToNative(requireKey(inner, 'id_suffix'))),
      serviceType: String(scValToNative(requireKey(inner, 'service_type'))),
      serviceEndpoint: asHttpsUrl(
        String(scValToNative(requireKey(inner, 'service_endpoint'))),
        'service_endpoint_invalid'
      ) satisfies string,
    };
  });
}
