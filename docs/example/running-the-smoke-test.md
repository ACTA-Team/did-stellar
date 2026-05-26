# Running the testnet smoke test

The package [`examples/smoke-testnet`](../examples/smoke-testnet) is a
runnable end-to-end test that exercises every code path of the SDK
against the **live** `did-stellar-registry` contract on Stellar testnet.

It is the only test in this repository that crosses the network. The
unit suites (`pnpm test`) cover encoding, decoding, validation and
business logic in isolation; the smoke test proves they line up with
what the real contract returns.

## When to run it

| Situation | Run the smoke test? |
|---|---|
| Before opening a PR that changes anything under `packages/resolver/src/record/`, `prepare/`, or `resolver/` | **Yes** |
| Before tagging a release of `@acta-team/did-stellar` | **Yes** |
| Before deploying a new version of [`did.acta.build`](https://did.acta.build) | **Yes** |
| You bumped `@stellar/stellar-sdk` | **Yes** — SDK shape changes have caused regressions before |
| You only touched docs / tests / CI / lint config | No |
| You only touched `packages/api/src/middleware/`, `lib/`, `routes/health.ts` | No — those are infra around the SDK, not against the contract |

## What it proves

When the script exits with `✅ Smoke test passed`, you have just
demonstrated, against real on-chain state:

| Code path | Validated by |
|---|---|
| `prepareRegisterDidXdr` builds a syntactically valid Soroban invocation | Step 3 — Soroban `simulate` would reject a malformed value |
| The `DidRecord` ScVal layout matches the contract's `#[contracttype]` struct | Step 3 — the contract's deserialiser accepts the bytes |
| The signed XDR is submittable end-to-end | Step 5 — transaction reaches `SUCCESS` state |
| The registry persists the record at `version: 1` | Step 5 — confirmed in `getTransaction` response |
| `readDidRecord` decodes `getLedgerEntries` correctly | Step 7 — record values match what was registered |
| `resolveDidStellar` produces a W3C-compliant DID Document | Step 6 — `@context`, `verificationMethod`, fragment refs all correct |
| The optimistic concurrency `version` field starts at `1` and `deactivated` at `false` | Step 7 |

The script also leaves a permanent, publicly verifiable record:
the registered DID is resolvable forever (subject to storage TTL
extension, which is automatic on every read or update) by anyone
in the world who has the contract ID.

## Prerequisites

### 1. A funded Stellar testnet account

You need a Stellar `G...` account on testnet with at least a few XLM.
Two options:

**Option A — reuse an existing testnet wallet**
You already have a `G...` / `S...` pair. Skip to step 2.

**Option B — generate a fresh one**
From the monorepo root:

```powershell
node -e "const k = require('@stellar/stellar-sdk').Keypair.random(); console.log('PUBLIC:', k.publicKey()); console.log('SECRET:', k.secret());"
```

Copy both keys. Then fund the account once with friendbot
(10,000 testnet XLM, free):

```powershell
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
```

### 2. Node.js + pnpm installed

The repo pins Node `>=22.22.0 <25` and pnpm `>=9 <11`. Check:

```powershell
node --version
pnpm --version
```

If you don't have pnpm, enable Corepack: `corepack enable`.

### 3. Workspace dependencies installed

From the monorepo root:

```powershell
pnpm install
```

This installs the SDK, the example's deps, and links the example to
the in-tree SDK via the `workspace:*` protocol.

## Run

Export your **testnet secret key** as an environment variable and
invoke the smoke script.

**PowerShell:**

```powershell
$env:STELLAR_SECRET_KEY="S...your-testnet-secret..."
pnpm --filter @examples/smoke-testnet smoke
```

**bash / WSL:**

```bash
export STELLAR_SECRET_KEY="S...your-testnet-secret..."
pnpm --filter @examples/smoke-testnet smoke
```

### Key handling

The script never logs, prints, persists or transmits
`STELLAR_SECRET_KEY`. It reads the env var once at startup, builds a
Stellar `Keypair` in memory, signs the unsigned XDR, and drops the
keypair when the process exits.

`STELLAR_SECRET_KEY` is consumed by the script via `process.env`. It
is NOT used by the API service (the API never has key custody — keys
are wallet responsibility per spec §1.4). When you're done, clear the
env var if you don't want it lingering in the shell session:

```powershell
Remove-Item Env:STELLAR_SECRET_KEY
```

## Reading the output

The script prints seven banner-separated steps. Each step is a
checkpoint; the next runs only if the previous succeeded.

### Pre-flight

```
controller (your wallet): G...
network:                  testnet
rpcUrl:                   https://soroban-testnet.stellar.org
registryContractId:       CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ
```

Confirms env config. `controller` MUST match the public key of the
secret you exported — if it doesn't, you copied the wrong key.

### Step 1 — Generate fresh didId

```
didId: <26 base32 lowercase chars>
did:   did:stellar:testnet:<didId>
```

CSPRNG output. Each run produces a fresh DID.

### Step 2 — Mint Ed25519 authentication keypair

```
authentication[0].publicKeyMultibase: z6Mk...
```

A separate Ed25519 keypair used as the DID's authentication key.
In production a wallet would persist this key; the script discards
it, since the goal is purely to register a valid record.

### Step 3 — Prepare register XDR (Soroban simulate)

```
xdr (unsigned, head): AAAA…
network:              testnet
networkPassphrase:    Test SDF Network ; September 2015
```

**If you see this output, the SDK's ScVal encoder is correct.**
Soroban's `simulate` runs the contract's `register` method
end-to-end against the prepared payload; a malformed value would
return `ScErrors::ContractType` and the script would exit here.

### Step 4 — Sign with controller secret

```
xdr (signed, head):   AAAA…
```

The transaction envelope is signed locally with the `STELLAR_SECRET_KEY`
keypair.

### Step 5 — Submit and poll

```
txId: <hex>
view in Stellar Lab: https://stellar.expert/explorer/testnet/tx/<hex>
```

The signed XDR is submitted via `sendTransaction`. The script polls
`getTransaction` until the status reaches `SUCCESS` (timeout: 30s).
Click the explorer URL to inspect the on-chain transaction —
that's your public proof.

### Step 6 — Resolve via resolveDidStellar()

A complete `DidResolutionResult` JSON object:

```json
{
  "didDocument": {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1"
    ],
    "id": "did:stellar:testnet:...",
    "verificationMethod": [{ ... }],
    "authentication": ["did:stellar:testnet:...#auth-1"],
    "assertionMethod": [],
    "keyAgreement": [],
    "service": []
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false,
    "method": {
      "network": "testnet",
      "stellarAccount": "G..."
    }
  },
  "didResolutionMetadata": {
    "contentType": "application/did+ld+json"
  }
}
```

This is exactly what a verifier or the DIF Universal Resolver
would receive. The `didDocument.id` must match the DID printed in
Step 1; `didDocumentMetadata.method.stellarAccount` is your wallet
surfaced as informational metadata (the document is self-controlled
per spec §5.3 and does NOT publish a top-level `controller` field).

### Step 7 — Read raw DidRecord (via getLedgerEntries)

The on-chain struct decoded directly, no W3C transformation:

```json
{
  "controller": "G...",
  "authentication": [{ "publicKeyMultibase": "z6Mk..." }],
  "assertionMethod": [],
  "keyAgreement": [],
  "services": [],
  "version": 1,
  "createdLedger": <ledger>,
  "updatedLedger": <ledger>,
  "deactivated": false
}
```

This is the **literal contract storage** decoded into TypeScript. Use
it when you need `version` for an optimistic-concurrency update, or
when you want to confirm the controller without parsing the W3C
metadata path.

### Final summary

```
─────────────────────── ✅ Smoke test passed ───────────────────────
  Encoder ScVal + Soroban simulate ........ OK
  Sign locally + submit + poll ............ OK
  Resolver (getLedgerEntries + decode) .... OK
  W3C DID Document builder ................ OK

Resolve from Postman:
  GET http://localhost:8080/1.0/identifiers/did:stellar:testnet:<your-fresh-did>
  GET http://localhost:8080/v1/dids/stellar/did:stellar:testnet:<your-fresh-did>
```

Copy that DID into Postman / the API / your wallet — it's
permanent on testnet.

## After a successful run

The DID you just registered is real, on-chain, and resolvable by
anyone who points the SDK or the API at the testnet registry. Things
you can do with it:

| Action | Command / endpoint |
|---|---|
| Resolve via the API locally | `GET http://localhost:8080/1.0/identifiers/<did>` |
| Resolve via the SDK | `await resolveDidStellar('<did>')` |
| Read the raw record | `GET http://localhost:8080/v1/dids/stellar/<did>` |
| See it on stellar.expert | Click the link printed in Step 5 |
| Update it | (requires another script — `update` mutation, not yet automated) |
| Resolve via `dev.uniresolver.io` | Once `did.acta.build` is deployed and listed upstream |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `STELLAR_SECRET_KEY is not set` | Env var missing or not exported in the same shell as the run | Re-export in the same terminal; PowerShell uses `$env:NAME="..."`, bash uses `export NAME="..."` |
| `STELLAR_SECRET_KEY is not a valid Stellar secret (S...)` | Wrong key format. Stellar secrets start with `S` and are 56 chars. You probably pasted the public key (`G...`) | Paste the secret key, not the public one |
| `Account ... was not found` during Step 3 | The controller wallet has never been funded on testnet | `curl "https://friendbot.stellar.org?addr=<G_PUBLIC_KEY>"` |
| Step 3 fails with `tx_simulation_failed` | Either the SDK ScVal encoder drifted from the contract layout, or the RPC is having a bad day | Re-run once. If persistent, the SDK has a bug — diagnose with the `details` field the script prints |
| Step 5 fails after 30s | Network congestion, fee too low, or RPC issue | Re-run. Defaults are conservative; this is almost always transient |
| Step 5 returns `did_already_exists` | The same `didId` was registered before. Statistically impossible with CSPRNG bytes — file a bug | — |
| Step 6 fails with `expected scvMap for DidRecord, got contractData` | The reader hasn't been rebuilt after a code change | `pnpm --filter @acta-team/did-stellar run build` then re-run |
| Step 7 returns `null` | TTL extension failed and the record was archived (extremely unlikely on testnet) | Re-register |

## Cost

**Testnet runs are free.** Stellar testnet XLM has no monetary value;
the friendbot mints 10,000 XLM per funded account, and each smoke
run consumes a handful of stroops. You can safely run the script
hundreds of times without exhausting the balance.

**Mainnet runs are not free.** Each `register` consumes inclusion
fee + Soroban resource fee + storage rent. Order of magnitude: a
few cents in XLM per DID at typical fee floors. **Do not point the
script at mainnet without explicit intent** — the script is hardcoded
to `testnet` precisely to prevent accidents. To run against mainnet
you would need to fork the script and adjust the `NETWORK` constant.

## Adding more smoke tests

The current script only exercises `register`. The other mutation
flows (`update`, `transferController`, `deactivate`) and the
`proof-of-control` verification are written and unit-tested but
have not been exercised against the live contract. Following the
same pattern as `smoke.ts`, you can add:

- `examples/smoke-update/` — read current `version`, prepare an
  update with a new key, verify `version` becomes `2`.
- `examples/smoke-deactivate/` — deactivate the DID, verify the
  resolver returns `410 Gone` + tombstone document.
- `examples/smoke-proof-of-control/` — emit a challenge, sign it
  with the authentication key, verify via `verifyProofOfControl`.

Each is roughly 50 lines; the existing `smoke.ts` is a working
template.
