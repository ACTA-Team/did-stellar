#!/usr/bin/env node
/**
 * Standalone indexer worker.
 *
 * Run this when the index lives in Postgres and several API replicas read
 * from it: exactly one writer, restarted independently of the HTTP tier.
 * With `DID_INDEX_MODE=embedded` (the default) the API runs the same
 * `DidIndexer` in-process and this worker is unnecessary.
 *
 *     DID_INDEX_DATABASE_URL=postgres://... pnpm --filter did-stellar-indexer start
 */

import { pino } from 'pino';

import { buildIndexStore, loadIndexConfig } from '../config';
import { DidIndexer } from '../indexer';

async function main(): Promise<void> {
  let config;
  try {
    config = loadIndexConfig();
  } catch (err) {
    process.stderr.write(`did-stellar-indexer: configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'did-stellar-indexer' });

  if (!config.enabled) {
    logger.warn('DID_INDEX_ENABLED is false; nothing to do');
    return;
  }

  const store = buildIndexStore(config);
  const indexer = new DidIndexer({
    store,
    networks: {
      ...(config.networks.testnet ? { testnet: config.networks.testnet } : {}),
      ...(config.networks.mainnet ? { mainnet: config.networks.mainnet } : {}),
    },
    pollIntervalSeconds: config.pollIntervalSeconds,
    reconcileIntervalSeconds: config.reconcileIntervalSeconds,
    reconcileBatch: config.reconcileBatch,
    bootstrap: config.bootstrap,
    logger,
  });

  await indexer.start();
  logger.info({ status: await indexer.status(), store: store.kind }, 'did-stellar-indexer ready');

  // The indexer's timers are unref'd so they never hold a host process
  // open; this worker IS the process, so keep it alive explicitly.
  const keepAlive = setInterval(() => {
    /* the poll loop does the work */
  }, 60_000);

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    clearInterval(keepAlive);
    indexer.stop();
    void store.close().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, 'store close failed');
        process.exit(1);
      }
    );
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
