/**
 * `ActaDidClient` — thin HTTP wrapper over the `did-stellar-api`
 * service (Bloque C, e.g. `https://did.acta.build`).
 *
 * The client is *optional*. The canonical path is to use
 * {@link resolveDidStellar} and {@link prepareRegisterDidXdr} directly,
 * which speak Stellar RPC and do not depend on any ACTA-hosted service.
 *
 * Use this client when:
 *
 * - you don't have a Soroban RPC URL configured client-side and prefer
 *   to delegate that detail to ACTA, or
 * - you are integrating with the DIF Universal Resolver and want a
 *   uniform HTTP fetch path.
 *
 * Every method maps to one endpoint described in
 * [`TRANCHE_2_PLAN.md`](../../../TRANCHE_2_PLAN.md) §4.2. The shapes
 * follow the spec exactly — `kebab-case` query params,
 * `camelCase` request bodies.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import { DidError } from './errors';
import type { DidDocument, DidResolutionResult } from './document/types';
import type { DidRecord, DidRecordInput } from './record/types';

export interface ActaDidClientOptions {
  /** Base URL of the `did-stellar-api` service (e.g. `https://did.acta.build`). */
  readonly baseUrl: string;
  /** Per-request timeout in ms. Defaults to 10_000. */
  readonly timeoutMs?: number;
}

/** Combined record + parsed DID — what `GET /v1/dids/stellar/:did` returns. */
export interface DidRecordResponse {
  readonly did: string;
  readonly didId: string;
  readonly record: DidRecord;
}

/** Output of every mutation endpoint (prepare or submit). */
export interface DidMutationResponse {
  readonly xdr?: string;
  readonly network?: 'mainnet' | 'testnet';
  readonly txId?: string;
}

export class ActaDidClient {
  private readonly http: AxiosInstance;

  constructor(opts: ActaDidClientOptions) {
    if (typeof opts.baseUrl !== 'string' || opts.baseUrl.length === 0) {
      throw new DidError('http_error', 'baseUrl must be a non-empty string');
    }
    this.http = axios.create({
      baseURL: opts.baseUrl.replace(/\/$/u, ''),
      timeout: opts.timeoutMs ?? 10_000,
      headers: { Accept: 'application/did+ld+json, application/json' },
    });
  }

  /** Resolve a DID to a W3C document (DIF resolver-compatible). */
  async resolve(did: string): Promise<DidResolutionResult> {
    return this.get<DidResolutionResult>(`/1.0/identifiers/${encodeURIComponent(did)}`);
  }

  /**
   * Convenience: resolve and return only the `didDocument`. Throws
   * `did_not_found` if the resolver reports `notFound`.
   */
  async resolveDocument(did: string): Promise<DidDocument> {
    const result = await this.resolve(did);
    if (!result.didDocument) {
      throw new DidError(
        result.didResolutionMetadata.error === 'notFound' ? 'did_not_found' : 'http_error',
        result.didResolutionMetadata.message ?? `unable to resolve ${did}`
      );
    }
    return result.didDocument;
  }

  /** Read the raw on-chain `DidRecord` (no W3C document construction). */
  async getDidRecord(did: string): Promise<DidRecordResponse> {
    return this.get<DidRecordResponse>(`/v1/dids/stellar/${encodeURIComponent(did)}`);
  }

  /**
   * Build an unsigned `register` transaction via the API. Most
   * integrators should prefer {@link prepareRegisterDidXdr} for a fully
   * local prepare path.
   */
  async prepareRegister(args: {
    record: DidRecordInput;
    network: 'mainnet' | 'testnet';
    sourcePublicKey?: string;
  }): Promise<DidMutationResponse> {
    return this.post<DidMutationResponse>('/v1/dids/stellar', args);
  }

  /** Submit a signed XDR for any mutation endpoint. */
  async submit(args: { signedXdr: string }): Promise<DidMutationResponse> {
    return this.post<DidMutationResponse>('/v1/dids/stellar/submit', args);
  }

  // --- Internal -------------------------------------------------------------

  private async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.http.get<T>(path, config);
      return res.data;
    } catch (cause) {
      throw httpError(cause);
    }
  }

  private async post<T>(path: string, body: unknown, config?: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.http.post<T>(path, body, config);
      return res.data;
    } catch (cause) {
      throw httpError(cause);
    }
  }
}

function httpError(cause: unknown): DidError {
  if (axios.isAxiosError(cause)) {
    const status = cause.response?.status;
    const body = cause.response?.data as { code?: string; message?: string } | undefined;
    const message = body?.message ?? cause.message;
    return new DidError('http_error', `did-stellar-api request failed: ${message}`, {
      cause,
      details: {
        httpStatus: status,
        code: body?.code,
      },
    });
  }
  return new DidError('http_error', 'did-stellar-api request failed', { cause });
}
