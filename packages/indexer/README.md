# `@acta-team/did-stellar-indexer`

Reverse index for `did:stellar` - answers **"which DIDs does this wallet
control?"**, the one question the registry contract deliberately does not.

Powers `GET /v1/dids/stellar?controller=G...&network=testnet` on
[`did.acta.build`](https://did.acta.build).

---

## The problem

A Stellar account can control several `did:stellar` identifiers, and that
is the point: the method spec recommends one DID per relying party so a
holder cannot be correlated across contexts (§7.2, §8.3).

The registry contract stores `did_id → record` and nothing else. There is
no `controller → dids` mapping on-chain, so today an application's only
memory of a user's DID is whatever it wrote to that browser's
`localStorage`. That fails in three ordinary situations:

| Situation                                                    | What happens today                                        |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| User clears the browser, or opens the app on a second device | The app sees no DID and offers to create one              |
| User visits a partner dApp with the same wallet              | The partner creates its own DID, unaware of the first     |
| Either of the above, repeatedly                              | Each orphaned DID keeps its credentials on-chain, forever |

The bug is not that several DIDs exist. It is that they get created
**unintentionally**, because there is no way to look up the ones that
already exist.

## Why not fix it in the contract

1. An on-chain index costs extra storage and an extra write on every
   `register` and `transfer_controller` - charging every caller for what
   is an interface problem.
2. The data is already published, in the events the contract emits for
   exactly this purpose.
3. The contract is deployed on mainnet and testnet, and the method spec
   is normative.

So the index lives off-chain and is rebuilt from the event stream.

---

## How it works

```
                  ┌──────────────────────── syncNetwork() ───────────┐
Soroban RPC       │  getEvents(contractId) → decode → reduce → store │
  getEvents ──────┤                                                  │
                  └──────────────────────────────────────────────────┘
                                        │
                  ┌───────────────────── reconcile() ────────────────┐
Soroban RPC       │  getLedgerEntries(keys) → authoritative record   │
  getLedgerEntries┤  → repair / drop rows                            │
                  └──────────────────────────────────────────────────┘
                                        │
                            listDidsByController()
```

**Ingestion** (`syncNetwork`) walks `getEvents` for the registry contract
and folds four events into the projection:

| Event                        | Effect on the index                                   |
| ---------------------------- | ----------------------------------------------------- |
| `did_registered`             | Creates the row: controller, version, `createdLedger` |
| `did_controller_transferred` | Moves the DID to `new_controller`                     |
| `did_deactivated`            | Marks the row `deactivated: true` - it stays listed   |
| `did_updated`                | Bumps the version                                     |

The reducer is pure, idempotent and order-safe, so replaying a page after
a crash is a no-op and a late event cannot roll a row backwards.

**Reconciliation** (`reconcile`) reads the authoritative `DidRecord`
straight from persistent storage in one batched `getLedgerEntries` and
overwrites the projection. It is the correctness backstop, and it fixes
what events alone cannot:

- a DID registered _before_ the RPC retention window (its later events
  carry no controller - reconciliation supplies it);
- a `transfer_controller` lost to a crash or an RPC gap;
- a DID whose storage entry no longer exists.

### About the backfill and RPC retention

Soroban RPC keeps a rolling window of events - the public SDF endpoints
report roughly a week through `getHealth().oldestLedger`. **There is no
way to walk the whole chain from `getEvents` alone.**

That is not a minor gap. On a low-traffic production contract the window
is routinely _empty_, and then the index answers "this wallet holds
nothing" for every wallet. It happened on mainnet: three DIDs registered
between 2026-06-30 and 2026-08-03, a seven-day window, and therefore an
index that reported nothing at all no matter how often it restarted.

Three mechanisms cover the three different ways a DID can be missing.

| Mechanism                       | Reads                                       | Fixes                                                                                                                      |
| ------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap (`discover.ts`)       | Archival contract history                   | A DID whose `DidRegistered` aged out and that has not mutated since. This is the only one that can **discover** such a DID |
| Event sync (`ingest.ts`)        | `getEvents`, retention-bound                | Everything current                                                                                                         |
| Reconciliation (`reconcile.ts`) | `getLedgerEntries`, **not** retention-bound | Wrong or missing state on a DID the index already knows about                                                              |

Only the bootstrap closes the discovery gap: reconciliation is
authoritative about a DID's _contents_ but can only confirm or prune
candidates the index has already heard of.

#### The bootstrap, and what it does and does not trust

On a network with no cursor yet, `DidIndexer.start()` reads the
contract's whole event history from an archival index (StellarExpert by
default), then **re-reads every DID it found off the ledger** through the
normal `reconcile` path before the endpoint is served.

