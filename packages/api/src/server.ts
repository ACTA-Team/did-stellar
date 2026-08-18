/**
 * Express application factory.
 *
 * Exposed as a pure function `buildApp({ config, cache, logger })` so
 * tests can construct an isolated server with in-memory backends and
 * mocked SDK calls. The entrypoint (`src/index.ts`) is the only place
 * that wires the real backends together.
 */

import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { errorHandler } from './middleware/error-handler';
import { rateLimit } from './middleware/rate-limit';
import { requestId } from './middleware/request-id';
import { buildOpenApiSpec } from './openapi';
import { directoryRouter } from './routes/directory';
import { docsRouter } from './routes/docs';
import { healthRouter } from './routes/health';
import { mutationsRouter } from './routes/mutations';
import { recordsRouter } from './routes/records';
import { resolverRouter } from './routes/resolver';

import type { AppConfig } from './config';
import type { Analytics } from './lib/analytics';
import type { Cache } from './lib/cache';
import type { Logger } from './logger';
import type { IndexHealth } from './routes/health';
import type { DidIndexStore } from '@acta-team/did-stellar-indexer';

export interface BuildAppDeps {
  readonly config: AppConfig;
  readonly cache: Cache;
  readonly logger: Logger;
  readonly analytics: Analytics;
  /**
   * Backing store for the controller → DIDs index. `null` (the default)
   * disables `GET /v1/dids/stellar`, which then answers 501 - the
   * resolver and mutation endpoints are unaffected either way.
   */
  readonly indexStore?: DidIndexStore | null;
  /** Reports whether the index has finished its initial backfill. */
  readonly indexReady?: () => boolean;
  /** Per-network index status for `/health`. */
  readonly indexStatus?: () => Promise<IndexHealth>;
}

export function buildApp(deps: BuildAppDeps): Express {
  const app = express();

  // Trust upstream proxy headers so req.ip reflects the real client.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(
    pinoHttp({
      logger: deps.logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'https:', 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  app.use(
    cors({
      origin: deps.config.corsOrigins === '*' ? true : [...deps.config.corsOrigins],
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Accept', 'X-Request-ID'],
      exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    })
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(
    rateLimit({
      cache: deps.cache,
      max: deps.config.rateLimit.max,
      windowSeconds: deps.config.rateLimit.windowSeconds,
    })
  );

  // --- Routes ---------------------------------------------------------------
  app.use(
    healthRouter({
      config: deps.config,
      ...(deps.indexStatus ? { indexStatus: deps.indexStatus } : {}),
    })
  );
  app.use(resolverRouter({ config: deps.config, cache: deps.cache, analytics: deps.analytics }));
  app.use(
    directoryRouter({
      config: deps.config,
      store: deps.indexStore ?? null,
      ...(deps.indexReady ? { isReady: deps.indexReady } : {}),
    })
  );
  app.use(recordsRouter({ config: deps.config }));
  app.use(mutationsRouter({ config: deps.config, analytics: deps.analytics }));

  // --- OpenAPI + Swagger UI -------------------------------------------------
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(buildOpenApiSpec(deps.config));
  });
  app.use(docsRouter());
  app.get('/', (_req: Request, res: Response) => {
    res.redirect(301, '/docs');
  });

  // --- 404 ------------------------------------------------------------------
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      code: 'not_found',
      message: `no route for ${req.method} ${req.originalUrl}`,
    });
  });

  // --- Error handler --------------------------------------------------------
  app.use(errorHandler);

  return app;
}
