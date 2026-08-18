# API Reference — `did.acta.build`

> **Live URL**: [`did.acta.build`](https://did.acta.build)
> **Swagger UI**: [`did.acta.build/docs`](https://did.acta.build/docs)
> **OpenAPI spec**: [`did.acta.build/openapi.json`](https://did.acta.build/openapi.json)
> **Source**: [`packages/api/`](../../packages/api/)
> **Auth**: None (trust-minimised)

## Base URL

```
https://did.acta.build
```

## Endpoints

### `GET /health`

Liveness probe. Does not call Stellar RPC or Redis.

**Response** `200`:
```json
{
  "status": "ok",
  "service": "did-stellar-api",
  "method": "did:stellar",
  "networks": {
    "testnet": "CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ",
    "mainnet": "CD6LSWW5ZSXOO5WAIHKQLQ262TW7BPI37PNEVMMA273BAPC65NN2AYXQ"
  },
  "startedAt": "2026-05-26T00:00:00.000Z",
  "index": {
    "mode": "embedded",
    "store": "memory",
    "ready": true,
    "networks": [
      {
        "network": "testnet",
        "configured": true,
        "dids": 3,
        "firstLedger": 4077775,
        "lastLedger": 4198736,
        "syncedAt": "2026-08-18T01:14:05.675Z",
        "lastError": null
      }
    ]
  }
}
```

`index` is `null` when the reverse index is disabled. A lagging or failed
index never changes `status` - the resolver endpoints do not depend on it.

---

### `GET /openapi.json`

Full OpenAPI 3.1 specification of every endpoint.

---

### `GET /1.0/identifiers/{did}` — DID Resolver

DIF Universal Resolver compatible endpoint.

**Content negotiation** (via `Accept` header):
- `application/did+ld+json` (default) — full document with `@context`
- `application/did+json` — same document without `@context`

**Caching**: 30 seconds (Redis or in-memory). Controlled by `RESOLVER_CACHE_TTL_SECONDS`.

**Response `200`** (active DID):
```json
{
  "didDocument": {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      "https://w3id.org/security/multikey/v1"
    ],
    "id": "did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi",
    "verificationMethod": [
      {
        "id": "did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi#auth-1",
        "type": "Multikey",
        "controller": "did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi",
        "publicKeyMultibase": "z6MkwBw2szL21i4Ym1wqzV8bPWwJyp1WDt8oRofTEs9ZntSq"
      }
    ],
    "authentication": ["did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi#auth-1"],
    "assertionMethod": [],
    "keyAgreement": [],
    "service": []
  },
  "didDocumentMetadata": {
    "versionId": "1",
    "deactivated": false,
    "method": {
      "network": "testnet",
      "stellarAccount": "GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M"
    }
  },
  "didResolutionMetadata": {
    "contentType": "application/did+ld+json"
  }
}
```

**Response `400`** — invalid DID syntax:
```json
{
  "didDocument": null,
  "didDocumentMetadata": { "versionId": "" },
  "didResolutionMetadata": { "error": "invalidDid", "message": "..." }
}
```

**Response `404`** — DID not registered on-chain.

**Response `410`** — deactivated DID (tombstone document with empty arrays).

**Response `502`** — Stellar RPC unreachable.

---

### `GET /v1/dids/stellar` - DIDs by controller (reverse index)

Lists every DID a Stellar address currently controls.

A wallet may hold several `did:stellar` identifiers on purpose - the
method spec recommends one DID per relying party so a holder cannot be
correlated across contexts (§7.2, §8.3). The registry contract stores only
`did_id → record`, so this listing is served from an off-chain index
rebuilt from the contract's event stream
(see [`packages/indexer/`](../../packages/indexer/)).

**Query parameters** (both required):

| Name | Type | Description |
|---|---|---|
| `controller` | `G...` account or `C...` contract | The address holding the DIDs |
| `network` | `mainnet` \| `testnet` | Which network to list. The same address controls different DIDs on each |

**Semantics**

- Deactivated DIDs are **included**, flagged `deactivated: true`.
- A DID moved by `transfer_controller` is reported under its **new**
  controller only.
- A wallet with no DIDs returns `200` with `dids: []` - never `404`.
- Results are ordered by `createdLedger`, then `didId`.

**Response `200`**:
```json
{
  "controller": "GA46UJYF6ULGOW7O52RDJTNURP76SR3C3LB2IEZ7LVFDB2QWA2KEVTKX",
  "network": "testnet",
  "count": 2,
  "dids": [
    {
      "did": "did:stellar:testnet:43imozsjua5w7wcaum5a4hev4q",
      "didId": "43imozsjua5w7wcaum5a4hev4q",
      "version": 1,
      "deactivated": false,
      "createdLedger": 4081007,
      "updatedLedger": 4081007
    },
    {
      "did": "did:stellar:testnet:3argppyl4haefk62url2mwvyvq",
      "didId": "3argppyl4haefk62url2mwvyvq",
      "version": 1,
      "deactivated": false,
      "createdLedger": 4081065,
      "updatedLedger": 4081065
    }
  ],
  "index": {
    "verified": true,
    "fromLedger": 4077775,
    "toLedger": 4198736,
    "syncedAt": "2026-08-18T01:14:05.675Z"
  }
}
```

**The `index` block** describes the freshness of the answer:

| Field | Meaning |
|---|---|
| `verified` | `true` when every listed DID was confirmed against the ledger before responding (`DID_INDEX_VERIFY_ON_READ`, on by default). Then `version`, `deactivated` and the controller are exactly what the contract holds |
| `fromLedger` | First ledger the index ingested events from |
| `toLedger` | Last ledger the index has ingested |
| `syncedAt` | When the last successful sync finished |

**Error responses**

| Status | `code` | When |
|---|---|---|
| `400` | `controller_required` | `controller` was not supplied |
| `400` | `controller_invalid` | Not a valid `G...` / `C...` address |
| `400` | `network_invalid` | `network` missing, or not `mainnet` / `testnet` |
| `501` | `index_unavailable` | The index is disabled (`DID_INDEX_ENABLED=false`) |
| `501` | `network_unavailable` | No registry configured for that network |
| `503` | `index_warming` | The initial backfill has not finished. Sent with `Retry-After: 5`. Answering from a half-built index would under-report a wallet - which is exactly what makes an app mint a duplicate DID |

**Coverage caveat.** Soroban RPC retains events for a rolling window
(~1 week on the public endpoints). The backfill ingests everything the
RPC still has; DIDs registered before that window become visible once
they emit any event, at which point reconciliation reads the
authoritative record off the ledger. For a complete index from a
contract's first ledger, run the indexer against an archival RPC with
`DID_INDEX_START_LEDGER_*`. See
[`packages/indexer/README.md`](../../packages/indexer/README.md).

---

### `GET /v1/dids/stellar/{did}` — Raw DidRecord

Returns the on-chain record without W3C document wrapping. Useful for
reading `version` before an update or inspecting `controller` directly.

**Response `200`**:
```json
{
  "did": "did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi",
  "didId": "znfxngsh46vkyqu6inrx4omphi",
  "record": {
    "controller": "GCVRCDEQYWRJVUGKMVXBRF45EX2SMZOLCT5IZN2KK6ILU7I3FZ64O36M",
    "authentication": [{ "publicKeyMultibase": "z6MkwBw2..." }],
    "assertionMethod": [],
    "keyAgreement": [],
    "services": [],
    "version": 1,
    "createdLedger": 2661630,
    "updatedLedger": 2661630,
    "deactivated": false
  }
}
```

**Response `400`** — `did_invalid` or `network_invalid`.

**Response `404`** — `did_not_found`.

---

### `POST /v1/dids/stellar` — Register DID

**Prepare mode** (returns unsigned XDR):

```json
{
  "did": "did:stellar:testnet:...",
  "sourcePublicKey": "G...",
  "record": {
    "controller": "G...",
    "authentication": [{ "publicKeyMultibase": "z6Mk..." }],
    "assertionMethod": [],
    "keyAgreement": [],
    "services": []
  }
}
```

**Response `200`**:
```json
{
  "xdr": "AAAA...",
  "network": "testnet",
  "networkPassphrase": "Test SDF Network ; September 2015"
}
```

**Submit mode** (submits signed XDR):

```json
{ "signedXdr": "AAAA...signed..." }
```

**Response `200`**:
```json
{ "txId": "9c3234a8..." }
```

**Error responses**: `400` (validation), `409` (`did_already_exists`), `502` (RPC failure).

---

### `POST /v1/dids/stellar/{did}/update` — Update DID

**Prepare mode**:
```json
{
  "expectedVersion": 1,
  "sourcePublicKey": "G...",
  "record": { ... }
}
```

Requires `expectedVersion` to match on-chain. Returns `409 version_mismatch` if stale.

> **Naming note:** previous versions exposed this as
> `PATCH /v1/dids/stellar/{did}`. It was renamed to
> `POST /v1/dids/stellar/{did}/update` so every mutation follows the
> same `POST /…/{action}` pattern and Swagger UI shows distinct URLs
> per operation.

---

### `POST /v1/dids/stellar/{did}/transfer` — Transfer controller

**Prepare mode**:
```json
{
  "expectedVersion": 1,
  "newController": "G...new-wallet...",
  "sourcePublicKey": "G...current-controller..."
}
```

---

### `POST /v1/dids/stellar/{did}/deactivate` — Deactivate (irreversible)

**Prepare mode**:
```json
{
  "expectedVersion": 2,
  "sourcePublicKey": "G..."
}
```

After deactivation, the DID resolves as a tombstone (`410 Gone`).

---

### `POST /v1/dids/stellar/submit` — Submit signed XDR

Submit any signed XDR (register, update, transfer, or deactivate):

```json
{ "signedXdr": "AAAA...signed..." }
```

**Response `200`**: `{ "txId": "..." }`

**Response `502`**: `{ "code": "tx_submission_failed", "message": "..." }`

---

## Error envelope

Every error response uses the same shape:

```json
{
  "code": "version_mismatch",
  "message": "human-readable description",
  "details": { ... }
}
```

`code` is a stable string from the `DidErrorCode` union — same codes
the SDK throws. See [`error-codes.md`](./error-codes.md) for the full table.

---

## Response headers

| Header | Present on | Purpose |
|---|---|---|
| `X-Request-ID` | Every response | Correlation ID (echoes inbound header or generates UUID) |
| `X-RateLimit-Limit` | Every response | Max requests per window |
| `X-RateLimit-Remaining` | Every response | Remaining requests |
| `Retry-After` | `429` responses | Seconds until the window resets |
| `Content-Type` | Resolver responses | `application/did+ld+json` or `application/did+json` |

---

## Rate limiting

Default: **120 requests per 60 seconds** per IP address.

When exceeded, response is `429`:
```json
{ "code": "rate_limited", "message": "Rate limit exceeded: 120 requests per 60s" }
```

Configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_SECONDS`.
See [`configuration.md`](./configuration.md).
