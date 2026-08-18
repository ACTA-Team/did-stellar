#!/usr/bin/env node
/**
 * Entrypoint: parse env → build backends → boot Express → handle signals.
 *
 * Kept tiny on purpose. All wiring lives here; everything reusable
 * lives in {@link buildApp}.
 */

import { DidIndexer, buildIndexStore } from '@acta-team/did-stellar-indexer';

import { loadConfig } from './config';
import { buildAnalytics } from './lib/analytics';
import { buildCache } from './lib/cache';
import { buildLogger } from './logger';
import { buildApp } from './server';

import type { AppConfig } from './config';
import type { Logger } from './logger';
import type { IndexHealth } from './routes/health';
import type { DidIndexStore } from '@acta-team/did-stellar-indexer';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Fall back to stderr — the logger isn't built yet.
    process.stderr.write(`did-stellar-api: configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const logger = buildLogger(config);
  const cache = await buildCache({
    redisUrl: config.redisUrl,
    onError: (err) => logger.error({ err }, 'cache backend error'),
  });

  const analytics = buildAnalytics(config.analytics);
  const index = buildIndex(config, logger);

  const app = buildApp({
    config,
    cache,
    logger,
    analytics,
    indexStore: index?.store ?? null,
    ...(index ? { indexReady: () => index.isReady(), indexStatus: () => index.status() } : {}),
  });
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        networks: {
          testnet: config.networks.testnet.registryContractId || null,
          mainnet: config.networks.mainnet.registryContractId || null,
        },
        cache: config.redisUrl ? 'redis' : 'in-memory',
        analytics: config.analytics.apiKey ? 'posthog' : 'off',
        index: index ? `${config.index.mode}/${index.store.kind}` : 'off',
      },
      'did-stellar-api ready'
    );
  });

  // The index backfills in the background: the HTTP server accepts
  // connections immediately (so `/health` and the resolver stay
  // available) while `GET /v1/dids/stellar` answers 503 until the
  // backfill lands. Blocking the listen on a full RPC walk would make a
  // slow upstream look like a dead pod.
  if (index) {
    index.start().catch((err: unknown) => logger.error({ err }, 'did index failed to start'));
  }

  // Graceful shutdown — Kubernetes / Docker send SIGTERM.
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    index?.stop();
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'http server close failed');
        process.exit(1);
      }
      void Promise.allSettled([
        cache.close(),
        analytics.shutdown(),
        index?.store.close() ?? Promise.resolve(),
      ]).then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      });
    });
    // Hard kill after 10s — the close callback won't fire if there
    // are still long-poll connections; the operator expects the pod
    // to die promptly.
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

interface IndexHandle {
  readonly store: DidIndexStore;
  start(): Promise<void>;
  stop(): void;
  isReady(): boolean;
  status(): Promise<IndexHealth>;
}

/**
 * Build the reverse-index handle, or `null` when the index is disabled.
 *
 * Two shapes:
 *
 * - `embedded` (default) - this process also ingests events. Right for a
 *   single instance, and the only shape that works with the in-memory
 *   store, since nothing else could fill it.
 * - `external` - a separate `did-stellar-indexer` worker writes to a
 *   shared Postgres and the API only reads. Required as soon as there is
 *   more than one replica: several writers on one cursor would each
 *   re-walk the same pages.
 */
function buildIndex(config: AppConfig, logger: Logger): IndexHandle | null {
  if (!config.index.enabled) return null;

  const store = buildIndexStore(config.index);

  if (config.index.mode === 'external') {
    if (store.kind === 'memory') {
      logger.warn(
        'DID_INDEX_MODE=external with no DID_INDEX_DATABASE_URL: nothing will ever write to ' +
          'the in-memory index, so controller listings will be empty. Set a database URL or ' +
          'use the embedded mode.'
      );
    }
    let ready = false;
    return {
      store,
      start: async () => {
        await store.init();
        ready = true;
      },
      stop: () => {},
      isReady: () => ready,
      status: async () => ({
        mode: 'external',
        store: store.kind,
        ready,
        networks: await externalStatus(store),
      }),
    };
  }

  const indexer = new DidIndexer({
    store,
    networks: {
      ...(config.index.networks.testnet ? { testnet: config.index.networks.testnet } : {}),
      ...(config.index.networks.mainnet ? { mainnet: config.index.networks.mainnet } : {}),
    },
    pollIntervalSeconds: config.index.pollIntervalSeconds,
    reconcileIntervalSeconds: config.index.reconcileIntervalSeconds,
    reconcileBatch: config.index.reconcileBatch,
    logger,
  });

  return {
    store,
    start: () => indexer.start(),
    stop: () => indexer.stop(),
    isReady: () => indexer.isBackfilled,
    status: async () => ({
      mode: 'embedded',
      store: store.kind,
      ready: indexer.isBackfilled,
      networks: await indexer.status(),
    }),
  };
}

/** Status for a read-only API replica: cursor + counts, no runtime state. */
async function externalStatus(store: DidIndexStore): Promise<IndexHealth['networks']> {
  return Promise.all(
    (['testnet', 'mainnet'] as const).map(async (network) => {
      const [cursor, dids] = await Promise.all([
        store.getCursor(network),
        store.countDids(network),
      ]);
      return {
        network,
        configured: cursor !== null,
        dids,
        firstLedger: cursor?.firstLedger ?? 0,
        lastLedger: cursor?.lastLedger ?? 0,
        syncedAt: cursor?.syncedAt ?? null,
        lastError: null,
      };
    })
  );
}

void main();
