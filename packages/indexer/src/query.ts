/**
 * The read path: "which DIDs does this controller hold?"
 *
 * Two modes, chosen per call:
 *
 *   - **Indexed** - answer straight from the store. Fast, and correct up
 *     to the ingestion lag (a few seconds on a healthy poll interval).
 *   - **Verified** - answer from the store, then confirm each candidate
 *     against the ledger in one batched `getLedgerEntries` and re-read.
 *     Costs one RPC round-trip and makes the answer authoritative: a DID
 *     transferred away is dropped even if the event has not landed yet,
 *     and `version` / `deactivated` are exactly what the contract holds.
 *
 * Verification can only confirm or prune candidates the index already
 * knows about - it cannot discover a DID the event stream never surfaced.
 * That is what the backfill and the reconciliation sweep are for, and why
 * `coverage` travels with every response.
 */

import { reconcile } from './reconcile';

import type { DidIndexStore } from './store/types';
import type { IndexedDid } from './types';
import type { NetworkType } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

export interface ListDidsByControllerOptions {
  readonly store: DidIndexStore;
  readonly network: NetworkType;
  /** `G...` account or `C...` contract. */
  readonly controller: string;
  /**
   * Confirm every candidate against the ledger before answering. Omit to
   * serve purely from the index.
   */
  readonly verify?: {
    readonly rpcServer: rpc.Server;
    readonly registryContractId: string;
  };
}

export interface ListDidsByControllerResult {
  readonly dids: IndexedDid[];
  /** True when the rows were confirmed against the ledger. */
  readonly verified: boolean;
  /** Ledger range the index has ingested events for. */
  readonly coverage: {
    readonly fromLedger: number;
    readonly toLedger: number;
    readonly syncedAt: string | null;
  };
}

/**
 * List the DIDs a controller currently holds, deactivated ones included.
 *
 * A controller with no DIDs yields an empty array - never an error. "This
 * wallet holds nothing" is a valid, complete answer, not a missing
 * resource.
 */
export async function listDidsByController(
  opts: ListDidsByControllerOptions
): Promise<ListDidsByControllerResult> {
  const cursor = await opts.store.getCursor(opts.network);
  const coverage = {
    fromLedger: cursor?.firstLedger ?? 0,
    toLedger: cursor?.lastLedger ?? 0,
    syncedAt: cursor?.syncedAt ?? null,
  };

  let dids = await opts.store.listByController(opts.network, opts.controller);

  if (opts.verify && dids.length > 0) {
    await reconcile({
      store: opts.store,
      rpcServer: opts.verify.rpcServer,
      registryContractId: opts.verify.registryContractId,
      network: opts.network,
      didIds: dids.map((d) => d.didId),
    });
    // Re-read rather than patching in place: reconciliation may have
    // moved a DID to a different controller or dropped it entirely, and
    // the store is the single place that knows the resulting set.
    dids = await opts.store.listByController(opts.network, opts.controller);
    return { dids, verified: true, coverage };
  }

  return { dids, verified: false, coverage };
}
