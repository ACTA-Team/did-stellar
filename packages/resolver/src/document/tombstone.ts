/**
 * Tombstone DID Document for a deactivated DID.
 *
 * Per `did:stellar` v0.1 §4.6.4 and Annex A.3, a deactivated record
 * MUST produce a document with:
 *
 * - `@context` containing only `https://www.w3.org/ns/did/v1` (the
 *   Multikey context is dropped because no keys are published).
 * - All cryptographic and service arrays empty.
 * - `didDocumentMetadata.deactivated = true`.
 *
 * This module is the only place that knows the tombstone shape so it
 * can be re-used by the resolver (`410 Gone` path) and the document
 * builder.
 */

import { DID_CONTEXT_V1, type DidDocument, type DidDocumentMetadata } from './types';

import type { DidRecord } from '../record/types';

export interface BuildTombstoneOptions {
  readonly did: string;
  readonly record: DidRecord;
}

export function buildTombstone(opts: BuildTombstoneOptions): {
  didDocument: DidDocument;
  didDocumentMetadata: DidDocumentMetadata;
} {
  const didDocument: DidDocument = {
    '@context': [DID_CONTEXT_V1],
    id: opts.did,
    verificationMethod: [],
    authentication: [],
    assertionMethod: [],
    keyAgreement: [],
    service: [],
  };
  const didDocumentMetadata: DidDocumentMetadata = {
    versionId: String(opts.record.version),
    deactivated: true,
  };
  return { didDocument, didDocumentMetadata };
}
