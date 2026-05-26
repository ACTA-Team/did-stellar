import { describe, expect, it } from 'vitest';

import { DidError } from '../src/errors';
import { buildChallenge, generateNonce } from '../src/proof-of-control/challenge';

const DID = 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4';

describe('buildChallenge', () => {
  it('builds a valid challenge', () => {
    const c = buildChallenge({
      did: DID,
      domain: 'verifier.example.com',
      nonce: 'a'.repeat(32),
      timestamp: '2026-05-19T12:00:00Z',
    });
    expect(c.did).toBe(DID);
    expect(c.timestamp).toBe('2026-05-19T12:00:00Z');
  });

  it('defaults timestamp to now (UTC, second precision)', () => {
    const c = buildChallenge({
      did: DID,
      domain: 'verifier.example.com',
      nonce: 'a'.repeat(32),
    });
    expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects an invalid DID', () => {
    expect(() =>
      buildChallenge({
        did: 'not-a-did',
        domain: 'x',
        nonce: 'a'.repeat(32),
      })
    ).toThrow(DidError);
  });

  it('rejects a nonce that is not 32 lowercase hex chars', () => {
    expect(() =>
      buildChallenge({
        did: DID,
        domain: 'x',
        nonce: 'NOT-HEX',
      })
    ).toThrow(DidError);
  });
});

describe('generateNonce', () => {
  it('produces a 32-char lowercase hex string', () => {
    expect(generateNonce()).toMatch(/^[0-9a-f]{32}$/);
  });
});
