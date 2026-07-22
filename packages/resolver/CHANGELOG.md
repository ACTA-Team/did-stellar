# Changelog

All notable changes to `@acta-team/did-stellar` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1]

### Security

- The direct `axios` dependency moves from `^1.15.2` to `^1.18.0`, clearing
  [GHSA-gcfj-64vw-6mp9](https://github.com/advisories/GHSA-gcfj-64vw-6mp9)
  (high). A matching `pnpm.overrides` entry in the monorepo root is required
  as well, because `@stellar/stellar-sdk` pins `axios` to an exact `1.16.1`
  and would otherwise pull a second, vulnerable copy into the tree.

### Added

- `DEFAULT_REGISTRY_CONTRACT_IDS.mainnet` is now populated with the mainnet
  `did-stellar-registry` (`CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ`,
  v0.2.0), so `resolveDidStellar`, `readDidRecord`, and the `prepare*Xdr`
  helpers work on mainnet without an explicit `registryContractId` override.
  Published 0.1.0 shipped an empty mainnet default, which raised
  "no default registry contract is configured for network mainnet".

## [0.1.0]

First public release. Implements the full `did:stellar` v0.1 method
surface against `did-stellar-registry` v0.1.0 (testnet contract
`CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ`).

### Added

- **Identifier primitives** — `generateDidId`, `encodeDidId`,
  `decodeDidId`, `buildDidStellar`, `parseDidStellar`, `isValidDidStellar`,
  `DID_STELLAR_REGEX`.
- **Multikey codec** — `decodeMultikey`, `encodeMultikey`,
  `detectCurve` (Ed25519 + X25519, multibase base58btc).
- **DidRecord** — TypeScript types (`DidRecord`, `DidRecordInput`,
  `DidKey`, `DidService`), client-side validator
  (`validateDidRecordInput`, mirrors the contract's `validate_record`),
  ScVal encoder/decoder, and direct `readDidRecord` against Stellar
  RPC `getLedgerEntries`.
- **DID Document builder** — `buildDidDocument` + `buildTombstone`
  produce W3C DID Core 1.1 compliant documents matching spec vectors
  A.1–A.3 byte-for-byte.
- **Resolver** — `resolveDidStellar` (direct RPC) and `getResolver`
  (DIF `did-resolver` driver).
- **Prepare / submit** — `prepareRegisterDidXdr`,
  `prepareUpdateDidXdr`, `prepareTransferControllerXdr`,
  `prepareDeactivateDidXdr`, `submitSignedXdr`.
- **Proof of control** — `jcsCanonicalize` (RFC 8785),
  `buildChallenge`, `verifyProofOfControl` with timestamp + nonce +
  domain checks per spec §6.5 / §7.5.
- **HTTP client** — optional `ActaDidClient` for [`did.acta.build`](https://did.acta.build).
- **React hook** — `useDid()` exposed via `./hooks` subpath.
- **Typed errors** — `DidError` + `DidErrorCode` covering every
  `RegistryError` plus transport and client-side codes.
- **Branded primitives** — `Url`, `Hex32` for compile-time safety
  around validated strings.

### Tests

- Spec vectors A.1 / A.2 / A.3 against the DID Document builder.
- Unit tests for identifier, base32, multikey, JCS, record validation,
  contract error mapping, proof-of-control happy paths and every
  spec-mandated rejection (timestamp window, domain mismatch, nonce
  reuse, tombstone).

### Notes

- Trust-minimised: the resolver hot path does not call any
  ACTA-hosted service. A Stellar RPC URL is sufficient.
- Does NOT publish from this branch automatically — `npm provenance`
  publish only fires from a tagged release in `main`.
