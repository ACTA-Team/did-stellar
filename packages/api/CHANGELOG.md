# Changelog

All notable changes to the [`did.acta.build`](https://did.acta.build) HTTP resolver service are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — Unreleased

First public release. Implements every endpoint described in
[`TRANCHE_2_PLAN.md`](../../../TRANCHE_2_PLAN.md) §4.

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
