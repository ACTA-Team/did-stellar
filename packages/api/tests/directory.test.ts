/**
 * HTTP tests for `GET /v1/dids/stellar?controller=...&network=...`.
 *
 * The index is pre-seeded with decoded events rather than driven through
 * a live sync - the ingestion machinery has its own tests in
 * `@acta-team/did-stellar-indexer`. What matters here is the HTTP
 * contract: parameter validation, status codes, and the response body
 * the three acceptance criteria describe.
 *
 * `verifyOnRead` is off in this fixture, so no test reaches Stellar RPC.
 */

import {
  MemoryIndexStore,
  type DidIndexStore,
  type DidRegistryEvent,
} from '@acta-team/did-stellar-indexer';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAnalytics } from '../src/lib/analytics';
import { InMemoryCache } from '../src/lib/cache';
import { buildApp } from '../src/server';

import type { AppConfig } from '../src/config';

const TESTNET_CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';
const MAINNET_CONTRACT = 'CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ';

const DID_A = 'znfxngsh46vkyqu6inrx4omphi';
const DID_B = 'ceirceirceirceirceirceirce';
const DID_C = 'gmztgmztgmztgmztgmztgmztgm';
const ALICE = 'GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M';
const BOB = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const NOBODY = 'GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3';
const SMART_ACCOUNT = 'CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const network = {
    testnet: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      registryContractId: TESTNET_CONTRACT,
      allowHttp: false,
    },
    mainnet: {
      rpcUrl: 'https://mainnet.sorobanrpc.com',
      registryContractId: MAINNET_CONTRACT,
      allowHttp: false,
    },
  } as const;

  const base: AppConfig = {
    port: 0,
    networks: network,
    redisUrl: null,
    resolverCacheTtlSeconds: 30,
    rateLimit: { max: 1000, windowSeconds: 60 },
    corsOrigins: '*',
    logLevel: 'fatal',
    nodeEnv: 'test',
    analytics: { apiKey: null, host: 'https://us.i.posthog.com' },
    index: {
      enabled: true,
      mode: 'embedded',
      store: { kind: 'memory' },
      networks: network,
      // Tests must never reach the archival bootstrap endpoint.
      bootstrap: { mode: 'off' as const, baseUrl: '' },
      warnings: [],
      pollIntervalSeconds: 10,
      reconcileIntervalSeconds: 900,
      reconcileBatch: 500,
      verifyOnRead: false,
    },
  };
  return Object.freeze({ ...base, ...overrides });
}

interface Opts {
  readonly config?: Partial<AppConfig>;
  readonly store?: DidIndexStore | null;
  readonly indexReady?: () => boolean;
}

function makeApp(opts: Opts = {}) {
  return buildApp({
    config: makeConfig(opts.config ?? {}),
    cache: new InMemoryCache(),
    logger: pino({ level: 'silent' }),
    analytics: buildAnalytics({ apiKey: null, host: 'https://us.i.posthog.com' }),
    indexStore: 'store' in opts ? (opts.store ?? null) : new MemoryIndexStore(),
    ...(opts.indexReady ? { indexReady: opts.indexReady } : {}),
  });
}

/** Decoded events, built directly - the wire decoding is tested upstream. */
const registered = (didId: string, controller: string, ledger: number): DidRegistryEvent => ({
  kind: 'registered',
  didId,
  controller,
  version: 1,
  ledger,
  eventId: `${String(ledger).padStart(19, '0')}-0000000001`,
  txHash: `tx-${ledger}`,
  ledgerClosedAt: '2026-08-17T00:00:00.000Z',
});

const transferred = (
  didId: string,
  oldController: string,
  newController: string,
  version: number,
  ledger: number
): DidRegistryEvent => ({
  kind: 'controller_transferred',
  didId,
  oldController,
  newController,
  version,
  ledger,
  eventId: `${String(ledger).padStart(19, '0')}-0000000001`,
  txHash: `tx-${ledger}`,
  ledgerClosedAt: '2026-08-17T00:00:00.000Z',
});

