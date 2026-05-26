# `@examples/smoke-testnet`

End-to-end smoke test against the canonical `did-stellar-registry`
contract on Stellar testnet (`CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ`).

Runs the full lifecycle:

1. Generate a fresh 16-byte `didId`.
2. Mint a fresh Ed25519 authentication keypair.
3. Prepare the `register` XDR via the SDK (Soroban simulate).
4. Sign locally with your controller secret key.
5. Submit and poll until confirmation.
6. Resolve the new DID (W3C / DIF shape).
7. Read the raw on-chain `DidRecord`.

If all 7 steps pass, the three "untested against the live contract"
risks called out in the SDK README are closed:

- **ScVal encoder** for `DidRecord` matches the contract layout
  (proved by step 3 — simulate would reject a malformed value).
- **Prepare → sign → submit** pipeline works end-to-end (steps 3–5).
- **`getLedgerEntries` reader** decodes the on-chain record back into
  the SDK's typed `DidRecord` (step 7).

## Prerequisites

A funded Stellar **testnet** account.

If you don't have one yet, generate a keypair and fund it once with
friendbot:

```powershell
node -e "const k = require('@stellar/stellar-sdk').Keypair.random(); console.log('PUBLIC:', k.publicKey()); console.log('SECRET:', k.secret());"
curl "https://friendbot.stellar.org?addr=<PUBLIC>"
```

## Run

From the **monorepo root** (`C:\Projects\ACTA\did-stellar`):

```powershell
$env:STELLAR_SECRET_KEY="S...your-testnet-secret..."
pnpm --filter @examples/smoke-testnet smoke
```

Or bash:

```bash
export STELLAR_SECRET_KEY="S...your-testnet-secret..."
pnpm --filter @examples/smoke-testnet smoke
```

The script never logs or persists `STELLAR_SECRET_KEY`. It uses it
once to construct a `Keypair`, signs the XDR, and discards it when
the process exits.

## Expected output

A banner-separated transcript ending with:

```
─────────────────────── ✅ Smoke test passed ───────────────────────
  Encoder ScVal + Soroban simulate ........ OK
  Sign locally + submit + poll ............ OK
  Resolver (getLedgerEntries + decode) .... OK
  W3C DID Document builder ................ OK

Resolve from Postman:
  GET http://localhost:8080/1.0/identifiers/did:stellar:testnet:<fresh-didId>
  GET http://localhost:8080/v1/dids/stellar/did:stellar:testnet:<fresh-didId>
```

Copy the DID into your Postman `did` variable and re-run the resolver
requests. You'll now get `200 OK` with a populated `didDocument`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `STELLAR_SECRET_KEY is not set` | Forgot the env var. |
| `Account ... was not found` during prepare | Wallet not funded. Re-run friendbot. |
| `did_already_exists` (#1) | Same `didId` was registered before. The script generates random bytes, so this is statistically impossible in practice — investigate. |
| `tx_simulation_failed` | Usually a contract-layout drift. Diagnose with the `details` field printed by the script. |
| `tx_submission_failed` after a long wait | Network congestion or a stale fee. Re-run; the script polls up to 30s. |

## What this does NOT prove

- Mutation paths beyond `register` (`update`, `transfer_controller`,
  `deactivate`). Those are mirror flows; add follow-up scripts when
  you want to exercise them.
- Mainnet behaviour. The script is hard-coded to `testnet`.
- Long-running RPC fluctuations. Single-shot, no retries.
