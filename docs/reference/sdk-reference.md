# SDK Reference — `@acta-team/did-stellar`

> **npm**: [`@acta-team/did-stellar`](https://www.npmjs.com/package/@acta-team/did-stellar)
> **Version**: `0.1.0`
> **Source**: [`packages/resolver/`](../../packages/resolver/)

## Install

```bash
npm install @acta-team/did-stellar
```

React hook users (optional):
```bash
npm install @acta-team/did-stellar react
```

## Subpath exports

| Import path | What you get | Bundle size |
|---|---|---|
| `@acta-team/did-stellar` | Everything | ~48 KB (CJS) |
| `@acta-team/did-stellar/resolver` | `resolveDidStellar` + `getResolver` only | ~15 KB |
| `@acta-team/did-stellar/hooks` | `useDid()` React hook | ~35 KB |

---

## Identifier primitives

```ts
import {
  generateDidId,        // () => string (26-char base32)
  generateDidIdBytes,   // () => Uint8Array (16 bytes CSPRNG)
  encodeDidId,          // (bytes: Uint8Array) => string
  decodeDidId,          // (s: string) => Uint8Array
  buildDidStellar,      // (network, didId) => 'did:stellar:testnet:...'
  buildDidStellarFromBytes, // (network, bytes) => string
  parseDidStellar,      // (did) => { network, didId, didIdBytes }
  isValidDidStellar,    // (did) => boolean
} from '@acta-team/did-stellar';
```

**Constants**:
- `DID_STELLAR_REGEX` = `/^did:stellar:(mainnet|testnet):[a-z2-7]{26}$/`
- `DID_ID_REGEX` = `/^[a-z2-7]{26}$/`
- `DID_ID_BYTES` = `16`
- `DID_ID_LENGTH` = `26`

---

## Resolver

### Direct resolution (no HTTP, talks to Stellar RPC)

```ts
import { resolveDidStellar } from '@acta-team/did-stellar';

const result = await resolveDidStellar(
  'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi',
  {
    rpcUrl: 'https://soroban-testnet.stellar.org',       // optional, default per network
    registryContractId: 'CB7ATU7SF5...NNZJ',             // optional, default per network
    allowHttp: false,                                     // optional
  }
);
// result: { didDocument, didDocumentMetadata, didResolutionMetadata }
```

### DIF `did-resolver` driver

```ts
import { Resolver } from 'did-resolver';
import { getResolver } from '@acta-team/did-stellar/resolver';

const resolver = new Resolver({ ...getResolver() });
const result = await resolver.resolve('did:stellar:testnet:...');
```

`getResolver()` options:
- `testnetRpcUrl`, `mainnetRpcUrl` — override RPC endpoints
- `testnetRegistryContractId`, `mainnetRegistryContractId` — override contract IDs
- `allowHttp` — allow HTTP RPC (dev only)

---

## Record operations

### Read a raw `DidRecord` from the chain

```ts
import { readDidRecord, buildRpcServer, parseDidStellar } from '@acta-team/did-stellar';

const parsed = parseDidStellar('did:stellar:testnet:...');
const rpcServer = buildRpcServer('https://soroban-testnet.stellar.org');
const record = await readDidRecord({
  rpcServer,
  registryContractId: 'CB7ATU7SF5...NNZJ',
  didIdBytes: parsed.didIdBytes,
});
// record: { controller, authentication, version, deactivated, ... } | null
```

### Validate before submitting

```ts
import { validateDidRecordInput } from '@acta-team/did-stellar';

validateDidRecordInput({
  controller: 'G...',
  authentication: [{ publicKeyMultibase: 'z6Mk...' }],
  assertionMethod: [],
  keyAgreement: [],
  services: [],
});
// Throws DidError with a specific code on any violation
```

---

## Prepare / submit XDR

All mutation helpers follow the same pattern: **prepare** returns an
unsigned XDR → the caller signs with their wallet → **submit** sends
the signed XDR and polls until confirmation.

### Register

```ts
import { generateDidId, buildDidStellar, prepareRegisterDidXdr, submitSignedXdr } from '@acta-team/did-stellar';

const didId = generateDidId();
const did = buildDidStellar('testnet', didId);

const prepared = await prepareRegisterDidXdr({
  did,
  sourcePublicKey: 'G...',
  record: {
    controller: 'G...',
    authentication: [{ publicKeyMultibase: 'z6Mk...' }],
    assertionMethod: [],
    keyAgreement: [],
    services: [],
  },
});
// prepared: { xdr: string, network: 'testnet', networkPassphrase: string }

// Sign with your wallet (Freighter, Albedo, server-side, etc.)
const signedXdr = await sign(prepared.xdr, { networkPassphrase: prepared.networkPassphrase });

const { txId } = await submitSignedXdr({ signedXdr, network: 'testnet' });
```

### Update

```ts
import { prepareUpdateDidXdr } from '@acta-team/did-stellar';

const prepared = await prepareUpdateDidXdr({
  did: 'did:stellar:testnet:...',
  expectedVersion: 1,  // must match on-chain version
  nextRecord: { controller: 'G...', authentication: [...], ... },
  sourcePublicKey: 'G...',
});
```

### Transfer controller

```ts
import { prepareTransferControllerXdr } from '@acta-team/did-stellar';

const prepared = await prepareTransferControllerXdr({
  did: 'did:stellar:testnet:...',
  expectedVersion: 1,
  newController: 'G...new-wallet...',
  sourcePublicKey: 'G...current-controller...',
});
```

### Deactivate (irreversible)

```ts
import { prepareDeactivateDidXdr } from '@acta-team/did-stellar';

const prepared = await prepareDeactivateDidXdr({
  did: 'did:stellar:testnet:...',
  expectedVersion: 2,
  sourcePublicKey: 'G...',
});
```

---

## Proof of Control

```ts
import {
  buildChallenge,
  generateNonce,
  jcsCanonicalize,
  verifyProofOfControl,
  resolveDidStellar,
} from '@acta-team/did-stellar';

// Verifier creates the challenge:
const challenge = buildChallenge({
  did: 'did:stellar:testnet:...',
  domain: 'verifier.example.com',
  nonce: generateNonce(),  // 32-char lowercase hex
  // timestamp defaults to now (UTC)
});

// Signer canonicalizes and signs:
const message = jcsCanonicalize(challenge);
// → sign `message` with Ed25519 key from authentication
// → encode signature as base64url-nopad

// Verifier checks:
const { didDocument } = await resolveDidStellar(challenge.did);
const result = await verifyProofOfControl({
  challenge,
  signature: 'base64url-signature...',
  didDocument: didDocument!,
  expectedDomain: 'verifier.example.com',
  isNonceFresh: (nonce, did) => checkRedis(nonce, did),  // pluggable
});
// result: { valid: boolean, reason?: DidError, matchedKeyId?: string }
```

**Timestamp window**: `DEFAULT_TIMESTAMP_WINDOW_MS = 300000` (±5 minutes)

---

## Multikey codec

```ts
import { encodeMultikey, decodeMultikey, detectCurve } from '@acta-team/did-stellar';

detectCurve('z6Mk...');  // → 'Ed25519'
detectCurve('z6LS...');  // → 'X25519'

const { curve, publicKey } = decodeMultikey('z6Mk...');
// curve: 'Ed25519', publicKey: Uint8Array (32 bytes)

const multibase = encodeMultikey('Ed25519', publicKey);
// → 'z6Mk...'
```

---

## HTTP Client (optional)

For integrators that prefer HTTP over Stellar RPC:

```ts
import { ActaDidClient } from '@acta-team/did-stellar';

const client = new ActaDidClient({ baseUrl: 'https://did.acta.build' });

const resolution = await client.resolve('did:stellar:testnet:...');
const document = await client.resolveDocument('did:stellar:testnet:...');
const record = await client.getDidRecord('did:stellar:testnet:...');
```

---

## React hook

```ts
import { useDid } from '@acta-team/did-stellar/hooks';

function MyComponent() {
  const { register, update, transfer, deactivate, resolve, getRecord } = useDid();

  const handleRegister = async () => {
    const { txId } = await register({
      did: 'did:stellar:testnet:...',
      sourcePublicKey: 'G...',
      record: { ... },
      sign: async (xdr, { networkPassphrase }) => {
        // return signed XDR from your wallet
      },
    });
  };
}
```

---

## Error handling

```ts
import { DidError } from '@acta-team/did-stellar';

try {
  await prepareRegisterDidXdr({ ... });
} catch (err) {
  if (DidError.is(err)) {
    switch (err.code) {
      case 'did_already_exists': // retry with a new didId
      case 'version_mismatch':  // re-read record, retry with current version
      case 'controller_invalid': // wrong G... address
      default: throw err;
    }
  }
}
```

See [`error-codes.md`](./error-codes.md) for the full table.

---

## Network defaults (from `src/network.ts`)

| Network | RPC URL | Registry contract ID |
|---|---|---|
| `testnet` | `https://soroban-testnet.stellar.org` | `CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ` |
| `mainnet` | `https://mainnet.sorobanrpc.com` | (not deployed yet) |

---

## Dependencies

| Package | Purpose |
|---|---|
| `@stellar/stellar-sdk` ^15.0.0 | Stellar/Soroban RPC interaction |
| `@noble/ed25519` ^2.1.0 | Ed25519 signature verification (proof of control) |
| `@scure/base` ^1.1.9 | Base32 + base58btc codecs |
| `axios` ^1.15.2 | HTTP client for `ActaDidClient` (tree-shakes away if unused) |
