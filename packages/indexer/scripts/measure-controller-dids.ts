/**
 * Throwaway measurement: how many Stellar wallets control more than one DID?
 *
 * Reads every `DidRegistered` event emitted by the `did-stellar-registry`
 * contract on both networks, groups by the event's `controller` field, and
 * prints four numbers per network:
 *
 *   1. total DIDs registered
 *   2. distinct controller wallets
 *   3. wallets holding more than one DID
 *   4. the largest number of DIDs held by a single wallet
 *
 * Nothing here is imported by production code and nothing is written
 * anywhere - it only reads. Delete the file once the number is recorded.
 *
 * ## Why there are two sources
 *
 * Soroban RPC keeps only a rolling event window (about a week on the
 * public SDF endpoints), so `getEvents` cannot reach a contract's first
 * ledger and would silently under-count every DID older than that. The
 * default source is therefore StellarExpert's contract-events API, which
 * indexes from the contract's creation ledger. Its records carry the raw
 * `topicsXdr` / `bodyXdr`, so both sources are handed to the *same*
 * production decoder (`src/events.ts`) and cannot drift in how they read
 * an event.
 *
 * `--source rpc` runs the original RPC walk instead - useful to sanity
 * check the last week against a first-party endpoint. Either way the
 * report prints the ledger range actually covered and warns when the scan
 * is retention-bound, so a number is never quoted as a total when it is
 * only a floor.
 *
 * Usage (from `packages/indexer`):
 *
 * ```sh
 * pnpm tsx scripts/measure-controller-dids.ts
 * pnpm tsx scripts/measure-controller-dids.ts --json
 * pnpm tsx scripts/measure-controller-dids.ts --network mainnet
 * pnpm tsx scripts/measure-controller-dids.ts --source rpc
 * ```
 *
 * Env overrides, all optional:
 *   MEASURE_RPC_URL_{MAINNET,TESTNET}      RPC endpoint, `--source rpc`
 *   MEASURE_CONTRACT_ID_{MAINNET,TESTNET}  non-default registry deploy
 *   MEASURE_START_LEDGER_{MAINNET,TESTNET} first ledger to scan, `--source rpc`
 */

import {
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  type NetworkType,
} from '@acta-team/did-stellar';
import { rpc } from '@stellar/stellar-sdk';

import { DEFAULT_BOOTSTRAP_URL, discoverEvents } from '../src/discover';
import { decodeRegistryEvents, type DidRegistryEvent } from '../src/events';
import { reduceEvent } from '../src/reduce';

import type { DidIndexState } from '../src/types';

/** Events per `getEvents` page. The RPC caps this at 10 000. */
const RPC_PAGE_LIMIT = 10_000;
/** Hard stop so a paging bug cannot loop forever. */
const MAX_PAGES = 5_000;
/**
 * Ledgers of headroom above the RPC's reported `oldestLedger`. The window
 * slides forward while we are asking, so requesting exactly `oldestLedger`
 * is a race. Mirrors `RETENTION_SAFETY_MARGIN` in `src/ingest.ts`.
 */
const RETENTION_SAFETY_MARGIN = 12;

const ALL_NETWORKS: readonly NetworkType[] = ['mainnet', 'testnet'];

type Source = 'history' | 'rpc';

/** The four numbers the card asks for, plus the context to read them with. */
interface NetworkReport {
  readonly network: NetworkType;
  readonly source: Source;
  readonly endpoint: string;
  readonly contractId: string;
  /** 1. `DidRegistered` events seen, deduplicated by `didId`. */
  readonly totalDids: number;
  /** 2. Distinct `controller` values across those events. */
  readonly distinctControllers: number;
  /** 3. Controllers appearing on more than one DID. */
  readonly controllersWithMultiple: number;
  /** 4. Largest DID count on any single controller. */
  readonly maxDidsPerController: number;
  /** Every wallet above one DID, biggest first. Empty when there is none. */
  readonly topControllers: readonly { controller: string; dids: number }[];
  /**
   * The same four numbers after applying `did_controller_transferred` and
   * dropping deactivated DIDs - i.e. who holds what *now*, rather than who
   * registered what. Reported alongside because a DID that was handed off
   * is no longer a duplicate its original registrant has to worry about.
   */
  readonly current: {
    readonly totalDids: number;
    readonly distinctControllers: number;
    readonly controllersWithMultiple: number;
    readonly maxDidsPerController: number;
    readonly deactivated: number;
    readonly transferred: number;
  };
  readonly coverage: Coverage;
}

/** What the scan actually managed to read, so the counts can be judged. */
interface Coverage {
  readonly fromLedger: number;
  readonly toLedger: number;
  readonly pages: number;
  readonly rawEvents: number;
  readonly decodedEvents: number;
  /** Set when the source could not reach the contract's first ledger. */
  readonly retentionFloor: number | null;
  /** True when `MAX_PAGES` cut the walk short. */
  readonly truncated: boolean;
}

interface Scan {
  readonly events: DidRegistryEvent[];
  readonly coverage: Coverage;
}

