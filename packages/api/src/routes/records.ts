/**
 * `GET /v1/dids/stellar/:did` — raw `DidRecord` accessor.
 *
 * Returns the on-chain record without the W3C document wrapper.
 * Integrators use this when they need the `version` value for an
 * optimistic-concurrency update, or when they want to inspect
 * `controller` directly.
 */

import {
  buildRpcServer,
  DidError,
  isValidDidStellar,
  parseDidStellar,
  readDidRecord,
} from '@acta-team/did-stellar';
import { Router, type Request, type Response } from 'express';

import { httpFromDidError } from '../lib/errors';

import type { AppConfig } from '../config';

export interface RecordsRouterDeps {
  readonly config: AppConfig;
}

export function recordsRouter(deps: RecordsRouterDeps): Router {
  const router = Router();

  router.get('/v1/dids/stellar/:did', async (req: Request, res: Response): Promise<void> => {
    const param = req.params['did'];
    const rawDid = decodeURIComponent(Array.isArray(param) ? (param[0] ?? '') : (param ?? ''));
    if (!isValidDidStellar(rawDid)) {
      res.status(400).json({ code: 'did_invalid', message: `not a valid did:stellar: ${rawDid}` });
      return;
    }
    const parsed = parseDidStellar(rawDid);
    if (parsed.network !== deps.config.network) {
      res.status(400).json({
        code: 'network_invalid',
        message: `service is configured for ${deps.config.network}, got DID on ${parsed.network}`,
      });
      return;
    }

    try {
      const rpcServer = buildRpcServer(deps.config.rpcUrl, { allowHttp: deps.config.allowHttp });
      const record = await readDidRecord({
        rpcServer,
        registryContractId: deps.config.registryContractId,
        didIdBytes: parsed.didIdBytes,
      });
      if (!record) {
        res.status(404).json({ code: 'did_not_found', message: `no record for ${rawDid}` });
        return;
      }
      res.json({
        did: rawDid,
        didId: parsed.didId,
        record,
      });
    } catch (cause) {
      if (DidError.is(cause)) {
        const mapped = httpFromDidError(cause);
        res.status(mapped.status).json(mapped.body);
        return;
      }
      throw cause;
    }
  });

  return router;
}
