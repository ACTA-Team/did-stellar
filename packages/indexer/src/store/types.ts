/**
 * Storage contract for the reverse index.
 *
 * Two backends ship with the package:
 *
 *   - {@link MemoryIndexStore} - zero infrastructure, the default. Keeps
 *     the service's trust-minimised posture: a fresh deployment indexes
 *     itself from the RPC event stream and needs no database.
 *   - {@link PostgresIndexStore} - durable and shared across replicas
 *     (Supabase or any Postgres). Survives restarts, so the backfill
 *     runs once instead of on every boot.
 *
 * The interface is deliberately small. Everything the index needs is
 * expressible as: read the rows for a set of DIDs, write rows back, list
 * by controller, and track one cursor per network.
 */

import type { DidRegistryEvent } from '../events';
import type { DidIndexState, IndexCursor, IndexedDid } from '../types';
import type { NetworkType } from '@acta-team/did-stellar';

export interface ApplyEventsResult {
  /** Events handed to the store. */
  readonly seen: number;
  /** Rows actually written (stale / duplicate events write nothing). */
  readonly written: number;
}

export interface DidIndexStore {
  readonly kind: 'memory' | 'postgres';

  /** Create schema / warm connections. Idempotent; safe to call on every boot. */
  init(): Promise<void>;

  /**
   * Fold a batch of decoded events into the index. Implementations MUST
   * be idempotent with respect to the event ids (see `reduceEvent`), so a
   * replayed page after a crash cannot corrupt the projection.
   */
  applyEvents(
    network: NetworkType,
    events: readonly DidRegistryEvent[]
  ): Promise<ApplyEventsResult>;

  /** Overwrite rows with authoritative ledger state. Used by `reconcile`. */
  putStates(network: NetworkType, states: readonly DidIndexState[]): Promise<void>;

  /** Drop rows for DIDs that no longer exist on the ledger. */
  removeDids(network: NetworkType, didIds: readonly string[]): Promise<void>;

  /** Read the raw state rows for specific DIDs. Missing DIDs are absent from the map. */
  getStates(network: NetworkType, didIds: readonly string[]): Promise<Map<string, DidIndexState>>;

  /**
   * The reverse lookup. Returns every DID currently controlled by
   * `controller`, deactivated ones included, ordered by `createdLedger`
   * then `didId` for a stable response.
   */
  listByController(network: NetworkType, controller: string): Promise<IndexedDid[]>;

  /**
   * Page through `didId`s for reconciliation sweeps, ascending.
   * `onlyUnresolved` restricts the sweep to rows whose controller the
   * index could not learn from the event stream.
   */
  listDidIds(
    network: NetworkType,
    opts: { readonly limit: number; readonly after?: string; readonly onlyUnresolved?: boolean }
  ): Promise<string[]>;

  /** Number of indexed DIDs for a network. */
  countDids(network: NetworkType): Promise<number>;

  getCursor(network: NetworkType): Promise<IndexCursor | null>;
  setCursor(cursor: IndexCursor): Promise<void>;

  /** Release connections. Idempotent. */
  close(): Promise<void>;
}
