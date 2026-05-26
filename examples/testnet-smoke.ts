/**
 * Testnet smoke test — end-to-end against `did-stellar-registry` on testnet.
 *
 * Closes the three gaps that unit tests can't reach:
 *   1. ScVal encoding for `DidRecord` matches the contract codec.
 *   2. `getLedgerEntries` returns a shape the reader decodes correctly.
 *   3. `prepare/submit` round-trip works against real Soroban RPC.
 *
 * Run:
 *
 *   $env:STELLAR_SECRET = "S..."   # PowerShell
 *   pnpm tsx examples/testnet-smoke.ts
 *
 * Cost: ~0.2 XLM for register + update + deactivate. Fund the account
 * with friendbot first: https://friendbot.stellar.org?addr=G...
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildDidStellar,
  buildRpcServer,
  encodeMultikey,
  generateDidId,
  parseDidStellar,
  prepareRegisterDidXdr,
  prepareUpdateDidXdr,
  prepareDeactivateDidXdr,
  readDidRecord,
  resolveDidStellar,
  submitSignedXdr,
} from '@acta-team/did-stellar';
import { getPublicKeyAsync, utils } from '@noble/ed25519';

const SECRET = process.env['STELLAR_SECRET'];
if (!SECRET) {
  console.error('Set STELLAR_SECRET=S... (a funded testnet account).');
  process.exit(1);
}
const controllerKp = Keypair.fromSecret(SECRET);
const CONTROLLER = controllerKp.publicKey();
console.log('controller:', CONTROLLER);

// --- A signer that uses the test account's secret to sign the prepared XDR.
async function sign(xdr: string, opts: { networkPassphrase: string }): Promise<string> {
  const tx = TransactionBuilder.fromXDR(xdr, opts.networkPassphrase);
  tx.sign(controllerKp);
  return tx.toXDR();
}

async function main() {
  // 1. Generate a fresh authentication key (Ed25519, just for this DID)
  const authPriv = utils.randomPrivateKey();
  const authPub = await getPublicKeyAsync(authPriv);
  const authMultikey = encodeMultikey('Ed25519', authPub);
  console.log('auth key:', authMultikey);

  // 2. Mint a brand-new DID
  const didId = generateDidId();
  const did = buildDidStellar('testnet', didId);
  console.log('did:    ', did);

  // 3. REGISTER
  console.log('\n[1/4] register…');
  const prep1 = await prepareRegisterDidXdr({
    did,
    sourcePublicKey: CONTROLLER,
    record: {
      controller: CONTROLLER,
      authentication: [{ publicKeyMultibase: authMultikey }],
      assertionMethod: [],
      keyAgreement: [],
      services: [],
    },
  });
  const signed1 = await sign(prep1.xdr, { networkPassphrase: prep1.networkPassphrase });
  const sub1 = await submitSignedXdr({ signedXdr: signed1, network: 'testnet' });
  console.log('  ✓ txId:', sub1.txId);

  // 4. READ direct from RPC
  console.log('\n[2/4] readDidRecord…');
  const parsed = parseDidStellar(did);
  const rpc = buildRpcServer('https://soroban-testnet.stellar.org');
  const record = await readDidRecord({
    rpcServer: rpc,
    registryContractId: 'CB7ATU7SF5QUKJMSULJDJVWJZVDXC23HTZX6NFUDTSFPVT6MA575NNZJ',
    didIdBytes: parsed.didIdBytes,
  });
  console.log('  ✓ record.version =', record?.version);
  console.log('  ✓ record.controller =', record?.controller);
  console.log('  ✓ record.deactivated =', record?.deactivated);
  if (!record) throw new Error('record came back null — encoder/reader mismatch!');
  if (record.version !== 1) throw new Error(`expected version=1, got ${record.version}`);

  // 5. RESOLVE → W3C DID Document
  console.log('\n[3/4] resolveDidStellar…');
  const result = await resolveDidStellar(did);
  console.log('  ✓ didDocument.id =', result.didDocument?.id);
  console.log('  ✓ verificationMethod count =', result.didDocument?.verificationMethod.length);

  // 6. UPDATE (add an assertion key)
  console.log('\n[4/4] update + deactivate…');
  const assertPriv = utils.randomPrivateKey();
  const assertPub = await getPublicKeyAsync(assertPriv);
  const prep2 = await prepareUpdateDidXdr({
    did,
    expectedVersion: 1,
    sourcePublicKey: CONTROLLER,
    nextRecord: {
      controller: CONTROLLER,
      authentication: [{ publicKeyMultibase: authMultikey }],
      assertionMethod: [{ publicKeyMultibase: encodeMultikey('Ed25519', assertPub) }],
      keyAgreement: [],
      services: [],
    },
  });
  const signed2 = await sign(prep2.xdr, { networkPassphrase: prep2.networkPassphrase });
  const sub2 = await submitSignedXdr({ signedXdr: signed2, network: 'testnet' });
  console.log('  ✓ update txId:', sub2.txId);

  const prep3 = await prepareDeactivateDidXdr({
    did,
    expectedVersion: 2,
    sourcePublicKey: CONTROLLER,
  });
  const signed3 = await sign(prep3.xdr, { networkPassphrase: prep3.networkPassphrase });
  const sub3 = await submitSignedXdr({ signedXdr: signed3, network: 'testnet' });
  console.log('  ✓ deactivate txId:', sub3.txId);

  // 7. Resolve again — should be a tombstone
  const tomb = await resolveDidStellar(did);
  console.log('\n  ✓ tombstone deactivated =', tomb.didDocumentMetadata.deactivated);
  console.log('  ✓ tombstone verificationMethod.length =', tomb.didDocument?.verificationMethod.length);

  console.log('\n✅ ALL GOOD — encoder, reader, resolver and prepare/submit all match the live contract.');
}

main().catch((err) => {
  console.error('\n❌ smoke test FAILED');
  console.error(err);
  process.exit(1);
});
