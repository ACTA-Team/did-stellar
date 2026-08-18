/**
 * Ledger reconciliation - the index's correctness backstop.
 *
 * Event ingestion alone is *eventually* right, and only for the window
 * the RPC still retains. Reconciliation makes it *actually* right by
 * reading the authoritative `DidRecord` straight from persistent storage
 * for a set of DIDs and overwriting the projection with what the ledger
 * says. It fixes three things the event stream cannot:
 *
 *   1. **Pre-window DIDs** - a DID registered before the retention window
 *      only appears in the stream when it mutates again, and that event
 *      carries no controller. Reconciliation fills it in.
 *   2. **Missed events** - a crash, an RPC gap, or a cursor rewind can
 *      drop a `transfer_controller`. Reading the record repairs it, so a
 *      transferred DID cannot linger under its old controller.
 *   3. **Archived / absent entries** - a DID whose storage entry is gone
 *      is dropped from the index rather than reported as live.
 *
 * Reads are batched into a single `getLedgerEntries` per chunk, so
 * verifying a wallet with a handful of DIDs costs one round-trip, not one
 * per DID.
 */

import {
  buildDidRecordLedgerKey,
  decodeDidId,
  decodeLedgerEntryRecord,
  type DidRecord,
  type NetworkType,
} from '@acta-team/did-stellar';

import type { DidIndexStore } from './store/types';
import type { DidIndexState } from './types';
import type { rpc } from '@stellar/stellar-sdk';

/**
 * Ledger keys per `getLedgerEntries` call. Soroban RPC caps a request at
 * 200 keys; 100 leaves headroom for proxies with tighter body limits.
 */
export const DEFAULT_READ_CHUNK = 100;

export interface ReadRecordsOptions {
  readonly rpcServer: rpc.Server;
  readonly registryContractId: string;
  readonly didIds: readonly string[];
  /** Keys per request. Defaults to {@link DEFAULT_READ_CHUNK}. */
  readonly chunkSize?: number;
}

/**
 * Batch-read `DidRecord`s by `didId`.
 *
 * The returned map has an entry for every requested `didId`: the decoded
 * record, or `null` when the ledger has no entry for it. Undecodable
 * `didId` strings are skipped entirely rather than reported as absent -
 * they were never valid, so "the ledger says it is gone" would be a lie.
 */
export async function readDidRecords(
  opts: ReadRecordsOptions
): Promise<Map<string, DidRecord | null>> {
  const out = new Map<string, DidRecord | null>();
  const chunkSize = Math.max(1, opts.chunkSize ?? DEFAULT_READ_CHUNK);

  const valid: { didId: string; bytes: Uint8Array }[] = [];
  for (const didId of opts.didIds) {
    try {
      valid.push({ didId, bytes: decodeDidId(didId) });
    } catch {
      // Not a canonical didId - nothing on the ledger could match it.
    }
  }

  for (let i = 0; i < valid.length; i += chunkSize) {
    const chunk = valid.slice(i, i + chunkSize);
    const keys = chunk.map((c) => buildDidRecordLedgerKey(opts.registryContractId, c.bytes));
    // Index the response by the base64 of each returned key so rows are
    // matched back to their didId positionally-independently: the RPC
    // omits missing entries and does not promise request order.
    const byKey = new Map<string, unknown>();
    const response = await opts.rpcServer.getLedgerEntries(...keys);
    for (const entry of response.entries ?? []) {
      byKey.set(entry.key.toXDR('base64'), entry);
    }
    for (let j = 0; j < chunk.length; j += 1) {
      const item = chunk[j];
      const key = keys[j];
      if (!item || !key) continue;
      const entry = byKey.get(key.toXDR('base64'));
      if (entry === undefined) {
        // The RPC omitted the key: the storage entry does not exist.
        out.set(item.didId, null);
        continue;
      }
      // A row we cannot decode is NOT evidence the DID is gone, so it is
      // left out of the map entirely and the caller leaves it untouched.
      const decoded = safeDecode(entry);
      if (decoded !== undefined) out.set(item.didId, decoded);
    }
  }

  return out;
}

