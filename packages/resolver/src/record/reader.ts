/**
 * Read a `DidRecord` directly from Stellar persistent storage.
 *
 * The resolver hot path uses `getLedgerEntries` against the
 * `DidDataKey::Record(BytesN<16>)` key so that no transaction simulation
 * is required to surface the current record. This is critical for two
 * reasons:
 *
 * 1. It is free (no fee, no inclusion).
 * 2. It works against any RPC endpoint, including ones that disable
 *    simulation. That preserves the trust-minimisation property of the
 *    method: a verifier only needs a vanilla Stellar RPC URL.
 *
 * Returns `null` when no record exists for the given DID, so callers can
 * distinguish "the DID was never registered" from "the DID exists and is
 * deactivated".
 */

import { Address, StrKey, xdr, type rpc } from '@stellar/stellar-sdk';

import { DidError } from '../errors';
import { didRecordStorageKey } from '../internal/scval';
import { decodeDidRecord } from './decode';
import type { DidRecord } from './types';

export interface ReadDidRecordOptions {
  readonly rpcServer: rpc.Server;
  readonly registryContractId: string;
  readonly didIdBytes: Uint8Array;
}

/**
 * Read the `DidRecord` for a given `didId`. Returns `null` if the
 * persistent storage entry is absent.
 *
 * Errors:
 * - `contract_id_invalid` — registry contract ID is not a valid C... strkey.
 * - `rpc_error`           — RPC returned an unexpected response shape.
 */
export async function readDidRecord(opts: ReadDidRecordOptions): Promise<DidRecord | null> {
  if (!StrKey.isValidContract(opts.registryContractId)) {
    throw new DidError(
      'contract_id_invalid',
      `registryContractId must be a valid C... contract ID, got: ${opts.registryContractId}`
    );
  }

  const contractAddress = Address.contract(StrKey.decodeContract(opts.registryContractId));
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: didRecordStorageKey(opts.didIdBytes),
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  let entries: Awaited<ReturnType<rpc.Server['getLedgerEntries']>>;
  try {
    entries = await opts.rpcServer.getLedgerEntries(ledgerKey);
  } catch (cause) {
    throw new DidError('rpc_error', `getLedgerEntries failed while reading DID record`, { cause });
  }

  if (!entries.entries || entries.entries.length === 0) return null;

  const entry = entries.entries[0];
  if (!entry) return null;

  // `getLedgerEntries` returns entries where the payload is the full
  // `LedgerEntryData` envelope — either under `.val` (Stellar SDK ≥ v12)
  // or under `.xdr` (older / alternate codepaths). In both cases the
  // raw `DidRecord` ScVal lives inside `contractData().val()`. We do NOT
  // accept a bare ScVal here: their `.switch()` enums collide with
  // LedgerEntryType ones (both contain `contractData`), so distinguishing
  // by switch name alone is unreliable. Always unwrap through
  // `extractContractDataVal`.
  const loose = entry as unknown as { val?: unknown; xdr?: unknown };
  const envelope = pickLedgerEntryData(loose.val) ?? pickLedgerEntryData(loose.xdr);
  if (!envelope) return null;

  const inner = extractContractDataVal(envelope);
  if (!inner) return null;
  return decodeDidRecord(inner);
}

function pickLedgerEntryData(value: unknown): xdr.LedgerEntryData | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { switch?: unknown; contractData?: unknown };
  // Both `LedgerEntryData` and `ScVal` expose `.switch()`. The
  // distinguishing feature is `.contractData()` — present on
  // `LedgerEntryData` as a union variant accessor, absent on `ScVal`.
  if (typeof candidate.switch !== 'function' || typeof candidate.contractData !== 'function') {
    return null;
  }
  return value as xdr.LedgerEntryData;
}

function extractContractDataVal(data: xdr.LedgerEntryData): xdr.ScVal | undefined {
  if (data.switch().name !== 'contractData') return undefined;
  return data.contractData().val();
}
