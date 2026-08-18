/**
 * Event ingestion - walk the registry's `getEvents` stream into the store.
 *
 * One `syncNetwork` call catches a network up to the ledger head, then
 * returns. The caller (the poll loop in {@link DidIndexer}) decides how
 * often to run it.
 *
 * ## Retention, and why the backfill has a floor
 *
 * Soroban RPC keeps only a rolling window of events (a few days on the
 * public SDF endpoints; `getHealth` reports the exact `oldestLedger`).
 * There is no way to walk the whole chain from `getEvents` alone, so
 * "backfill the history before exposing the endpoint" means, precisely:
 * ingest everything the RPC still has, starting at `oldestLedger`, before
 * serving reads. Anything older is recovered a different way - a DID
 * registered before the window becomes visible as soon as it emits any
 * event, and `reconcile()` then reads its controller off the ledger,
 * which is not retention-bound. Operators who need a genuinely complete
 * index from a contract's first ledger should point `startLedger` at it
 * while running against an archival RPC that retains that far back.
 *
 * ## Filtering
 *
 * The filter matches the registry contract and nothing else - no topic
 * filter. Two reasons: the registry is a low-volume contract, so the
 * bandwidth saved is negligible; and a topic filter pins the exact topic
 * *arity*, so a future contract revision that promotes a field to a topic
 * would silently match nothing. Unrecognised events are dropped by
 * `decodeRegistryEvents` instead.
 */

import { decodeRegistryEvents } from './events';

import type { DidIndexStore } from './store/types';
import type { IndexCursor } from './types';
import type { NetworkType } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

/** Events per `getEvents` page. The RPC caps this at 10 000. */
export const DEFAULT_PAGE_LIMIT = 200;
/** Pages per `syncNetwork` call, so one sync cannot run unbounded. */
export const DEFAULT_MAX_PAGES = 200;

export interface SyncNetworkOptions {
  readonly store: DidIndexStore;
  readonly rpcServer: rpc.Server;
  readonly registryContractId: string;
  readonly network: NetworkType;
  /**
   * Ledger to begin the very first backfill at. Clamped to the RPC's
   * `oldestLedger`. Omit to start at `oldestLedger` - i.e. ingest
   * everything the endpoint still retains.
   */
  readonly startLedger?: number;
  readonly pageLimit?: number;
  readonly maxPages?: number;
}

export interface SyncNetworkResult {
  readonly network: NetworkType;
  /** Raw events returned by the RPC. */
  readonly seen: number;
  /** Events that decoded to a DID lifecycle event. */
  readonly decoded: number;
  /** Rows the store actually wrote. */
  readonly written: number;
  readonly pages: number;
  readonly fromLedger: number;
  readonly toLedger: number;
  /** True when the stored cursor fell out of retention and was rewound. */
  readonly rewound: boolean;
  /** True when the loop hit `maxPages` before catching up. */
  readonly truncated: boolean;
  readonly cursor: IndexCursor;
}

/**
 * Catch one network up to the ledger head.
 *
 * Resumes from the stored cursor when there is one. If that cursor has
 * aged out of the RPC's retention window the sync rewinds to
 * `oldestLedger` and reports `rewound: true` - the projection stays valid
 * (the reducer is idempotent) but the caller should schedule a
 * reconciliation sweep, since events in the gap are unrecoverable.
 */
export async function syncNetwork(opts: SyncNetworkOptions): Promise<SyncNetworkResult> {
  const pageLimit = clampInt(opts.pageLimit ?? DEFAULT_PAGE_LIMIT, 1, 10_000);
  const maxPages = clampInt(opts.maxPages ?? DEFAULT_MAX_PAGES, 1, 100_000);
  const health = await opts.rpcServer.getHealth();

  const stored = await opts.store.getCursor(opts.network);
  const floor = Math.max(1, health.oldestLedger);
  const requestedStart = opts.startLedger ?? floor;
  const startLedger = clampInt(requestedStart, floor, Math.max(floor, health.latestLedger));

  const filters: rpc.Api.EventFilter[] = [
    { type: 'contract', contractIds: [opts.registryContractId] },
  ];

  let cursor = stored?.cursor ?? null;
  let rewound = false;
  let seen = 0;
  let decoded = 0;
  let written = 0;
  let pages = 0;
  let truncated = true;
  let highestLedger = stored?.lastLedger ?? 0;
  let firstLedger =
    stored && stored.firstLedger > 0 ? Math.min(stored.firstLedger, startLedger) : startLedger;

  while (pages < maxPages) {
    let page: rpc.Api.GetEventsResponse;
    try {
      page = await opts.rpcServer.getEvents(
        cursor === null
          ? { filters, startLedger, limit: pageLimit }
          : { filters, cursor, limit: pageLimit }
      );
    } catch (err) {
      // A cursor older than `oldestLedger` is rejected by the RPC. Rewind
      // once to the retention floor and retry; anything else propagates.
      if (cursor !== null && !rewound && isOutOfRangeError(err)) {
        cursor = null;
        rewound = true;
        firstLedger = floor;
        continue;
      }
      throw err;
    }

    pages += 1;
    const events = page.events ?? [];
    seen += events.length;

    if (events.length > 0) {
      const registryEvents = decodeRegistryEvents(events);
      decoded += registryEvents.length;
      if (registryEvents.length > 0) {
        const applied = await opts.store.applyEvents(opts.network, registryEvents);
        written += applied.written;
      }
      const last = events[events.length - 1];
      if (last && last.ledger > highestLedger) highestLedger = last.ledger;
    }

    cursor = page.cursor ?? cursor;

    // A short page means the stream is drained up to the ledger head, so
    // the index now covers everything through `latestLedger` - including
    // the ledgers in between that emitted no registry events at all.
    if (events.length < pageLimit) {
      if (page.latestLedger > highestLedger) highestLedger = page.latestLedger;
      truncated = false;
      break;
    }
  }

  const next: IndexCursor = {
    network: opts.network,
    cursor,
    firstLedger,
    lastLedger: highestLedger,
    syncedAt: new Date().toISOString(),
  };
  await opts.store.setCursor(next);

  return {
    network: opts.network,
    seen,
    decoded,
    written,
    pages,
    fromLedger: firstLedger,
    toLedger: highestLedger,
    rewound,
    truncated,
    cursor: next,
  };
}

/**
 * Recognise the RPC's "start is before the oldest retained ledger" family
 * of errors. The wording is not part of any spec, so this matches loosely
 * and the caller only ever uses it to decide whether to rewind once.
 */
export function isOutOfRangeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();
  return (
    lowered.includes('oldest ledger') ||
    lowered.includes('oldestledger') ||
    lowered.includes('start is before') ||
    lowered.includes('startledger must be within') ||
    lowered.includes('out of range') ||
    lowered.includes('invalid cursor')
  );
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
