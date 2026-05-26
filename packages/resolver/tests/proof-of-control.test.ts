import { getPublicKeyAsync, signAsync, utils } from '@noble/ed25519';
import { base64urlnopad } from '@scure/base';
import { describe, expect, it } from 'vitest';

import { encodeMultikey } from '../src/multikey';
import { jcsCanonicalize } from '../src/proof-of-control/jcs';
import { buildChallenge } from '../src/proof-of-control/challenge';
import { verifyProofOfControl } from '../src/proof-of-control/verify';
import type { DidDocument } from '../src/document/types';

const DID = 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4';
const DOMAIN = 'verifier.example.com';

function buildDocFor(publicKeyMultibase: string): DidDocument {
  return {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1'],
    id: DID,
    verificationMethod: [
      {
        id: `${DID}#auth-1`,
        type: 'Multikey',
        controller: DID,
        publicKeyMultibase,
      },
    ],
    authentication: [`${DID}#auth-1`],
    assertionMethod: [],
    keyAgreement: [],
    service: [],
  };
}

describe('verifyProofOfControl', () => {
  it('accepts a valid Ed25519 signature over the JCS canonicalisation', async () => {
    const priv = utils.randomPrivateKey();
    const pub = await getPublicKeyAsync(priv);
    const multibase = encodeMultikey('Ed25519', pub);
    const doc = buildDocFor(multibase);

    const challenge = buildChallenge({
      did: DID,
      domain: DOMAIN,
      nonce: 'a'.repeat(32),
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    const message = jcsCanonicalize(challenge);
    const sig = await signAsync(message, priv);
    const sigB64 = base64urlnopad.encode(sig);

    const result = await verifyProofOfControl({
      challenge,
      signature: sigB64,
      didDocument: doc,
      expectedDomain: DOMAIN,
    });
    expect(result.valid).toBe(true);
    expect(result.matchedKeyId).toBe(`${DID}#auth-1`);
  });

  it('rejects a challenge whose timestamp is out of the ±5 minute window', async () => {
    const priv = utils.randomPrivateKey();
    const pub = await getPublicKeyAsync(priv);
    const multibase = encodeMultikey('Ed25519', pub);
    const doc = buildDocFor(multibase);

    const challenge = buildChallenge({
      did: DID,
      domain: DOMAIN,
      nonce: 'b'.repeat(32),
      timestamp: '2020-01-01T00:00:00Z',
    });
    const result = await verifyProofOfControl({
      challenge,
      signature: 'AAAA',
      didDocument: doc,
      expectedDomain: DOMAIN,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe('challenge_expired');
  });

  it('rejects a mismatched domain BEFORE signature verification', async () => {
    const doc = buildDocFor('z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doY');
    const challenge = buildChallenge({
      did: DID,
      domain: 'attacker.example',
      nonce: 'c'.repeat(32),
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    const result = await verifyProofOfControl({
      challenge,
      signature: 'AAAA',
      didDocument: doc,
      expectedDomain: DOMAIN,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe('challenge_domain_mismatch');
  });

  it('rejects a duplicate nonce via the isNonceFresh callback', async () => {
    const priv = utils.randomPrivateKey();
    const pub = await getPublicKeyAsync(priv);
    const doc = buildDocFor(encodeMultikey('Ed25519', pub));
    const challenge = buildChallenge({
      did: DID,
      domain: DOMAIN,
      nonce: 'd'.repeat(32),
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    const result = await verifyProofOfControl({
      challenge,
      signature: 'AAAA',
      didDocument: doc,
      expectedDomain: DOMAIN,
      isNonceFresh: () => false,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe('challenge_nonce_invalid');
  });

  it('rejects a tombstone document (no authentication keys)', async () => {
    const doc: DidDocument = {
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: DID,
      verificationMethod: [],
      authentication: [],
      assertionMethod: [],
      keyAgreement: [],
      service: [],
    };
    const challenge = buildChallenge({
      did: DID,
      domain: DOMAIN,
      nonce: 'e'.repeat(32),
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    });
    const result = await verifyProofOfControl({
      challenge,
      signature: 'AAAA',
      didDocument: doc,
      expectedDomain: DOMAIN,
    });
    expect(result.valid).toBe(false);
    expect(result.reason?.code).toBe('did_deactivated');
  });
});
