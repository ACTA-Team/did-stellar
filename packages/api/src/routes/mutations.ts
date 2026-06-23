/**
 * Lifecycle endpoints for `did:stellar`.
 *
 * Every mutation route operates in **prepare** mode by default (returns
 * an unsigned XDR for the controller wallet to sign) or **submit** mode
 * (accepts a signed XDR and finalises it). The mode is selected by the
 * presence of `signedXdr` in the request body — this keeps the surface
 * narrow and matches the SDK's `prepare/submit` pattern.
 *
 * Routes:
 *
 *   POST   /v1/dids/stellar                                  → register
 *   POST   /v1/dids/stellar/:did/update                      → update
 *   POST   /v1/dids/stellar/:did/transfer                    → transfer_controller
 *   POST   /v1/dids/stellar/:did/deactivate                  → deactivate
 *   POST   /v1/dids/stellar/submit                           → submit-only
 *
 * Note: every mutation uses POST with an explicit action suffix
 * (`/update`, `/transfer`, `/deactivate`) so each operation is
 * self-describing in Swagger UI and DIF tooling. The earlier
 * `PATCH /v1/dids/stellar/:did` was renamed because it shared the URL
 * with the `GET` raw-record read, which was ambiguous in API
 * explorers.
 *
 * No auth: the contract enforces `controller.require_auth()`. The HTTP
 * layer never holds keys; it never sees the signed XDR's controller in
 * a privileged way.
 */

import {
  DidError,
  isValidDidStellar,
  parseDidStellar,
  prepareDeactivateDidXdr,
  prepareRegisterDidXdr,
  prepareTransferControllerXdr,
  prepareUpdateDidXdr,
  submitSignedXdr,
  type DidRecordInput,
  type NetworkType,
} from '@acta-team/did-stellar';
import { Router, type Request, type Response } from 'express';

import { httpFromDidError } from '../lib/errors';

import type { AppConfig } from '../config';

export interface MutationsRouterDeps {
  readonly config: AppConfig;
}

