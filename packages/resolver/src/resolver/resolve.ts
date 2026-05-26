/**
 * `resolveDidStellar` — direct (no HTTP service) resolution of a
 * `did:stellar:...` to a W3C DID Document.
 *
 * Reads the on-chain `DidRecord` via Stellar RPC `getLedgerEntries`,
 * constructs the document with {@link buildDidDocument}, and returns a
 * DIF-compatible `DidResolutionResult`. Designed to work offline-of-ACTA:
 * the caller only provides the Stellar RPC URL and (optionally) the
 * registry contract ID. No ACTA-hosted endpoint is contacted.
 */

import { DidError } from '../errors';
import { parseDidStellar } from '../identifier';
import { buildRpcServer } from '../internal/rpc';
import type { NetworkType } from '../network';
import { DEFAULT_REGISTRY_CONTRACT_IDS, DEFAULT_RPC_URLS } from '../network';
import { readDidRecord } from '../record/reader';
import { buildDidDocument } from '../document/builder';
import type { DidResolutionResult } from '../document/types';

export interface ResolveDidStellarOptions {
  /** Stellar RPC URL. Defaults to the SDF public endpoint for the parsed network. */
  readonly rpcUrl?: string;
  /** Registry contract ID. Defaults to the canonical ACTA deployment per network. */
  readonly registryContractId?: string;
  /** Allow plain HTTP (development only). Defaults to inferred from rpcUrl. */
  readonly allowHttp?: boolean;
}

/**
 * Resolve a `did:stellar:...` to a W3C DID Document.
 *
 * Returns a `DidResolutionResult` with one of three shapes:
 *
 * 1. **Active**: `didDocument` populated, `didDocumentMetadata.deactivated = false`.
 * 2. **Deactivated**: `didDocument` is a tombstone (empty arrays), `deactivated = true`.
 * 3. **Not found**: `didDocument = null`, `didResolutionMetadata.error = 'notFound'`.
 *
 * Throws {@link DidError} only for parse failures (`did_invalid`) and
 * misconfiguration (`rpc_url_invalid`, `contract_id_invalid`). Resolution
 * failures (network errors, unknown DIDs) are returned via
 * `didResolutionMetadata.error`, matching the DIF resolver contract.
 */
export async function resolveDidStellar(
  did: string,
  opts: ResolveDidStellarOptions = {}
): Promise<DidResolutionResult> {
  const parsed = parseDidStellar(did);
  const network: NetworkType = parsed.network;

  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URLS[network];
  const registryContractId = opts.registryContractId ?? DEFAULT_REGISTRY_CONTRACT_IDS[network];

  if (!registryContractId) {
    throw new DidError(
      'contract_id_invalid',
      `no default registry contract is configured for network ${network}; pass options.registryContractId explicitly`
    );
  }

  const rpcServer = buildRpcServer(
    rpcUrl,
    opts.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}
  );

  let record;
  try {
    record = await readDidRecord({
      rpcServer,
      registryContractId,
      didIdBytes: parsed.didIdBytes,
    });
  } catch (cause) {
    if (DidError.is(cause)) throw cause;
    return {
      didDocument: null,
      didDocumentMetadata: { versionId: '' },
      didResolutionMetadata: {
        error: 'internalError',
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }

  if (!record) {
    return {
      didDocument: null,
      didDocumentMetadata: { versionId: '' },
      didResolutionMetadata: {
        error: 'notFound',
        message: `no DID record found for ${did}`,
      },
    };
  }

  const { didDocument, didDocumentMetadata } = buildDidDocument({ did, record });

  return {
    didDocument,
    didDocumentMetadata,
    didResolutionMetadata: {
      contentType: 'application/did+ld+json',
    },
  };
}
