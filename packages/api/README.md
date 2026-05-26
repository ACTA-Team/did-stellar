# `did-stellar-api`

Standalone HTTP service for the [`did:stellar`](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md)
v0.1 method. Thin wrapper around
[`@acta-team/did-stellar`](../did-stellar): the SDK does the work, this
service exposes it as HTTP for non-JS consumers and for the
[DIF Universal Resolver](https://dev.uniresolver.io/).

| | |
|---|---|
| **Distribution** | Docker image `ghcr.io/acta-team/did-stellar-api` |
| **Default port** | `8080` |
| **Auth** | **None** — trust-minimised per spec §1.4 / §9.5 |
| **State** | Stateless. Optional Redis for cache + rate-limit |
| **Method spec** | [`did:stellar` v0.1](https://github.com/ACTA-Team/contracts-acta/blob/main/docs/did-spec/did-stellar-v0.1.md) |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe (no external calls). |
| `GET` | `/openapi.json` | OpenAPI 3.1 spec of every endpoint below. |
| `GET` | `/1.0/identifiers/{did}` | **DIF Universal Resolver entry point.** Returns the W3C DID Document. Content-negotiates `application/did+ld+json` (default) and `application/did+json`. `410 Gone` for tombstones. |
| `GET` | `/v1/dids/stellar/{did}` | Raw `DidRecord` (no document wrapper). |
| `POST` | `/v1/dids/stellar` | Register a DID. Prepare mode (body has `did`, `record`, `sourcePublicKey`) or submit mode (body has `signedXdr`). |
| `PATCH` | `/v1/dids/stellar/{did}` | Update — requires `expectedVersion`. |
| `POST` | `/v1/dids/stellar/{did}/transfer` | Transfer controller — requires `expectedVersion` + `newController`. |
| `POST` | `/v1/dids/stellar/{did}/deactivate` | **Irreversible.** Requires `expectedVersion`. |
| `POST` | `/v1/dids/stellar/submit` | Submit any signed XDR. |

Every error response shares the envelope:

```json
{ "code": "version_mismatch", "message": "...", "details": { ... } }
```

The `code` is the same as the SDK's `DidErrorCode`. Branch on `code`,
never on `message`.

## Configuration

See [`.env.example`](./.env.example). Defaults are sane for testnet
development; production deployments SHOULD pin `NETWORK_TYPE`,
`STELLAR_RPC_URL` and `DID_REGISTRY_CONTRACT_ID`. Mainnet requires the
contract ID explicitly until Bloque E lands.

## Run locally

```bash
pnpm install
pnpm --filter did-stellar-api run dev
# → http://localhost:8080
curl http://localhost:8080/health
curl 'http://localhost:8080/1.0/identifiers/did:stellar:testnet:aaaqeayeaudaocajbifqydiob4'
```

## Docker

```bash
# Build
docker build -t did-stellar-api -f packages/api/Dockerfile .
# Run
docker run --rm -p 8080:8080 \
  -e NETWORK_TYPE=testnet \
  did-stellar-api
```

The image is multi-stage, runs as a non-root user (`uid 10001`), and
ships a `HEALTHCHECK` calling `/health`.

## Trust model

This service intentionally has **no authentication**. Anyone can resolve
a `did:stellar:...`, and anyone can build an unsigned XDR — the
contract itself is the gatekeeper via `controller.require_auth()`. The
HTTP layer never holds, sees, or proxies private keys.

If the service is offline, every consumer that imports
`@acta-team/did-stellar` directly continues to work against the
Stellar RPC. The service is a convenience, not a single point of
failure.

## License

MIT
