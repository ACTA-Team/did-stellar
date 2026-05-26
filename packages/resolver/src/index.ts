/**
 * `@acta-team/did-stellar` — official TypeScript SDK for the
 * `did:stellar` v0.1 DID method.
 *
 * See https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md
 * for the normative method spec.
 */

// --- Identifier -------------------------------------------------------------
export {
  DID_ID_BYTES,
  DID_ID_LENGTH,
  DID_ID_REGEX,
  DID_STELLAR_REGEX,
  buildDidStellar,
  buildDidStellarFromBytes,
  decodeDidId,
  encodeDidId,
  generateDidId,
  generateDidIdBytes,
  isValidDidStellar,
  parseDidStellar,
} from './identifier';
export type { ParsedDidStellar } from './identifier';

// --- Network ----------------------------------------------------------------
export {
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  NETWORK_PASSPHRASES,
  isNetworkType,
} from './network';
export type { NetworkType } from './network';

// --- Errors -----------------------------------------------------------------
export { DidError, contractErrorCodeFromNumber, fromContractErrorMessage } from './errors';
export type { DidErrorCode, DidErrorOptions } from './errors';

// --- Multikey ---------------------------------------------------------------
export {
  decodeMultibaseBase58btc,
  decodeMultikey,
  detectCurve,
  encodeMultikey,
} from './multikey';
export type { MultikeyCurve } from './multikey';

// --- Record -----------------------------------------------------------------
export type {
  DidKey,
  DidRecord,
  DidRecordInput,
  DidService,
} from './record/types';
export {
  DID_RECORD_LIMITS,
  MAX_KEY_COUNT_AGREEMENT,
  MAX_KEY_COUNT_ASSERT,
  MAX_KEY_COUNT_AUTH,
  MAX_KEY_MULTIBASE_LEN,
  MAX_SERVICE_COUNT,
  MAX_SERVICE_ID_LEN,
  MAX_SERVICE_TYPE_LEN,
  MAX_URL_LEN,
  METADATA_HASH_LEN,
  MIN_KEY_COUNT_AUTH,
} from './record/types';
export {
  decodeDidRecord,
  encodeDidRecord,
  readDidRecord,
  validateDidRecordInput,
} from './record';
export type { ReadDidRecordOptions } from './record';

// --- RPC helper -------------------------------------------------------------
export { buildRpcServer } from './internal/rpc';
export type { RpcServerOptions } from './internal/rpc';

// --- Document ---------------------------------------------------------------
export {
  DID_CONTEXT_V1,
  MULTIKEY_CONTEXT_V1,
  buildDidDocument,
  buildTombstone,
} from './document';
export type {
  BuildDidDocumentOptions,
  BuildTombstoneOptions,
  DidDocument,
  DidDocumentMetadata,
  DidResolutionMetadata,
  DidResolutionResult,
  DidServiceEntry,
  VerificationMethod,
  VerificationRelationshipRef,
} from './document';

// --- Resolver ---------------------------------------------------------------
export { getResolver, resolveDidStellar } from './resolver';
export type { DifResolverFn, GetResolverOptions, ResolveDidStellarOptions } from './resolver';

// --- Prepare / Submit -------------------------------------------------------
export {
  prepareDeactivateDidXdr,
  prepareRegisterDidXdr,
  prepareTransferControllerXdr,
  prepareUpdateDidXdr,
  submitSignedXdr,
} from './prepare';
export type {
  CommonPrepareOptions,
  PrepareDeactivateDidArgs,
  PrepareRegisterDidArgs,
  PrepareTransferControllerArgs,
  PrepareUpdateDidArgs,
  SubmitSignedXdrOptions,
  SubmittedTx,
} from './prepare';

// --- Proof of Control -------------------------------------------------------
export {
  DEFAULT_TIMESTAMP_WINDOW_MS,
  buildChallenge,
  generateNonce,
  jcsCanonicalize,
  jcsStringify,
  verifyProofOfControl,
} from './proof-of-control';
export type {
  BuildChallengeArgs,
  PoCChallenge,
  VerifyProofOfControlArgs,
  VerifyProofOfControlResult,
} from './proof-of-control';

// --- HTTP Client ------------------------------------------------------------
export { ActaDidClient } from './http-client';
export type {
  ActaDidClientOptions,
  DidMutationResponse,
  DidRecordResponse,
} from './http-client';

// --- Branded primitives -----------------------------------------------------
export type { Brand, Hex32, Url } from './utils/branded';
export { asHex32, bytesToHex, hexToBytes, isHex32 } from './utils/hex';
export { asHttpsUrl, isHttpsUrl } from './utils/url';
