/**
 * OpenAPI 3.1 description of the `did-stellar-api` surface.
 *
 * Kept inline (no JSON file) so changes ship with the server build and
 * the spec is impossible to forget when adding an endpoint. The schema
 * mirrors the routes module-for-module; CI would catch drift via the
 * supertest suite if a route name changed without updating this object.
 */

import type { AppConfig } from './config';

export function buildOpenApiSpec(cfg: Pick<AppConfig, 'network' | 'registryContractId'>) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'did-stellar-api',
      version: '0.1.0',
      description:
        'Standalone HTTP service for the did:stellar v0.1 method. ' +
        'Wraps @acta-team/did-stellar. Trust-minimised: no auth, no key custody.',
      license: { name: 'MIT' },
    },
    servers: [{ url: 'https://did.acta.build', description: 'Production (planned)' }],
    paths: {
      '/health': {
        get: {
          summary: 'Liveness probe',
          responses: {
            '200': { description: 'Service is up.' },
          },
        },
      },
      '/1.0/identifiers/{did}': {
        get: {
          summary: 'DID Resolver (DIF Universal Resolver compatible)',
          parameters: [didParam()],
          responses: {
            '200': resolverResponse('Active DID Document'),
            '400': errorResponse('invalidDid'),
            '404': errorResponse('notFound (cached)'),
            '410': resolverResponse('Tombstone document for a deactivated DID'),
            '502': errorResponse('Upstream RPC failure'),
          },
        },
      },
      '/v1/dids/stellar': {
        post: {
          summary: 'Register a DID (prepare or submit)',
          requestBody: jsonBody({
            oneOf: [registerPrepareSchema(), submitSchema()],
          }),
          responses: prepareResponses(),
        },
      },
      '/v1/dids/stellar/{did}': {
        get: {
          summary: 'Read the raw on-chain DidRecord',
          parameters: [didParam()],
          responses: {
            '200': jsonResponse('Raw DidRecord wrapper'),
            '400': errorResponse('did_invalid / network_invalid'),
            '404': errorResponse('did_not_found'),
          },
        },
        patch: {
          summary: 'Update a DidRecord (prepare or submit)',
          parameters: [didParam()],
          requestBody: jsonBody({
            oneOf: [updatePrepareSchema(), submitSchema()],
          }),
          responses: prepareResponses(),
        },
      },
      '/v1/dids/stellar/{did}/transfer': {
        post: {
          summary: 'Transfer controller (prepare or submit)',
          parameters: [didParam()],
          requestBody: jsonBody({
            oneOf: [transferPrepareSchema(), submitSchema()],
          }),
          responses: prepareResponses(),
        },
      },
      '/v1/dids/stellar/{did}/deactivate': {
        post: {
          summary: 'Deactivate a DID (prepare or submit) — IRREVERSIBLE',
          parameters: [didParam()],
          requestBody: jsonBody({
            oneOf: [deactivatePrepareSchema(), submitSchema()],
          }),
          responses: prepareResponses(),
        },
      },
      '/v1/dids/stellar/submit': {
        post: {
          summary: 'Submit a signed XDR (any mutation)',
          requestBody: jsonBody(submitSchema()),
          responses: {
            '200': jsonResponse('Submitted transaction'),
            '400': errorResponse('invalid signedXdr'),
            '502': errorResponse('Upstream RPC / contract failure'),
          },
        },
      },
    },
    'x-acta': {
      network: cfg.network,
      registryContractId: cfg.registryContractId,
      method: 'did:stellar',
      methodSpec:
        'https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md',
    },
  } as const;
}

const didParam = () => ({
  name: 'did',
  in: 'path' as const,
  required: true,
  schema: { type: 'string', pattern: '^did:stellar:(mainnet|testnet):[a-z2-7]{26}$' },
});

const jsonBody = (schema: object) => ({
  required: true,
  content: { 'application/json': { schema } },
});

const jsonResponse = (description: string) => ({
  description,
  content: { 'application/json': {} },
});

const resolverResponse = (description: string) => ({
  description,
  content: {
    'application/did+ld+json': {},
    'application/did+json': {},
  },
});

const errorResponse = (description: string) => ({
  description,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
    },
  },
});

const prepareResponses = () => ({
  '200': jsonResponse('Prepared XDR or submitted txId'),
  '400': errorResponse('Validation failed'),
  '409': errorResponse('did_already_exists / version_mismatch'),
  '410': errorResponse('did_deactivated'),
  '502': errorResponse('Upstream RPC / contract failure'),
});

const registerPrepareSchema = () => ({
  type: 'object',
  required: ['did', 'record', 'sourcePublicKey'],
  properties: {
    did: { type: 'string' },
    sourcePublicKey: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
    record: didRecordSchema(),
  },
});

const updatePrepareSchema = () => ({
  type: 'object',
  required: ['expectedVersion', 'record', 'sourcePublicKey'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    sourcePublicKey: { type: 'string' },
    record: didRecordSchema(),
  },
});

const transferPrepareSchema = () => ({
  type: 'object',
  required: ['expectedVersion', 'newController', 'sourcePublicKey'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    newController: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
    sourcePublicKey: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
  },
});

const deactivatePrepareSchema = () => ({
  type: 'object',
  required: ['expectedVersion', 'sourcePublicKey'],
  properties: {
    expectedVersion: { type: 'integer', minimum: 1 },
    sourcePublicKey: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
  },
});

const submitSchema = () => ({
  type: 'object',
  required: ['signedXdr'],
  properties: {
    signedXdr: { type: 'string' },
  },
});

const didRecordSchema = () => ({
  type: 'object',
  required: ['controller', 'authentication', 'assertionMethod', 'keyAgreement', 'services'],
  properties: {
    controller: { type: 'string', pattern: '^G[A-Z2-7]{55}$' },
    authentication: { type: 'array', minItems: 1, maxItems: 3, items: didKeySchema() },
    assertionMethod: { type: 'array', maxItems: 3, items: didKeySchema() },
    keyAgreement: { type: 'array', maxItems: 1, items: didKeySchema() },
    services: { type: 'array', maxItems: 3, items: didServiceSchema() },
    metadataUri: { type: 'string', pattern: '^https://' },
    metadataHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  },
});

const didKeySchema = () => ({
  type: 'object',
  required: ['publicKeyMultibase'],
  properties: {
    publicKeyMultibase: { type: 'string', maxLength: 128 },
  },
});

const didServiceSchema = () => ({
  type: 'object',
  required: ['idSuffix', 'serviceType', 'serviceEndpoint'],
  properties: {
    idSuffix: { type: 'string', pattern: '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$', maxLength: 32 },
    serviceType: { type: 'string', maxLength: 64 },
    serviceEndpoint: { type: 'string', pattern: '^https://', maxLength: 255 },
  },
});