export function mutationsRouter(deps: MutationsRouterDeps): Router {
  const router = Router();

  // --- POST /v1/dids/stellar ------------------------------------------------
  router.post('/v1/dids/stellar', async (req, res) => {
    await handle(req, res, async () => {
      const signedXdr = extractSignedXdr(req.body);
      if (signedXdr !== null) {
        return submit(signedXdr, deps.config);
      }
      const { did, record, sourcePublicKey } = parseRegisterBody(req.body, deps.config.network);
      const prepared = await prepareRegisterDidXdr({
        did,
        record,
        sourcePublicKey,
        rpcUrl: deps.config.rpcUrl,
        registryContractId: deps.config.registryContractId,
        allowHttp: deps.config.allowHttp,
      });
      return {
        xdr: prepared.xdr,
        network: prepared.network,
        networkPassphrase: prepared.networkPassphrase,
      };
    });
  });

  // --- POST /v1/dids/stellar/:did/update -----------------------------------
  router.post('/v1/dids/stellar/:did/update', async (req, res) => {
    await handle(req, res, async () => {
      const signedXdr = extractSignedXdr(req.body);
      if (signedXdr !== null) {
        return submit(signedXdr, deps.config);
      }
      const did = requireDid(req, deps.config.network);
      const { expectedVersion, record, sourcePublicKey } = parseUpdateBody(
        req.body,
        deps.config.network
      );
      const prepared = await prepareUpdateDidXdr({
        did,
        expectedVersion,
        nextRecord: record,
        sourcePublicKey,
        rpcUrl: deps.config.rpcUrl,
        registryContractId: deps.config.registryContractId,
        allowHttp: deps.config.allowHttp,
      });
      return {
        xdr: prepared.xdr,
        network: prepared.network,
        networkPassphrase: prepared.networkPassphrase,
      };
    });
  });

  // --- POST /v1/dids/stellar/:did/transfer ---------------------------------
  router.post('/v1/dids/stellar/:did/transfer', async (req, res) => {
    await handle(req, res, async () => {
      const signedXdr = extractSignedXdr(req.body);
      if (signedXdr !== null) {
        return submit(signedXdr, deps.config);
      }
      const did = requireDid(req, deps.config.network);
      const { expectedVersion, newController, sourcePublicKey } = parseTransferBody(req.body);
      const prepared = await prepareTransferControllerXdr({
        did,
        expectedVersion,
        newController,
        sourcePublicKey,
        rpcUrl: deps.config.rpcUrl,
        registryContractId: deps.config.registryContractId,
        allowHttp: deps.config.allowHttp,
      });
      return {
        xdr: prepared.xdr,
        network: prepared.network,
        networkPassphrase: prepared.networkPassphrase,
      };
    });
  });

  // --- POST /v1/dids/stellar/:did/deactivate -------------------------------
  router.post('/v1/dids/stellar/:did/deactivate', async (req, res) => {
    await handle(req, res, async () => {
      const signedXdr = extractSignedXdr(req.body);
      if (signedXdr !== null) {
        return submit(signedXdr, deps.config);
      }
      const did = requireDid(req, deps.config.network);
      const { expectedVersion, sourcePublicKey } = parseDeactivateBody(req.body);
      const prepared = await prepareDeactivateDidXdr({
        did,
        expectedVersion,
        sourcePublicKey,
        rpcUrl: deps.config.rpcUrl,
        registryContractId: deps.config.registryContractId,
        allowHttp: deps.config.allowHttp,
      });
      return {
        xdr: prepared.xdr,
        network: prepared.network,
        networkPassphrase: prepared.networkPassphrase,
      };
    });
  });

  // --- POST /v1/dids/stellar/submit ----------------------------------------
  router.post('/v1/dids/stellar/submit', async (req, res) => {
    await handle(req, res, async () => {
      const signedXdr = extractSignedXdr(req.body);
      if (signedXdr === null) {
        throw new DidError('unknown', 'submit body must include signedXdr: string');
      }
      return submit(signedXdr, deps.config);
    });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function handle<T>(req: Request, res: Response, fn: () => Promise<T>): Promise<void> {
  try {
    const payload = await fn();
    res.json(payload);
  } catch (cause) {
    if (DidError.is(cause)) {
      const mapped = httpFromDidError(cause);
      res.status(mapped.status).json(mapped.body);
      return;
    }
    throw cause;
  }
}

async function submit(signedXdr: string, cfg: AppConfig): Promise<{ txId: string }> {
  const result = await submitSignedXdr({
    signedXdr,
    network: cfg.network,
    rpcUrl: cfg.rpcUrl,
    allowHttp: cfg.allowHttp,
  });
  return { txId: result.txId };
}

function requireDid(req: Request, network: NetworkType): string {
  const param = req.params['did'];
  const did = decodeURIComponent(Array.isArray(param) ? (param[0] ?? '') : (param ?? ''));
  if (!isValidDidStellar(did)) {
    throw new DidError('did_invalid', `path parameter is not a valid did:stellar: ${did}`);
  }
  const parsed = parseDidStellar(did);
  if (parsed.network !== network) {
    throw new DidError(
      'network_invalid',
      `service is configured for ${network}, got DID on ${parsed.network}`
    );
  }
  return did;
}

interface RegisterBody {
  did: string;
  record: DidRecordInput;
  sourcePublicKey: string;
}

function parseRegisterBody(body: unknown, network: NetworkType): RegisterBody {
  if (!isPlainObject(body)) throw new DidError('unknown', 'register body must be a JSON object');
  const did = expectString(body, 'did');
  if (!isValidDidStellar(did)) {
    throw new DidError('did_invalid', `body.did is not a valid did:stellar: ${did}`);
  }
  const parsed = parseDidStellar(did);
  if (parsed.network !== network) {
    throw new DidError(
      'network_invalid',
      `service is configured for ${network}, got DID on ${parsed.network}`
    );
  }
  const record = expectRecord(body, 'record');
  const sourcePublicKey = expectString(body, 'sourcePublicKey');
  return { did, record, sourcePublicKey };
}

interface UpdateBody {
  expectedVersion: number;
  record: DidRecordInput;
  sourcePublicKey: string;
}

function parseUpdateBody(body: unknown, _network: NetworkType): UpdateBody {
  if (!isPlainObject(body)) throw new DidError('unknown', 'update body must be a JSON object');
  const expectedVersion = expectInt(body, 'expectedVersion');
  const record = expectRecord(body, 'record');
  const sourcePublicKey = expectString(body, 'sourcePublicKey');
  return { expectedVersion, record, sourcePublicKey };
}

interface TransferBody {
  expectedVersion: number;
  newController: string;
  sourcePublicKey: string;
}

function parseTransferBody(body: unknown): TransferBody {
  if (!isPlainObject(body)) throw new DidError('unknown', 'transfer body must be a JSON object');
  return {
    expectedVersion: expectInt(body, 'expectedVersion'),
    newController: expectString(body, 'newController'),
    sourcePublicKey: expectString(body, 'sourcePublicKey'),
  };
}

interface DeactivateBody {
  expectedVersion: number;
  sourcePublicKey: string;
}

function parseDeactivateBody(body: unknown): DeactivateBody {
  if (!isPlainObject(body)) throw new DidError('unknown', 'deactivate body must be a JSON object');
  return {
    expectedVersion: expectInt(body, 'expectedVersion'),
    sourcePublicKey: expectString(body, 'sourcePublicKey'),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns `signedXdr` from any unknown body shape, or `null` if absent. */
function extractSignedXdr(body: unknown): string | null {
  if (!isPlainObject(body)) return null;
  const value = body['signedXdr'];
  return typeof value === 'string' ? value : null;
}

function expectString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new DidError('unknown', `body.${key} must be a non-empty string`);
  }
  return v;
}

function expectInt(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new DidError('expected_version_required', `body.${key} must be an integer ≥ 1`);
  }
  return v;
}

function expectRecord(obj: Record<string, unknown>, key: string): DidRecordInput {
  const v = obj[key];
  if (!isPlainObject(v)) {
    throw new DidError('unknown', `body.${key} must be a JSON object matching DidRecordInput`);
  }
  return coerceDidRecordInput(v, key);
}

/**
 * Structural narrowing from `Record<string, unknown>` → `DidRecordInput`.
 *
 * Performs only the shape check the HTTP layer is responsible for:
 * required fields are present and have the right top-level type
 * (string/array). Field-level validity (key counts, multibase parse,
 * URL shape, hex hash) is the SDK's job — `validateDidRecordInput`
 * runs inside every `prepare*Xdr` and surfaces the precise typed
 * `DidError` to the caller. Two-level validation: shape here, bounds
 * there.
 */
function coerceDidRecordInput(obj: Record<string, unknown>, key: string): DidRecordInput {
  const fail = (suffix: string): never => {
    throw new DidError('unknown', `body.${key}.${suffix}`);
  };
  const controller = obj['controller'];
  if (typeof controller !== 'string' || controller.length === 0)
    fail('controller must be a non-empty string');

  const auth = obj['authentication'];
  if (!Array.isArray(auth)) fail('authentication must be an array');

  const assert = obj['assertionMethod'];
  if (!Array.isArray(assert)) fail('assertionMethod must be an array');

  const keyagr = obj['keyAgreement'];
  if (!Array.isArray(keyagr)) fail('keyAgreement must be an array');

  const services = obj['services'];
  if (!Array.isArray(services)) fail('services must be an array');

  const metadataUri = obj['metadataUri'];
  if (metadataUri !== undefined && typeof metadataUri !== 'string') {
    fail('metadataUri, when present, must be a string');
  }

  const metadataHash = obj['metadataHash'];
  if (metadataHash !== undefined && typeof metadataHash !== 'string') {
    fail('metadataHash, when present, must be a string');
  }

  return {
    controller: controller as string,
    authentication: (auth as unknown[]).map(coerceDidKey),
    assertionMethod: (assert as unknown[]).map(coerceDidKey),
    keyAgreement: (keyagr as unknown[]).map(coerceDidKey),
    services: (services as unknown[]).map(coerceDidService),
    ...(metadataUri !== undefined ? { metadataUri: metadataUri as string } : {}),
    ...(metadataHash !== undefined ? { metadataHash: metadataHash as string } : {}),
  };
}

function coerceDidKey(entry: unknown): { publicKeyMultibase: string } {
  if (!isPlainObject(entry) || typeof entry['publicKeyMultibase'] !== 'string') {
    throw new DidError('unknown', 'key entry must be { publicKeyMultibase: string }');
  }
  return { publicKeyMultibase: entry['publicKeyMultibase'] };
}

function coerceDidService(entry: unknown): {
  idSuffix: string;
  serviceType: string;
  serviceEndpoint: string;
} {
  if (
    !isPlainObject(entry) ||
    typeof entry['idSuffix'] !== 'string' ||
    typeof entry['serviceType'] !== 'string' ||
    typeof entry['serviceEndpoint'] !== 'string'
  ) {
    throw new DidError(
      'unknown',
      'service entry must be { idSuffix, serviceType, serviceEndpoint: string }'
    );
  }
  return {
    idSuffix: entry['idSuffix'],
    serviceType: entry['serviceType'],
    serviceEndpoint: entry['serviceEndpoint'],
  };
}
