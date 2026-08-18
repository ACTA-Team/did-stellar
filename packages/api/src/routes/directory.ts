/**
 * `GET /v1/dids/stellar?controller=G...&network=testnet` - the reverse
 * lookup: every DID a wallet currently controls.
 *
 * ## Why this endpoint exists
 *
 * A Stellar account may control several `did:stellar` identifiers, and
 * that is deliberate - the method spec recommends one DID per relying
 * party so a holder cannot be correlated across contexts (§7.2, §8.3).
 * The registry contract therefore only maps `did_id → record`; an
 * on-chain reverse index would tax every `register` and
 * `transfer_controller` caller for a client-side convenience.
 *
 * Without this endpoint an application's only memory of a user's DID is
 * whatever it put in that browser's local storage. Clear the storage,
 * switch device, or open a different app, and the wallet looks
 * DID-less - so a second DID gets minted and the first one, with every
 * credential issued against it, is orphaned on-chain forever.
 *
 * ## Semantics
 *
 * - Deactivated DIDs are **included**, flagged `deactivated: true`. They
 *   still resolve (as tombstones) and still carry history.
 * - A DID moved by `transfer_controller` is reported under its new
 *   controller only.
 * - A wallet with no DIDs returns `200` with `dids: []`. "This wallet
 *   holds nothing" is a complete answer, not a missing resource - a 404
 *   here would be indistinguishable from a typo'd route.
 *
 * ## Freshness
 *
 * Answers come from an off-chain index rebuilt from the registry's event
 * stream. With `DID_INDEX_VERIFY_ON_READ` on (the default) every listed
 * DID is confirmed against the ledger in one batched read before the
 * response goes out, so `version`, `deactivated` and the controller
 * itself are exactly what the contract holds. The `index` block reports
 * the ledger range the index covers either way.
 */

import { isValidAddress, isNetworkType, buildRpcServer } from '@acta-team/did-stellar';
import { listDidsByController, type DidIndexStore } from '@acta-team/did-stellar-indexer';
import { Router, type Request, type Response } from 'express';

import { networkConfigFor, type AppConfig } from '../config';

import type { NetworkType } from '@acta-team/did-stellar';
import type { rpc } from '@stellar/stellar-sdk';

export interface DirectoryRouterDeps {
  readonly config: AppConfig;
  /** `null` when the index is disabled - the route then answers 501. */
  readonly store: DidIndexStore | null;
  /** Reports whether the initial backfill has finished. */
  readonly isReady?: () => boolean;
}

export function directoryRouter(deps: DirectoryRouterDeps): Router {
  const router = Router();
  // One `rpc.Server` per network, built on first use and reused: the
  // verification path runs on every request and should not re-parse the
  // URL or re-allocate an axios client each time.
  const rpcServers = new Map<NetworkType, rpc.Server>();

  router.get('/v1/dids/stellar', async (req: Request, res: Response): Promise<void> => {
    const store = deps.store;
    if (!store) {
      res.status(501).json({
        code: 'index_unavailable',
        message:
          'the controller → DIDs index is disabled on this deployment (DID_INDEX_ENABLED=false)',
      });
      return;
    }

    const controller = firstQueryValue(req.query['controller']);
    if (controller === '') {
      res.status(400).json({
        code: 'controller_required',
        message: 'query parameter `controller` is required, e.g. ?controller=G...&network=testnet',
      });
      return;
    }
    if (!isValidAddress(controller)) {
      res.status(400).json({
        code: 'controller_invalid',
        message: `controller must be a Stellar address (G... account or C... contract), got: ${controller}`,
      });
      return;
    }

    const network = firstQueryValue(req.query['network']);
    if (!isNetworkType(network)) {
      res.status(400).json({
        code: 'network_invalid',
        message: `query parameter \`network\` is required and must be mainnet or testnet, got: ${network || '(missing)'}`,
      });
      return;
    }

    const netCfg = networkConfigFor(deps.config, network);
    if (!netCfg) {
      res.status(501).json({
        code: 'network_unavailable',
        message: `network not configured on this service: ${network}`,
      });
      return;
    }

    // Answering from a half-built index would under-report a wallet, and
    // under-reporting is exactly the failure this endpoint exists to
    // prevent - the caller would mint a duplicate DID. Say "not yet".
    if (deps.isReady && !deps.isReady()) {
      res.status(503).set('Retry-After', '5').json({
        code: 'index_warming',
        message: 'the DID index is still backfilling; retry shortly',
      });
      return;
    }

    const verifyOnRead = deps.config.index.verifyOnRead;
    const result = await listDidsByController({
      store,
      network,
      controller,
      ...(verifyOnRead
        ? {
            verify: {
              rpcServer: rpcServerFor(rpcServers, network, netCfg.rpcUrl, netCfg.allowHttp),
              registryContractId: netCfg.registryContractId,
            },
          }
        : {}),
    });

    res.json({
      controller,
      network,
      count: result.dids.length,
      dids: result.dids.map((d) => ({
        did: d.did,
        didId: d.didId,
        version: d.version,
        deactivated: d.deactivated,
        createdLedger: d.createdLedger,
        updatedLedger: d.updatedLedger,
      })),
      index: {
        verified: result.verified,
        fromLedger: result.coverage.fromLedger,
        toLedger: result.coverage.toLedger,
        syncedAt: result.coverage.syncedAt,
      },
    });
  });

  return router;
}

function rpcServerFor(
  cache: Map<NetworkType, rpc.Server>,
  network: NetworkType,
  rpcUrl: string,
  allowHttp: boolean
): rpc.Server {
  const existing = cache.get(network);
  if (existing) return existing;
  const server = buildRpcServer(rpcUrl, { allowHttp });
  cache.set(network, server);
  return server;
}

/** Express 5 gives `string | string[] | ParsedQs`; collapse to a plain string. */
function firstQueryValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return typeof first === 'string' ? first.trim() : '';
  }
  return '';
}
