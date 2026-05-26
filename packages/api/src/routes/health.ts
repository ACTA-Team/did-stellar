/**
 * Liveness / readiness endpoint.
 *
 * `GET /health` always returns 200 with a small payload — used by
 * Kubernetes/Docker healthchecks and the DIF Universal Resolver
 * sidecar. No external calls (RPC, Redis) so a transient backend
 * outage does NOT take the pod out of rotation; degraded behaviour
 * is surfaced through the resolver responses themselves.
 */

import { Router } from 'express';

import type { AppConfig } from '../config';

export function healthRouter(cfg: Pick<AppConfig, 'network' | 'registryContractId'>): Router {
  const router = Router();
  const startedAt = new Date().toISOString();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'did-stellar-api',
      method: 'did:stellar',
      network: cfg.network,
      registryContractId: cfg.registryContractId,
      startedAt,
    });
  });

  return router;
}
