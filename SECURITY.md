# Security Policy

`did:stellar` is a [W3C-registered DID method](https://www.w3.org/TR/did-extensions-methods/).
This repository holds its reference implementation: the
`@acta-team/did-stellar` SDK and the `did-stellar-api` HTTP resolver that
backs [`did.acta.build`](https://did.acta.build) and the
[DIF Universal Resolver](https://dev.uniresolver.io/) driver.

Third parties run this code in their own infrastructure. We treat reports
against it accordingly.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `@acta-team/did-stellar` 0.1.x | :white_check_mark: |
| `did-stellar-api` 0.1.x / `driver-did-stellar` 0.1.x | :white_check_mark: |
| Anything older / unpublished pre-releases | :x: |

The method specification is at `v0.1`. While it stays there, the latest
`0.1.x` line of each package is the only supported one — we patch forward, not
backward. When `0.2.0` ships, `0.1.x` receives security fixes for 90 days
after that release.

If you run the driver from a container, `ghcr.io/acta-team/driver-did-stellar`
is only supported at its most recent tag. Pinned older digests do not receive
patches.

## Scope

**In scope**

- Resolution returning a DID Document that does not match on-chain state
- A deactivated (tombstoned) DID resolving as active, or the reverse
- Proof-of-control verification accepting a challenge it should reject —
  replay outside the ±5 minute window, wrong `domain`, wrong `nonce`, or
  signatures from a key not in `authentication`
- Identifier generation producing predictable or colliding `didId` values
- Errors in the prepare/submit XDR helpers that could cause a user to sign a
  transaction other than the one they intended
- Injection, SSRF, or unauthenticated resource exhaustion in the HTTP resolver
- Anything letting a party other than a DID's controller alter it

**Out of scope**

- Vulnerabilities in the Soroban contract itself — report those against
  [contracts-acta](https://github.com/ACTA-Team/contracts-acta), which holds
  the `did-stellar-registry`
- Denial of service against public Stellar RPC endpoints, which we do not
  operate
- Missing rate limits on a self-hosted deployment configured without them
- Design properties documented in
  [`docs/method/did-stellar-method.md`](./docs/method/did-stellar-method.md),
  such as DID Documents being public and unencrypted by design
- Advisories in development-only dependencies with no path to published or
  deployed code

If you are unsure whether something is in scope, report it. We would rather
triage a non-issue than miss a real one.

## Reporting a Vulnerability

**Do not open a public issue for a security report.**

Use GitHub's private reporting:
[**Report a vulnerability**](https://github.com/ACTA-Team/did-stellar/security/advisories/new)

If you cannot use that form, email **acta.xyz@gmail.com** with `SECURITY` in
the subject.

Please include:

- The affected component and version — SDK, HTTP resolver, or container image
- Steps to reproduce, ideally with a concrete DID and network (`testnet` is
  preferred for examples)
- What an attacker gains, in your own assessment
- Any proof-of-concept you have

### What happens next

| Stage | Timeline |
| ----- | -------- |
| We acknowledge your report | Within **3 business days** |
| We confirm or reject it, with reasoning | Within **10 business days** |
| Fix released for a confirmed critical or high | Target **30 days** from confirmation |
| Fix released for moderate or low | Target **90 days** from confirmation |

You will get an update at each stage, and at least once every two weeks while
a report stays open — including when the answer is still "we are working on
it".

**If we accept the report:** we develop the fix in a private advisory, credit
you by the name or handle you choose (or keep you anonymous, your call), and
publish a GitHub Security Advisory when the patched version ships. You are
welcome to review the fix before release.

**If we decline it:** we tell you why in writing. If you disagree, reply — we
will look again. A rejection is not a request for silence.

### Disclosure

We ask for **90 days** before public disclosure, or until a patched version
ships, whichever comes first. If we go quiet or miss the timelines above, you
are free to disclose sooner; we will not ask otherwise.

Because the DIF Universal Resolver runs this driver, a confirmed
resolution-correctness issue will also be reported upstream to
[DIF](https://github.com/decentralized-identity/universal-resolver) once a fix
is available.

## Trust model

Read [`docs/method/did-stellar-method.md`](./docs/method/did-stellar-method.md)
before reporting. Two properties are intentional and frequently mistaken for
bugs:

- **The resolver is trust-minimised.** It reads Stellar RPC and the registry
  contract, holds no keys, and requires no credentials. Anyone can run it and
  get identical results. It is not an authority, and does not need to be
  trusted for correctness.
- **`verify_vc` is a status signal, not proof of authenticity.** It answers
  "is this credential active, revoked or expired", not "is this credential
  genuine". Authenticity comes from the issuer's signature.

## Security practices

- Dependencies are monitored by Dependabot; `pnpm audit` runs in CI
- The container image is published with provenance and SBOM attestations, and
  a release is blocked unless the pushed image boots and answers both
  `/health` and `GET /1.0/identifiers/{did}`
- Contributions require a [DCO 1.1](https://developercertificate.org/)
  sign-off, so provenance stays auditable
