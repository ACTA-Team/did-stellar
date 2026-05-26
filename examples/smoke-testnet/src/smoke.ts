/**
 * Testnet smoke test.
 *
 * Runs the full lifecycle of a `did:stellar` against the canonical
 * testnet registry contract:
 *
 *   1. Generate a fresh 16-byte didId (CSPRNG).
 *   2. Mint a fresh Ed25519 keypair for `authentication`.
 *   3. Prepare the `register(did_id, initial_record)` invocation.
 *      → Soroban simulate runs end-to-end; reaching this step verifies
 *        the ScVal encoder for `DidRecord` matches the contract.
 *   4. Sign the unsigned XDR locally with the controller's secret key.
 *   5. Submit and poll until confirmation.
 *   6. Resolve the DID via the SDK (DIF-shape `DidResolutionResult`).
 *   7. Read the raw on-chain `DidRecord` to confirm controller +
 *      version persisted as expected.
 *
 * The script never echoes the secret key. It receives it from the
 * environment (`STELLAR_SECRET_KEY`), uses it once for signing, then
 * discards it.
 *
 * Usage:
 *
 *   $env:STELLAR_SECRET_KEY="S...your-testnet-secret..."
 *   pnpm --filter @examples/smoke-testnet smoke
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { getPublicKeyAsync, utils as edUtils } from '@noble/ed25519';

import {
  buildDidStellar,
  buildRpcServer,
  DEFAULT_REGISTRY_CONTRACT_IDS,
  DEFAULT_RPC_URLS,
  DidError,
  encodeMultikey,
  generateDidId,
  parseDidStellar,
  prepareRegisterDidXdr,
  readDidRecord,
  resolveDidStellar,
  submitSignedXdr,
} from '@acta-team/did-stellar';

const NETWORK = 'testnet' as const;

async function main(): Promise<void> {
  banner('Pre-flight');

  const secret = process.env['STELLAR_SECRET_KEY'];
  if (!secret) {
    fail(
      'STELLAR_SECRET_KEY is not set.\n' +
        '  PowerShell:  $env:STELLAR_SECRET_KEY="S..."\n' +
        '  bash:        export STELLAR_SECRET_KEY="S..."'
    );
  }

  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secret);
  } catch {
    fail('STELLAR_SECRET_KEY is not a valid Stellar secret (S...).');
  }
  const controller = keypair.publicKey();
  log('controller (your wallet):', controller);
  log('network:                 ', NETWORK);
  log('rpcUrl:                  ', DEFAULT_RPC_URLS[NETWORK]);
  log('registryContractId:      ', DEFAULT_REGISTRY_CONTRACT_IDS[NETWORK]);

  // --- Step 1: generate a fresh didId ---------------------------------------
  banner('Step 1 — Generate fresh didId');
  const didId = generateDidId();
  const did = buildDidStellar(NETWORK, didId);
  log('didId:', didId);
  log('did:  ', did);

  // --- Step 2: mint an Ed25519 authentication keypair ----------------------
  banner('Step 2 — Mint Ed25519 authentication keypair');
  const authPriv = edUtils.randomPrivateKey();
  const authPub = await getPublicKeyAsync(authPriv);
  const authMultibase = encodeMultikey('Ed25519', authPub);
  log('authentication[0].publicKeyMultibase:', authMultibase);
  // NOTE: in production the wallet stores `authPriv` securely. This script
  // doesn't persist it — the goal is purely to verify the registry round-trip.

  // --- Step 3: prepare register XDR ----------------------------------------
  banner('Step 3 — Prepare register XDR (Soroban simulate)');
  let prepared;
  try {
    prepared = await prepareRegisterDidXdr({
      did,
      sourcePublicKey: controller,
      record: {
        controller,
        authentication: [{ publicKeyMultibase: authMultibase }],
        assertionMethod: [],
        keyAgreement: [],
        services: [],
      },
    });
  } catch (cause) {
    explainError(cause, 'prepareRegisterDidXdr failed');
    process.exit(1);
  }
  log('xdr (unsigned, head):', prepared.xdr.slice(0, 80) + '…');
  log('network:             ', prepared.network);
  log('networkPassphrase:   ', prepared.networkPassphrase);

  // --- Step 4: sign with the controller secret ------------------------------
  banner('Step 4 — Sign with controller secret');
  const tx = TransactionBuilder.fromXDR(prepared.xdr, prepared.networkPassphrase);
  tx.sign(keypair);
  const signedXdr = tx.toXDR();
  log('xdr (signed, head):  ', signedXdr.slice(0, 80) + '…');

  // --- Step 5: submit and poll --------------------------------------------
  banner('Step 5 — Submit and poll');
  let submitResult;
  try {
    submitResult = await submitSignedXdr({
      signedXdr,
      network: NETWORK,
    });
  } catch (cause) {
    explainError(cause, 'submitSignedXdr failed');
    process.exit(1);
  }
  log('txId:', submitResult.txId);
  log('view in Stellar Lab:', `https://stellar.expert/explorer/testnet/tx/${submitResult.txId}`);

  // --- Step 6: resolve the DID (W3C DIF shape) -----------------------------
  banner('Step 6 — Resolve via resolveDidStellar() (W3C DIF result)');
  const resolution = await resolveDidStellar(did);
  console.log(JSON.stringify(resolution, null, 2));

  // --- Step 7: read raw DidRecord ------------------------------------------
  banner('Step 7 — Read raw DidRecord (via getLedgerEntries)');
  const parsed = parseDidStellar(did);
  const rpcServer = buildRpcServer(DEFAULT_RPC_URLS[NETWORK]);
  const record = await readDidRecord({
    rpcServer,
    registryContractId: DEFAULT_REGISTRY_CONTRACT_IDS[NETWORK],
    didIdBytes: parsed.didIdBytes,
  });
  console.log(JSON.stringify(record, null, 2));

  // --- Summary -------------------------------------------------------------
  banner('✅ Smoke test passed');
  log('Encoder ScVal + Soroban simulate ........ OK');
  log('Sign locally + submit + poll ............ OK');
  log('Resolver (getLedgerEntries + decode) .... OK');
  log('W3C DID Document builder ................ OK');
  console.log('\nResolve from Postman:');
  console.log(`  GET http://localhost:8080/1.0/identifiers/${did}`);
  console.log(`  GET http://localhost:8080/v1/dids/stellar/${did}`);
}

// --- helpers ----------------------------------------------------------------

function banner(text: string): void {
  console.log('\n' + '─'.repeat(72));
  console.log(text);
  console.log('─'.repeat(72));
}

function log(label: string, value?: string): void {
  if (value === undefined) console.log(label);
  else console.log(`  ${label} ${value}`);
}

function fail(message: string): never {
  console.error('\nERROR: ' + message);
  process.exit(1);
}

function explainError(cause: unknown, prefix: string): void {
  console.error('\n' + prefix);
  if (DidError.is(cause)) {
    console.error('  code:    ', cause.code);
    console.error('  message: ', cause.message);
    if (cause.details) console.error('  details: ', JSON.stringify(cause.details, null, 2));
  } else if (cause instanceof Error) {
    console.error('  ' + cause.message);
  } else {
    console.error('  ' + String(cause));
  }
}

main().catch((err: unknown) => {
  explainError(err, '\nUnhandled error in smoke test:');
  process.exit(1);
});
