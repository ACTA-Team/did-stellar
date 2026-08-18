# Configuration — `did.acta.build`

Every setting is configured via environment variables. All variables
are optional in development (sane defaults for testnet). Production
deployments should pin `NETWORK_TYPE`, `STELLAR_RPC_URL` and
`DID_REGISTRY_CONTRACT_ID`.

Source: `packages/api/src/config.ts` + `packages/api/.env.example`

## Environment variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | integer | `8080` | HTTP listen port. Railway sets this automatically. |
| `NETWORK_TYPE` | `mainnet` \| `testnet` | `testnet` | Which Stellar network to resolve against. No aliases accepted. |
| `DID_REGISTRY_CONTRACT_ID` | string | Testnet: `CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ` | Override the `did-stellar-registry` contract ID. **Required for mainnet** (no default is configured yet). |
| `STELLAR_RPC_URL` | string | Testnet: `https://soroban-testnet.stellar.org`, Mainnet: `https://mainnet.sorobanrpc.com` | Stellar Soroban RPC endpoint. Can point to a private pool or balancer. |
| `REDIS_URL` | string | (unset) | Redis connection URL. When set, the resolver cache and rate-limit counters use Redis (shared across replicas). When unset, both degrade to per-process in-memory. |
| `RESOLVER_CACHE_TTL_SECONDS` | integer | `30` | How long resolved DID Documents are cached. Set to `0` to disable caching. |
| `RATE_LIMIT_MAX` | integer | `120` | Maximum requests per IP per window. |
| `RATE_LIMIT_WINDOW_SECONDS` | integer | `60` | Duration of the rate-limit window in seconds. |
| `CORS_ORIGINS` | string | `*` | Comma-separated list of allowed origins, or `*` for any origin. |
| `LOG_LEVEL` | string | `info` | Pino log level. One of: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `NODE_ENV` | string | `development` | One of: `development`, `production`, `test`. In `production`, logs are JSON lines (no pretty-print). |

## Reverse index (`controller → DIDs`)

Powers [`GET /v1/dids/stellar`](./api-reference.md). Enabled by default
with an in-memory store, so a bare deployment answers the endpoint with
no extra infrastructure. Full details in
[`packages/indexer/README.md`](../../packages/indexer/README.md).

| Variable | Type | Default | Description |
|---|---|---|---|
| `DID_INDEX_ENABLED` | boolean | `true` | `false` disables the index; the endpoint answers `501`. Resolver endpoints are unaffected. |
| `DID_INDEX_MODE` | `embedded` \| `external` | `embedded` | `embedded` ingests events in the API process. `external` makes the API read-only against a store a separate `did-stellar-indexer` worker writes. Required with more than one replica. |
| `DID_INDEX_DATABASE_URL` | string | (unset) | Postgres / Supabase URL. Unset ⇒ in-memory store, rebuilt on every boot. Falls back to `DATABASE_URL`. |
| `DID_INDEX_PG_SCHEMA` | string | `public` | Schema holding `did_stellar_index` and `did_stellar_index_cursor`. |
| `DID_INDEX_PG_SKIP_SCHEMA` | boolean | `false` | Skip `CREATE TABLE` on boot - for a service role with no DDL grant. |
| `DID_INDEX_PG_SSL` | boolean | auto | TLS without certificate verification. Auto-enabled for `supabase.` hosts, whose poolers terminate TLS at a proxy. |
| `DID_INDEX_POLL_SECONDS` | integer | `10` | Seconds between event polls (~2 ledger closes). |
| `DID_INDEX_RECONCILE_SECONDS` | integer | `900` | Seconds between background ledger reconciliation sweeps. `0` disables the sweep. |
| `DID_INDEX_RECONCILE_BATCH` | integer | `500` | DIDs visited per sweep. |
| `DID_INDEX_VERIFY_ON_READ` | boolean | `true` | Confirm every listing against the ledger (one batched `getLedgerEntries`) before responding. |
| `DID_INDEX_RPC_URL_TESTNET` / `_MAINNET` | string | falls back to `STELLAR_RPC_URL_*` | RPC used for ingestion. Point at an archival endpoint for a backfill deeper than the public retention window. |
| `DID_INDEX_START_LEDGER_TESTNET` / `_MAINNET` | integer | RPC `oldestLedger` | First ledger to backfill from, clamped to what the RPC retains. |

Booleans accept `1/true/yes/on` and `0/false/no/off`; anything else falls
back to the default rather than failing startup.

### Store behavior

| `DID_INDEX_DATABASE_URL` | Store | Backfill cost | Replicas |
|---|---|---|---|
| Unset | In-memory `Map` | Re-walks the RPC retention window on every boot | One only - nothing shares the index |
| Set | Postgres / Supabase | Once, then resumes from the stored cursor | Many readers, one writer (`DID_INDEX_MODE=external`) |

## Validation rules

The config is parsed and validated at startup. The process exits with
a descriptive error message if any value is invalid:

- `NETWORK_TYPE` must be exactly `mainnet` or `testnet`. No aliases (`pubnet`, `public`).
- `PORT`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `RESOLVER_CACHE_TTL_SECONDS` must be positive integers.
- `LOG_LEVEL` must be one of the six pino levels.
- `DID_REGISTRY_CONTRACT_ID` is **required** when `NETWORK_TYPE=mainnet` (no mainnet default exists yet).
- `STELLAR_RPC_URL` must start with `http://` or `https://`. When it starts with `http://`, the service automatically sets `allowHttp: true` for the Stellar SDK.
- `DID_INDEX_POLL_SECONDS`, `DID_INDEX_RECONCILE_BATCH` and `DID_INDEX_START_LEDGER_*` must be positive integers; `DID_INDEX_RECONCILE_SECONDS` must be non-negative (`0` disables the sweep).

## Redis behavior

| REDIS_URL | Resolver cache | Rate limit |
|---|---|---|
| Set and reachable | Redis (`SET ... EX ttl`) | Redis (`INCR` + `EXPIRE NX`) — shared across replicas |
| Set but unreachable | Falls back to in-memory, logs error | **Fails open** — requests pass through without rate limiting |
| Unset | Per-process `Map` with lazy expiry | Per-process `Map` with lazy expiry |

The rate limiter **always fails open** on cache errors: a degraded
rate limiter must not drop legitimate resolver traffic.

## Example `.env`

```bash
PORT=8080
NETWORK_TYPE=testnet
DID_REGISTRY_CONTRACT_ID=CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
RESOLVER_CACHE_TTL_SECONDS=30
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_SECONDS=60
CORS_ORIGINS=*
LOG_LEVEL=info

# Reverse index - defaults shown; omit the whole block to accept them.
DID_INDEX_ENABLED=true
DID_INDEX_MODE=embedded
DID_INDEX_POLL_SECONDS=10
DID_INDEX_VERIFY_ON_READ=true
# DID_INDEX_DATABASE_URL=postgres://user:pass@host:5432/db
```
