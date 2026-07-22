# Changelog

All notable changes to the `did-stellar` monorepo are documented in this
file. The monorepo hosts the SDK
([`@acta-team/did-stellar`](./packages/resolver)) and the standalone
HTTP resolver service ([`did.acta.build`](https://did.acta.build), source in [`packages/api`](./packages/api)) for the
[`did:stellar` v0.1 DID method](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).
Per-package changelogs in
[`packages/resolver/CHANGELOG.md`](./packages/resolver/CHANGELOG.md) and
[`packages/api/CHANGELOG.md`](./packages/api/CHANGELOG.md) cover the
narrower picture; this top-level changelog captures the cross-package
state of the monorepo.

---

## [Unreleased]

### Changed (licensing)

- **Relicensed from MIT to Apache-2.0** across the monorepo — root, both
  packages, and their published `package.json` `license` fields. The change was
  made deliberately before the [DIF Universal Resolver
  PR](https://github.com/decentralized-identity/universal-resolver/pull/576)
  merges and before external contributions arrive: ACTA is still the sole
  copyright holder, so relicensing is a single commit. Once third parties have
  contributed under MIT, the same change would require each of their consent.
- **Rationale.** `did:stellar` is a registered W3C DID method whose driver is
  run by third parties in their own infrastructure. Apache-2.0 supplies two
  things MIT does not, and both matter specifically at standards scale: an
  express patent grant with defensive termination (§3), and an explicit
  reservation of trademark rights (§6). It also removes a split that should
  never have existed — the normative spec and the `did-stellar-registry`
  contract in `contracts-acta` were already Apache-2.0 while the reference
  implementation of the same method was MIT. The upstream
  `universal-resolver` repository and DIF's `did-resolver`, a direct
  dependency, are both Apache-2.0 as well.
- **This is not a restriction.** Apache-2.0 remains an OSI-approved permissive
  license: forking, self-hosting the resolver, and commercial use are as
  unrestricted as they were under MIT. Downstream consumers gain a patent
  grant they did not have before. The only new obligations are retaining the
  `NOTICE` file and stating changes made.
- Added `NOTICE` (root and per package, shipped in the npm tarball via the
  `files` array) and `TRADEMARK.md`, which states what the Apache §6 trademark
  reservation does and does not cover — forks may say they implement
  `did:stellar`, but may not present themselves as published by ACTA.
- `CONTRIBUTING.md` now requires a
  [DCO 1.1](https://developercertificate.org/) sign-off (`git commit -s`) on
  every commit, so the provenance of contributions from outside ACTA stays
  auditable.

### Security

- **axios raised to `>=1.18.0`** ([GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9),
  high). The Node HTTP adapter could use an inherited proxy after interceptor
  config cloning. The root `pnpm.overrides` entry still read
  `"axios@<1.15.2": "^1.15.2"`, written for an earlier advisory; the new one
  declares `>=1.15.2 <1.18.0` vulnerable, so the pin that used to protect the
  tree had become the thing holding it on a vulnerable version (`1.16.1`).
  The override is now `"axios@<1.18.0": "^1.18.0"` and the SDK's direct
  dependency was raised to match.
- The override is load-bearing rather than cosmetic: `@stellar/stellar-sdk`
  pins `axios` to an exact `1.16.1` even on its latest release, so no amount of
  upgrading dependencies reaches a patched version on its own. Forcing it
  resolves all five reported paths to a single `axios@1.18.1` with no duplicate
  copies in the tree.
- `pnpm audit --audit-level=high --prod` drops from 11 findings (1 high,
  9 moderate, 1 low) to 1 low, and exits 0. The published container image was
  rebuilt so the shipped artifact carries the patched version.

### Added (container distribution)

- **Public container image.** The HTTP resolver is now published as
  `ghcr.io/acta-team/driver-did-stellar`, built from the existing
  [`packages/api/Dockerfile`](./packages/api/Dockerfile). This is what the
  [DIF Universal Resolver](https://dev.uniresolver.io/) consumes: it does not
  call a hosted URL, it pulls an image and runs the driver inside its own
  cluster, so `did.acta.build` alone could never be listed there. GHCR was
  chosen over Docker Hub because the Universal Resolver driver rules call out
  Docker Hub's anonymous-pull rate limits as a reason drivers get removed.
- **`.github/workflows/docker.yml`** — builds and pushes the image on every
  published release (and on manual dispatch with an explicit tag), for
  `linux/amd64` and `linux/arm64`, with provenance and SBOM attestations. The
  workflow then boots the pushed image and asserts `/health` and
  `GET /1.0/identifiers/{did}` respond, so a broken driver fails here rather
  than in the Universal Resolver's CI. Releases are tagged `vX.Y.Z`; the image
  tag drops the `v` to match `packages/api/package.json`. `:latest` is
  published for convenience but must never be referenced from the Universal
  Resolver config — their rules require an explicit version.

### Fixed

- **Root `.dockerignore` was missing.** The build context is the repo root
  (the Dockerfile `COPY`s `pnpm-workspace.yaml` and `packages/` from the
  workspace root, and Railway builds the same way), but the only
  `.dockerignore` lived in `packages/api/` — Docker reads the one at the
  *context* root, so it was never applied and every build shipped the full
  `node_modules/` and `.git/` to the daemon. Added [`.dockerignore`](./.dockerignore)
  at the root, which also closes a path where a stray `.env` could reach the
  build context.

### Added (multi-network)

- **Multi-network resolver.** The HTTP service now serves both `testnet` and
  `mainnet` from a single deployment and routes each request by the network
  embedded in the `did:stellar:{network}:...` identifier (no `NETWORK_TYPE`
  lock). Per-network config via `DID_REGISTRY_CONTRACT_ID_TESTNET` /
  `DID_REGISTRY_CONTRACT_ID_MAINNET` and `STELLAR_RPC_URL_TESTNET` /
  `STELLAR_RPC_URL_MAINNET`; the legacy single-network envs (`NETWORK_TYPE`,
  `DID_REGISTRY_CONTRACT_ID`, `STELLAR_RPC_URL`) still work as a fallback for
  the named network. Requests for an unconfigured network return a clean
  error instead of resolving against the wrong registry.
- **SDK:** `DEFAULT_REGISTRY_CONTRACT_IDS.mainnet` is now populated with the
  mainnet `did-stellar-registry` (`CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ`).
- `GET /health` and the OpenAPI `x-acta` block now list both networks instead
  of a single configured network.

### Changed (BREAKING — HTTP API)

- **Renamed update endpoint:**
  `PATCH /v1/dids/stellar/{did}` → **`POST /v1/dids/stellar/{did}/update`**.
  Reason: the previous route shared its URL with the `GET` raw-record
  read, which was ambiguous in Swagger UI and confusing for integrators
  scanning the API surface. Every mutation now follows the same
  `POST /v1/dids/stellar/{did}/<action>` pattern (`/update`,
  `/transfer`, `/deactivate`) so each operation is self-describing.
  - Request body and response shape are unchanged — only the verb and
    URL changed.
  - CORS `methods` allowlist drops `PATCH`.
  - Existing integrators using `PATCH` must switch to
    `POST /v1/dids/stellar/{did}/update`.

### Changed

- **Validation: same key allowed across distinct verification
  relationships.** `validateDidRecordInput` no longer rejects records
  where the same `publicKeyMultibase` appears in more than one
  relationship (e.g. one Ed25519 key used in both `authentication` and
  `assertionMethod`, which is the idiomatic shape for an issuer DID).
  Duplicates *within* the same relationship still raise `duplicate_key`.
  This aligns the SDK with the post-audit `did-stellar-registry`
  contract, which removed the equivalent rule because W3C DID Core 1.1
  §3.2 only requires uniqueness on `verificationMethod.id`, not on key
  material. Closes audit finding **A1**.

### Added

- **Swagger UI at `GET /docs`** — interactive API explorer powered by
  `swagger-ui-dist`, served from the same Express instance. Loads the
  existing `/openapi.json` spec. No external CDN dependency.
- **`GET /`** redirects to `/docs` — visiting the root URL lands on
  the Swagger UI instead of a 404.
- **`CONTRIBUTING.md`** — contributor guide covering setup, workflow,
  conventions, and PR process.
- **`.gitattributes`** — enforces LF line endings, marks
  `pnpm-lock.yaml` as `merge=ours` to prevent lockfile merge
  conflicts, tags `dist/` and `coverage/` as `linguist-generated`.
- **Husky + lint-staged** — pre-commit hook formats staged files with
  Prettier; pre-push hook runs `lint` + `typecheck`.

### Changed

- **Import ordering enforced** — added `eslint-plugin-import-x` with
  alphabetical, grouped import rules (builtin → external → internal →
  parent → sibling → type). All existing imports auto-sorted.
- **Removed `DOM` lib from `tsconfig.base.json`** — both the SDK and
  the API run in Node; the React hook uses `useCallback` (no DOM
  APIs). Consumers' bundlers provide DOM types when needed.

---

## [0.1.0] — 2026-05-22

First public release of the `did:stellar` v0.1 implementation.
Validated end-to-end against the canonical testnet `did-stellar-registry`
(`CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ`).

The release is structurally complete: every endpoint described in the
plan is implemented, every code path tested, and the SDK round-trip
proved against the live contract.

### Headline

- **`@acta-team/did-stellar` v0.1.0** — TypeScript SDK with the
  identifier primitives, W3C DID Document builder, Stellar RPC
  reader, prepare/submit XDR helpers, JCS proof-of-control verifier,
  and a DIF [`did-resolver`](https://www.npmjs.com/package/did-resolver)
  driver.
- **[`did.acta.build`](https://did.acta.build) v0.1.0** — Express 5 HTTP resolver wrapping the
  SDK; exposes `GET /1.0/identifiers/{did}` for DIF Universal
  Resolver compatibility plus the lifecycle endpoints.
- **`examples/smoke-testnet`** — end-to-end smoke test that
  registers and resolves a DID on testnet using a real Stellar
  controller wallet. Used as the canonical "is this build ready to
  ship" check.
- **`docs/`** — operational documentation, including the smoke test
  runbook under `docs/example/`.

### Verified against the live `did-stellar-registry` contract

The smoke test (`examples/smoke-testnet`) was executed against
Stellar testnet on 2026-05-22 and closed every previously-open
integration risk:

| Risk | Closed by | Evidence |
|---|---|---|
| ScVal encoder for `DidRecord` matches the contract layout | Soroban simulate accepts the prepared transaction | tx [`9c3234a8a9c9b3cc9a24fa7751cd4a4cfda167763343fa5a9888388d4a57119c`](https://stellar.expert/explorer/testnet/tx/9c3234a8a9c9b3cc9a24fa7751cd4a4cfda167763343fa5a9888388d4a57119c) at ledger 2661630 |
| Prepare → sign locally → submit pipeline works | Transaction confirmed on-chain, `version: 1` persisted | Same tx |
| `getLedgerEntries` reader decodes the on-chain record back into the SDK's typed `DidRecord` | `resolveDidStellar()` + `readDidRecord()` return the document and raw record with all fields intact | Smoke step 6 + 7 outputs |

The DID `did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi` registered
during that run remains resolvable from any caller pointing at the
testnet contract.

---

## Packages

### `@acta-team/did-stellar` (the SDK)

**Path**: `packages/resolver/`
**Distribution**: npm (planned, name reserved)
**Public surface**: 50+ exports from one main entrypoint plus subpath
exports for `./resolver` (DIF driver, minimal bundle) and `./hooks`
(React).

#### Added

- **Identifier primitives** — `generateDidId`, `generateDidIdBytes`,
  `encodeDidId`, `decodeDidId`, `buildDidStellar`,
  `buildDidStellarFromBytes`, `parseDidStellar`, `isValidDidStellar`.
  Backed by an inline RFC 4648 base32 lowercase codec
  (`base32.encodeBase32Lower` / `decodeBase32Lower`). Mints opaque
  128-bit DIDs that are **not** derived from any wallet (spec §1.2).
- **Multikey codec** — `decodeMultikey`, `encodeMultikey`,
  `detectCurve`, `decodeMultibaseBase58btc`. Supports Ed25519
  (`z6Mk...`) and X25519 (`z6LS...`), the two curves listed in
  v0.1 §5.4.
- **`DidRecord` domain** —
  TypeScript types (`DidRecord`, `DidRecordInput`, `DidKey`,
  `DidService`), client-side validator
  (`validateDidRecordInput`) that mirrors the contract's
  `validate_record` rule-for-rule, ScVal encoder (`encodeDidRecord`)
  with alphabetical field ordering enforced by the Soroban host,
  ScVal decoder (`decodeDidRecord`), and a direct reader against
  Stellar RPC's `getLedgerEntries` (`readDidRecord`).
- **W3C DID Document builder** —
  `buildDidDocument` and `buildTombstone` produce W3C DID Core 1.1
  compliant documents. Bit-for-bit equal to spec Annex A vectors
  A.1 (minimal active), A.2 (full active), A.3 (tombstone).
  Self-controlled — no `controller` field at the document root
  (spec §5.3). Verification relationships hold fragment references
  only; keys are centralised in `verificationMethod` (spec §5.5).
- **Resolver** —
  `resolveDidStellar(did, opts)` does the full
  `parseDid → readDidRecord → buildDidDocument` pipeline against a
  Stellar RPC endpoint. Returns the DIF-standard
  `DidResolutionResult` shape. `getResolver(opts)` exports a
  DIF [`did-resolver`](https://www.npmjs.com/package/did-resolver)-compatible
  driver so `did:stellar` can be plugged into any app that already
  resolves other DID methods.
- **Prepare / submit helpers** —
  `prepareRegisterDidXdr`, `prepareUpdateDidXdr`,
  `prepareTransferControllerXdr`, `prepareDeactivateDidXdr`,
  `submitSignedXdr`. Build unsigned Soroban transaction XDRs ready
  for any wallet to sign; submit signed XDRs and poll until the
  network reports a terminal status. Optimistic concurrency:
  `update`/`transfer`/`deactivate` require `expectedVersion` and
  surface `version_mismatch` when the on-chain version drifts.
- **Proof of Control** —
  `jcsCanonicalize` (RFC 8785), `buildChallenge`,
  `generateNonce`, `verifyProofOfControl`. Enforces the §6.5
  algorithm in the spec-mandated order (timestamp window first,
  then domain, then nonce dedup, then signature). Verifies
  Ed25519 signatures against every key listed in
  `authentication`. Pluggable nonce-dedup callback (the SDK is
  stateless; verifiers plug Redis / in-memory).
- **Optional HTTP client** —
  `ActaDidClient` for integrators that prefer fetch over a
  Stellar RPC dependency. Talks to [`did.acta.build`](https://did.acta.build).
- **React hook** —
  `useDid()` exposed via `./hooks` subpath. Mirrors the
  prepare/sign/submit flow for browser apps. Signer is a
  function the caller provides — wallets (Freighter, Albedo,
  Hana, hardware) plug in unchanged.
- **Typed error hierarchy** —
  `DidError` + the `DidErrorCode` string union covering every
  `RegistryError` numeric (1–20) plus client-side and transport
  codes. `DidError.is(value)` works across realm boundaries.
  `fromContractErrorMessage` extracts contract errors from
  Soroban's `Error(Contract, #n)` envelope.
- **Branded primitives** — `Hex32`, `Url` for compile-time
  invariants on validated strings. Validation lives at the
  boundary; the rest of the program trusts the brand.

#### Internal

- **Low-level transaction primitives** (`src/internal/`) —
  `prepareInvokeXdr` (build → simulate → assemble), `submitSignedXdr`
  (parse → send → poll), `buildRpcServer` (Stellar RPC factory),
  ScVal helpers (`addressScVal`, `bytesN16ScVal`,
  `didRecordStorageKey`, etc.).
- **Module structure** — by domain, not by file kind. Every
  domain (`record/`, `document/`, `resolver/`, `prepare/`,
  `proof-of-control/`, `hooks/`) is a folder with an `index.ts`
  aggregator. No circular imports.

#### Tested

- 54 unit tests covering:
  - Identifier (round-trip, regex, generation, vector A.1).
  - Base32 (RFC 4648 lowercase, no padding).
  - Multikey (curve detection, encode/decode round-trip).
  - `validateDidRecordInput` (every contract bound + cross-relation duplicates).
  - JCS (key sorting, array order, escape rules, non-finite rejection).
  - `buildChallenge` and `verifyProofOfControl` (all 5 rejection paths from §6.5).
  - `DidDocument` builder against spec vectors A.1, A.2, A.3 byte-for-byte.
  - `DidError` typing, contract-error mapping.

#### Build / packaging

- `tsup` dual ESM/CJS + `.d.ts`. Subpath exports tree-shake
  cleanly: a resolver-only consumer pulls ~15 KB.
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`.
- ESLint with `@typescript-eslint` strict typed rules,
  `--max-warnings=0` in CI.
- Zero `any` in source. Three intentional `as unknown as`
  remain — all defensive reads of Stellar SDK shapes that have
  varied across versions, with comments explaining why.

#### Fixed

- **Reader: unwrap `LedgerEntryData` envelope.** The Stellar SDK
  v15 returns `getLedgerEntries` entries with `.val` set to the
  full `LedgerEntryData` envelope (whose `.switch()` name is
  `'contractData'`), not the inner ScVal. The previous
  `isScVal` heuristic matched both via the shared `.switch()`
  method and passed the envelope straight into `decodeDidRecord`,
  which failed with `expected scvMap for DidRecord, got
  contractData`. Replaced with `pickLedgerEntryData()` that
  distinguishes by the `.contractData()` variant accessor (only
  on `LedgerEntryData`, not on `ScVal`), then unwraps through
  `.contractData().val()` before decoding. Discovered and fixed
  during the on-chain smoke test (see *Verified* above).

---

### [`did.acta.build`](https://did.acta.build) (the HTTP resolver service)

**Path**: `packages/api/`
**Distribution**: [`did.acta.build`](https://did.acta.build) (Railway)
**Auth**: none — trust-minimised per spec §1.4
**State**: stateless; optional Redis for cache + rate-limit

#### Added

- **`GET /health`** — liveness probe. Pure (no RPC, no Redis
  reads), so a transient backend outage does not take a pod
  out of rotation.
- **`GET /openapi.json`** — full OpenAPI 3.1 spec emitted from
  source (`src/openapi.ts`), so the spec cannot drift from the
  routes silently.
- **`GET /1.0/identifiers/{did}`** — DIF Universal Resolver
  endpoint. Content-negotiates between
  `application/did+ld+json` (default, with `@context`) and
  `application/did+json` (without). Tombstone documents return
  `410 Gone` per spec §4.6.4. Cached by `did:network` for
  `RESOLVER_CACHE_TTL_SECONDS` (default 30s).
- **`GET /v1/dids/stellar/{did}`** — raw on-chain `DidRecord`
  (no W3C wrapping). Useful for callers that need `version`
  before an optimistic-concurrency update, or the `controller`
  Stellar account directly.
- **`POST /v1/dids/stellar`** — register. Prepare mode (body
  has `did`, `record`, `sourcePublicKey` → returns unsigned
  XDR) or submit mode (body has `signedXdr` → submits + polls).
- **`POST /v1/dids/stellar/{did}/update`** — update; requires
  `expectedVersion`. (Renamed from `PATCH /v1/dids/stellar/{did}` in
  the `[Unreleased]` entry above.)
- **`POST /v1/dids/stellar/{did}/transfer`** — transfer
  controller; requires `expectedVersion` + `newController`.
- **`POST /v1/dids/stellar/{did}/deactivate`** — irreversible.
- **`POST /v1/dids/stellar/submit`** — submit any signed XDR.
- **Typed error envelope** — every error response is shaped
  `{ code, message, details? }` with `code` from the same
  `DidErrorCode` union the SDK exports. Branches on `code`,
  never on `message`.
- **Per-IP rate limit** — fixed window via `cache.incr` +
  `EXPIRE NX`. Emits `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, `Retry-After`. Defaults: 120 req /
  60 s. Fails open on cache errors — a degraded rate limiter
  MUST NOT drop legitimate resolver traffic.
- **Request correlation** — `X-Request-ID` echoed in and out,
  attached to every log line via `pino-http`. Honours upstream
  proxies.
- **Structured logging** via `pino` + `pino-http`. Custom log
  level by response status (`error` for 5xx, `warn` for 4xx,
  `info` otherwise). Redacts `authorization` and `cookie`
  headers.
- **CORS** allow-list configurable via `CORS_ORIGINS`. Default
  `*` — resolver traffic comes from arbitrary verifier scripts.
- **Hardening** — `helmet` baseline, `trust proxy`, 64 KB JSON
  body cap, content-type validation.
- **Graceful shutdown** on `SIGTERM` / `SIGINT` with a 10 s
  hard kill so pods die promptly on rolling deploys.

#### Build / packaging

- Multi-stage `Dockerfile` — `node:22.22.1-bookworm-slim` for
  build, deploy stage runs as `uid 10001` (`useradd
  --system`), no root, `HEALTHCHECK` calling `/health` every
  30s.
- TypeScript `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`.
- Workspace dep on `@acta-team/did-stellar` via
  `workspace:*` so changes to the SDK surface immediately.

#### Tested

- 39 tests covering:
  - `loadConfig`: env parsing, defaults, validation,
    mainnet-without-contract-id rejection.
  - `InMemoryCache`: get/set/incr + TTL.
  - `httpFromDidError` / `httpFromUnknown`: every
    `DidErrorCode` → HTTP status mapping.
  - `supertest` integration: health, openapi, malformed
    DID, network mismatch, content negotiation (`did+ld+json`
    vs `did+json`), submit with bad XDR, rate limit (X-RateLimit
    headers + 429 + Retry-After), request-id propagation,
    404 envelope for unknown routes.

---

## Examples

### `examples/smoke-testnet`

End-to-end smoke test against the live `did-stellar-registry`
testnet contract.

#### Added

- 7-step runbook (`src/smoke.ts`):
  1. Generate a fresh 128-bit `didId`.
  2. Mint an Ed25519 authentication keypair.
  3. Prepare `register` XDR (Soroban simulate).
  4. Sign locally with `STELLAR_SECRET_KEY`.
  5. Submit and poll until confirmation.
  6. Resolve via `resolveDidStellar` (W3C/DIF result).
  7. Read raw `DidRecord` via `getLedgerEntries`.
- The script never logs, persists, or transmits the secret
  key. It reads `process.env.STELLAR_SECRET_KEY` once to
  build a `Keypair`, then discards it.
- Friendly diagnostics: on `DidError`, prints `code`,
  `message`, `details` so a failure is debuggable without
  jumping into source.
- README covering prerequisites (testnet wallet, friendbot
  fallback), the run command in PowerShell and bash, the
  expected output, troubleshooting table, and what the script
  does NOT prove.

#### Run

```bash
$env:STELLAR_SECRET_KEY="S..."         # PowerShell
export STELLAR_SECRET_KEY="S..."        # bash
pnpm --filter @examples/smoke-testnet smoke
```

---

## Documentation

### `docs/`

#### Added

- `docs/README.md` — index of operational docs, navigation by
  audience (contributor, integrator, deployer, SCF auditor).
- `docs/example/running-the-smoke-test.md` — full runbook for
  `examples/smoke-testnet`. When to run it, what it proves,
  prerequisites, step-by-step, reading the output, post-run
  consequences (DID is on-chain forever), troubleshooting,
  cost, plus a template for adding new smoke scripts.

Per-package `README.md` and `CHANGELOG.md` are kept inside
their packages and linked from `docs/README.md`.

---

## Tooling / infra

### Monorepo

- `pnpm` workspaces + `Turborepo` for build/test/lint caching.
- Single shared `tsconfig.base.json` with strict TypeScript
  options. Each package extends with `rootDir`/`outDir` and
  the relevant `module` setting.
- Shared `eslint.config.mjs` enforcing
  `@typescript-eslint/no-explicit-any: error`,
  `consistent-type-imports`, `no-floating-promises`,
  `no-misused-promises`, `require-await`, plus stricter rules
  for tests.
- `prettier` + `editorconfig` for formatting.
- Workspace globs: `packages/*`, `examples/*`.

### CI

- `.github/workflows/ci.yml` runs on every push and pull
  request to `main` / `dev`. Steps: pnpm install, lint,
  typecheck, test, build, `pnpm audit --audit-level=high
  --prod`. Pinned Node version via `.nvmrc`.

### Conventions

- Cross-package boundary respected: nothing in `packages/api/`
  imports from `packages/resolver/src/...` — only from the
  package's public `@acta-team/did-stellar` exports. This
  makes the SDK genuinely substitutable.
- All public types are `readonly`. Object literals frozen
  where the value is shared (`DEFAULT_RPC_URLS`, etc.).
- Errors are thrown as `DidError`, never as plain `Error`,
  outside of `Error` subclasses for env / config which
  surface before the logger exists.
- React, Redis, axios are all peer / optional / lazy:
  - `react` is a peer of the resolver package's `./hooks`
    subpath only.
  - `ioredis` is dynamically imported inside the API only
    when `REDIS_URL` is configured.
  - `axios` is a direct dep of the resolver (used only by
    `ActaDidClient`); resolver consumers that don't use the
    HTTP client pay nothing thanks to tree-shaking.

---

## Notes and known limitations

- **Mainnet is not supported in this release.** The default
  mainnet registry contract ID is intentionally blank
  (`DEFAULT_REGISTRY_CONTRACT_IDS.mainnet === ''`); calling
  `resolveDidStellar` with a `mainnet` DID without explicitly
  passing `registryContractId` throws `contract_id_invalid`.
  Mainnet deployment is the **Bloque E** milestone and will
  populate the constant.
- **Only `register` exercised against the live contract so
  far.** `update`, `transferController`, `deactivate` are
  implemented, fully tested with unit mocks, and gated by the
  same `expectedVersion` flow, but no smoke test runs them
  against testnet yet. Adding
  `examples/smoke-update`, `examples/smoke-deactivate`, and
  `examples/smoke-proof-of-control` is the next planned
  contribution. None of those exercises require code changes
  in the SDK or the API — only orchestrator scripts.
- **DIF `did-resolver` integration not exercised in a smoke
  test yet.** The `getResolver()` driver is unit-tested
  against the DIF function signature, but a real
  `new Resolver({ ...getResolver() })` integration script has
  not been run. Planned alongside the missing smoke scripts.
- **Docker image not yet built in CI.** The `Dockerfile`
  exists and has been validated by inspection; the actual
  `docker build && push` happens in **Bloque E** when the
  service first deploys to `did.acta.build`.

---

## Roadmap (post-0.1.0)

| Bloque | Description | Status |
|---|---|---|
| **D** | `acta-api` (credentials API) alignment with the new SDK. Most work landed in commit `30566e5` of the `acta-api` repo; only a smoke test against testnet credentials remains. | Mostly done |
| **E** | Mainnet Release Candidate: deploy `did-stellar-registry` to mainnet with a multisig admin, stand up `did.acta.build` (DNS + hosting + Docker), open the PR to [`decentralized-identity/universal-resolver`](https://github.com/decentralized-identity/universal-resolver) listing the driver. | Pending |
| **F** | Issuer onboarding documentation: a step-by-step "zero to verifiable credential" doc that registers a DID, authorises an issuer on the vault, and issues a VC signed by the DID's `assertionMethod` key. | Pending |

---

[0.1.0]: https://github.com/ACTA-Team/did-stellar/releases/tag/v0.1.0
