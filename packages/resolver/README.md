# `@acta-team/did-stellar`

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DIF compliant](https://img.shields.io/badge/DIF-did--resolver-blue.svg)](https://github.com/decentralized-identity/did-resolver)

Official TypeScript SDK for the [`did:stellar` v0.1 method](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md).

| | |
|---|---|
| **DID method** | `did:stellar` |
| **Networks** | `mainnet`, `testnet` |
| **Testnet registry** | `CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ` |
| **Spec** | [v0.1](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md) |
| **DIF compatibility** | Drop-in driver for [`did-resolver`](https://www.npmjs.com/package/did-resolver) |

## What's inside

- **Resolver** — `resolveDidStellar(did)` reads the on-chain `DidRecord`
  via Stellar RPC and returns a W3C DID Document.
- **DIF driver** — `getResolver()` plugs straight into
  `new Resolver({...})` from `did-resolver`.
- **Prepare / submit** — four mutation helpers
  (`prepareRegisterDidXdr`, `prepareUpdateDidXdr`,
  `prepareTransferControllerXdr`, `prepareDeactivateDidXdr`) that build
  unsigned XDRs, plus `submitSignedXdr` to deliver them.
- **Proof of control** — JCS-canonicalised challenges, `buildChallenge`,
  `verifyProofOfControl` (Ed25519, ±5 min replay window).
- **Optional HTTP client** — `ActaDidClient` for integrators that
  prefer talking to [`did.acta.build`](https://did.acta.build) rather than wiring a Stellar RPC
  themselves.
- **React hook** — `useDid()` (subpath `@acta-team/did-stellar/hooks`)
  for browser apps.
- **Typed errors** — every failure is a `DidError` with a stable
  `code` string (`did_not_found`, `version_mismatch`, `signature_invalid`, …).

The SDK has **zero ACTA-hosted dependencies** in its hot path. You can
resolve any `did:stellar:...` with just a Stellar RPC URL.

## Install

```bash
npm install @acta-team/did-stellar
# peer (only if you use the ./hooks entrypoint):
npm install react
```

## Quickstart — resolve

```ts
import { resolveDidStellar } from '@acta-team/did-stellar';

const { didDocument, didDocumentMetadata } = await resolveDidStellar(
  'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4'
);
console.log(didDocument);
```

Defaults: SDF public RPC (`https://soroban-testnet.stellar.org`) + the
canonical registry contract ID. Override either via `{ rpcUrl,
registryContractId }`.

## Quickstart — DIF driver

```ts
import { Resolver } from 'did-resolver';
import { getResolver } from '@acta-team/did-stellar/resolver';

const resolver = new Resolver({ ...getResolver() });
const result = await resolver.resolve('did:stellar:testnet:aaaqeayeaudaocajbifqydiob4');
```

## Quickstart — register a DID

```ts
import {
  generateDidId,
  buildDidStellar,
  prepareRegisterDidXdr,
  submitSignedXdr,
} from '@acta-team/did-stellar';

const didId = generateDidId();
const did = buildDidStellar('testnet', didId);

const prepared = await prepareRegisterDidXdr({
  did,
  sourcePublicKey: 'G...',
  record: {
    controller: 'G...',
    authentication: [{ publicKeyMultibase: 'z6Mk...' }],
    assertionMethod: [{ publicKeyMultibase: 'z6Mk...' }],
    keyAgreement: [],
    services: [],
  },
});

// Sign with Freighter / Albedo / Hana / server-side key ...
const signedXdr = await signWithWallet(prepared.xdr, {
  networkPassphrase: prepared.networkPassphrase,
});

const { txId } = await submitSignedXdr({
  signedXdr,
  network: prepared.network,
});
```

## Quickstart — proof of control

```ts
import {
  buildChallenge,
  generateNonce,
  jcsCanonicalize,
  resolveDidStellar,
  verifyProofOfControl,
} from '@acta-team/did-stellar';

// Verifier issues the challenge:
const challenge = buildChallenge({
  did: 'did:stellar:testnet:aaaqeayeaudaocajbifqydiob4',
  domain: 'verifier.example.com',
  nonce: generateNonce(),
});
const message = jcsCanonicalize(challenge);
// → present `challenge` + `message` to the wallet for Ed25519 signing.

// Wallet returns signature (base64url, no padding):
const signature = '...';

// Verifier:
const { didDocument } = await resolveDidStellar(challenge.did);
const result = await verifyProofOfControl({
  challenge,
  signature,
  didDocument: didDocument!,
  expectedDomain: 'verifier.example.com',
  isNonceFresh: (nonce, did) => myRedis.setnx(`pc:${did}:${nonce}`, '1', 'EX', 300),
});
if (!result.valid) throw result.reason;
```

## Error handling

Every SDK function rejects with `DidError`. Branch on `code`:

```ts
import { DidError } from '@acta-team/did-stellar';

try {
  await prepareUpdateDidXdr({ ... });
} catch (err) {
  if (DidError.is(err) && err.code === 'version_mismatch') {
    // re-read the record, rebuild, retry
  } else {
    throw err;
  }
}
```

See [`src/errors.ts`](./src/errors.ts) for the full `DidErrorCode` union.

## Spec conformance

The package ships [vectors A.1–A.3](./tests/fixtures/vectors.json) from
the spec and `pnpm test` verifies the DID Document builder produces
bit-identical output. Adding new functionality without updating the
spec is intentionally a CI failure surface.

## License

MIT
