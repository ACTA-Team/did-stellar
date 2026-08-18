/**
 * Bootstrap discovery - finding the DIDs the RPC event window cannot show.
 *
 * ## The gap this closes
 *
 * `syncNetwork` rebuilds the index from `getEvents`, and Soroban RPC
 * retains only a rolling window of events (about a week on the public SDF
 * endpoints). `reconcile` then reads authoritative state off the ledger,
 * which is *not* retention-bound - but it can only confirm or prune DIDs
 * the index already knows about. Neither path can **discover** a DID whose
 * `DidRegistered` event has aged out and which has not mutated since.
 *
 * That is not a corner case, it is the normal state of a low-traffic
 * production contract. Mainnet is the worst instance of it: three DIDs
 * registered between 2026-06-30 and 2026-08-03, a seven-day event window,
 * and therefore an index that answers "this wallet holds nothing" for
 * every wallet, forever, no matter how often it restarts.
 *
 * So the index needs one source of `didId`s that starts at the contract's
 * creation ledger. This module is that source.
 *
 * ## Why a third party is acceptable here
 *
 * The only endpoints that reach a contract's first ledger are archival,
 * and the free one is StellarExpert's contract-events index. Depending on
 * it in the boot path is a real trade, so it is bounded on three sides:
 *
 *   1. **It cannot inject bad data.** Discovery supplies candidate
 *      `didId`s and nothing else that survives: {@link bootstrapNetwork}
 *      re-reads every discovered DID off the ledger through the existing
 *      `reconcile` before the index is served. A wrong or hostile
 *      response yields DIDs the ledger denies, and those rows are dropped.
 *      The worst it can do is make the index *miss* DIDs - which is
 *      exactly the failure we already have without it.
 *   2. **It cannot break startup.** Every failure is the caller's to
 *      swallow; `DidIndexer` logs and falls back to the RPC window.
 *   3. **It is switchable.** `DID_INDEX_BOOTSTRAP=off` removes it, and
 *      `DID_INDEX_BOOTSTRAP_URL` repoints it at a mirror or a local
 *      archival service that speaks the same shape.
 *
 * Records carry the untouched `topicsXdr` / `bodyXdr`, so they are handed
 * to the same {@link decodeRegistryEvent} the RPC path uses rather than a
 * second decoder that could drift.
 */

import { xdr } from '@stellar/stellar-sdk';

import { decodeRegistryEvent, type DidRegistryEvent } from './events';
import { reconcile } from './reconcile';

import type { DidIndexStore } from './store/types';
import type { IndexCursor } from './types';
import type { NetworkType } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

/** Default archival index. Overridable via `DID_INDEX_BOOTSTRAP_URL`. */
export const DEFAULT_BOOTSTRAP_URL = 'https://api.stellar.expert/explorer';

/** StellarExpert names networks after their passphrases, not after ours. */
const REMOTE_NETWORK: Readonly<Record<NetworkType, string>> = Object.freeze({
  mainnet: 'public',
  testnet: 'testnet',
});

/** Records per page. The endpoint caps this at 200. */
export const DEFAULT_DISCOVER_PAGE_LIMIT = 200;
/** Pages per discovery run, so a paging bug cannot loop forever. */
export const DEFAULT_DISCOVER_MAX_PAGES = 1_000;
/** Per-request timeout. Startup must not hang on an unresponsive host. */
export const DEFAULT_DISCOVER_TIMEOUT_MS = 15_000;
/** DIDs confirmed against the ledger per `reconcile` call. */
const VERIFY_CHUNK = 500;

/**
 * The slice of `fetch` this module uses. Declared structurally so tests
 * can pass a stub without a DOM lib or a network round-trip.
 */
export type FetchLike = (
  url: string,
  init?: { readonly headers?: Record<string, string>; readonly signal?: AbortSignal }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}>;

export interface DiscoverEventsOptions {
  readonly network: NetworkType;
  readonly registryContractId: string;
  /** Archival index base URL. Defaults to {@link DEFAULT_BOOTSTRAP_URL}. */
  readonly baseUrl?: string;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  readonly pageLimit?: number;
  readonly maxPages?: number;
  readonly timeoutMs?: number;
}

export interface DiscoverEventsResult {
  /** Decoded DID lifecycle events, oldest first. */
  readonly events: DidRegistryEvent[];
  readonly pages: number;
  /** Contract events returned, including ones that are not DID lifecycle. */
  readonly rawEvents: number;
  /** Lowest / highest ledger any returned event sits in. `0` when empty. */
  readonly fromLedger: number;
  readonly toLedger: number;
}

