/**
 * `DidIndexer` - the long-running piece that keeps the reverse index warm.
 *
 * Lifecycle per network: backfill everything the RPC retains, then poll
 * for new events, with a periodic reconciliation sweep that reads
 * authoritative state off the ledger for rows the event stream left
 * incomplete.
 *
 * `start()` resolves once the initial backfill has completed on every
 * configured network - that is the "backfill before exposing the
 * endpoint" guarantee. It never rejects: a network whose RPC is down
 * records its error in `status()` and keeps retrying on the poll interval
 * rather than taking the whole process with it. Callers that want to gate
 * on a clean backfill inspect `status()`.
 *
 * The timers are `unref()`d, so an embedded indexer never keeps the host
 * process alive on its own.
 */

import { buildRpcServer, type NetworkType } from '@acta-team/did-stellar';

import { syncNetwork, type SyncNetworkResult } from './ingest';
import { reconcile } from './reconcile';

import type { DidIndexStore } from './store/types';
import type { IndexNetworkStatus } from './types';
import type { rpc } from '@stellar/stellar-sdk';

/** Minimal logger surface - satisfied by pino and by `console`. */
export interface IndexerLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const SILENT: IndexerLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface IndexerNetworkConfig {
  readonly rpcUrl: string;
  readonly registryContractId: string;
  readonly allowHttp?: boolean;
  /** First ledger to backfill from. Clamped to the RPC retention floor. */
  readonly startLedger?: number;
}

export interface DidIndexerOptions {
  readonly store: DidIndexStore;
  /** Networks to index. A network may be omitted entirely. */
  readonly networks: Partial<Record<NetworkType, IndexerNetworkConfig>>;
  /** Seconds between polls. Defaults to 10 - roughly two ledger closes. */
  readonly pollIntervalSeconds?: number;
  /**
   * Seconds between reconciliation sweeps. Defaults to 900 (15 min).
   * Set to 0 to disable the background sweep entirely.
   */
  readonly reconcileIntervalSeconds?: number;
  /** DIDs visited per reconciliation sweep. Defaults to 500. */
  readonly reconcileBatch?: number;
  readonly logger?: IndexerLogger;
}

interface NetworkRuntime {
  readonly network: NetworkType;
  readonly config: IndexerNetworkConfig;
  readonly rpcServer: rpc.Server;
  lastError: string | null;
  /** Set when a sync rewound past a retention gap; clears after a sweep. */
  needsSweep: boolean;
  sweepAfter: string | undefined;
}

export class DidIndexer {
  private readonly store: DidIndexStore;
  private readonly logger: IndexerLogger;
  private readonly pollIntervalMs: number;
  private readonly reconcileIntervalMs: number;
  private readonly reconcileBatch: number;
  private readonly runtimes: NetworkRuntime[];

  private pollTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private running = false;
  private syncing = false;
  private backfilled = false;

  constructor(options: DidIndexerOptions) {
    this.store = options.store;
    this.logger = options.logger ?? SILENT;
    this.pollIntervalMs = Math.max(1, options.pollIntervalSeconds ?? 10) * 1000;
    this.reconcileIntervalMs = Math.max(0, options.reconcileIntervalSeconds ?? 900) * 1000;
    this.reconcileBatch = Math.max(1, options.reconcileBatch ?? 500);

    this.runtimes = [];
    for (const network of ['testnet', 'mainnet'] as const) {
      const config = options.networks[network];
      if (!config || !config.registryContractId || !config.rpcUrl) continue;
      this.runtimes.push({
        network,
        config,
        rpcServer: buildRpcServer(config.rpcUrl, {
          allowHttp: config.allowHttp ?? config.rpcUrl.startsWith('http://'),
        }),
        lastError: null,
        needsSweep: false,
        sweepAfter: undefined,
      });
    }
  }

  /** Networks this indexer was configured for. */
  get networks(): NetworkType[] {
    return this.runtimes.map((r) => r.network);
  }

  /** True once the initial backfill has run on every configured network. */
  get isBackfilled(): boolean {
    return this.backfilled;
  }

  /**
   * Run the initial backfill, then start the poll and sweep timers.
   * Resolves after the backfill. Calling it twice is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.store.init();

    if (this.runtimes.length === 0) {
      this.logger.warn({}, 'did-stellar indexer started with no configured networks');
      this.backfilled = true;
      return;
    }

    this.logger.info(
      { networks: this.networks, store: this.store.kind },
      'did-stellar indexer backfilling'
    );
    await this.syncOnce();
    this.backfilled = true;

    // Fill in controllers the backfill window could not supply before the
    // first read lands, so a wallet is not under-reported on boot.
    await this.reconcileOnce({ onlyUnresolved: true });

    if (!this.running) return;
    this.pollTimer = setInterval(() => void this.syncOnce(), this.pollIntervalMs);
    this.pollTimer.unref();
    if (this.reconcileIntervalMs > 0) {
      this.reconcileTimer = setInterval(() => void this.reconcileOnce(), this.reconcileIntervalMs);
      this.reconcileTimer.unref();
    }
  }

  /** Stop the timers. Does not close the store - the owner does that. */
  stop(): void {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.pollTimer = null;
    this.reconcileTimer = null;
  }

