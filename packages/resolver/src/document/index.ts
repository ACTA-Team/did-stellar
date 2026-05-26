export type {
  DidDocument,
  DidDocumentMetadata,
  DidResolutionMetadata,
  DidResolutionResult,
  DidServiceEntry,
  VerificationMethod,
  VerificationRelationshipRef,
} from './types';
export { DID_CONTEXT_V1, MULTIKEY_CONTEXT_V1 } from './types';
export { buildDidDocument } from './builder';
export type { BuildDidDocumentOptions } from './builder';
export { buildTombstone } from './tombstone';
export type { BuildTombstoneOptions } from './tombstone';