async function main(): Promise<void> {
  const { networks, json, source } = parseArgs(process.argv.slice(2));

  const reports: NetworkReport[] = [];
  for (const network of networks) {
    if (!json) process.stderr.write(`scanning ${network} via ${source}...\n`);
    reports.push(await measureNetwork(network, source));
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    return;
  }
  for (const report of reports) process.stdout.write(formatReport(report));
}

async function measureNetwork(network: NetworkType, source: Source): Promise<NetworkReport> {
  const upper = network.toUpperCase();
  const contractId =
    process.env[`MEASURE_CONTRACT_ID_${upper}`]?.trim() || DEFAULT_REGISTRY_CONTRACT_IDS[network];

  const endpoint =
    source === 'rpc'
      ? process.env[`MEASURE_RPC_URL_${upper}`]?.trim() || DEFAULT_RPC_URLS[network]
      : DEFAULT_BOOTSTRAP_URL;

  const scan =
    source === 'rpc'
      ? await scanViaRpc(
          endpoint,
          contractId,
          parseOptionalInt(process.env[`MEASURE_START_LEDGER_${upper}`])
        )
      : await scanViaHistory(network, contractId);

  // --- The four numbers, as the card defines them -------------------------
  // Group by the `controller` carried on `DidRegistered` itself. A `didId`
  // can only be registered once, but a replayed page would double count,
  // so dedupe by `didId` first.
  const registeredBy = new Map<string, string>();
  for (const event of scan.events) {
    if (event.kind !== 'registered' || !event.controller) continue;
    if (!registeredBy.has(event.didId)) registeredBy.set(event.didId, event.controller);
  }
  const atRegistration = tally(registeredBy.values());

  // --- Same question, current ledger state --------------------------------
  const states = new Map<string, DidIndexState>();
  for (const event of scan.events) {
    states.set(event.didId, reduceEvent(states.get(event.didId) ?? null, event));
  }
  const liveHolders: string[] = [];
  let deactivated = 0;
  let transferred = 0;
  for (const [didId, state] of states) {
    if (state.deactivated) deactivated += 1;
    else if (state.controller) liveHolders.push(state.controller);
    const origin = registeredBy.get(didId);
    if (origin && state.controller && state.controller !== origin) transferred += 1;
  }
  const current = tally(liveHolders);

  return {
    network,
    source,
    endpoint,
    contractId,
    totalDids: atRegistration.totalDids,
    distinctControllers: atRegistration.distinctControllers,
    controllersWithMultiple: atRegistration.controllersWithMultiple,
    maxDidsPerController: atRegistration.maxDidsPerController,
    topControllers: atRegistration.topControllers,
    current: {
      totalDids: current.totalDids,
      distinctControllers: current.distinctControllers,
      controllersWithMultiple: current.controllersWithMultiple,
      maxDidsPerController: current.maxDidsPerController,
      deactivated,
      transferred,
    },
    coverage: scan.coverage,
  };
}

// --- Source: archival contract history ---------------------------------------

/**
 * Walk the contract's whole event history through the indexer's own
 * `discoverEvents`. The script deliberately calls the production module
 * rather than keeping its own copy of the walk: the measurement is only
 * worth anything if it reads events exactly the way the index does.
 */
async function scanViaHistory(network: NetworkType, contractId: string): Promise<Scan> {
  const result = await discoverEvents({ network, registryContractId: contractId });
  return {
    events: result.events,
    coverage: {
      fromLedger: result.fromLedger,
      toLedger: result.toLedger,
      pages: result.pages,
      rawEvents: result.rawEvents,
      decodedEvents: result.events.length,
      // The archival index starts at the contract's creation ledger, so
      // nothing is cut off the front the way an RPC window cuts it off.
      retentionFloor: null,
      truncated: false,
    },
  };
}

// --- Source: Soroban RPC -----------------------------------------------------

/**
 * Walk `getEvents` from the earliest reachable ledger to the head.
 *
 * No topic filter, for the same reason `src/ingest.ts` uses none: a topic
 * filter pins the exact topic arity, and unrecognised events are dropped
 * by the decoder anyway.
 */
async function scanViaRpc(
  rpcUrl: string,
  contractId: string,
  requestedStart: number | undefined
): Promise<Scan> {
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith('http://') });
  const health = await server.getHealth();
  const floor = Math.max(1, health.oldestLedger + RETENTION_SAFETY_MARGIN);
  const wanted = requestedStart ?? floor;
  const startLedger = Math.max(floor, Math.min(wanted, health.latestLedger));

  const filters: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [contractId] }];
  const events: DidRegistryEvent[] = [];

  let cursor: string | null = null;
  let pages = 0;
  let rawEvents = 0;
  let toLedger = startLedger;
  let truncated = true;

  while (pages < MAX_PAGES) {
    const page: rpc.Api.GetEventsResponse = await server.getEvents(
      cursor === null
        ? { filters, startLedger, limit: RPC_PAGE_LIMIT }
        : { filters, cursor, limit: RPC_PAGE_LIMIT }
    );
    pages += 1;

    const raw = page.events ?? [];
    rawEvents += raw.length;
    events.push(...decodeRegistryEvents(raw));

    const last = raw[raw.length - 1];
    if (last && last.ledger > toLedger) toLedger = last.ledger;
    cursor = page.cursor ?? cursor;

    // A short page means the stream is drained up to the ledger head.
    if (raw.length < RPC_PAGE_LIMIT) {
      if (page.latestLedger > toLedger) toLedger = page.latestLedger;
      truncated = false;
      break;
    }
  }

  return {
    events,
    coverage: {
      fromLedger: startLedger,
      toLedger,
      pages,
      rawEvents,
      decodedEvents: events.length,
      // Only a caller-supplied start at or above the floor proves the scan
      // was not cut off by retention.
      retentionFloor: requestedStart !== undefined && requestedStart >= floor ? null : floor,
      truncated,
    },
  };
}

