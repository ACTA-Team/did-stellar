# `did-stellar` — Documentation

Operational and developer documentation for the `did:stellar` v0.1
implementation in this monorepo.

For the **normative method specification** see
[`contracts-acta/docs/did-spec/did-stellar-v0.1.md`](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md).
For per-package documentation see each package's `README.md`:

- [`packages/resolver/README.md`](../packages/resolver/README.md) — the SDK
- [`packages/api/README.md`](../packages/api/README.md) — the HTTP service (`did.acta.build`)

## Index by audience

**You're an integrator and want to use the SDK**
→ [`packages/resolver/README.md`](../packages/resolver/README.md)

**You're deploying the HTTP service**
→ [`packages/api/README.md`](../packages/api/README.md) + the `Dockerfile`

**You're auditing the work for SCF / a security review**
→ read the SDK and contract source, then verify on-chain via [`did.acta.build`](https://did.acta.build)