export interface ReconcileOptions {
  readonly store: DidIndexStore;
  readonly rpcServer: rpc.Server;
  readonly registryContractId: string;
  readonly network: NetworkType;
  /** DIDs to check. Omit to sweep the whole index for this network. */
  readonly didIds?: readonly string[];
  /** Sweep only rows whose controller the event stream could not supply. */
  readonly onlyUnresolved?: boolean;
  /** Resume a paged sweep after this `didId`. Ignored when `didIds` is given. */
  readonly after?: string;
  /** Ledger keys per RPC call. Defaults to {@link DEFAULT_READ_CHUNK}. */
  readonly chunkSize?: number;
  /** Upper bound on DIDs visited in one sweep. Defaults to 1000. */
  readonly maxDids?: number;
}

export interface ReconcileResult {
  readonly checked: number;
  readonly updated: number;
  readonly removed: number;
  /** Highest `didId` visited - the resume point for the next paged sweep. */
  readonly lastDidId: string | null;
}

/**
 * Confirm indexed rows against the ledger and repair the differences.
 *
 * With `didIds` given this is the on-read verification path used by the
 * API; without it, it is the background sweep the worker runs.
 */
export async function reconcile(opts: ReconcileOptions): Promise<ReconcileResult> {
  const targets = opts.didIds
    ? [...opts.didIds]
    : await opts.store.listDidIds(opts.network, {
        limit: opts.maxDids ?? 1000,
        ...(opts.onlyUnresolved === true ? { onlyUnresolved: true } : {}),
        ...(opts.after !== undefined ? { after: opts.after } : {}),
      });
  if (targets.length === 0) return { checked: 0, updated: 0, removed: 0, lastDidId: null };

  const records = await readDidRecords({
    rpcServer: opts.rpcServer,
    registryContractId: opts.registryContractId,
    didIds: targets,
    ...(opts.chunkSize !== undefined ? { chunkSize: opts.chunkSize } : {}),
  });

  const known = await opts.store.getStates(opts.network, targets);
  const updates: DidIndexState[] = [];
  const removals: string[] = [];

  for (const didId of targets) {
    const record = records.get(didId);
    if (record === undefined) continue; // didId was not decodable; leave as-is.
    if (record === null) {
      if (known.has(didId)) removals.push(didId);
      continue;
    }
    const prev = known.get(didId) ?? null;
    const next = stateFromRecord(didId, record, prev);
    if (!sameState(prev, next)) updates.push(next);
  }

  if (updates.length > 0) await opts.store.putStates(opts.network, updates);
  if (removals.length > 0) await opts.store.removeDids(opts.network, removals);

  return {
    checked: targets.length,
    updated: updates.length,
    removed: removals.length,
    // `listDidIds` returns ascending order, so the last element is the
    // high-water mark; an explicit `didIds` list may not be sorted.
    lastDidId: opts.didIds ? null : (targets[targets.length - 1] ?? null),
  };
}

/**
 * Project an authoritative `DidRecord` onto index state.
 *
 * `lastEventId` / `lastEventLedger` are carried over from the previous
 * row: reconciliation observes ledger state, not an event, so it must not
 * claim to have consumed one - doing so would let it swallow a real event
 * that is still in flight.
 */
export function stateFromRecord(
  didId: string,
  record: DidRecord,
  prev: DidIndexState | null
): DidIndexState {
  return {
    didId,
    controller: record.controller,
    version: record.version,
    deactivated: record.deactivated,
    createdLedger: record.createdLedger,
    updatedLedger: record.updatedLedger,
    lastEventId: prev?.lastEventId ?? '',
    lastEventLedger: prev?.lastEventLedger ?? 0,
  };
}

function sameState(a: DidIndexState | null, b: DidIndexState): boolean {
  if (!a) return false;
  return (
    a.controller === b.controller &&
    a.version === b.version &&
    a.deactivated === b.deactivated &&
    a.createdLedger === b.createdLedger &&
    a.updatedLedger === b.updatedLedger
  );
}

/** `undefined` means "could not interpret this row" - never "absent". */
function safeDecode(entry: unknown): DidRecord | null | undefined {
  try {
    return decodeLedgerEntryRecord(entry) ?? undefined;
  } catch {
    return undefined;
  }
}
