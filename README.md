# did-stellar

Monorepo for the [`did:stellar`](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md)
v0.1 method — SDK + standalone HTTP service.

| Package | Purpose | Distribution |
|---|---|---|
| [`@acta-team/did-stellar`](./packages/resolver) | TypeScript SDK: identifier generation, RPC resolution, DIF-compatible resolver, prepare/submit XDR, proof-of-control. Lives in `packages/resolver/`. | npm |
| [`did.acta.build`](./packages/api) | Standalone Express service that wraps the SDK. Serves `GET /1.0/identifiers/{did}` for DIF Universal Resolver + the 6 lifecycle endpoints. No auth, trust-minimised. Lives in `packages/api/`. | [`did.acta.build`](https://did.acta.build) (Railway) |

The SDK is the canonical entry point. The HTTP service is a thin wrapper that
exists for non-JS consumers and for the DIF Universal Resolver listing.

## Layout

```
did-stellar/
└── packages/
    ├── resolver/   # @acta-team/did-stellar       — SDK (published to npm)
    └── api/        # did.acta.build                — HTTP resolver service (Railway)
```

Folder names describe **what each package does** so the layout reads
unambiguously inside the `did-stellar/` repo. The npm package name
(`@acta-team/did-stellar`) is the npm-publishable SDK. The HTTP service
is deployed at [`did.acta.build`](https://did.acta.build).

## Local development

```bash
corepack enable
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

See each package's `README.md` for usage.

## Trust model

`did:stellar` is **trust-minimized by design**. A verifier MUST be able to
resolve a `did:stellar:...` DID using only a Stellar RPC endpoint and the
registry contract ID — no ACTA infrastructure is required.

That principle drives the architecture of this repo:

- The SDK reads directly from the Stellar RPC. It does not depend on any
  hosted API.
- The HTTP service is convenience for wallets that don't ship a JS runtime
  and for the DIF Universal Resolver. It is stateless and replaceable.
- `acta-api` (the ACTA credentials API, separate repo) intentionally
  **does not** import this SDK. Identity and credentials are separate
  trust domains.

## License

[MIT](./LICENSE)
