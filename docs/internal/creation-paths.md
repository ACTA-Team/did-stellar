# Caminos para crear un DID

> Tres formas de crear un `did:stellar`. **Todas producen DIDs
> igualmente válidos.** La diferencia es ergonomía, no legitimidad.

---

## Los tres caminos

### 1. `@acta-team/credentials` (acta-sdk) — el camino fácil

El SDK se encarga de todo. El integrador no piensa en keys, codificación
Multikey ni llamadas al contrato.

La primera vez que un integrador llama `acta.issueCredential(...)`, el SDK:

1. Detecta que todavía no hay un DID de issuer
2. Genera un par de llaves Ed25519 por debajo
3. Guarda la llave privada localmente (IndexedDB en browser, keystore en Node)
4. Registra el DID on-chain usando las primitivas de `did-stellar`
5. Firma la VC con la assertion key
6. Emite la VC a través de `acta-api`

**Una línea de código. Cero conocimiento de DIDs requerido.**

```ts
import { ActaClient } from '@acta-team/credentials';

const acta = new ActaClient({ apiKey: '...', network: 'mainnet' });
await acta.issueCredential({ subject: 'G...', claims: { ... } });
```

### 2. `@acta-team/did-stellar` (did-stellar) — primitivas directas

El integrador maneja el flujo manualmente. Genera las llaves, prepara
el XDR, firma, submitea.

```ts
import {
  generateDidId,
  encodeMultikey,
  prepareRegisterDidXdr,
  submitSignedXdr,
} from '@acta-team/did-stellar';
import * as ed25519 from '@noble/ed25519';

const priv = ed25519.utils.randomPrivateKey();
const pub  = await ed25519.getPublicKey(priv);
const mb   = encodeMultikey('Ed25519', pub);

const prepared = await prepareRegisterDidXdr({
  did: buildDidStellar('testnet', generateDidId()),
  sourcePublicKey: 'G...',
  record: {
    controller: 'G...',
    authentication:  [{ publicKeyMultibase: mb }],
    assertionMethod: [{ publicKeyMultibase: mb }],
    keyAgreement: [],
    services: [],
  },
});

const signedXdr = await wallet.sign(prepared.xdr, prepared.networkPassphrase);
await submitSignedXdr({ signedXdr, network: 'testnet' });
```

**Tres llamadas en lugar de una. El DID resultante es exactamente igual de válido.**

### 3. API HTTP `did.acta.build` — agnóstica del lenguaje

Cualquier cliente HTTP en cualquier lenguaje. El integrador genera las
llaves localmente (en el lenguaje que prefiera) y hace POST a la API.

```bash
curl -X POST https://did.acta.build/v1/dids/stellar \
  -H "Content-Type: application/json" \
  -d '{
    "did": "did:stellar:testnet:...",
    "sourcePublicKey": "G...",
    "record": {
      "controller": "G...",
      "authentication":  [{ "publicKeyMultibase": "z6Mk..." }],
      "assertionMethod": [{ "publicKeyMultibase": "z6Mk..." }],
      "keyAgreement": [],
      "services": []
    }
  }'
```

La API devuelve el XDR sin firmar. El integrador lo firma (con
Freighter, hardware wallet, keystore server-side) y manda el XDR
firmado a `/v1/dids/stellar/submit`.

**Mismo DID. Misma validez. Distinto lenguaje, distinto tooling.**

---

## La regla de validez

Un `did:stellar` es válido **si y solo si está registrado en el contrato
`did-stellar-registry`**. Esa es la única autoridad. Ningún SDK, API
ni panel puede otorgar o negar validez.

| Creado vía | Validez del DID |
|---|---|
| `acta-sdk` (auto-onboarding) | ✅ Válido |
| `did-stellar` SDK directo | ✅ Válido |
| API HTTP `did.acta.build` | ✅ Válido |
| Stellar Lab (XDR armado a mano) | ✅ Válido |
| Cliente custom en Rust con `soroban-sdk` | ✅ Válido |
| Cliente en Python que arma la llamada al contrato | ✅ Válido |

Todos son resolubles desde `did.acta.build/1.0/identifiers/...`, todos
pasan por el DIF Universal Resolver, y todos verifican firmas de la
misma forma.

---

## La analogía con git

Es la misma idea que `git`:

| Herramienta | Equivalente |
|---|---|
| Panel de source control de VSCode | `acta-sdk` (capa de UX) |
| GitHub Desktop | SDK `did-stellar` (primitivas tipadas) |
| `git` desde la terminal | La API HTTP en crudo |

Las tres herramientas crean commits idénticos. El hash del commit no
sabe ni le importa qué cliente lo produjo. **La validez del commit
viene del repositorio, no del cliente.**

Acá es igual: la validez del DID viene del contrato on-chain, no del
cliente.

---

## Por qué esto importa

Esta es la garantía central de trust-minimization de `did:stellar`:

- Un integrador en Hungría usando la API en crudo **no** necesita el
  permiso, el SDK ni el panel de ACTA. Puede registrar su DID
  directamente contra el contrato público.
- Ninguna librería cliente está privilegiada. Cualquiera puede escribir
  un SDK alternativo en cualquier lenguaje sin romper compatibilidad.
- Los verifiers que resuelven un `did:stellar` solo necesitan un
  endpoint RPC de Stellar y el ID del contrato registry. No necesitan
  saber qué cliente creó el DID.

Esto es lo que hace que `did:stellar` sea un método DID legítimo del
W3C y no un producto cerrado de ACTA.
