/**
 * Environment-driven configuration for the indexer.
 *
 * Shared by the standalone worker (`src/bin/worker.ts`) and by
 * `did-stellar-api`, so both read the same variables and a deployment can
 * move the indexer in or out of the API process without renaming anything.
 *
 * Defaults are chosen so that setting nothing at all still works: memory
 * store, both networks pointed at the SDK's canonical registries, a 10s
 * poll. Set `DID_INDEX_DATABASE_URL` to make it durable.
 */

import {
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  type NetworkType,
} from '@acta-team/did-stellar';

import { DEFAULT_BOOTSTRAP_URL } from './discover';
import { MemoryIndexStore } from './store/memory';
import { PostgresIndexStore } from './store/postgres';

import type { DidIndexStore } from './store/types';

export interface IndexNetworkSettings {
  readonly rpcUrl: string;
  readonly registryContractId: string;
  readonly allowHttp: boolean;
  readonly startLedger?: number;
}

export interface IndexConfig {
  /**
   * Master switch. `false` means the API serves no controller listing and
   * the worker exits immediately - the resolver endpoints are unaffected.
   */
  readonly enabled: boolean;
  /**
   * `embedded` runs the ingestion loop inside the API process; `external`
   * makes the API read-only against a store a separate worker writes to.
   * Only meaningful for the API - the worker always ingests.
   */
  readonly mode: 'embedded' | 'external';
  readonly store:
    | { readonly kind: 'memory' }
    | {
        readonly kind: 'postgres';
        readonly connectionString: string;
        readonly schema: string;
        readonly skipSchema: boolean;
        readonly ssl: boolean;
      };
  readonly networks: Readonly<Record<NetworkType, IndexNetworkSettings | null>>;
  /**
   * Seeding the index from the contract's full event history. Without it
   * the index can only ever see the RPC's rolling event window, which on
   * a low-traffic contract is routinely empty - see `discover.ts`.
   */
  readonly bootstrap: {
    readonly mode: 'auto' | 'always' | 'off';
    readonly baseUrl: string;
  };
  readonly pollIntervalSeconds: number;
  readonly reconcileIntervalSeconds: number;
  readonly reconcileBatch: number;
  /** Confirm listings against the ledger before answering. Defaults to `true`. */
  readonly verifyOnRead: boolean;
}

export function loadIndexConfig(env: NodeJS.ProcessEnv = process.env): IndexConfig {
  const enabled = parseBool(env.DID_INDEX_ENABLED, true);
  const mode = env.DID_INDEX_MODE?.trim() === 'external' ? 'external' : 'embedded';

  const connectionString = env.DID_INDEX_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || '';
  const store: IndexConfig['store'] = connectionString
    ? {
        kind: 'postgres',
        connectionString,
        schema: env.DID_INDEX_PG_SCHEMA?.trim() || 'public',
        skipSchema: parseBool(env.DID_INDEX_PG_SKIP_SCHEMA, false),
        // Supabase's pooled connection strings terminate TLS at a proxy
        // whose certificate does not chain to a public root.
        ssl: parseBool(env.DID_INDEX_PG_SSL, connectionString.includes('supabase.')),
      }
    : { kind: 'memory' };

  return Object.freeze<IndexConfig>({
    enabled,
    mode,
    store,
    networks: Object.freeze({
      testnet: buildNetwork('testnet', env),
      mainnet: buildNetwork('mainnet', env),
    }),
    bootstrap: Object.freeze({
      mode: parseBootstrapMode(env.DID_INDEX_BOOTSTRAP),
      baseUrl: env.DID_INDEX_BOOTSTRAP_URL?.trim() || DEFAULT_BOOTSTRAP_URL,
    }),
    pollIntervalSeconds: parsePositiveInt('DID_INDEX_POLL_SECONDS', env.DID_INDEX_POLL_SECONDS, 10),
    reconcileIntervalSeconds: parseNonNegativeInt(
      'DID_INDEX_RECONCILE_SECONDS',
      env.DID_INDEX_RECONCILE_SECONDS,
      900
    ),
    reconcileBatch: parsePositiveInt(
      'DID_INDEX_RECONCILE_BATCH',
      env.DID_INDEX_RECONCILE_BATCH,
      500
    ),
    verifyOnRead: parseBool(env.DID_INDEX_VERIFY_ON_READ, true),
  });
}

/** Build the configured store. The caller owns `init()` and `close()`. */
export function buildIndexStore(cfg: IndexConfig): DidIndexStore {
  if (cfg.store.kind === 'postgres') {
    return new PostgresIndexStore({
      connectionString: cfg.store.connectionString,
      schema: cfg.store.schema,
      skipSchema: cfg.store.skipSchema,
      ssl: cfg.store.ssl,
    });
  }
  return new MemoryIndexStore();
}

/**
 * Per-network settings. Falls back to the same env names the API uses
 * (`DID_REGISTRY_CONTRACT_ID_*`, `STELLAR_RPC_URL_*`) so a combined
 * deployment configures each network exactly once.
 */
function buildNetwork(network: NetworkType, env: NodeJS.ProcessEnv): IndexNetworkSettings | null {
  const upper = network.toUpperCase();
  const registryContractId =
    env[`DID_REGISTRY_CONTRACT_ID_${upper}`]?.trim() || DEFAULT_REGISTRY_CONTRACT_IDS[network];
  if (!registryContractId) return null;

  const rpcUrl =
    env[`DID_INDEX_RPC_URL_${upper}`]?.trim() ||
    env[`STELLAR_RPC_URL_${upper}`]?.trim() ||
    DEFAULT_RPC_URLS[network];

  const startLedger = parseOptionalPositiveInt(
    `DID_INDEX_START_LEDGER_${upper}`,
    env[`DID_INDEX_START_LEDGER_${upper}`]
  );

  return Object.freeze({
    rpcUrl,
    registryContractId,
    allowHttp: rpcUrl.startsWith('http://'),
    ...(startLedger !== undefined ? { startLedger } : {}),
  });
}

/**
 * `auto` (the default) bootstraps only when a network has no cursor yet.
 * An unrecognised value falls back to `auto` rather than throwing: losing
 * the bootstrap over a typo would silently shrink coverage, which is the
 * failure this whole mechanism exists to prevent.
 */
function parseBootstrapMode(value: string | undefined): 'auto' | 'always' | 'off' {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'always') return 'always';
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return 'off';
  return 'auto';
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '') return fallback;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return n;
}

function parseNonNegativeInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got: ${value}`);
  }
  return n;
}

function parseOptionalPositiveInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  return parsePositiveInt(name, value, 0);
}