That second step is the point. The archival source supplies _candidate
`didId`s_ and nothing else that survives: every controller in the index
came from a `getLedgerEntries` read, and any DID the ledger does not
corroborate is dropped. A wrong or hostile response can only make the
index miss DIDs, which is exactly the failure it exists to prevent.

It never blocks startup either. If the source is unreachable the indexer
logs a warning, reports `bootstrap: "failed"` in `/health`, and falls
back to the RPC window - degraded in precisely the way it was before.

Set `DID_INDEX_BOOTSTRAP=off` to disable it, or `DID_INDEX_BOOTSTRAP_URL`
to point at a mirror or a local archival service of the same shape. If
you would rather not depend on a third party at all, run against an
archival RPC with `DID_INDEX_START_LEDGER_*` set to the contract's deploy
ledger and turn the bootstrap off.

---

## Usage

### Embedded in the API (default)

Nothing to configure. `did-stellar-api` runs the indexer in-process with
an in-memory store and rebuilds the index on boot.

### Standalone worker + Postgres / Supabase

Right as soon as there is more than one API replica: one worker writes,
every replica reads.

```bash
# 1. Apply the schema (or let the worker create it on boot)
psql "$DATABASE_URL" -f packages/indexer/sql/001_did_index.sql

# 2. Run the worker
DID_INDEX_DATABASE_URL=postgres://... pnpm --filter @acta-team/did-stellar-indexer start

# 3. Point the API at the same database, read-only
DID_INDEX_DATABASE_URL=postgres://... DID_INDEX_MODE=external pnpm --filter did-stellar-api start
```

### On Railway

The repo already deploys `did-stellar-api` from `railway.toml` at the root.
Two ways to get the index there:

**Nothing to deploy (default).** The API embeds the indexer, so the
existing service already answers the endpoint. It rebuilds an in-memory
index on every boot and only works with a single instance. Fine to start
with; nothing to configure.

**A second Railway service, once you want durability or replicas.** In the
same Railway project:

1. **Add Postgres.** `New -> Database -> Add PostgreSQL`. Railway exposes
   it as `DATABASE_URL`, which the indexer already falls back to, so you
   can also just reference it: `DID_INDEX_DATABASE_URL=${{Postgres.DATABASE_URL}}`.
2. **Add the worker service.** `New -> GitHub Repo`, same repo, then set
   _Settings -> Config-as-code_ to `packages/indexer/railway.toml`. That
   file points at `packages/indexer/Dockerfile` and pins the service to one
   replica, which is what a single-writer index wants. Leave it with no
   public domain: the worker serves no HTTP.
3. **Flip the API to read-only.** On the API service set
   `DID_INDEX_MODE=external` and the same `DID_INDEX_DATABASE_URL`. Now the
   worker writes and every API replica reads.

The schema is created on boot, so step 1 needs no migration. Apply
`sql/001_did_index.sql` yourself and set `DID_INDEX_PG_SKIP_SCHEMA=true` if
the service role has no DDL grant.

Use the **private** connection string (`${{Postgres.DATABASE_PRIVATE_URL}}`)
rather than the public one: the traffic stays inside the project and is not
billed as egress. Railway's private network is not up the instant a
container is, so the first connect can fail with `ENOTFOUND` while nothing
is wrong. That is handled - `init()` retries transient connection failures
over about eight seconds, and the API keeps retrying the whole start with a
backoff after that - but it is why `/health` reports `index.startError`
rather than only logging it. A configuration error (bad credentials, no DDL
grant) is not retried; it surfaces immediately.

If the index never comes up, `/health` shows `ready: false` with the reason
in `index.startError`. The endpoint still answers `200` on purpose: making
it fail would make the platform's healthcheck restart a container whose
HTTP surface is fine, and the resolver routes do not depend on the index.

| Service               | Config file                     | Public domain | Replicas            |
| --------------------- | ------------------------------- | ------------- | ------------------- |
| `did-stellar-api`     | `railway.toml`                  | yes           | as many as you want |
| `did-stellar-indexer` | `packages/indexer/railway.toml` | no            | exactly 1           |

Both build with the repo root as the Docker context, which is what the
multi-stage Dockerfiles expect.

Two things to know. The worker has no healthcheck path because it listens
on nothing; Railway keeps it alive through `restartPolicyType`, and
ingestion state is visible in the API's `/health` under `index`. And do not
scale the worker past one replica: several writers would each walk the same
pages and contend on the same cursor row for no gain. Scale the API
instead.

### As a library

