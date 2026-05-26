import { describe, expect, it } from 'vitest';

import {
  buildDidStellar,
  buildDidStellarFromBytes,
  DID_ID_BYTES,
  decodeDidId,
  encodeDidId,
  generateDidId,
  generateDidIdBytes,
  isValidDidStellar,
  parseDidStellar,
} from '../src/identifier';
import { DidError } from '../src/errors';

import vectorsJson from './fixtures/vectors.json' assert { type: 'json' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v1 = (vectorsJson.vectors as any)[0];
const hexBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

describe('identifier', () => {
  it('encodeDidId matches the spec vector A.1 base32', () => {
    const bytes = hexBytes(v1.input.did_id_bytes_hex);
    expect(encodeDidId(bytes)).toBe(v1.input.did_id_base32);
  });

  it('decodeDidId is the inverse of encodeDidId', () => {
    const bytes = hexBytes(v1.input.did_id_bytes_hex);
    const decoded = decodeDidId(v1.input.did_id_base32);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('buildDidStellar produces the spec vector A.1 DID', () => {
    expect(buildDidStellar('testnet', v1.input.did_id_base32)).toBe(v1.input.did);
  });

  it('buildDidStellarFromBytes round-trips through encodeDidId', () => {
    const bytes = hexBytes(v1.input.did_id_bytes_hex);
    expect(buildDidStellarFromBytes('testnet', bytes)).toBe(v1.input.did);
  });

  it('parseDidStellar splits a canonical DID into its components', () => {
    const parsed = parseDidStellar(v1.input.did);
    expect(parsed.network).toBe('testnet');
    expect(parsed.didId).toBe(v1.input.did_id_base32);
    expect(parsed.didIdBytes.length).toBe(DID_ID_BYTES);
  });

  it.each([
    ['empty', ''],
    ['uppercase', 'DID:STELLAR:TESTNET:AAAQEAYEAUDAOCAJBIFQYDIOB4'],
    ['invalid network', 'did:stellar:pubnet:aaaqeayeaudaocajbifqydiob4'],
    ['wrong length', 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob'],
  ])('parseDidStellar rejects %s input', (_label, did) => {
    expect(() => parseDidStellar(did)).toThrow(DidError);
  });

  it('isValidDidStellar agrees with parseDidStellar', () => {
    expect(isValidDidStellar(v1.input.did)).toBe(true);
    expect(isValidDidStellar('did:stellar:mainnet:invalid')).toBe(false);
  });

  it('generateDidId emits a parseable identifier of the spec length', () => {
    const id = generateDidId();
    expect(id).toMatch(/^[a-z2-7]{26}$/);
    expect(generateDidIdBytes().length).toBe(DID_ID_BYTES);
  });
});
