import { describe, expect, it } from 'vitest';

import { jcsCanonicalize, jcsStringify } from '../src/proof-of-control/jcs';

describe('JCS (RFC 8785)', () => {
  it('sorts object keys lexicographically', () => {
    expect(jcsStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(jcsStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits compact JSON (no whitespace)', () => {
    expect(jcsStringify({ key: 'value', n: 42 })).toBe('{"key":"value","n":42}');
  });

  it('matches the spec example challenge layout', () => {
    const challenge = {
      did: 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4',
      domain: 'verifier.example.com',
      nonce: '5f9b2a1c0d3e4f6789012345abcdef01',
      timestamp: '2026-04-26T12:34:56Z',
    };
    // Keys arrive in the spec order; JCS must still re-sort lexicographically.
    const shuffled = {
      timestamp: challenge.timestamp,
      did: challenge.did,
      nonce: challenge.nonce,
      domain: challenge.domain,
    };
    expect(jcsStringify(challenge)).toBe(jcsStringify(shuffled));
  });

  it('rejects non-finite numbers', () => {
    expect(() => jcsStringify(NaN)).toThrow();
    expect(() => jcsStringify(Infinity)).toThrow();
  });

  it('canonicalize returns UTF-8 bytes', () => {
    const bytes = jcsCanonicalize({ a: 1 });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });
});