  /**
   * Catch every network up once. Errors are captured per network, never
   * thrown: one unreachable RPC must not stop the other network.
   */
  async syncOnce(): Promise<SyncNetworkResult[]> {
    if (this.syncing) return [];
    this.syncing = true;
    const results: SyncNetworkResult[] = [];
    try {
      for (const runtime of this.runtimes) {
        try {
          const result = await syncNetwork({
            store: this.store,
            rpcServer: runtime.rpcServer,
            registryContractId: runtime.config.registryContractId,
            network: runtime.network,
            ...(runtime.config.startLedger !== undefined
              ? { startLedger: runtime.config.startLedger }
              : {}),
          });
          runtime.lastError = null;
          if (result.rewound) {
            runtime.needsSweep = true;
            this.logger.warn(
              { network: runtime.network, fromLedger: result.fromLedger },
              'indexer cursor fell out of RPC retention; rewound and scheduled a full sweep'
            );
          }
          if (result.decoded > 0 || result.rewound) {
            this.logger.info(
              {
                network: runtime.network,
                seen: result.seen,
                decoded: result.decoded,
                written: result.written,
                toLedger: result.toLedger,
              },
              'indexer synced'
            );
          }
          results.push(result);
        } catch (err) {
          runtime.lastError = err instanceof Error ? err.message : String(err);
          this.logger.error({ err, network: runtime.network }, 'indexer sync failed');
        }
      }
    } finally {
      this.syncing = false;
    }
    return results;
  }

  /**
   * Run one reconciliation pass per network. Sweeps page through the
   * index across calls (`sweepAfter` carries the position), so a large
   * index is verified incrementally rather than in one burst.
   */
  async reconcileOnce(opts: { onlyUnresolved?: boolean } = {}): Promise<void> {
    for (const runtime of this.runtimes) {
      try {
        // A rewind means events were lost, so that network gets a full
        // sweep regardless of what the caller asked for.
        const onlyUnresolved = runtime.needsSweep ? false : (opts.onlyUnresolved ?? false);
        const result = await reconcile({
          store: this.store,
          rpcServer: runtime.rpcServer,
          registryContractId: runtime.config.registryContractId,
          network: runtime.network,
          onlyUnresolved,
          maxDids: this.reconcileBatch,
          ...(!onlyUnresolved && runtime.sweepAfter !== undefined
            ? { after: runtime.sweepAfter }
            : {}),
        });
        if (result.checked > 0) {
          this.logger.debug({ network: runtime.network, ...result }, 'indexer reconciled');
        }
        if (result.checked < this.reconcileBatch) {
          // Reached the end of the index; the next sweep starts over.
          runtime.sweepAfter = undefined;
          if (!onlyUnresolved) runtime.needsSweep = false;
        } else if (!onlyUnresolved && result.lastDidId !== null) {
          runtime.sweepAfter = result.lastDidId;
        }
      } catch (err) {
        this.logger.error({ err, network: runtime.network }, 'indexer reconcile failed');
      }
    }
  }

  /**
   * Verify specific DIDs against the ledger right now. Used by the read
   * path so a controller listing reflects the ledger even if a transfer
   * event has not been ingested yet.
   */
  async verify(network: NetworkType, didIds: readonly string[]): Promise<void> {
    const runtime = this.runtimes.find((r) => r.network === network);
    if (!runtime || didIds.length === 0) return;
    await reconcile({
      store: this.store,
      rpcServer: runtime.rpcServer,
      registryContractId: runtime.config.registryContractId,
      network,
      didIds,
    });
  }

  /** Per-network snapshot for `/health` and operator dashboards. */
  async status(): Promise<IndexNetworkStatus[]> {
    const out: IndexNetworkStatus[] = [];
    for (const network of ['testnet', 'mainnet'] as const) {
      const runtime = this.runtimes.find((r) => r.network === network);
      if (!runtime) {
        out.push({
          network,
          configured: false,
          dids: 0,
          firstLedger: 0,
          lastLedger: 0,
          syncedAt: null,
          lastError: null,
        });
        continue;
      }
      const [cursor, dids] = await Promise.all([
        this.store.getCursor(network),
        this.store.countDids(network),
      ]);
      out.push({
        network,
        configured: true,
        dids,
        firstLedger: cursor?.firstLedger ?? 0,
        lastLedger: cursor?.lastLedger ?? 0,
        syncedAt: cursor?.syncedAt ?? null,
        lastError: runtime.lastError,
      });
    }
    return out;
  }
}
