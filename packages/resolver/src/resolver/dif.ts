/**
 * DIF [`did-resolver`](https://www.npmjs.com/package/did-resolver) driver.
 *
 * Returns a record shaped `{ stellar: ResolverFn }` that can be passed to
 * `new Resolver(getResolver())` from `did-resolver`. We avoid taking a
 * dependency on `did-resolver` itself — the surface is small enough to
 * mirror locally and consumers wire it in via their existing instance.
 */

import { DidError } from '../errors';

import { resolveDidStellar } from './resolve';

import type { DidResolutionResult } from '../document/types';
import type { NetworkType } from '../network';

/** Per-network override for RPC URL + registry contract ID. */
export interface GetResolverOptions {
  readonly mainnetRpcUrl?: string;
  readonly testnetRpcUrl?: string;
  readonly mainnetRegistryContractId?: string;
  readonly testnetRegistryContractId?: string;
  readonly allowHttp?: boolean;
}

/** Loose signature matching DIF `did-resolver`'s `ResolverFn`. */
export type DifResolverFn = (
  did: string,
  parsed: { method?: string },
  resolver: unknown,
  options: { accept?: string }
) => Promise<DidResolutionResult>;

/**
 * Build a DIF-compatible resolver map. Wrap as:
 *
 * ```ts
 * import { Resolver } from 'did-resolver';
 * import { getResolver } from '@acta-team/did-stellar/resolver';
 *
 * const resolver = new Resolver({ ...getResolver() });
 * const result = await resolver.resolve('did:stellar:testnet:...');
 * ```
 */
export function getResolver(opts: GetResolverOptions = {}): { stellar: DifResolverFn } {
  const stellar: DifResolverFn = async (did, parsed) => {
    if (parsed.method && parsed.method !== 'stellar') {
      return {
        didDocument: null,
        didDocumentMetadata: { versionId: '' },
        didResolutionMetadata: {
          error: 'methodNotSupported',
          message: `expected did:stellar, got method=${parsed.method}`,
        },
      };
    }

    try {
      const network = parseNetwork(did);
      return await resolveDidStellar(did, {
        ...rpcOverrideFor(opts, network),
        ...registryOverrideFor(opts, network),
        ...(opts.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}),
      });
    } catch (cause) {
      if (DidError.is(cause)) {
        return {
          didDocument: null,
          didDocumentMetadata: { versionId: '' },
          didResolutionMetadata: {
            error: cause.code === 'did_invalid' ? 'invalidDid' : 'internalError',
            message: cause.message,
          },
        };
      }
      return {
        didDocument: null,
        didDocumentMetadata: { versionId: '' },
        didResolutionMetadata: {
          error: 'internalError',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  };

  return { stellar };
}

function parseNetwork(did: string): NetworkType {
  const parts = did.split(':');
  if (parts.length >= 3 && (parts[2] === 'mainnet' || parts[2] === 'testnet')) {
    return parts[2];
  }
  throw new DidError('did_invalid', `unable to extract network from DID: ${did}`);
}

function rpcOverrideFor(opts: GetResolverOptions, network: NetworkType): { rpcUrl?: string } {
  if (network === 'mainnet' && opts.mainnetRpcUrl) return { rpcUrl: opts.mainnetRpcUrl };
  if (network === 'testnet' && opts.testnetRpcUrl) return { rpcUrl: opts.testnetRpcUrl };
  return {};
}

function registryOverrideFor(
  opts: GetResolverOptions,
  network: NetworkType
): { registryContractId?: string } {
  if (network === 'mainnet' && opts.mainnetRegistryContractId) {
    return { registryContractId: opts.mainnetRegistryContractId };
  }
  if (network === 'testnet' && opts.testnetRegistryContractId) {
    return { registryContractId: opts.testnetRegistryContractId };
  }
  return {};
}