const deactivated = (didId: string, version: number, ledger: number): DidRegistryEvent => ({
  kind: 'deactivated',
  didId,
  version,
  ledger,
  eventId: `${String(ledger).padStart(19, '0')}-0000000001`,
  txHash: `tx-${ledger}`,
  ledgerClosedAt: '2026-08-17T00:00:00.000Z',
});

async function seededStore(events: DidRegistryEvent[]): Promise<MemoryIndexStore> {
  const store = new MemoryIndexStore();
  await store.init();
  await store.applyEvents('testnet', events);
  await store.setCursor({
    network: 'testnet',
    cursor: 'c1',
    firstLedger: 1,
    lastLedger: 999,
    syncedAt: '2026-08-17T00:00:00.000Z',
  });
  return store;
}

describe('GET /v1/dids/stellar (controller → DIDs)', () => {
  describe('acceptance criteria', () => {
    it('returns all N DIDs a wallet holds, deactivated ones marked as such', async () => {
      const store = await seededStore([
        registered(DID_A, ALICE, 100),
        registered(DID_B, ALICE, 101),
        registered(DID_C, ALICE, 102),
        deactivated(DID_B, 2, 110),
      ]);

      const res = await request(makeApp({ store }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(3);
      expect(res.body.dids).toEqual([
        {
          did: `did:stellar:testnet:${DID_A}`,
          didId: DID_A,
          version: 1,
          deactivated: false,
          createdLedger: 100,
          updatedLedger: 100,
        },
        {
          did: `did:stellar:testnet:${DID_B}`,
          didId: DID_B,
          version: 2,
          deactivated: true,
          createdLedger: 101,
          updatedLedger: 110,
        },
        {
          did: `did:stellar:testnet:${DID_C}`,
          didId: DID_C,
          version: 1,
          deactivated: false,
          createdLedger: 102,
          updatedLedger: 102,
        },
      ]);
    });

    it('moves a transferred DID to the new controller and off the old one', async () => {
      const store = await seededStore([
        registered(DID_A, ALICE, 100),
        registered(DID_B, ALICE, 101),
        transferred(DID_A, ALICE, BOB, 2, 120),
      ]);
      const app = makeApp({ store });

      const alice = await request(app)
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });
      const bob = await request(app)
        .get('/v1/dids/stellar')
        .query({ controller: BOB, network: 'testnet' });

      expect(alice.body.dids.map((d: { didId: string }) => d.didId)).toEqual([DID_B]);
      expect(bob.body.dids.map((d: { didId: string }) => d.didId)).toEqual([DID_A]);
    });

    it('returns 200 with an empty list - not 404 - for a wallet with no DIDs', async () => {
      const store = await seededStore([registered(DID_A, ALICE, 100)]);
      const res = await request(makeApp({ store }))
        .get('/v1/dids/stellar')
        .query({ controller: NOBODY, network: 'testnet' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        controller: NOBODY,
        network: 'testnet',
        count: 0,
        dids: [],
      });
    });
  });

  describe('response envelope', () => {
    it('reports the index coverage alongside the answer', async () => {
      const store = await seededStore([registered(DID_A, ALICE, 100)]);
      const res = await request(makeApp({ store }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });

      expect(res.body.index).toEqual({
        verified: false,
        fromLedger: 1,
        toLedger: 999,
        syncedAt: '2026-08-17T00:00:00.000Z',
      });
    });

    it('scopes results to the requested network', async () => {
      const store = await seededStore([registered(DID_A, ALICE, 100)]);
      const res = await request(makeApp({ store }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'mainnet' });

      expect(res.status).toBe(200);
      expect(res.body.dids).toEqual([]);
    });

    it('accepts a C... smart account as a controller', async () => {
      const store = await seededStore([registered(DID_A, SMART_ACCOUNT, 100)]);
      const res = await request(makeApp({ store }))
        .get('/v1/dids/stellar')
        .query({ controller: SMART_ACCOUNT, network: 'testnet' });

      expect(res.status).toBe(200);
      expect(res.body.dids.map((d: { didId: string }) => d.didId)).toEqual([DID_A]);
    });
  });

  describe('validation', () => {
    it('rejects a missing controller with 400', async () => {
      const res = await request(makeApp()).get('/v1/dids/stellar').query({ network: 'testnet' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('controller_required');
    });

    it('rejects a malformed controller with 400', async () => {
      const res = await request(makeApp())
        .get('/v1/dids/stellar')
        .query({ controller: 'not-an-address', network: 'testnet' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('controller_invalid');
    });

    it('rejects a missing network with 400', async () => {
      const res = await request(makeApp()).get('/v1/dids/stellar').query({ controller: ALICE });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('network_invalid');
    });

    it('rejects an unknown network alias with 400', async () => {
      const res = await request(makeApp())
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'pubnet' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('network_invalid');
    });

    it('answers 501 for a network with no registry configured', async () => {
      const res = await request(
        makeApp({
          config: {
            networks: {
              testnet: {
                rpcUrl: 'https://soroban-testnet.stellar.org',
                registryContractId: TESTNET_CONTRACT,
                allowHttp: false,
              },
              mainnet: { rpcUrl: '', registryContractId: '', allowHttp: false },
            },
          },
        })
      )
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'mainnet' });

      expect(res.status).toBe(501);
      expect(res.body.code).toBe('network_unavailable');
    });
  });

  describe('index availability', () => {
    it('answers 501 when the index is disabled', async () => {
      const res = await request(makeApp({ store: null }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });
      expect(res.status).toBe(501);
      expect(res.body.code).toBe('index_unavailable');
    });

    it('answers 503 with Retry-After while the backfill is still running', async () => {
      // Under-reporting mid-backfill is exactly what makes an app mint a
      // duplicate DID, so the endpoint refuses rather than guesses.
      const res = await request(makeApp({ indexReady: () => false }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('index_warming');
      expect(res.headers['retry-after']).toBe('5');
    });

    it('serves normally once the backfill has finished', async () => {
      const store = await seededStore([registered(DID_A, ALICE, 100)]);
      const res = await request(makeApp({ store, indexReady: () => true }))
        .get('/v1/dids/stellar')
        .query({ controller: ALICE, network: 'testnet' });
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });
  });

  describe('routing', () => {
    it('does not shadow GET /v1/dids/stellar/:did', async () => {
      const res = await request(makeApp()).get('/v1/dids/stellar/not-a-did');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('did_invalid');
    });
  });

  describe('openapi', () => {
    it('documents the endpoint', async () => {
      const res = await request(makeApp()).get('/openapi.json');
      const path = res.body.paths['/v1/dids/stellar'];
      expect(path.get).toBeDefined();
      expect(path.get.parameters.map((p: { name: string }) => p.name)).toEqual([
        'controller',
        'network',
      ]);
      expect(Object.keys(path.get.responses)).toEqual(['200', '400', '501', '503']);
    });
  });
});

describe('GET /health with the index', () => {
  it('reports per-network index status when a status probe is wired', async () => {
    const store = await seededStore([registered(DID_A, ALICE, 100)]);
    const app = buildApp({
      config: makeConfig(),
      cache: new InMemoryCache(),
      logger: pino({ level: 'silent' }),
      analytics: buildAnalytics({ apiKey: null, host: 'https://us.i.posthog.com' }),
      indexStore: store,
      indexStatus: () =>
        Promise.resolve({
          mode: 'embedded' as const,
          store: 'memory' as const,
          ready: true,
          networks: [
            {
              network: 'testnet' as const,
              configured: true,
              dids: 1,
              firstLedger: 1,
              lastLedger: 999,
              syncedAt: '2026-08-17T00:00:00.000Z',
              lastError: null,
            },
          ],
        }),
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.index).toMatchObject({ mode: 'embedded', store: 'memory', ready: true });
    expect(res.body.index.networks[0]).toMatchObject({ network: 'testnet', dids: 1 });
  });

  it('reports index: null when the index is disabled', async () => {
    const res = await request(
      makeApp({ config: { index: { ...makeConfig().index, enabled: false } }, store: null })
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.index).toBeNull();
  });
});
