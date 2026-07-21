/**
 * `GET /1.0/identifiers/:did` — DIF Universal Resolver-compatible endpoint.
 *
 * Resolves a `did:stellar:...` via the SDK and emits a W3C DID Document
 * with the appropriate content type. Tombstone documents are returned
 * with HTTP `410 Gone` per spec §4.6.4. Missing DIDs are `404`.
 *
 * Response cache: short-lived (default 30s), keyed by `did:network`.
 * Cache hits never reach the Stellar RPC.
 */

import {
  DidError,
  isValidDidStellar,
  parseDidStellar,
  resolveDidStellar,
  type DidResolutionResult,
} from '@acta-team/did-stellar';
import { Router, type Request, type Response } from 'express';

import { networkConfigFor, type AppConfig } from '../config';
import { anonId, type Analytics } from '../lib/analytics';
import { negotiateContentType, projectDocumentForContentType } from '../lib/content-negotiation';
import { httpFromDidError } from '../lib/errors';

import type { Cache } from '../lib/cache';

const CACHE_KEY = (did: string, network: string): string =>
  `did-stellar-api:resolve:${network}:${did}`;

export interface ResolverRouterDeps {
  readonly config: AppConfig;
  readonly cache: Cache;
  readonly analytics: Analytics;
  /** Override for tests. */
  readonly resolve?: typeof resolveDidStellar;
}

export function resolverRouter(deps: ResolverRouterDeps): Router {
  const router = Router();
  const resolve = deps.resolve ?? resolveDidStellar;

  router.get('/1.0/identifiers/:did', async (req: Request, res: Response): Promise<void> => {
    const rawDid = decodeURIComponent(stringParam(req.params['did']));
    const contentType = negotiateContentType(req);

    if (!isValidDidStellar(rawDid)) {
      deps.analytics.capture('did_resolved', { outcome: 'invalid_did', http_status: 400 });
      res
        .status(400)
        .type(contentType)
        .json(emptyResult('invalidDid', `not a valid did:stellar identifier: ${rawDid}`));
      return;
    }

    // The network is encoded in the DID; resolve against that network's registry.
    const network = parseDidStellar(rawDid).network;
    const netCfg = networkConfigFor(deps.config, network);
    if (!netCfg) {
      deps.analytics.capture(
        'did_resolved',
        { outcome: 'network_unconfigured', network, http_status: 501 },
        anonId(rawDid)
      );
      res
        .status(501)
        .type(contentType)
        .json(
          emptyResult('methodNotSupported', `network not configured on this resolver: ${network}`)
        );
      return;
    }

    const cacheKey = CACHE_KEY(rawDid, network);
    const cached = await deps.cache.get<{ status: number; body: DidResolutionResult }>(cacheKey);
    if (cached) {
      deps.analytics.capture(
        'did_resolved',
        {
          outcome: resolutionOutcome(cached.body, cached.status),
          network,
          cache_hit: true,
          http_status: cached.status,
        },
        anonId(rawDid)
      );
      sendResult(res, contentType, cached.status, cached.body);
      return;
    }

    let result: DidResolutionResult;
    try {
      result = await resolve(rawDid, {
        rpcUrl: netCfg.rpcUrl,
        registryContractId: netCfg.registryContractId,
        allowHttp: netCfg.allowHttp,
      });
    } catch (cause) {
      if (DidError.is(cause)) {
        const mapped = httpFromDidError(cause);
        deps.analytics.capture(
          'did_resolved',
          { outcome: 'error', network, error_code: cause.code, http_status: mapped.status },
          anonId(rawDid)
        );
        res.status(mapped.status).json(mapped.body);
        return;
      }
      throw cause;
    }

    const status = pickHttpStatus(result);

    // Cache active and tombstone responses. Do NOT cache transport
    // errors — `notFound` we DO cache (short TTL) to dampen fuzzing.
    if (!result.didResolutionMetadata.error || result.didResolutionMetadata.error === 'notFound') {
      await deps.cache.set(cacheKey, { status, body: result }, deps.config.resolverCacheTtlSeconds);
    }

    deps.analytics.capture(
      'did_resolved',
      {
        outcome: resolutionOutcome(result, status),
        network,
        cache_hit: false,
        http_status: status,
      },
      anonId(rawDid)
    );
    sendResult(res, contentType, status, result);
  });

  return router;
}

/** Coarse, non-identifying label for a resolution outcome. */
function resolutionOutcome(result: DidResolutionResult, status: number): string {
  if (result.didResolutionMetadata.error) return result.didResolutionMetadata.error;
  if (result.didDocumentMetadata.deactivated === true) return 'deactivated';
  return status === 200 ? 'resolved' : 'other';
}

function sendResult(
  res: Response,
  contentType: 'application/did+ld+json' | 'application/did+json',
  status: number,
  result: DidResolutionResult
): void {
  const document = result.didDocument
    ? projectDocumentForContentType(result.didDocument, contentType)
    : null;
  res
    .status(status)
    .type(contentType)
    .json({
      didDocument: document,
      didDocumentMetadata: result.didDocumentMetadata,
      didResolutionMetadata: {
        ...result.didResolutionMetadata,
        contentType,
      },
    });
}

function pickHttpStatus(result: DidResolutionResult): number {
  if (result.didResolutionMetadata.error === 'invalidDid') return 400;
  if (result.didResolutionMetadata.error === 'notFound') return 404;
  if (result.didResolutionMetadata.error === 'methodNotSupported') return 400;
  if (result.didResolutionMetadata.error === 'representationNotSupported') return 406;
  if (result.didResolutionMetadata.error === 'internalError') return 502;
  if (result.didDocumentMetadata.deactivated === true) return 410;
  return 200;
}

function emptyResult(
  error: 'invalidDid' | 'notFound' | 'methodNotSupported',
  message: string
): DidResolutionResult {
  return {
    didDocument: null,
    didDocumentMetadata: { versionId: '' },
    didResolutionMetadata: { error, message },
  };
}

function stringParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = (value as readonly string[])[0];
    return typeof first === 'string' ? first : '';
  }
  return '';
}
