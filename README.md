# did-stellar

Official [`did:stellar`](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md)
v0.1 implementation — TypeScript SDK + standalone HTTP resolver.

| Component | What it is | Link |
|---|---|---|
| **SDK** | `@acta-team/did-stellar` — identifier generation, RPC resolution, DIF-compatible resolver, prepare/submit XDR, proof-of-control | [![npm](https://img.shields.io/npm/v/@acta-team/did-stellar)](https://www.npmjs.com/package/@acta-team/did-stellar) |
| **HTTP resolver** | Standalone Express service. Serves `GET /1.0/identifiers/{did}` for DIF Universal Resolver + 6 lifecycle endpoints. No auth, trust-minimised. [Swagger UI](https://did.acta.build/docs) | [`did.acta.build`](https://did.acta.build) |
| **Registry contract** | `did-stellar-registry` on Stellar testnet | [`CB7ATU7SF5...NNZJ`](https://stellar.expert/explorer/testnet/contract/CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ) |

## Quick start

**Resolve a DID** (no install needed):
```bash
curl https://did.acta.build/1.0/identifiers/did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi
```

**Install the SDK**:
```bash
npm install @acta-team/did-stellar
```

**Resolve from code** (talks directly to Stellar RPC, no ACTA service dependency):
```ts
import { resolveDidStellar } from '@acta-team/did-stellar';

const { didDocument } = await resolveDidStellar(
  'did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi'
);
```

**DIF Universal Resolver driver**:
```ts
import { Resolver } from 'did-resolver';
import { getResolver } from '@acta-team/did-stellar/resolver';

const resolver = new Resolver({ ...getResolver() });
const result = await resolver.resolve('did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi');
```

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/method/did-stellar-method.md`](./docs/method/did-stellar-method.md) | How `did:stellar` works — syntax, identifier generation, on-chain storage, DID Document structure, tombstones, proof-of-control, trust model |
| [`docs/reference/sdk-reference.md`](./docs/reference/sdk-reference.md) | Every export of `@acta-team/did-stellar` — functions, types, constants, code examples for every operation |
| [`docs/reference/api-reference.md`](./docs/reference/api-reference.md) | Every HTTP endpoint on `did.acta.build` — request/response JSON, status codes, content negotiation, rate limit headers |
| [`docs/reference/error-codes.md`](./docs/reference/error-codes.md) | All 35 `DidErrorCode` values with contract error numbers, HTTP status codes, and descriptions |
| [`docs/reference/configuration.md`](./docs/reference/configuration.md) | Every environment variable for `did.acta.build` with defaults, types, and validation rules |
| [`docs/internal/creation-paths.md`](./docs/internal/creation-paths.md) | Internal note: the three ways to create a `did:stellar` and why all produce equally valid DIDs |
| [`docs/internal/empty-fields.md`](./docs/internal/empty-fields.md) | Internal note: why `assertionMethod` / `keyAgreement` / `service` may resolve empty depending on the path used to create the DID |

## Layout

```
did-stellar/
├── packages/
│   ├── resolver/   # @acta-team/did-stellar       — SDK (npm)
│   └── api/        # did.acta.build                — HTTP resolver (Railway)
└── docs/           # method, SDK, API, errors, config docs
```

## Local development

```bash
corepack enable
pnpm install
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm test
```

Run the API locally:
```bash
pnpm --filter did-stellar-api run dev
# → http://localhost:8080/health
```

## Trust model

`did:stellar` is **trust-minimized by design**. A verifier can resolve
any `did:stellar:...` using only a Stellar RPC endpoint and the
registry contract ID — no ACTA infrastructure is required.

- The SDK reads directly from the Stellar RPC. It does not depend on
  any hosted API.
- The HTTP service ([`did.acta.build`](https://did.acta.build)) is a
  convenience wrapper for non-JS consumers and for the
  [DIF Universal Resolver](https://dev.uniresolver.io/) listing. It
  is stateless and replaceable.
- `acta-api` (the ACTA credentials API, separate repo) intentionally
  **does not** import this SDK. Identity and credentials are separate
  trust domains.

## License

[MIT](./LICENSE)
