import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

const TESTNET_CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';

describe('loadConfig', () => {
  it('returns defaults for testnet when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.network).toBe('testnet');
    expect(cfg.port).toBe(8080);
    expect(cfg.registryContractId).toBe(TESTNET_CONTRACT);
    expect(cfg.resolverCacheTtlSeconds).toBe(30);
    expect(cfg.rateLimit.max).toBe(120);
    expect(cfg.corsOrigins).toBe('*');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.nodeEnv).toBe('development');
  });

  it('honours overrides', () => {
    const cfg = loadConfig({
      PORT: '9090',
      NETWORK_TYPE: 'testnet',
      RATE_LIMIT_MAX: '50',
      RATE_LIMIT_WINDOW_SECONDS: '30',
      CORS_ORIGINS: 'https://verifier.example.com,https://wallet.example.com',
      LOG_LEVEL: 'warn',
    });
    expect(cfg.port).toBe(9090);
    expect(cfg.rateLimit).toEqual({ max: 50, windowSeconds: 30 });
    expect(cfg.corsOrigins).toEqual([
      'https://verifier.example.com',
      'https://wallet.example.com',
    ]);
    expect(cfg.logLevel).toBe('warn');
  });

  it('rejects an invalid network', () => {
    expect(() => loadConfig({ NETWORK_TYPE: 'pubnet' })).toThrow(/mainnet.*testnet/);
  });

  it('rejects non-positive numeric envs', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/positive integer/);
    expect(() => loadConfig({ RATE_LIMIT_MAX: '-3' })).toThrow();
  });

  it('rejects mainnet without an explicit contract ID', () => {
    expect(() => loadConfig({ NETWORK_TYPE: 'mainnet' })).toThrow(/DID_REGISTRY_CONTRACT_ID/);
  });

  it('accepts mainnet when DID_REGISTRY_CONTRACT_ID is provided', () => {
    const cfg = loadConfig({
      NETWORK_TYPE: 'mainnet',
      DID_REGISTRY_CONTRACT_ID: 'CBSOMETHINGSOMETHING',
    });
    expect(cfg.network).toBe('mainnet');
    expect(cfg.registryContractId).toBe('CBSOMETHINGSOMETHING');
  });

  it('marks allowHttp=true when STELLAR_RPC_URL is http://', () => {
    const cfg = loadConfig({ STELLAR_RPC_URL: 'http://localhost:8000/soroban' });
    expect(cfg.allowHttp).toBe(true);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });
});