// --- Counting ----------------------------------------------------------------

interface Tally {
  readonly totalDids: number;
  readonly distinctControllers: number;
  readonly controllersWithMultiple: number;
  readonly maxDidsPerController: number;
  readonly topControllers: readonly { controller: string; dids: number }[];
}

/** Count DIDs per controller over an iterable of one controller per DID. */
function tally(controllers: Iterable<string>): Tally {
  const perController = new Map<string, number>();
  let totalDids = 0;
  for (const controller of controllers) {
    totalDids += 1;
    perController.set(controller, (perController.get(controller) ?? 0) + 1);
  }

  let controllersWithMultiple = 0;
  let maxDidsPerController = 0;
  for (const count of perController.values()) {
    if (count > 1) controllersWithMultiple += 1;
    if (count > maxDidsPerController) maxDidsPerController = count;
  }

  const topControllers = [...perController.entries()]
    .filter(([, dids]) => dids > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([controller, dids]) => ({ controller, dids }));

  return {
    totalDids,
    distinctControllers: perController.size,
    controllersWithMultiple,
    maxDidsPerController,
    topControllers,
  };
}

// --- Output ------------------------------------------------------------------

function formatReport(r: NetworkReport): string {
  const pct =
    r.distinctControllers > 0
      ? ` (${((r.controllersWithMultiple / r.distinctControllers) * 100).toFixed(1)}% of wallets)`
      : '';

  const lines = [
    '',
    `=== ${r.network} ===`,
    `contract  ${r.contractId}`,
    `source    ${r.source} - ${r.endpoint}`,
    '',
    'At registration (DidRegistered.controller):',
    `  total DIDs                 ${r.totalDids}`,
    `  distinct wallets           ${r.distinctControllers}`,
    `  wallets with >1 DID        ${r.controllersWithMultiple}${pct}`,
    `  max DIDs on one wallet     ${r.maxDidsPerController}`,
    '',
    'Current holdings (transfers applied, deactivated excluded):',
    `  active DIDs                ${r.current.totalDids}`,
    `  distinct wallets           ${r.current.distinctControllers}`,
    `  wallets with >1 DID        ${r.current.controllersWithMultiple}`,
    `  max DIDs on one wallet     ${r.current.maxDidsPerController}`,
    `  deactivated DIDs           ${r.current.deactivated}`,
    `  DIDs since transferred     ${r.current.transferred}`,
    '',
    `Coverage: ledgers ${r.coverage.fromLedger}-${r.coverage.toLedger}` +
      ` | ${r.coverage.pages} page(s), ${r.coverage.rawEvents} contract events,` +
      ` ${r.coverage.decodedEvents} DID lifecycle events`,
  ];

  if (r.coverage.retentionFloor !== null) {
    lines.push(
      `WARNING: the scan started at the RPC retention floor (ledger` +
        ` ${r.coverage.retentionFloor}), not at the contract's first ledger. Any` +
        ` DID registered before that is missing, so these counts are a lower` +
        ` bound. Drop --source rpc to read the full history.`
    );
  }
  if (r.coverage.truncated) {
    lines.push(`WARNING: stopped at the ${MAX_PAGES}-page cap before draining the stream.`);
  }

  if (r.topControllers.length > 0) {
    lines.push('', 'Wallets holding more than one DID:');
    for (const { controller, dids } of r.topControllers) {
      lines.push(`  ${controller}  ${dids}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv: readonly string[]): {
  networks: NetworkType[];
  json: boolean;
  source: Source;
} {
  let networks: NetworkType[] = [...ALL_NETWORKS];
  let json = false;
  let source: Source = 'history';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--network' || arg === '-n') {
      const value = argv[i + 1];
      i += 1;
      if (value !== 'mainnet' && value !== 'testnet') {
        throw new Error(`--network expects mainnet or testnet, got: ${String(value)}`);
      }
      networks = [value];
    } else if (arg === '--source' || arg === '-s') {
      const value = argv[i + 1];
      i += 1;
      if (value !== 'history' && value !== 'rpc') {
        throw new Error(`--source expects history or rpc, got: ${String(value)}`);
      }
      source = value;
    } else {
      throw new Error(`unknown argument: ${String(arg)}`);
    }
  }

  return { networks, json, source };
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`expected a positive integer, got: ${value}`);
  return n;
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
