# `did-stellar` — Documentation

> All data in these docs is extracted directly from the source code in
> this repository. Nothing is paraphrased or speculative.

## Quick links

| Resource | URL |
|---|---|
| Live resolver | [`did.acta.build`](https://did.acta.build) |
| npm SDK | [`@acta-team/did-stellar`](https://www.npmjs.com/package/@acta-team/did-stellar) |
| OpenAPI spec | [`did.acta.build/openapi.json`](https://did.acta.build/openapi.json) |
| Method spec | [`did:stellar` v0.1](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md) |
| Testnet contract | [`CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ`](https://stellar.expert/explorer/testnet/contract/CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ) |

## Contents

### Method — how `did:stellar` works

| Doc | What it covers |
|---|---|
| [`method/did-stellar-method.md`](./method/did-stellar-method.md) | Syntax, identifier generation, on-chain storage, DID Document structure, tombstones |

### Reference — public surface

| Doc | What it covers |
|---|---|
| [`reference/sdk-reference.md`](./reference/sdk-reference.md) | Every export of `@acta-team/did-stellar` — functions, types, constants, subpath exports |
| [`reference/api-reference.md`](./reference/api-reference.md) | Every HTTP endpoint on `did.acta.build` — request/response shapes, status codes, content negotiation |
| [`reference/error-codes.md`](./reference/error-codes.md) | Complete table of all 35 `DidErrorCode` values, what triggers them, and what HTTP status they map to |
| [`reference/configuration.md`](./reference/configuration.md) | Every environment variable for `did.acta.build`, with defaults and validation rules |

### Internal — design notes and explanations

> Conceptual notes for the team and contributors. Useful when answering
> questions like "why is this field empty?" or "why is this split into
> two SDKs?".

| Doc | What it covers |
|---|---|
| [`internal/creation-paths.md`](./internal/creation-paths.md) | The three ways to create a `did:stellar` (acta-sdk, did-stellar SDK, raw API) and why all produce equally valid DIDs |
| [`internal/empty-fields.md`](./internal/empty-fields.md) | Why `assertionMethod`, `keyAgreement`, and `service` may resolve empty depending on which path was used to create the DID, and how to fix it via `update()` |
