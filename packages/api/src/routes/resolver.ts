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

import { Router, type Request, type Response } from 'express';

import {
  DidError,
  isValidDidStellar,
  resolveDidStellar,
  type DidResolutionResult,
} from '@acta-team/did-stellar';

import type { AppConfig } from '../config';
import type { Cache } from '../lib/cache';
import {
  negotiateContentType,
  projectDocumentForContentType,
} from '../lib/content-negotiation';
import { httpFromDidError } from '../lib/errors';

const CACHE_KEY = (did: string, network: string): string => `did-stellar-api:resolve:${network}:${did}`;

export interface ResolverRouterDeps {
  readonly config: AppConfig;
  readonly cache: Cache;
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
      res.status(400).type(contentType).json(
        emptyResult('invalidDid', `not a valid did:stellar identifier: ${rawDid}`)
      );
      return;
    }

    const cacheKey = CACHE_KEY(rawDid, deps.config.network);
    const cached = await deps.cache.get<{ status: number; body: DidResolutionResult }>(cacheKey);
    if (cached) {
      sendResult(res, contentType, cached.status, cached.body);
      return;
    }

    let result: DidResolutionResult;
    try {
      result = await resolve(rawDid, {
        rpcUrl: deps.config.rpcUrl,
        registryContractId: deps.config.registryContractId,
        allowHttp: deps.config.allowHttp,
      });
    } catch (cause) {
      if (DidError.is(cause)) {
        const mapped = httpFromDidError(cause);
        res.status(mapped.status).json(mapped.body);
        return;
      }
      throw cause;
    }

    const status = pickHttpStatus(result);

    // Cache active and tombstone responses. Do NOT cache transport
    // errors — `notFound` we DO cache (short TTL) to dampen fuzzing.
    if (
      !result.didResolutionMetadata.error ||
      result.didResolutionMetadata.error === 'notFound'
    ) {
      await deps.cache.set(cacheKey, { status, body: result }, deps.config.resolverCacheTtlSeconds);
    }

    sendResult(res, contentType, status, result);
  });

  return router;
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

function emptyResult(error: 'invalidDid' | 'notFound', message: string): DidResolutionResult {
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
