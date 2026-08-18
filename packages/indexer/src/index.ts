/**
 * `@acta-team/did-stellar-indexer` - the controller → DIDs reverse index
 * for the `did:stellar` method.
 *
 * A Stellar wallet may control several DIDs on purpose: the method spec
 * recommends one DID per context so a holder cannot be correlated across
 * relying parties (§7.2, §8.3). The registry contract therefore stores
 * only `did_id → record` and never the inverse, because an on-chain
 * reverse index would charge every `register` and `transfer_controller`
 * caller for what is purely a client-side convenience.
 *
 * That leaves an application unable to ask "which DIDs does this wallet
 * already have?" - so it creates another one, and the previous DID and
 * its credentials are orphaned. This package closes that gap off-chain,
 * rebuilding the mapping from the contract's event stream and confirming
 * it against the ledger.
 *
 * ```ts
 * const store = new MemoryIndexStore();
 * const indexer = new DidIndexer({ store, networks: { testnet: { rpcUrl, registryContractId } } });
 * await indexer.start();                       // backfill, then poll
 * const { dids } = await listDidsByController({ store, network: 'testnet', controller });
 * ```
 */

// --- Types ------------------------------------------------------------------
export type { DidIndexState, IndexCursor, IndexedDid, IndexNetworkStatus } from './types';

// --- Events -----------------------------------------------------------------
export {
  DID_EVENT_TOPICS,
  compareEventIds,
  decodeRegistryEvent,
  decodeRegistryEvents,
} from './events';
export type { DidEventKind, DidRegistryEvent } from './events';

// --- Projection -------------------------------------------------------------
export { affectedDidIds, reduceEvent, reduceEvents, toIndexedDid } from './reduce';

// --- Stores -----------------------------------------------------------------
export { MemoryIndexStore } from './store/memory';
export { PostgresIndexStore } from './store/postgres';
export type { PostgresIndexStoreOptions } from './store/postgres';
export { DEFAULT_SCHEMA, TABLE_CURSORS, TABLE_DIDS, buildSchemaSql } from './store/schema';
export type { ApplyEventsResult, DidIndexStore } from './store/types';

// --- Ingestion --------------------------------------------------------------
export { DEFAULT_MAX_PAGES, DEFAULT_PAGE_LIMIT, isOutOfRangeError, syncNetwork } from './ingest';
export type { SyncNetworkOptions, SyncNetworkResult } from './ingest';

// --- Reconciliation ---------------------------------------------------------
export { DEFAULT_READ_CHUNK, readDidRecords, reconcile, stateFromRecord } from './reconcile';
export type { ReadRecordsOptions, ReconcileOptions, ReconcileResult } from './reconcile';

// --- Orchestrator -----------------------------------------------------------
export { DidIndexer } from './indexer';
export type { DidIndexerOptions, IndexerLogger, IndexerNetworkConfig } from './indexer';

// --- Read path --------------------------------------------------------------
export { listDidsByController } from './query';
export type { ListDidsByControllerOptions, ListDidsByControllerResult } from './query';

// --- Configuration ----------------------------------------------------------
export { buildIndexStore, loadIndexConfig } from './config';
export type { IndexConfig, IndexNetworkSettings } from './config';
