# Por qué un DID puede salir con campos vacíos

> Documento de referencia sobre cuándo un `did:stellar` resuelve con
> `assertionMethod`, `keyAgreement` o `service` vacíos, por qué pasa, y
> cómo evitarlo según el camino que se use para crearlo.

---

## La regla fundamental

El contrato `did-stellar-registry` es un **almacén tonto**: guarda
exactamente lo que le mandes en el `DidRecord` al llamar `register()` o
`update()`. No genera nada por sí solo, no rellena defaults, no inventa
keys.

Por eso:

- Si pasaste `assertionMethod: []`, on-chain queda `[]` para siempre.
- Si pasaste `assertionMethod: [{ publicKeyMultibase: "z6Mk…" }]`,
  on-chain queda esa key.

El resolver es un **espejo** de lo que está on-chain. No agrega keys que
no estén guardadas.

---

## Caso real — el DID del smoke test

`did:stellar:testnet:znfxngsh46vkyqu6inrx4omphi` se registró con este
`DidRecord`:

```json
{
  "controller": "GCVRCDEQ...",
  "authentication":  [{ "publicKeyMultibase": "z6Mk..." }],
  "assertionMethod": [],
  "keyAgreement":    [],
  "services":        []
}
```

Por eso, cuando se resuelve, sale:

```json
{
  "authentication":  ["did:stellar:testnet:znfxng...#auth-1"],
  "assertionMethod": [],
  "keyAgreement":    [],
  "service":         []
}
```

**No es un bug. Es lo que se registró.** Ese DID fue creado por el script
`examples/smoke-testnet` solo para validar el ciclo
`register → resolve`, no para emitir VCs. Por eso quedó con la
configuración mínima.

---

## Qué necesita cada campo para no quedar vacío

| Campo | Curva | Para qué | Quién decide |
|---|---|---|---|
| `authentication` | Ed25519 | Probar control del DID (proof-of-control) | Siempre obligatorio (1–3 keys) |
| `assertionMethod` | Ed25519 | Firmar VCs como issuer | El integrador, según rol |
| `keyAgreement` | X25519 | Recibir mensajes cifrados (DIDComm) | El integrador, según rol |
| `service` | n/a | Discovery (`LinkedDomains`, etc.) | El integrador, opcional |

**Si vas a emitir VCs, `assertionMethod` debe tener al menos una key.**
Sin eso, ningún verifier W3C-compliant acepta tus credenciales.

---

## Los tres caminos para crear un DID y cómo afectan los campos

Cualquier `did:stellar` registrado en el contrato es **igualmente
válido** (ver [`creation-paths.md`](./creation-paths.md)). La
diferencia entre los tres caminos no es validez, es **qué campos quedan
poblados por defecto**.

### Camino 1 — `@acta-team/credentials` (acta-sdk)

**Auto-onboarding completo.** El SDK detecta la primera vez que un
issuer emite una VC y, sin que el integrador haga nada:

1. Genera un par Ed25519
2. Mete la misma public key en `authentication` Y en `assertionMethod`
3. Registra el DID on-chain
4. Persiste el private key en IndexedDB (browser) o memoria (Node)

Resultado al resolver:

```json
{
  "authentication":  ["did:stellar:testnet:abc...#auth-1"],   // ← key
  "assertionMethod": ["did:stellar:testnet:abc...#assert-1"], // ← key
  "keyAgreement":    [],
  "service":         []
}
```

`keyAgreement` y `service` siguen vacíos **a propósito** — no se usan
en el flujo de emisión de VCs de ACTA. Si después aparece un caso de
uso (DIDComm, LinkedDomains), se agregan via `update()`.

**Uso típico:**

```ts
import { ActaClient } from '@acta-team/credentials';

const acta = new ActaClient('https://api.testnet.acta.build', apiKey);

// Sin issuerDid → el SDK lo crea solo con assertionMethod poblado
await acta.vcIssue({
  owner: 'G...',
  vcId: 'urn:...',
  vcData: '{...}',
  issuer: 'G...',
  sourcePublicKey: 'G...',
});
```

### Camino 2 — `@acta-team/did-stellar` (primitivas directas)

**Sin auto-onboarding.** El SDK respeta exactamente lo que le pases. Si
mandás `assertionMethod: []`, queda vacío para siempre (hasta `update`).

Resultado al resolver depende 100% de lo que el integrador haya pasado:

```ts
// Si pasaste esto:
await prepareRegisterDidXdr({
  did,
  sourcePublicKey: 'G...',
  record: {
    controller: 'G...',
    authentication:  [{ publicKeyMultibase: 'z6Mk...' }],
    assertionMethod: [],   // ← sale vacío al resolver
    keyAgreement:    [],
    services:        [],
  },
});
```

**Para no quedar vacío**, el integrador debe poblar los campos
manualmente:

```ts
import * as ed25519 from '@noble/ed25519';
import { encodeMultikey, prepareRegisterDidXdr } from '@acta-team/did-stellar';

const priv = ed25519.utils.randomPrivateKey();
const pub  = await ed25519.getPublicKey(priv);
const mb   = encodeMultikey('Ed25519', pub);

await prepareRegisterDidXdr({
  did,
  sourcePublicKey: 'G...',
  record: {
    controller: 'G...',
    authentication:  [{ publicKeyMultibase: mb }],
    assertionMethod: [{ publicKeyMultibase: mb }],   // ← ahora se llena
    keyAgreement:    [],
    services:        [],
  },
});
```

