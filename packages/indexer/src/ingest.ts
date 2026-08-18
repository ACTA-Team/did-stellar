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
/**
 * Ledgers of headroom above the RPC's reported `oldestLedger`. See
 * {@link retentionFloor}. Twelve ledgers is about a minute of slack.
 */
export const RETENTION_SAFETY_MARGIN = 12;
/** How many times one sync re-reads `getHealth` for a fresher floor. */
const MAX_REFLOOR_ATTEMPTS = 2;

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
  const floor = retentionFloor(health.oldestLedger);
  const requestedStart = opts.startLedger ?? floor;
  let startLedger = clampInt(requestedStart, floor, Math.max(floor, health.latestLedger));

  const filters: rpc.Api.EventFilter[] = [
    { type: 'contract', contractIds: [opts.registryContractId] },
  ];

  let cursor = stored?.cursor ?? null;
  let rewound = false;
  let refloors = 0;
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
      if (isOutOfRangeError(err)) {
        // A stored cursor older than the retention window is rejected.
        // Rewind once to the floor; the reducer is idempotent, so
        // re-reading the window is safe.
        if (cursor !== null && !rewound) {
          cursor = null;
          rewound = true;
          startLedger = floor;
          firstLedger = floor;
          continue;
        }
        // The floor itself was rejected. `getHealth().oldestLedger` is a
        // moving target: the window slides forward as ledgers close, so a
        // value read moments ago can already be too old by the time
        // `getEvents` is served. Re-read health and try the fresh floor.
        if (cursor === null && refloors < MAX_REFLOOR_ATTEMPTS) {
          refloors += 1;
          const fresh = await opts.rpcServer.getHealth();
          const freshFloor = retentionFloor(fresh.oldestLedger);
          if (freshFloor <= startLedger) throw err; // not the boundary; do not spin
          startLedger = freshFloor;
          firstLedger = freshFloor;
          continue;
        }
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
 * and the caller only ever uses it to decide whether to retry.
 */
export function isOutOfRangeError(err: unknown): boolean {
  const lowered = errorMessage(err).toLowerCase();
  return (
    lowered.includes('oldest ledger') ||
    lowered.includes('oldestledger') ||
    lowered.includes('start is before') ||
    lowered.includes('must be within the ledger range') ||
    lowered.includes('startledger must be within') ||
    lowered.includes('out of range') ||
    lowered.includes('invalid cursor')
  );
}

/**
 * Best-effort message for anything thrown across the RPC boundary.
 *
 * Soroban RPC failures arrive as **plain objects** (`{ code, message }`
 * from the JSON-RPC error envelope), not `Error` instances, so
 * `String(err)` yields `[object Object]` and swallows the reason. Reading
 * `message` off any object shape is what makes {@link isOutOfRangeError}
 * work and what keeps `lastError` legible in `/health`.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const { message, code } = err as { message?: unknown; code?: unknown };
    if (typeof message === 'string' && message.length > 0) {
      return typeof code === 'number' || typeof code === 'string'
        ? `${message} (code ${String(code)})`
        : message;
    }
    try {
      // `JSON.stringify` returns undefined for some exotic values.
      return JSON.stringify(err) ?? Object.prototype.toString.call(err);
    } catch {
      // Circular or otherwise unserialisable. The class tag is still more
      // use than the `[object Object]` this function exists to avoid.
      return Object.prototype.toString.call(err);
    }
  }
  // Primitives only by this point, so stringification is meaningful.
  return String(err);
}

/**
 * The oldest ledger it is actually safe to ask `getEvents` for.
 *
 * `getHealth().oldestLedger` is the *current* edge of the retention
 * window, and that edge slides forward every time a ledger closes (~5s).
 * Asking for exactly that ledger is a race: on mainnet it is routinely
 * rejected because the window moved between the two calls. The margin
 * costs a minute of the oldest history and removes the race entirely;
 * anything it skips is recovered by `reconcile()`, which reads the ledger
 * and is not retention-bound.
 */
function retentionFloor(oldestLedger: number): number {
  return Math.max(1, oldestLedger + RETENTION_SAFETY_MARGIN);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
