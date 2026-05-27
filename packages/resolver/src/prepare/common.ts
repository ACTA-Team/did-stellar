/**
 * Shared options + helpers used by every `prepare*Xdr` function.
 *
 * The four mutation helpers (`register`, `update`, `transferController`,
 * `deactivate`) share the same control-plane parameters:
 *
 * - `did` — the canonical DID to mutate.
 * - `controller` — the Stellar account that signs (defaults to the
 *   `sourcePublicKey`).
 * - `registryContractId`, `rpcUrl` — fall back to the canonical
 *   per-network defaults.
 *
 * Centralising these here keeps the public surface uniform and makes it
 * obvious which knobs every prepare function exposes.
 */

import { DidError } from '../errors';
import { parseDidStellar } from '../identifier';
import { buildRpcServer } from '../internal/rpc';
import { DEFAULT_REGISTRY_CONTRACT_IDS, DEFAULT_RPC_URLS } from '../network';

import type { NetworkType } from '../network';
import type { rpc } from '@stellar/stellar-sdk';

/** Options common to every prepare/submit helper. */
export interface CommonPrepareOptions {
  /** Stellar account that authorises the mutation (must be a `G...` strkey). */
  readonly sourcePublicKey: string;
  /** Override the default Stellar RPC URL for the DID's network. */
  readonly rpcUrl?: string;
  /** Override the default `did-stellar-registry` contract ID. */
  readonly registryContractId?: string;
  /** Override the outer transaction fee in stroops (default 100_000). */
  readonly baseFee?: string;
  /** Override the transaction timeout in seconds (default 60). */
  readonly timeoutSeconds?: number;
  /** Allow plain HTTP RPC (development only). */
  readonly allowHttp?: boolean;
}

export interface ResolvedContext {
  readonly network: NetworkType;
  readonly didIdBytes: Uint8Array;
  readonly registryContractId: string;
  readonly rpcServer: rpc.Server;
}

/**
 * Parse the DID, resolve defaults for the network, and build an RPC
 * server. Throws `did_invalid` / `contract_id_invalid` / `rpc_url_invalid`
 * on bad input.
 */
export function resolveContext(did: string, opts: CommonPrepareOptions): ResolvedContext {
  const parsed = parseDidStellar(did);
  const registryContractId =
    opts.registryContractId ?? DEFAULT_REGISTRY_CONTRACT_IDS[parsed.network];
  if (!registryContractId) {
    throw new DidError(
      'contract_id_invalid',
      `no default registry contract is configured for network ${parsed.network}; pass options.registryContractId`
    );
  }
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URLS[parsed.network];
  const rpcServer = buildRpcServer(
    rpcUrl,
    opts.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}
  );
  return {
    network: parsed.network,
    didIdBytes: parsed.didIdBytes,
    registryContractId,
    rpcServer,
  };
}
