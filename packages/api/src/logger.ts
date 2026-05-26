/**
 * Structured logger factory.
 *
 * `pino` is the standard for Node services: low overhead, JSON output,
 * synchronous transport-safe. We expose a factory rather than a global
 * so tests can pass a silent logger and production can attach pretty
 * transports without polluting the rest of the codebase.
 */

import pino, { type Logger } from 'pino';

import type { AppConfig } from './config';

export type { Logger } from 'pino';

export function buildLogger(config: Pick<AppConfig, 'logLevel' | 'nodeEnv'>): Logger {
  const isProduction = config.nodeEnv === 'production';
  return pino({
    level: config.logLevel,
    // In dev, pretty-print to stdout via pino-pretty when available; in
    // prod, leave the default JSON line format for log aggregators.
    ...(isProduction
      ? {}
      : {
          transport: {
            target: 'pino/file',
            options: { destination: 1 },
          },
        }),
    base: { service: 'did-stellar-api' },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      remove: true,
    },
  });
}
