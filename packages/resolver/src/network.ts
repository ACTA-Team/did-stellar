/**
 * Network identifiers and Stellar passphrases for `did:stellar`.
 *
 * The set is intentionally closed to `mainnet` and `testnet` per
 * `did:stellar` v0.1 §2. No aliases (`pubnet`, `public`, `horizon`) are
 * accepted anywhere in the SDK.
 */

import { Networks } from '@stellar/stellar-sdk';

/** Closed set of supported networks. */
export type NetworkType = 'mainnet' | 'testnet';

/** Soroban RPC URLs maintained by the Stellar Development Foundation. */
export const DEFAULT_RPC_URLS: Readonly<Record<NetworkType, string>> = Object.freeze({
  mainnet: 'https://mainnet.sorobanrpc.com',
  testnet: 'https://soroban-testnet.stellar.org',
});

/** Canonical `did-stellar-registry` contract IDs deployed by the ACTA team. */
export const DEFAULT_REGISTRY_CONTRACT_IDS: Readonly<Record<NetworkType, string>> = Object.freeze({
  // Filled in by Bloque E (Mainnet RC).
  mainnet: '',
  // Tranche 1 deployment: see contracts-acta/docs/deployments/testnet.md
  testnet: 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ',
});

/** Stellar network passphrase per network. Required when signing XDR. */
export const NETWORK_PASSPHRASES: Readonly<Record<NetworkType, string>> = Object.freeze({
  mainnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
});

/** Type guard for {@link NetworkType}. */
export function isNetworkType(value: unknown): value is NetworkType {
  return value === 'mainnet' || value === 'testnet';
}
