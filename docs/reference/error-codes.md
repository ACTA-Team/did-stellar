# Error Codes

Complete table of all `DidErrorCode` values. Every error thrown by the
SDK or returned by `did.acta.build` carries one of these codes. Branch
on `code`, never on `message`.

Source: `packages/resolver/src/errors.ts`

## Contract registry errors

These mirror the `RegistryError` enum in the `did-stellar-registry`
Soroban contract (values 1–20):

| Code | Contract # | HTTP | Meaning |
|---|---|---|---|
| `did_already_exists` | 1 | 409 | `register` called for a `didId` that already has a record |
| `did_not_found` | 2 | 404 | Mutation attempted on an unknown DID |
| `version_mismatch` | 3 | 409 | `expectedVersion` does not match on-chain `version` |
| `did_deactivated` | 4 | 410 | Mutation attempted on a deactivated DID |
| `invalid_auth_key_count` | 5 | 400 | `authentication` count outside [1, 3] |
| `invalid_assertion_key_count` | 6 | 400 | `assertionMethod` count exceeds 3 |
| `invalid_key_agreement_count` | 7 | 400 | `keyAgreement` count exceeds 1 |
| `invalid_service_count` | 8 | 400 | `services` count exceeds 3 |
| `duplicate_key` | 9 | 400 | Same `publicKeyMultibase` appears twice (within or across relationships) |
| `key_too_long` | 10 | 413 | `publicKeyMultibase` exceeds 128 chars |
| `key_empty` | 11 | 400 | `publicKeyMultibase` is empty string |
| `service_type_too_long` | 12 | 413 | `serviceType` exceeds 64 chars |
| `service_id_too_long` | 13 | 413 | `idSuffix` exceeds 32 chars |
| `service_id_invalid_format` | 14 | 400 | `idSuffix` doesn't match `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` |
| `service_endpoint_invalid` | 15 | 400 | `serviceEndpoint` is not `https://` or exceeds 255 chars |
| `metadata_uri_invalid` | 16 | 400 | `metadataUri` is not `https://` or exceeds 255 chars |
| `no_proposed_admin` | 17 | 404 | `accept_admin` called with no active proposal |
| `service_type_empty` | 18 | 400 | `serviceType` is empty string |
| `version_overflow` | 19 | 410 | `version` reached `u32::MAX` (theoretical) |
| `metadata_inconsistent` | 20 | 400 | `metadataHash` present but `metadataUri` absent |

## Client-side validation errors

Raised by the SDK before any network call:

| Code | HTTP | Meaning |
|---|---|---|
| `did_invalid` | 400 | DID string doesn't match `^did:stellar:(mainnet\|testnet):[a-z2-7]{26}$` |
| `did_id_invalid` | 400 | `didId` component is malformed (wrong length, invalid chars) |
| `network_invalid` | 400 | Network is not `mainnet` or `testnet` |
| `controller_invalid` | 400 | Not a valid Stellar `G...` address |
| `multibase_invalid` | 400 | Not a valid `z<base58>` multibase string |
| `multikey_unsupported` | 400 | Multicodec prefix is not Ed25519 or X25519, or raw key is not 32 bytes |
| `contract_id_invalid` | 500 | Registry contract ID is not a valid `C...` strkey |
| `rpc_url_invalid` | 500 | RPC URL is empty or doesn't start with `http://` / `https://` |
| `expected_version_required` | 400 | `expectedVersion` is missing or less than 1 |

## Proof of Control errors

| Code | HTTP | Meaning |
|---|---|---|
| `challenge_invalid` | 400 | Challenge object is malformed (bad DID, bad timestamp format) |
| `challenge_expired` | 400 | `timestamp` outside the ±5 minute window |
| `challenge_nonce_invalid` | 400 | Nonce has been reused (per the `isNonceFresh` callback) |
| `challenge_domain_mismatch` | 400 | `challenge.domain` doesn't match the verifier's expected domain |
| `signature_invalid` | 400 | No `authentication` key verified the signature |

## Transport errors

| Code | HTTP | Meaning |
|---|---|---|
| `rpc_error` | 502 | `getLedgerEntries` call to Stellar RPC failed |
| `tx_simulation_failed` | 502 | Soroban `simulateTransaction` failed |
| `tx_submission_failed` | 502 | `sendTransaction` or polling failed |
| `http_error` | 502 | `ActaDidClient` HTTP request failed |
| `unknown` | 400 | Generic fallback (usually malformed request body) |
