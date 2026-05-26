/**
 * Environment-driven configuration for `did-stellar-api`.
 *
 * Centralised parsing + validation so the rest of the service receives a
 * frozen, typed object and never reads `process.env` directly. Every
 * setting falls back to a safe default; the only hard-required value is
 * the registry contract ID when running against mainnet.
 */

import {
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  isNetworkType,
  type NetworkType,
} from '@acta-team/did-stellar';

export interface AppConfig {
  readonly port: number;
  readonly network: NetworkType;
  readonly rpcUrl: string;
  readonly registryContractId: string;
  readonly allowHttp: boolean;
  readonly redisUrl: string | null;
  readonly resolverCacheTtlSeconds: number;
  readonly rateLimit: {
    readonly max: number;
    readonly windowSeconds: number;
  };
  readonly corsOrigins: '*' | readonly string[];
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly nodeEnv: 'development' | 'production' | 'test';
}

/**
 * Build the config object from an environment dictionary. Pure with
 * respect to its input — used directly in tests with a synthetic env.
 *
 * Throws {@link Error} (plain) with a stable message on misconfiguration
 * so the entrypoint can log + exit with a non-zero code.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const network = parseNetwork(env.NETWORK_TYPE);
  const registryContractId = env.DID_REGISTRY_CONTRACT_ID?.trim() || DEFAULT_REGISTRY_CONTRACT_IDS[network];

  if (!registryContractId) {
    throw new Error(
      `Missing DID_REGISTRY_CONTRACT_ID for network=${network}. ` +
        `No default is registered for this network yet — set the env var explicitly.`
    );
  }

  const rpcUrl = env.STELLAR_RPC_URL?.trim() || DEFAULT_RPC_URLS[network];
  const allowHttp = rpcUrl.startsWith('http://');

  const corsOrigins = parseCors(env.CORS_ORIGINS);
  const port = parsePositiveInt('PORT', env.PORT, 8080);
  const ttl = parsePositiveInt('RESOLVER_CACHE_TTL_SECONDS', env.RESOLVER_CACHE_TTL_SECONDS, 30);
  const rateMax = parsePositiveInt('RATE_LIMIT_MAX', env.RATE_LIMIT_MAX, 120);
  const rateWindow = parsePositiveInt('RATE_LIMIT_WINDOW_SECONDS', env.RATE_LIMIT_WINDOW_SECONDS, 60);

  const nodeEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development';

  return Object.freeze<AppConfig>({
    port,
    network,
    rpcUrl,
    registryContractId,
    allowHttp,
    redisUrl: env.REDIS_URL?.trim() || null,
    resolverCacheTtlSeconds: ttl,
    rateLimit: Object.freeze({ max: rateMax, windowSeconds: rateWindow }),
    corsOrigins,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    nodeEnv,
  });
}

function parseNetwork(value: string | undefined): NetworkType {
  const v = (value ?? 'testnet').trim();
  if (!isNetworkType(v)) {
    throw new Error(`NETWORK_TYPE must be 'mainnet' or 'testnet', got: ${value ?? '(unset)'}`);
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
