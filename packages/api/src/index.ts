#!/usr/bin/env node
/**
 * Entrypoint: parse env → build backends → boot Express → handle signals.
 *
 * Kept tiny on purpose. All wiring lives here; everything reusable
 * lives in {@link buildApp}.
 */

import { loadConfig } from './config';
import { buildCache } from './lib/cache';
import { buildLogger } from './logger';
import { buildApp } from './server';

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

  const app = buildApp({ config, cache, logger });
  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        networks: {
          testnet: config.networks.testnet.registryContractId || null,
          mainnet: config.networks.mainnet.registryContractId || null,
        },
        cache: config.redisUrl ? 'redis' : 'in-memory',
      },
      'did-stellar-api ready'
    );
  });

  // Graceful shutdown — Kubernetes / Docker send SIGTERM.
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'shutting down');
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'http server close failed');
        process.exit(1);
      }
      void cache.close().finally(() => {
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

void main();