**Por qué el SDK base no auto-completa:** porque es agnóstico al caso de
uso. No sabe si vos sos issuer (necesitás `assertionMethod`), holder (no
necesitás), o verifier. Te da el control fino y vos decidís.

### Camino 3 — API HTTP `did.acta.build` (raw)

**Sin auto-onboarding.** Igual que el SDK directo, la API guarda lo que
le mandes. Quien usa la API en crudo debe generar las keys en su lado
(en su lenguaje) y pasar el record completo.

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
      "keyAgreement":    [],
      "services":        []
    }
  }'
```

Si el integrador pasa `assertionMethod: []`, queda vacío. Igual que el
camino 2.

---

## Tabla comparativa rápida

| Camino | `authentication` | `assertionMethod` | `keyAgreement` | `service` |
|---|---|---|---|---|
| `acta-sdk` auto-onboarding | ✅ auto | ✅ **auto** | ⬜ vacío (por diseño) | ⬜ vacío |
| `did-stellar` directo | depende del integrador | depende | depende | depende |
| API HTTP raw | depende del integrador | depende | depende | depende |
| Smoke test del repo | ✅ 1 key | ⬜ vacío | ⬜ vacío | ⬜ vacío |

---

## Por qué un campo "vacío" no significa "DID inválido"

Un `did:stellar` es válido si y solo si está registrado en el contrato.
Punto. Los campos vacíos son **legales** según la spec v0.1:

| Campo | Mínimo | Máximo |
|---|---|---|
| `authentication` | 1 | 3 |
| `assertionMethod` | 0 | 3 |
| `keyAgreement` | 0 | 1 |
| `service` | 0 | 3 |

Un DID con `assertionMethod: []` es **perfectamente válido**. Solo que
**no puede ser usado como issuer de VCs**. Es decir: es un DID legal,
pero limitado en función.

| Tipo de DID | `authentication` | `assertionMethod` | Para qué sirve |
|---|---|---|---|
| Holder (usuario final) | ✅ 1+ | ⬜ vacío | Recibir VCs, probar control |
| Issuer (empresa) | ✅ 1+ | ✅ **1+ (obligatorio)** | Emitir VCs firmadas |
| Holder + DIDComm | ✅ 1+ | ⬜ | + recibir mensajes cifrados |

---

## Cómo arreglar un DID existente con campos vacíos

Si un DID ya fue registrado con `assertionMethod: []` y querés agregarle
una key (para convertirlo en issuer), no hay que crear uno nuevo. Se
hace un `update()`:

```ts
import { prepareUpdateDidXdr, resolveDidStellar } from '@acta-team/did-stellar';

// 1. Leer la version actual
const { didDocumentMetadata } = await resolveDidStellar(did);
const currentVersion = Number(didDocumentMetadata.versionId);

// 2. Generar la assertion key faltante
const assertPriv = ed25519.utils.randomPrivateKey();
const assertPub  = await ed25519.getPublicKey(assertPriv);
const assertMb   = encodeMultikey('Ed25519', assertPub);

// 3. Preparar update con el record completo + la key nueva
const prepared = await prepareUpdateDidXdr({
  did,
  expectedVersion: currentVersion,
  nextRecord: {
    controller: 'G...',
    authentication:  [{ publicKeyMultibase: 'z6Mk...auth...' }], // la que ya estaba
    assertionMethod: [{ publicKeyMultibase: assertMb }],         // NUEVA
    keyAgreement:    [],
    services:        [],
  },
  sourcePublicKey: 'G...',
});

// 4. Firmar y submitear
const signedXdr = await wallet.sign(prepared.xdr, prepared.networkPassphrase);
await submitSignedXdr({ signedXdr, network: 'testnet' });

// 5. Después de la tx, el DID resolverá con assertionMethod poblado
//    y version: 2.
```

Importante:
- `update()` es **reemplazo total** del record, no patch. Tenés que
  mandar todos los campos como deberían quedar (incluyendo los que ya
  estaban).
- `expectedVersion` previene race conditions: si alguien actualizó el
  DID entre tu read y tu submit, el contrato responde con
  `version_mismatch (409)` y vos podés reintentar leyendo la version
  nueva.
- Solo el `controller` actual puede firmar la tx — el contrato lo
  verifica con `require_auth()`.

---

## Resumen en una página

1. **El contrato guarda literal lo que le mandes.** No genera nada.
2. **`assertionMethod: []` queda `[]` para siempre** hasta hacer `update`.
3. **`acta-sdk` (camino 1) lo llena automáticamente.** Los DIDs creados
   por este camino siempre tienen `assertionMethod` poblado.
4. **`did-stellar` SDK directo (camino 2)** y **API raw (camino 3)** no
   tienen auto-onboarding por diseño — son agnósticos al caso de uso.
5. **El DID del smoke test tiene `[]` porque se registró así
   deliberadamente** para validar el ciclo register/resolve, no para
   ser un issuer real.
6. **Un DID con campos vacíos es legal.** Solo que no puede emitir VCs.
   Para emitir, `assertionMethod` debe tener al menos una key.
7. **Para arreglar un DID existente:** `update()` con el record completo
   que incluya la key faltante.

---

## Referencias

- [`creation-paths.md`](./creation-paths.md) — los tres caminos para
  crear un DID y por qué todos producen DIDs igualmente válidos.
- Spec normativa `did:stellar` v0.1 — `contracts-acta/docs/did-spec/did-stellar-v0.1.md`.
