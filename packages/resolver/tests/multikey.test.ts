import { describe, expect, it } from 'vitest';

import { DidError } from '../src/errors';
import { decodeMultikey, detectCurve, encodeMultikey } from '../src/multikey';

// From spec vector A.1 (Annex A).
const ED25519_VEC = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doY';
// From spec vector A.2.
const ED25519_VEC2 = 'z6Mkff3F4VMDGbMbMtgRyXMrgr7qyxaKsPo7QEPQ2AkNrx2X';
const X25519_VEC = 'z6LSnGSQaEk7SBZMmMLHTCqz6YUuiVVCmBNdAqSVdepqYAW1';

describe('multikey', () => {
  it('detects Ed25519 from a z6Mk... key', () => {
    expect(detectCurve(ED25519_VEC)).toBe('Ed25519');
    expect(detectCurve(ED25519_VEC2)).toBe('Ed25519');
  });

  it('detects X25519 from a z6LS... key', () => {
    expect(detectCurve(X25519_VEC)).toBe('X25519');
  });

  it('decodeMultikey returns 32 raw bytes', () => {
    const { curve, publicKey } = decodeMultikey(ED25519_VEC);
    expect(curve).toBe('Ed25519');
    expect(publicKey.length).toBe(32);
  });

  it('encodeMultikey + decodeMultikey round-trip', () => {
    const { publicKey } = decodeMultikey(ED25519_VEC);
    const reEncoded = encodeMultikey('Ed25519', publicKey);
    expect(reEncoded).toBe(ED25519_VEC);
  });

  it('rejects non-multibase input', () => {
    expect(() => decodeMultikey('not-a-multikey')).toThrow(DidError);
  });
});
