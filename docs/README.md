# `did-stellar` — Documentation

Operational and developer documentation for the `did:stellar` v0.1
implementation in this monorepo.

For the **normative method specification** see
[`contracts-acta/docs/did-spec/did-stellar-v0.1.md`](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md).
For per-package documentation see each package's `README.md`:

- [`packages/resolver/README.md`](../packages/resolver/README.md) — the SDK
- [`packages/api/README.md`](../packages/api/README.md) — the HTTP service

## Contents

### `example/` — runnable demos

| Doc | When to read |
|---|---|
| [`example/running-the-smoke-test.md`](./example/running-the-smoke-test.md) | You want to validate the SDK + contract integration against the live `did-stellar-registry` on testnet. Run this before any release. |

## Index by audience

**You're a contributor and want to verify your changes don't break anything**
→ [`example/running-the-smoke-test.md`](./example/running-the-smoke-test.md)

**You're an integrator and want to learn how to use the SDK**
→ start with [`packages/resolver/README.md`](../packages/resolver/README.md), then read `examples/smoke-testnet/src/smoke.ts` as a working reference

**You're deploying the HTTP service**
→ [`packages/api/README.md`](../packages/api/README.md) + the `Dockerfile`

**You're auditing the work for SCF / a security review**
→ run the smoke test (it produces a public Stellar transaction as proof), then read the SDK and contract source
