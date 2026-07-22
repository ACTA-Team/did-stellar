# Changelog

All notable changes to the [`did.acta.build`](https://did.acta.build) HTTP resolver service are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release. Implements every endpoint described in
[`TRANCHE_2_PLAN.md`](../../../TRANCHE_2_PLAN.md) §4.

### Added (multi-network)

- The service is now **multi-network**: a single deployment serves both
  `testnet` and `mainnet`, routing each request by the network embedded in the
  `did:stellar:{network}:...` identifier (resolver, raw-record and lifecycle
  routes alike). For submit-only requests with no DID in the path
  (`POST /v1/dids/stellar/submit` and register-submit), the body must include
  `network: "testnet" | "mainnet"`.
- Config is per-network (`config.networks[network]`): `DID_REGISTRY_CONTRACT_ID_TESTNET`
  / `_MAINNET` and `STELLAR_RPC_URL_TESTNET` / `_MAINNET`, each falling back to
  the SDK default. The legacy single-network envs (`NETWORK_TYPE`,
  `DID_REGISTRY_CONTRACT_ID`, `STELLAR_RPC_URL`) remain honoured as a fallback
  for the named network, so existing deployments keep working.
- A request for a network without a configured registry returns a clean error
  (`501` on resolve, `network_invalid` on mutations) instead of querying the
  wrong contract.
- `GET /health` and the OpenAPI `x-acta` block now report both networks.

### Added (container distribution)

- The service is published as the public container image
  `ghcr.io/acta-team/driver-did-stellar:0.1.0` (`linux/amd64` +
  `linux/arm64`), built from this package's `Dockerfile` with the repo root as
  context. Published by `.github/workflows/docker.yml` on release.
- The image runs with **no configuration**: with no env vars set, both
  networks fall back to the SDK's default registry contract IDs and RPC URLs,
  so `docker run -p 8080:8080 ghcr.io/acta-team/driver-did-stellar:0.1.0`
  serves `GET /1.0/identifiers/{did}` immediately. This is a requirement for
  the DIF Universal Resolver, which runs the driver in its own cluster without
  ACTA-specific secrets.

### Added

- **`GET /health`** — liveness probe; no external calls.
- **`GET /openapi.json`** — inline OpenAPI 3.1 spec for every endpoint.
- **`GET /1.0/identifiers/{did}`** — DIF Universal Resolver-compatible
  W3C resolver. Content negotiation between
  `application/did+ld+json` (default) and `application/did+json`. `410
  Gone` for tombstone documents. Cached for
  `RESOLVER_CACHE_TTL_SECONDS` (default 30) in Redis or in-memory.
- **`GET /v1/dids/stellar/{did}`** — raw on-chain `DidRecord`.
- **`POST /v1/dids/stellar`** — register, prepare or submit mode.
- **`POST /v1/dids/stellar/{did}/update`** — update, prepare or submit
  mode (requires `expectedVersion`). Renamed from `PATCH
  /v1/dids/stellar/{did}` so every mutation follows the same
  `POST /…/{action}` pattern and the URL is self-describing in Swagger.
- **`POST /v1/dids/stellar/{did}/transfer`** — transfer controller.
- **`POST /v1/dids/stellar/{did}/deactivate`** — irreversible deactivation.
- **`POST /v1/dids/stellar/submit`** — submit any signed XDR.
- **Typed error envelope** — every error response is
  `{ code, message, details? }`. `code` matches the SDK's `DidErrorCode`.
- **Per-IP rate limiting** (sliding-window via Redis `INCR` or
  in-memory). Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `Retry-After`. Defaults: 120 req/min.
- **Request correlation** — `X-Request-ID` header echoed in/out and
  attached to every log line.
- **Structured logging** via `pino` + `pino-http`.
- **CORS** allow-list configurable via `CORS_ORIGINS` (default `*` —
  resolver traffic comes from arbitrary verifier scripts).
- **Hardening** — `helmet` baseline, `trust proxy`, 64 KB JSON body cap.
- **Graceful shutdown** on `SIGTERM` / `SIGINT` with a 10s hard kill.
- **Multi-stage Dockerfile** — non-root user, distroless runtime
  intent (Bookworm slim for now until distroless ships Node 22),
  `HEALTHCHECK` pointing at `/health`.

### Configuration

Environment-driven. See [`.env.example`](./.env.example). No external
state required for development; Redis recommended for production.

### Notes

- No authentication: spec §1.4 / §9.5 mandates trust-minimisation.
- No key custody: the service never accepts secret keys, only
  unsigned/signed XDRs.
- Stateless: every instance is interchangeable. Scale horizontally
  behind a load balancer; share Redis if rate-limiting consistency
  matters.