/**
 * Read a contract's whole event history from the archival index.
 *
 * Throws on any transport or HTTP failure rather than returning a partial
 * history: a truncated walk that looked successful would let the caller
 * write a cursor claiming coverage it does not have, and the missing DIDs
 * would never be retried. A `404` is the one exception - it means the
 * index has no record of the contract yet, which is an empty history, not
 * an error.
 */
export async function discoverEvents(opts: DiscoverEventsOptions): Promise<DiscoverEventsResult> {
  const fetchImpl: FetchLike | undefined = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('no fetch implementation available for index bootstrap');

  const base = `${(opts.baseUrl ?? DEFAULT_BOOTSTRAP_URL).replace(/\/+$/, '')}/${
    REMOTE_NETWORK[opts.network]
  }/contract/${opts.registryContractId}/events`;
  const pageLimit = clampInt(opts.pageLimit ?? DEFAULT_DISCOVER_PAGE_LIMIT, 1, 200);
  const maxPages = clampInt(opts.maxPages ?? DEFAULT_DISCOVER_MAX_PAGES, 1, 100_000);
  const timeoutMs = clampInt(opts.timeoutMs ?? DEFAULT_DISCOVER_TIMEOUT_MS, 1_000, 600_000);

  const events: DidRegistryEvent[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let rawEvents = 0;
  let fromLedger = 0;
  let toLedger = 0;

  while (pages < maxPages) {
    const url =
      `${base}?order=asc&limit=${pageLimit}` +
      (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);

    const res = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Nothing indexed for this contract yet - a real, empty answer.
    if (res.status === 404) break;
    if (!res.ok) {
      throw new Error(`index bootstrap: ${res.status} ${res.statusText} from ${url}`);
    }

    const records = readRecords(await res.json());
    pages += 1;
    rawEvents += records.length;

    for (const record of records) {
      const ledger = ledgerFromToid(record.id);
      if (ledger > 0) {
        if (fromLedger === 0 || ledger < fromLedger) fromLedger = ledger;
        if (ledger > toLedger) toLedger = ledger;
      }
      const decoded = decodeRemoteEvent(record, ledger);
      if (decoded) events.push(decoded);
    }

    // A short page means the history is drained.
    if (records.length < pageLimit) break;
    const last = records[records.length - 1];
    if (!last) break;
    cursor = last.id;
  }

  return { events, pages, rawEvents, fromLedger, toLedger };
}

export interface BootstrapNetworkOptions {
  readonly store: DidIndexStore;
  readonly network: NetworkType;
  readonly registryContractId: string;
  /** Used to confirm every discovered DID against the ledger. */
  readonly rpcServer: rpc.Server;
  readonly baseUrl?: string;
  readonly fetchImpl?: FetchLike;
  readonly pageLimit?: number;
  readonly maxPages?: number;
  readonly timeoutMs?: number;
}

export interface BootstrapNetworkResult {
  readonly network: NetworkType;
  /** Distinct DIDs the archival history surfaced. */
  readonly discovered: number;
  /** Rows `applyEvents` actually wrote. */
  readonly written: number;
  /** Rows re-read from the ledger. */
  readonly confirmed: number;
  /** Discovered DIDs the ledger has no entry for, so they were dropped. */
  readonly dropped: number;
  readonly fromLedger: number;
  readonly toLedger: number;
}

/**
 * Seed one network's index from the contract's full event history, then
 * confirm every row against the ledger.
 *
 * The confirmation pass is not an optimisation, it is what makes the
 * archival source safe to depend on: after it runs, every controller in
 * the index came from a `getLedgerEntries` read, and anything the ledger
 * does not corroborate has been removed.
 *
 * Writes a cursor whose `firstLedger` is the contract's first event, so
 * `/health` reports the coverage the index genuinely has and the
 * subsequent `syncNetwork` does not narrow it back to the RPC floor.
 */
export async function bootstrapNetwork(
  opts: BootstrapNetworkOptions
): Promise<BootstrapNetworkResult> {
  const discovered = await discoverEvents({
    network: opts.network,
    registryContractId: opts.registryContractId,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.pageLimit !== undefined ? { pageLimit: opts.pageLimit } : {}),
    ...(opts.maxPages !== undefined ? { maxPages: opts.maxPages } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });

  const didIds = [...new Set(discovered.events.map((e) => e.didId))];
  if (didIds.length === 0) {
    return {
      network: opts.network,
      discovered: 0,
      written: 0,
      confirmed: 0,
      dropped: 0,
      fromLedger: discovered.fromLedger,
      toLedger: discovered.toLedger,
    };
  }

  const applied = await opts.store.applyEvents(opts.network, discovered.events);

  // Re-read every discovered DID off the ledger. This is what downgrades
  // the archival index from "trusted source" to "list of candidates".
  let confirmed = 0;
  let dropped = 0;
  for (let i = 0; i < didIds.length; i += VERIFY_CHUNK) {
    const result = await reconcile({
      store: opts.store,
      rpcServer: opts.rpcServer,
      registryContractId: opts.registryContractId,
      network: opts.network,
      didIds: didIds.slice(i, i + VERIFY_CHUNK),
    });
    confirmed += result.checked;
    dropped += result.removed;
  }

  // `syncNetwork` keeps the lower of the stored and the requested
  // `firstLedger`, so recording the contract's first event here survives
  // every later sync from the RPC retention floor.
  const cursor: IndexCursor = {
    network: opts.network,
    // No paging token: the RPC stream is a different stream, and
    // `syncNetwork` must start it from the retention floor.
    cursor: null,
    firstLedger: discovered.fromLedger,
    lastLedger: discovered.toLedger,
    syncedAt: new Date().toISOString(),
  };
  await opts.store.setCursor(cursor);

  return {
    network: opts.network,
    discovered: didIds.length,
    written: applied.written,
    confirmed,
    dropped,
    fromLedger: discovered.fromLedger,
    toLedger: discovered.toLedger,
  };
}

// --- Wire format -------------------------------------------------------------

/** One record of `/contract/{id}/events`. Only the fields we decode. */
interface RemoteEvent {
  readonly id: string;
  readonly ts: number;
  readonly topicsXdr: readonly string[];
  readonly bodyXdr: string;
}

/**
 * Pull the record array out of an untyped JSON body, keeping only entries
 * that carry every field the decoder needs. A malformed record is skipped
 * rather than thrown on: it is the same policy `decodeRegistryEvents`
 * applies to the RPC stream, and one bad row must not lose the rest.
 */
function readRecords(body: unknown): RemoteEvent[] {
  if (typeof body !== 'object' || body === null) return [];
  const embedded = (body as { _embedded?: unknown })._embedded;
  if (typeof embedded !== 'object' || embedded === null) return [];
  const records = (embedded as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];

  const out: RemoteEvent[] = [];
  for (const raw of records as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { id, ts, topicsXdr, bodyXdr } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof bodyXdr !== 'string' || bodyXdr.length === 0) continue;
    if (!Array.isArray(topicsXdr)) continue;
    if (!topicsXdr.every((t): t is string => typeof t === 'string')) continue;
    out.push({
      id,
      ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : 0,
      topicsXdr,
      bodyXdr,
    });
  }
  return out;
}

