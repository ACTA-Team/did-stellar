/**
 * W3C-compliant DID Document types.
 *
 * Mirrors the subset of [DID Core 1.1](https://www.w3.org/TR/did-1.1/)
 * that `did:stellar` v0.1 emits. Intentionally narrower than the spec —
 * `did:stellar` documents never publish a root-level `controller`
 * (§5.3), do not use inline keys inside relationships (§5.5), and pin
 * `verificationMethod.type` to `"Multikey"` (§5.4).
 *
 * Compatible with the DIF [`did-resolver`](https://www.npmjs.com/package/did-resolver)
 * package's `DIDResolutionResult` shape.
 */

export const DID_CONTEXT_V1 = 'https://www.w3.org/ns/did/v1' as const;
export const MULTIKEY_CONTEXT_V1 = 'https://w3id.org/security/multikey/v1' as const;

/** A single verification method. v0.1 only emits `Multikey`. */
export interface VerificationMethod {
  readonly id: string;
  readonly type: 'Multikey';
  readonly controller: string;
  readonly publicKeyMultibase: string;
}

/** Reference (`#fragment`) to a verification method. */
export type VerificationRelationshipRef = string;

/** A single service endpoint. */
export interface DidServiceEntry {
  readonly id: string;
  readonly type: string;
  readonly serviceEndpoint: string;
}

/** Full DID Document. */
export interface DidDocument {
  readonly '@context': readonly string[];
  readonly id: string;
  readonly verificationMethod: readonly VerificationMethod[];
  readonly authentication: readonly VerificationRelationshipRef[];
  readonly assertionMethod: readonly VerificationRelationshipRef[];
  readonly keyAgreement: readonly VerificationRelationshipRef[];
  readonly service: readonly DidServiceEntry[];
}

/** Optional `didDocumentMetadata` per DID Core 1.1. */
export interface DidDocumentMetadata {
  /** Spec field name is `versionId`; type is string per the W3C spec. */
  readonly versionId: string;
  /** Present and `true` for tombstone documents. */
  readonly deactivated?: boolean;
  /** ISO 8601 string if the resolver was able to resolve the ledger close time. */
  readonly created?: string;
  /** ISO 8601 string if the resolver was able to resolve the ledger close time. */
  readonly updated?: string;
  /** Method-specific informational metadata. */
  readonly method?: {
    readonly network: 'mainnet' | 'testnet';
    /** Controller Stellar account, surfaced for audit purposes. */
    readonly stellarAccount: string;
  };
}

/** Resolution result, DIF-compatible. */
export interface DidResolutionResult {
  readonly didDocument: DidDocument | null;
  readonly didDocumentMetadata: DidDocumentMetadata;
  readonly didResolutionMetadata: DidResolutionMetadata;
}

/** Resolver-level metadata (errors, content type). */
export interface DidResolutionMetadata {
  readonly contentType?: string;
  /** Present when resolution failed. DIF-standard values + method extensions. */
  readonly error?:
    | 'invalidDid'
    | 'notFound'
    | 'representationNotSupported'
    | 'methodNotSupported'
    | 'internalError';
  readonly message?: string;
}
