/**
 * Environment-driven configuration for `did-stellar-api`.
 *
 * The service is **multi-network**: it serves both `testnet` and `mainnet`
 * from a single deployment and routes each request by the network embedded
 * in the `did:stellar:{network}:...` identifier. Each network has its own
 * RPC URL + registry contract id; both fall back to the SDK defaults.
 *
 * Per-network env overrides:
 *   - `DID_REGISTRY_CONTRACT_ID_TESTNET` / `DID_REGISTRY_CONTRACT_ID_MAINNET`
 *   - `STELLAR_RPC_URL_TESTNET` / `STELLAR_RPC_URL_MAINNET`
 *
 * Legacy single-network envs (`NETWORK_TYPE`, `DID_REGISTRY_CONTRACT_ID`,
 * `STELLAR_RPC_URL`) are still honoured as a fallback for the network named
 * by `NETWORK_TYPE`, so existing single-network deployments keep working.
 */

import {
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  isNetworkType,
  type NetworkType,
} from '@acta-team/did-stellar';

export interface NetworkConfig {
  readonly rpcUrl: string;
  readonly registryContractId: string;
  readonly allowHttp: boolean;
}

export interface AppConfig {
  readonly port: number;
  /** Per-network RPC + registry. A network with an empty `registryContractId` is unconfigured. */
  readonly networks: Readonly<Record<NetworkType, NetworkConfig>>;
  readonly redisUrl: string | null;
  readonly resolverCacheTtlSeconds: number;
  readonly rateLimit: {
    readonly max: number;
    readonly windowSeconds: number;
  };
  readonly corsOrigins: '*' | readonly string[];
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly nodeEnv: 'development' | 'production' | 'test';
  /**
   * Optional PostHog analytics. When `apiKey` is null the service emits
   * no events — analytics is strictly opt-in via `POSTHOG_API_KEY`,
   * matching the trust-minimised, no-required-infra posture of the
   * resolver.
   */
  readonly analytics: {
    readonly apiKey: string | null;
    readonly host: string;
  };
}

/** All networks the service can serve. */
const NETWORKS: readonly NetworkType[] = ['testnet', 'mainnet'];

/**
 * Build the config object from an environment dictionary. Pure with
 * respect to its input — used directly in tests with a synthetic env.
 *
 * Throws {@link Error} (plain) with a stable message on misconfiguration
 * so the entrypoint can log + exit with a non-zero code.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const legacyNetwork = parseLegacyNetwork(env.NETWORK_TYPE);

  const networks = Object.freeze({
    testnet: buildNetworkConfig('testnet', env, legacyNetwork),
    mainnet: buildNetworkConfig('mainnet', env, legacyNetwork),
  }) as Readonly<Record<NetworkType, NetworkConfig>>;

  if (NETWORKS.every((n) => !networks[n].registryContractId)) {
    throw new Error(
      'No did-stellar-registry configured for any network. ' +
        'Set DID_REGISTRY_CONTRACT_ID_TESTNET and/or DID_REGISTRY_CONTRACT_ID_MAINNET.'
    );
  }

  const corsOrigins = parseCors(env.CORS_ORIGINS);
  const port = parsePositiveInt('PORT', env.PORT, 8080);
  const ttl = parsePositiveInt('RESOLVER_CACHE_TTL_SECONDS', env.RESOLVER_CACHE_TTL_SECONDS, 30);
  const rateMax = parsePositiveInt('RATE_LIMIT_MAX', env.RATE_LIMIT_MAX, 120);
  const rateWindow = parsePositiveInt(
    'RATE_LIMIT_WINDOW_SECONDS',
    env.RATE_LIMIT_WINDOW_SECONDS,
    60
  );

  const nodeEnv =
    env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development';

  return Object.freeze<AppConfig>({
    port,
    networks,
    redisUrl: env.REDIS_URL?.trim() || null,
    resolverCacheTtlSeconds: ttl,
    rateLimit: Object.freeze({ max: rateMax, windowSeconds: rateWindow }),
    corsOrigins,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    nodeEnv,
    analytics: Object.freeze({
      apiKey: env.POSTHOG_API_KEY?.trim() || null,
      host: env.POSTHOG_HOST?.trim() || 'https://us.i.posthog.com',
    }),
  });
}

/**
 * Resolve the {@link NetworkConfig} for a network, or `null` when that
 * network is not configured (no registry contract id). Routes use this to
 * return a clean 501 instead of crashing on an unconfigured network.
 */
export function networkConfigFor(cfg: AppConfig, network: NetworkType): NetworkConfig | null {
  const nc = cfg.networks[network];
  return nc && nc.registryContractId ? nc : null;
}

function buildNetworkConfig(
  network: NetworkType,
  env: NodeJS.ProcessEnv,
  legacyNetwork: NetworkType | null
): NetworkConfig {
  const upper = network.toUpperCase();
  const isLegacyMatch = legacyNetwork === network;

  const legacyRegistry = isLegacyMatch ? env.DID_REGISTRY_CONTRACT_ID?.trim() : undefined;
  const legacyRpc = isLegacyMatch ? env.STELLAR_RPC_URL?.trim() : undefined;

  const registryContractId =
    env[`DID_REGISTRY_CONTRACT_ID_${upper}`]?.trim() ||
    legacyRegistry ||
    '' ||
    DEFAULT_REGISTRY_CONTRACT_IDS[network];

  const rpcUrl =
    env[`STELLAR_RPC_URL_${upper}`]?.trim() || legacyRpc || '' || DEFAULT_RPC_URLS[network];

  return Object.freeze({
    rpcUrl,
    registryContractId,
    allowHttp: rpcUrl.startsWith('http://'),
  });
}

function parseLegacyNetwork(value: string | undefined): NetworkType | null {
  const v = (value ?? '').trim();
  if (v === '') return null;
  if (!isNetworkType(v)) {
    throw new Error(`NETWORK_TYPE, when set, must be 'mainnet' or 'testnet', got: ${value}`);
  }
  return v;
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return n;
}

function parseCors(value: string | undefined): '*' | readonly string[] {
  const raw = (value ?? '*').trim();
  if (raw === '*' || raw === '') return '*';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Object.freeze(list);
}

function parseLogLevel(value: string | undefined): AppConfig['logLevel'] {
  const v = (value ?? 'info').trim();
  if (
    v === 'trace' ||
    v === 'debug' ||
    v === 'info' ||
    v === 'warn' ||
    v === 'error' ||
    v === 'fatal'
  ) {
    return v;
  }
  throw new Error(`LOG_LEVEL must be one of trace|debug|info|warn|error|fatal, got: ${value}`);
}
