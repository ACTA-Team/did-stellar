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

## Validation rules

The config is parsed and validated at startup. The process exits with
a descriptive error message if any value is invalid:

- `NETWORK_TYPE` must be exactly `mainnet` or `testnet`. No aliases (`pubnet`, `public`).
- `PORT`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`, `RESOLVER_CACHE_TTL_SECONDS` must be positive integers.
- `LOG_LEVEL` must be one of the six pino levels.
- `DID_REGISTRY_CONTRACT_ID` is **required** when `NETWORK_TYPE=mainnet` (no mainnet default exists yet).
- `STELLAR_RPC_URL` must start with `http://` or `https://`. When it starts with `http://`, the service automatically sets `allowHttp: true` for the Stellar SDK.

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
```
