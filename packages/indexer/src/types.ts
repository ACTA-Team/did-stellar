/**
 * Shared types for the `did:stellar` reverse index.
 *
 * The index answers one question the registry contract deliberately does
 * NOT answer on-chain: *given a controller address, which DIDs does it
 * hold?* The method spec (§7.2, §8.3) encourages a wallet to hold several
 * unlinkable DIDs, so a controller → DIDs mapping is inherently one-to-many.
 *
 * Keeping that mapping on-chain would charge every `register` /
 * `transfer_controller` caller for what is purely an interface concern, so
 * it lives off-chain and is rebuilt from the contract's event stream.
 */

import type { NetworkType } from '@acta-team/did-stellar';

/**
 * One indexed DID, as returned to API callers.
 *
 * `controller` is the *current* controller: a DID moved by
 * `transfer_controller` is reported under the new controller only.
 */
export interface IndexedDid {
  readonly network: NetworkType;
  /** Canonical `did:stellar:{network}:{didId}` string. */
  readonly did: string;
  /** Bare 26-char base32 `didId`. */
  readonly didId: string;
  /** Current controller (`G...` account or `C...` contract). */
  readonly controller: string;
  /** Contract mutation counter as last observed. */
  readonly version: number;
  /** One-way deactivation flag. Deactivated DIDs are still listed. */
  readonly deactivated: boolean;
  /** Ledger sequence at `register`. `0` when only learned from a later event. */
  readonly createdLedger: number;
  /** Ledger sequence of the most recent mutation the index has seen. */
  readonly updatedLedger: number;
}

/**
 * Internal projection state for a single DID.
 *
 * Differs from {@link IndexedDid} in one way: `controller` may be `null`
 * when the index first learned about the DID through a non-`register`
 * event (which happens whenever the backfill window starts after the DID
 * was registered - Soroban RPC only retains a few days of events). Such
 * rows are invisible to `listByController` until {@link reconcile} reads
 * the authoritative record off the ledger and fills the gap.
 */
export interface DidIndexState {
  readonly didId: string;
  readonly controller: string | null;
  readonly version: number;
  readonly deactivated: boolean;
  readonly createdLedger: number;
  readonly updatedLedger: number;
  /** Soroban RPC event id of the newest event folded into this row. */
  readonly lastEventId: string;
  /** Ledger of {@link lastEventId}. Kept alongside for cheap range queries. */
  readonly lastEventLedger: number;
}

/** Ingestion progress for one network. */
export interface IndexCursor {
  readonly network: NetworkType;
  /** Soroban RPC paging token to resume from. `null` before the first sync. */
  readonly cursor: string | null;
  /** Lowest ledger this index has observed events from. */
  readonly firstLedger: number;
  /** Highest ledger fully ingested. */
  readonly lastLedger: number;
  /** ISO-8601 timestamp of the last successful sync. */
  readonly syncedAt: string;
}

/** Per-network status, surfaced through `/health` and the worker log. */
export interface IndexNetworkStatus {
  readonly network: NetworkType;
  readonly configured: boolean;
  readonly dids: number;
  readonly firstLedger: number;
  readonly lastLedger: number;
  readonly syncedAt: string | null;
  readonly lastError: string | null;
}
