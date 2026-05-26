/**
 * Build a W3C DID Document from a {@link DidRecord}.
 *
 * Conformance: `did:stellar` v0.1 §5 (Annex A vectors A.1–A.3).
 *
 * Invariants enforced here:
 * - The `@context` always contains both `did/v1` and `multikey/v1` for
 *   active documents, and only `did/v1` for tombstones (matches the
 *   normative vector A.3).
 * - No top-level `controller` field — self-controlled per §5.3.
 * - Verification methods carry `controller = did` (the document's own
 *   `id`), per §5.4.
 * - Verification relationships hold fragment references only; keys are
 *   never inlined.
 * - Fragment identifiers are `#auth-N`, `#assert-N`, `#keyagr-N`
 *   (1-based) and `#service-{idSuffix}`.
 */

import type { DidRecord } from '../record/types';
import { buildTombstone } from './tombstone';
import {
  DID_CONTEXT_V1,
  MULTIKEY_CONTEXT_V1,
  type DidDocument,
  type DidDocumentMetadata,
  type DidServiceEntry,
  type VerificationMethod,
} from './types';

export interface BuildDidDocumentOptions {
  /** Canonical `did:stellar:...` identifier. */
  readonly did: string;
  /** Record read from the registry. */
  readonly record: DidRecord;
}

/**
 * Build a DID Document and its metadata from an on-chain record.
 *
 * Returns a tombstone document when `record.deactivated === true` (per
 * §4.4: deactivation empties cryptographic arrays and the consumer MUST
 * produce a tombstone).
 */
export function buildDidDocument(opts: BuildDidDocumentOptions): {
  didDocument: DidDocument;
  didDocumentMetadata: DidDocumentMetadata;
} {
  const { did, record } = opts;

  if (record.deactivated) {
    return buildTombstone({ did, record });
  }

  const verificationMethod: VerificationMethod[] = [];
  const authRefs: string[] = [];
  const assertRefs: string[] = [];
  const keyagrRefs: string[] = [];

  appendKeys(record.authentication, 'auth', did, verificationMethod, authRefs);
  appendKeys(record.assertionMethod, 'assert', did, verificationMethod, assertRefs);
  appendKeys(record.keyAgreement, 'keyagr', did, verificationMethod, keyagrRefs);

  const service: DidServiceEntry[] = record.services.map((s) => ({
    id: `${did}#service-${s.idSuffix}`,
    type: s.serviceType,
    serviceEndpoint: s.serviceEndpoint,
  }));

  const didDocument: DidDocument = {
    '@context': [DID_CONTEXT_V1, MULTIKEY_CONTEXT_V1],
    id: did,
    verificationMethod,
    authentication: authRefs,
    assertionMethod: assertRefs,
    keyAgreement: keyagrRefs,
    service,
  };

  const network = parseNetworkFromDid(did);
  const metadata: DidDocumentMetadata = {
    versionId: String(record.version),
    deactivated: false,
    ...(network
      ? {
          method: {
            network,
            stellarAccount: record.controller,
          },
        }
      : {}),
  };

  return { didDocument, didDocumentMetadata: metadata };
}

function appendKeys(
  keys: DidRecord['authentication'],
  fragment: 'auth' | 'assert' | 'keyagr',
  did: string,
  vmOut: VerificationMethod[],
  refsOut: string[]
): void {
  let index = 0;
  for (const k of keys) {
    index += 1;
    const id = `${did}#${fragment}-${index}`;
    vmOut.push({
      id,
      type: 'Multikey',
      controller: did,
      publicKeyMultibase: k.publicKeyMultibase,
    });
    refsOut.push(id);
  }
}

function parseNetworkFromDid(did: string): 'mainnet' | 'testnet' | null {
  const parts = did.split(':');
  if (parts.length !== 4) return null;
  const network = parts[2];
  return network === 'mainnet' || network === 'testnet' ? network : null;
}