```ts
import { DidIndexer, MemoryIndexStore, listDidsByController } from '@acta-team/did-stellar-indexer';

const store = new MemoryIndexStore();
const indexer = new DidIndexer({
  store,
  networks: {
    testnet: {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      registryContractId: 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ',
    },
  },
});

await indexer.start(); // backfills, then polls every 10s

const { dids, verified } = await listDidsByController({
  store,
  network: 'testnet',
  controller: 'GA46UJYF6ULGOW7O52RDJTNURP76SR3C3LB2IEZ7LVFDB2QWA2KEVTKX',
});
```

---

## Configuration

Every variable is optional. Defaults give a working in-memory index on
both networks using the SDK's canonical registries.

| Variable                                     | Default                           | What it does                                                                                       |
| -------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `DID_INDEX_ENABLED`                          | `true`                            | `false` disables the index and the endpoint (501)                                                  |
| `DID_INDEX_MODE`                             | `embedded`                        | `external` = read-only; a separate worker writes                                                   |
| `DID_INDEX_DATABASE_URL`                     | -                                 | Postgres/Supabase URL. Unset ⇒ in-memory store                                                     |
| `DATABASE_URL`                               | -                                 | Fallback for the above                                                                             |
| `DID_INDEX_PG_SCHEMA`                        | `public`                          | Schema for the two tables                                                                          |
| `DID_INDEX_PG_SKIP_SCHEMA`                   | `false`                           | Skip `CREATE TABLE` (schema under migration control)                                               |
| `DID_INDEX_PG_SSL`                           | auto                              | TLS without cert verification. Auto-on for `supabase.` hosts                                       |
| `DID_INDEX_POLL_SECONDS`                     | `10`                              | Seconds between event polls (~2 ledger closes)                                                     |
| `DID_INDEX_RECONCILE_SECONDS`                | `900`                             | Seconds between sweeps. `0` disables the sweep                                                     |
| `DID_INDEX_RECONCILE_BATCH`                  | `500`                             | DIDs visited per sweep                                                                             |
| `DID_INDEX_VERIFY_ON_READ`                   | `true`                            | Confirm every listing against the ledger before answering                                          |
| `DID_INDEX_BOOTSTRAP`                        | `auto`                            | Seed from the contract's full history. `auto` = only when a network has no cursor; `always`; `off` |
| `DID_INDEX_BOOTSTRAP_URL`                    | StellarExpert                     | Archival contract-events index to bootstrap from                                                   |
| `DID_INDEX_RPC_URL_{TESTNET,MAINNET}`        | falls back to `STELLAR_RPC_URL_*` | RPC for ingestion. Use an archival endpoint for a deep backfill                                    |
| `DID_INDEX_START_LEDGER_{TESTNET,MAINNET}`   | RPC `oldestLedger`                | First ledger to backfill from, clamped to retention                                                |
| `DID_REGISTRY_CONTRACT_ID_{TESTNET,MAINNET}` | SDK defaults                      | Registry contract to index                                                                         |

### `verifyOnRead`

On (the default), every listing is confirmed against the ledger in one
batched `getLedgerEntries` before the response goes out - so `version`,
`deactivated` and the controller are exactly what the contract holds,
even if a transfer event has not been ingested yet. It costs one RPC
round-trip per request regardless of how many DIDs the wallet holds.

Turn it off for a read-heavy deployment that can tolerate a few seconds
of lag. Verification can only confirm or prune DIDs the index already
knows about; discovering new ones is the backfill's job.

---

## Storage

Two tables, created on boot or from
[`sql/001_did_index.sql`](./sql/001_did_index.sql):

**`did_stellar_index`** - one row per `(network, did_id)`

| Column                                                       | Notes                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `network`                                                    | `mainnet` \| `testnet`                                           |
| `did_id`                                                     | 26-char base32                                                   |
| `controller`                                                 | **nullable** - unknown until reconciliation, for pre-window DIDs |
| `version`, `deactivated`, `created_ledger`, `updated_ledger` | Mirrors the on-chain record                                      |
| `last_event_id`, `last_event_ledger`                         | Ordering guard that makes writes idempotent                      |

**`did_stellar_index_cursor`** - one row per network: RPC paging token
plus the ledger range covered.

The index mirrors public blockchain data, so the migration enables RLS
with a read-anyone policy; writes belong to the indexer's service role.

---

## Tests

```bash
pnpm --filter @acta-team/did-stellar-indexer test
```

Event fixtures are built as real `ScVal`s in the exact shape soroban-sdk's
`#[contractevent]` emits (`topics = [Symbol(snake_case(StructName))]`,
data as an `ScMap` of the struct fields), so the decoder is tested against
the wire format rather than against a mock of itself.

## License

Apache-2.0
