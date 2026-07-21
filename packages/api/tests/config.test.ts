import { describe, expect, it } from 'vitest';

import { loadConfig, networkConfigFor } from '../src/config';

const TESTNET_CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';
const MAINNET_CONTRACT = 'CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ';

describe('loadConfig', () => {
  it('returns defaults for both networks when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8080);
    expect(cfg.networks.testnet.registryContractId).toBe(TESTNET_CONTRACT);
    expect(cfg.networks.mainnet.registryContractId).toBe(MAINNET_CONTRACT);
    expect(cfg.networks.testnet.allowHttp).toBe(false);
    expect(cfg.resolverCacheTtlSeconds).toBe(30);
    expect(cfg.rateLimit.max).toBe(120);
    expect(cfg.corsOrigins).toBe('*');
    expect(cfg.logLevel).toBe('info');
    expect(cfg.nodeEnv).toBe('development');
  });

  it('honours overrides', () => {
    const cfg = loadConfig({
      PORT: '9090',
      RATE_LIMIT_MAX: '50',
      RATE_LIMIT_WINDOW_SECONDS: '30',
      CORS_ORIGINS: 'https://verifier.example.com,https://wallet.example.com',
      LOG_LEVEL: 'warn',
    });
    expect(cfg.port).toBe(9090);
    expect(cfg.rateLimit).toEqual({ max: 50, windowSeconds: 30 });
    expect(cfg.corsOrigins).toEqual(['https://verifier.example.com', 'https://wallet.example.com']);
    expect(cfg.logLevel).toBe('warn');
  });

  it('rejects an invalid NETWORK_TYPE', () => {
    expect(() => loadConfig({ NETWORK_TYPE: 'pubnet' })).toThrow(/mainnet.*testnet/);
  });

  it('rejects non-positive numeric envs', () => {
    expect(() => loadConfig({ PORT: '0' })).toThrow(/positive integer/);
    expect(() => loadConfig({ RATE_LIMIT_MAX: '-3' })).toThrow();
  });

  it('honours per-network registry overrides', () => {
    const cfg = loadConfig({
      DID_REGISTRY_CONTRACT_ID_TESTNET: 'CBTESTOVERRIDE',
      DID_REGISTRY_CONTRACT_ID_MAINNET: 'CBMAINOVERRIDE',
    });
    expect(cfg.networks.testnet.registryContractId).toBe('CBTESTOVERRIDE');
    expect(cfg.networks.mainnet.registryContractId).toBe('CBMAINOVERRIDE');
  });

  it('honours the legacy single-network env for the NETWORK_TYPE network', () => {
    const cfg = loadConfig({
      NETWORK_TYPE: 'mainnet',
      DID_REGISTRY_CONTRACT_ID: 'CBLEGACYMAIN',
    });
    expect(cfg.networks.mainnet.registryContractId).toBe('CBLEGACYMAIN');
    // The other network keeps its default.
    expect(cfg.networks.testnet.registryContractId).toBe(TESTNET_CONTRACT);
  });

  it('marks allowHttp=true for a network with an http rpc url', () => {
    const cfg = loadConfig({ STELLAR_RPC_URL_TESTNET: 'http://localhost:8000/soroban' });
    expect(cfg.networks.testnet.allowHttp).toBe(true);
    expect(cfg.networks.mainnet.allowHttp).toBe(false);
  });

  it('networkConfigFor returns the per-network config when configured', () => {
    const cfg = loadConfig({});
    expect(networkConfigFor(cfg, 'testnet')?.registryContractId).toBe(TESTNET_CONTRACT);
    expect(networkConfigFor(cfg, 'mainnet')?.registryContractId).toBe(MAINNET_CONTRACT);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('disables analytics by default and enables it via POSTHOG_API_KEY', () => {
    expect(loadConfig({}).analytics).toEqual({
      apiKey: null,
      host: 'https://us.i.posthog.com',
    });
    const cfg = loadConfig({
      POSTHOG_API_KEY: 'phc_test',
      POSTHOG_HOST: 'https://eu.i.posthog.com',
    });
    expect(cfg.analytics).toEqual({ apiKey: 'phc_test', host: 'https://eu.i.posthog.com' });
  });
});
