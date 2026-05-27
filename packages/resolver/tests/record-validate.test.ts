import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';

import { DidError } from '../src/errors';
import { validateDidRecordInput } from '../src/record/validate';

import type { DidRecordInput } from '../src/record/types';

const CONTROLLER = Keypair.random().publicKey();
const KEY_AUTH = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doY';
const KEY_ASSERT = 'z6Mkff3F4VMDGbMbMtgRyXMrgr7qyxaKsPo7QEPQ2AkNrx2X';
const KEY_AGR = 'z6LSnGSQaEk7SBZMmMLHTCqz6YUuiVVCmBNdAqSVdepqYAW1';

const minimal = (overrides: Partial<DidRecordInput> = {}): DidRecordInput => ({
  controller: CONTROLLER,
  authentication: [{ publicKeyMultibase: KEY_AUTH }],
  assertionMethod: [],
  keyAgreement: [],
  services: [],
  ...overrides,
});

describe('validateDidRecordInput', () => {
  it('accepts a minimal valid record', () => {
    expect(() => validateDidRecordInput(minimal())).not.toThrow();
  });

  it('accepts a full valid record', () => {
    expect(() =>
      validateDidRecordInput(
        minimal({
          assertionMethod: [{ publicKeyMultibase: KEY_ASSERT }],
          keyAgreement: [{ publicKeyMultibase: KEY_AGR }],
          services: [
            {
              idSuffix: 'issuer',
              serviceType: 'LinkedDomains',
              serviceEndpoint: 'https://issuer.example.com',
            },
          ],
        })
      )
    ).not.toThrow();
  });

  it('rejects an invalid controller', () => {
    try {
      validateDidRecordInput(minimal({ controller: 'not-a-g-address' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(DidError.is(err)).toBe(true);
      expect((err as DidError).code).toBe('controller_invalid');
    }
  });

  it('rejects authentication with zero keys', () => {
    expect(() => validateDidRecordInput(minimal({ authentication: [] }))).toThrowError(
      /invalid_auth_key_count|/
    );
  });

  it('rejects more than 3 assertion keys', () => {
    expect(() =>
      validateDidRecordInput(
        minimal({
          assertionMethod: [
            { publicKeyMultibase: KEY_ASSERT },
            { publicKeyMultibase: KEY_ASSERT },
            { publicKeyMultibase: KEY_ASSERT },
            { publicKeyMultibase: KEY_ASSERT },
          ],
        })
      )
    ).toThrow();
  });

  it('rejects duplicate keys across relationships', () => {
    try {
      validateDidRecordInput(
        minimal({
          assertionMethod: [{ publicKeyMultibase: KEY_AUTH }],
        })
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as DidError).code).toBe('duplicate_key');
    }
  });

  it('rejects metadataHash without metadataUri', () => {
    try {
      validateDidRecordInput({
        ...minimal(),
        metadataHash: '0'.repeat(64),
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as DidError).code).toBe('metadata_inconsistent');
    }
  });

  it('rejects http:// service endpoints', () => {
    try {
      validateDidRecordInput(
        minimal({
          services: [
            {
              idSuffix: 'issuer',
              serviceType: 'LinkedDomains',
              serviceEndpoint: 'http://issuer.example.com',
            },
          ],
        })
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as DidError).code).toBe('service_endpoint_invalid');
    }
  });

  it('rejects an invalid service idSuffix', () => {
    try {
      validateDidRecordInput(
        minimal({
          services: [
            {
              idSuffix: '-bad',
              serviceType: 'LinkedDomains',
              serviceEndpoint: 'https://issuer.example.com',
            },
          ],
        })
      );
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as DidError).code).toBe('service_id_invalid_format');
    }
  });
});