/** Reshape a remote record into what {@link decodeRegistryEvent} expects. */
function decodeRemoteEvent(record: RemoteEvent, ledger: number): DidRegistryEvent | null {
  let topic: xdr.ScVal[];
  let value: xdr.ScVal;
  try {
    topic = record.topicsXdr.map((t) => xdr.ScVal.fromXDR(t, 'base64'));
    value = xdr.ScVal.fromXDR(record.bodyXdr, 'base64');
  } catch {
    return null;
  }

  return decodeRegistryEvent({
    id: paddedEventId(record.id),
    topic,
    value,
    ledger,
    ledgerClosedAt: new Date(record.ts * 1000).toISOString(),
    // The index only holds events from successful invocations, which is
    // the set `decodeRegistryEvent` keeps anyway.
    inSuccessfulContractCall: true,
    // Not exposed by this endpoint, and nothing downstream reads it.
    txHash: '',
  } as unknown as rpc.Api.EventResponse);
}

/**
 * A Stellar TOID packs the ledger sequence into its high 32 bits, so the
 * ledger is recoverable from the event id alone. Ids are `{toid}-{index}`.
 */
function ledgerFromToid(id: string): number {
  const [toid] = id.split('-');
  if (toid === undefined || !/^\d+$/.test(toid)) return 0;
  try {
    return Number(BigInt(toid) >> 32n);
  } catch {
    return 0;
  }
}

/**
 * Zero-pad `{toid}-{index}` so plain string comparison stays chronological.
 *
 * `reduceEvent` ignores any event whose id is not strictly greater than
 * the row's `lastEventId`. Soroban RPC pads its ids; this endpoint does
 * not, so unpadded ids would sort a 9-digit toid above a 10-digit one and
 * silently drop the later event of a DID that mutated twice.
 */
function paddedEventId(id: string): string {
  const [toid = '0', index = '0'] = id.split('-');
  return `${toid.padStart(25, '0')}-${index.padStart(10, '0')}`;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
