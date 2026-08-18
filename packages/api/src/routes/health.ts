/**
 * Liveness / readiness endpoint.
 *
 * `GET /health` always returns 200 with a small payload - used by
 * Kubernetes/Docker healthchecks and the DIF Universal Resolver
 * sidecar. No external calls (RPC, Redis) so a transient backend
 * outage does NOT take the pod out of rotation; degraded behaviour
 * is surfaced through the resolver responses themselves.
 *
 * The one exception is the `index` block: the reverse index has genuine
 * per-network state (how far it has ingested, when it last synced, the
 * last error) that operators need somewhere, and reading it touches only
 * the index store - never the chain. It is reported, never asserted on:
 * a lagging index still returns `status: "ok"`, because the resolver
 * endpoints do not depend on it.
 */

import { Router } from 'express';

import type { AppConfig } from '../config';
import type { IndexNetworkStatus } from '@acta-team/did-stellar-indexer';

/** Shape of the `index` block. `null` when the index is disabled. */
export interface IndexHealth {
  readonly mode: 'embedded' | 'external';
  readonly store: 'memory' | 'postgres';
  readonly ready: boolean;
  readonly networks: readonly IndexNetworkStatus[];
}

export interface HealthRouterDeps {
  readonly config: Pick<AppConfig, 'networks' | 'index'>;
  readonly indexStatus?: () => Promise<IndexHealth>;
}

export function healthRouter(deps: HealthRouterDeps): Router {
  const router = Router();
  const startedAt = new Date().toISOString();

  router.get('/health', (_req, res) => {
    const base = {
      status: 'ok',
      service: 'did-stellar-api',
      method: 'did:stellar',
      // Multi-network: the resolver routes each DID by its embedded network.
      networks: {
        testnet: deps.config.networks.testnet.registryContractId || null,
        mainnet: deps.config.networks.mainnet.registryContractId || null,
      },
      startedAt,
    };

    if (!deps.indexStatus || !deps.config.index.enabled) {
      res.json({ ...base, index: null });
      return;
    }

    // The status read can touch Postgres; a failure there must not fail
    // the probe, so it degrades to `index: null` like a disabled index.
    deps.indexStatus().then(
      (index) => res.json({ ...base, index }),
      () => res.json({ ...base, index: null })
    );
  });

  return router;
}
