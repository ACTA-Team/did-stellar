/**
 * Server-level integration tests.
 *
 * Uses `supertest` against a {@link buildApp} instance with the
 * in-memory cache and a silent logger. The SDK's resolver is
 * stubbed via a route-level override where possible, but most tests
 * exercise the genuine wiring and only assert HTTP-shape concerns.
 */

import { Keypair } from '@stellar/stellar-sdk';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';

import { buildAnalytics } from '../src/lib/analytics';
import { InMemoryCache } from '../src/lib/cache';
import { buildApp } from '../src/server';

import type { AppConfig } from '../src/config';

const TESTNET_CONTRACT = 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ';
const MAINNET_CONTRACT = 'CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    port: 0,
    networks: {
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
    },
    redisUrl: null,
    resolverCacheTtlSeconds: 30,
    rateLimit: { max: 1000, windowSeconds: 60 },
    corsOrigins: '*',
    logLevel: 'fatal',
    nodeEnv: 'test',
    analytics: { apiKey: null, host: 'https://us.i.posthog.com' },
  };
  return Object.freeze({ ...base, ...overrides });
}

function makeApp(overrides: Partial<AppConfig> = {}) {
  return buildApp({
    config: makeConfig(overrides),
    cache: new InMemoryCache(),
    logger: pino({ level: 'silent' }),
    // apiKey: null → no-op analytics; tests never touch PostHog.
    analytics: buildAnalytics({ apiKey: null, host: 'https://us.i.posthog.com' }),
  });
}

describe('did-stellar-api / server', () => {
  describe('GET /health', () => {
    it('responds 200 with service metadata', async () => {
      const res = await request(makeApp()).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        service: 'did-stellar-api',
        method: 'did:stellar',
        networks: {
          testnet: TESTNET_CONTRACT,
          mainnet: MAINNET_CONTRACT,
        },
      });
    });
  });

  describe('GET /openapi.json', () => {
    it('returns an OpenAPI 3.1 spec', async () => {
      const res = await request(makeApp()).get('/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.paths['/1.0/identifiers/{did}']).toBeDefined();
    });
  });

  describe('GET /1.0/identifiers/:did', () => {
    it('rejects a malformed DID with 400 invalidDid', async () => {
      const res = await request(makeApp()).get('/1.0/identifiers/not-a-did');
      expect(res.status).toBe(400);
      expect(res.body.didResolutionMetadata.error).toBe('invalidDid');
    });

    it('rejects uppercase variants with 400', async () => {
      const res = await request(makeApp()).get(
        '/1.0/identifiers/DID:STELLAR:TESTNET:AAAQEAYEAUDAOCAJBIFQYDIOB4'
      );
      expect(res.status).toBe(400);
      expect(res.body.didResolutionMetadata.error).toBe('invalidDid');
    });

    it('returns application/did+ld+json by default', async () => {
      const res = await request(makeApp()).get('/1.0/identifiers/invalid').set('Accept', '*/*');
      expect(res.headers['content-type']).toMatch(/application\/did\+ld\+json/);
    });

    it('honours application/did+json content negotiation', async () => {
      const res = await request(makeApp())
        .get('/1.0/identifiers/invalid')
        .set('Accept', 'application/did+json');
      expect(res.headers['content-type']).toMatch(/application\/did\+json/);
    });
  });

  describe('POST /v1/dids/stellar', () => {
    it('rejects a missing JSON body', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar')
        .send('not-json')
        .set('Content-Type', 'text/plain');
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a register on a network that is not configured', async () => {
      // mainnet left unconfigured (empty registry) on this instance.
      const res = await request(
        makeApp({
          networks: {
            testnet: {
              rpcUrl: 'https://soroban-testnet.stellar.org',
              registryContractId: TESTNET_CONTRACT,
              allowHttp: false,
            },
            mainnet: {
              rpcUrl: 'https://mainnet.sorobanrpc.com',
              registryContractId: '',
              allowHttp: false,
            },
          },
        })
      )
        .post('/v1/dids/stellar')
        .send({
          did: 'did:stellar:mainnet:aaaqeayeaudaocajbifqydiob4',
          sourcePublicKey: Keypair.random().publicKey(),
          record: {
            controller: Keypair.random().publicKey(),
            authentication: [
              { publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doY' },
            ],
            assertionMethod: [],
            keyAgreement: [],
            services: [],
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('network_invalid');
    });

    it('rejects a register body missing required fields', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar')
        .send({ did: 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/dids/stellar/:did/update', () => {
    it('rejects expectedVersion < 1', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar/did:stellar:testnet:aaaqeayeaudaocajbifqydiob4/update')
        .send({
          expectedVersion: 0,
          sourcePublicKey: Keypair.random().publicKey(),
          record: {
            controller: Keypair.random().publicKey(),
            authentication: [
              { publicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doY' },
            ],
            assertionMethod: [],
            keyAgreement: [],
            services: [],
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('expected_version_required');
    });

    it('rejects an invalid DID in the path', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar/not-a-did/update')
        .send({ expectedVersion: 1, sourcePublicKey: Keypair.random().publicKey(), record: {} });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('did_invalid');
    });
  });

  describe('POST /v1/dids/stellar/submit', () => {
    it('rejects a submit body without signedXdr', async () => {
      const res = await request(makeApp()).post('/v1/dids/stellar/submit').send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejects a malformed signedXdr', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar/submit')
        .send({ signedXdr: 'not-xdr', network: 'testnet' });
      expect(res.status).toBe(502);
      expect(res.body.code).toBe('tx_submission_failed');
    });

    it('rejects a submit body without a network', async () => {
      const res = await request(makeApp())
        .post('/v1/dids/stellar/submit')
        .send({ signedXdr: 'not-xdr' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('network_invalid');
    });
  });

  describe('404', () => {
    it('returns a typed not_found payload for unknown routes', async () => {
      const res = await request(makeApp()).get('/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ code: 'not_found' });
    });
  });

  describe('rate limiter', () => {
    let app: ReturnType<typeof makeApp>;
    beforeEach(() => {
      app = makeApp({ rateLimit: { max: 2, windowSeconds: 60 } });
    });

    it('blocks the third request within the window', async () => {
      const a = await request(app).get('/health');
      const b = await request(app).get('/health');
      const c = await request(app).get('/health');
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(c.status).toBe(429);
      expect(c.body.code).toBe('rate_limited');
      expect(c.headers['retry-after']).toBe('60');
    });

    it('emits X-RateLimit headers on every response', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-ratelimit-limit']).toBe('2');
      expect(res.headers['x-ratelimit-remaining']).toBe('1');
    });
  });

  describe('request-id', () => {
    it('echoes an inbound X-Request-ID', async () => {
      const res = await request(makeApp()).get('/health').set('X-Request-ID', 'my-correlation-id');
      expect(res.headers['x-request-id']).toBe('my-correlation-id');
    });

    it('mints a fresh X-Request-ID when absent', async () => {
      const res = await request(makeApp()).get('/health');
      expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{8,}/);
    });
  });
});
