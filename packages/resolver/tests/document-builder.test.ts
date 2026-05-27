import { describe, expect, it } from 'vitest';

import { buildDidDocument } from '../src/document/builder';

import vectorsJson from './fixtures/vectors.json' assert { type: 'json' };

import type { DidRecord } from '../src/record/types';

interface RawKey {
  public_key_multibase: string;
}
interface RawService {
  id_suffix: string;
  service_type: string;
  service_endpoint: string;
}
interface RawRecord {
  authentication: RawKey[];
  assertion_method: RawKey[];
  key_agreement: RawKey[];
  services: RawService[];
  metadata_uri?: string | null;
  metadata_hash?: string | null;
  version: number;
  created_ledger?: number;
  updated_ledger?: number;
  deactivated?: boolean;
}

const fromRaw = (raw: RawRecord, controller: string): DidRecord => ({
  controller,
  authentication: raw.authentication.map((k) => ({ publicKeyMultibase: k.public_key_multibase })),
  assertionMethod: raw.assertion_method.map((k) => ({
    publicKeyMultibase: k.public_key_multibase,
  })),
  keyAgreement: raw.key_agreement.map((k) => ({ publicKeyMultibase: k.public_key_multibase })),
  services: raw.services.map((s) => ({
    idSuffix: s.id_suffix,
    serviceType: s.service_type,
    serviceEndpoint: s.service_endpoint,
  })),
  version: raw.version,
  createdLedger: raw.created_ledger ?? 0,
  updatedLedger: raw.updated_ledger ?? 0,
  deactivated: raw.deactivated ?? false,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allVectors = vectorsJson.vectors as any[];

describe('buildDidDocument — spec vectors', () => {
  it('vector A.1 produces the canonical minimal DID Document', () => {
    const v = allVectors[0];
    const record = fromRaw(v.input.record as RawRecord, v.input.controller as string);
    const { didDocument, didDocumentMetadata } = buildDidDocument({
      did: v.input.did as string,
      record,
    });
    expect(didDocument).toEqual(v.expected.did_document);
    expect(didDocumentMetadata.versionId).toBe(v.expected.did_document_metadata.versionId);
    expect(didDocumentMetadata.deactivated).toBe(false);
  });

  it('vector A.2 produces the canonical full DID Document', () => {
    const v = allVectors[1];
    const record = fromRaw(v.input.record as RawRecord, v.input.controller as string);
    const { didDocument } = buildDidDocument({
      did: v.input.did as string,
      record,
    });
    expect(didDocument).toEqual(v.expected.did_document);
  });

  it('vector A.3 produces a tombstone document for a deactivated DID', () => {
    const v = allVectors[2];
    const controller = allVectors[0].input.controller as string;
    const record = fromRaw(v.input.record_after_deactivation as RawRecord, controller);
    const { didDocument, didDocumentMetadata } = buildDidDocument({
      did: v.input.did as string,
      record,
    });
    expect(didDocument).toEqual(v.expected.did_document);
    expect(didDocumentMetadata.deactivated).toBe(true);
    expect(didDocumentMetadata.versionId).toBe('2');
  });
});
