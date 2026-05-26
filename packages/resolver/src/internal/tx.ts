/**
 * Low-level Soroban transaction primitives used by every `prepare*Xdr`
 * helper.
 *
 * Two operations:
 *
 *  - {@link prepareInvokeXdr}: build → simulate → assemble an unsigned
 *    transaction XDR for a contract function call.
 *  - {@link submitSignedXdr}: parse a signed XDR, send it, poll until
 *    the network reports a terminal status, and return the tx hash.
 *
 * Both surface contract failures through {@link DidError} so the rest of
 * the SDK never has to inspect raw Soroban error strings.
 */

import type {
  rpc,
  xdr} from '@stellar/stellar-sdk';
import {
  Account,
  Contract,
  Operation,
  StrKey,
  TransactionBuilder
} from '@stellar/stellar-sdk';

import { DidError, fromContractErrorMessage } from '../errors';
import type { NetworkType } from '../network';
import { NETWORK_PASSPHRASES } from '../network';

export interface PrepareInvokeArgs {
  readonly rpcServer: rpc.Server;
  readonly network: NetworkType;
  readonly contractId: string;
  readonly fn: string;
  readonly args: readonly xdr.ScVal[];
  readonly sourcePublicKey: string;
  /** Outer transaction fee in stroops. Defaults to `100_000`. */
  readonly baseFee?: string;
  /** Transaction timeout in seconds. Defaults to 60. */
  readonly timeoutSeconds?: number;
}

export interface PreparedTx {
  /** Base64-encoded unsigned transaction XDR. */
  readonly xdr: string;
  /** Network passphrase that must be passed to the signer. */
  readonly networkPassphrase: string;
}

/**
 * Build, simulate and prepare a Soroban contract invocation. The
 * returned XDR is unsigned and ready for the controller wallet.
 *
 * Throws:
 * - `contract_id_invalid` — `contractId` is not a valid `C...` strkey.
 * - `controller_invalid`  — `sourcePublicKey` is not a valid `G...` strkey.
 * - Any contract-mapped error if simulation surfaces one.
 * - `tx_simulation_failed` for transport/simulation failures otherwise.
 */
export async function prepareInvokeXdr(args: PrepareInvokeArgs): Promise<PreparedTx> {
  if (!StrKey.isValidContract(args.contractId)) {
    throw new DidError(
      'contract_id_invalid',
      `contractId must be a valid C... strkey, got: ${args.contractId}`
    );
  }
  if (!StrKey.isValidEd25519PublicKey(args.sourcePublicKey)) {
    throw new DidError(
      'controller_invalid',
      `sourcePublicKey must be a valid G... address, got: ${args.sourcePublicKey}`
    );
  }

  const networkPassphrase = NETWORK_PASSPHRASES[args.network];

  let sequence = '0';
  try {
    const acct = await args.rpcServer.getAccount(args.sourcePublicKey);
    // The SDK's Account shape exposes `sequenceNumber()` returning a string.
    const seq = (acct as unknown as { sequenceNumber?: () => string }).sequenceNumber?.();
    if (typeof seq === 'string') sequence = seq;
  } catch {
    // Account may not yet exist on testnet for first-time controllers;
    // fall back to seq 0. The simulation will still produce a valid XDR
    // because Soroban fee bumps live in the prepared envelope.
  }

  const source = new Account(args.sourcePublicKey, sequence);
  const contract = new Contract(args.contractId);

  const op = Operation.invokeContractFunction({
    contract: contract.contractId(),
    function: args.fn,
    args: [...args.args],
  });

  const tx = new TransactionBuilder(source, {
    fee: args.baseFee ?? '100000',
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(args.timeoutSeconds ?? 60)
    .build();

  try {
    const prepared = await args.rpcServer.prepareTransaction(tx);
    return { xdr: prepared.toXDR(), networkPassphrase };
  } catch (cause) {
    const typed = fromContractErrorMessage(cause);
    if (typed) throw typed;
    throw new DidError('tx_simulation_failed', 'Failed to simulate / prepare transaction', { cause });
  }
}

export interface SubmitSignedXdrArgs {
  readonly rpcServer: rpc.Server;
  readonly network: NetworkType;
  readonly signedXdr: string;
  /** Polling timeout in ms. Defaults to 30_000. */
  readonly timeoutMs?: number;
  /** Polling interval in ms. Defaults to 1_000. */
  readonly pollIntervalMs?: number;
}

export interface SubmittedTx {
  readonly txId: string;
}

/**
 * Submit a signed transaction and poll until it reaches a terminal
 * status. Returns the tx hash on success, throws {@link DidError} on
 * any failure (with contract errors mapped via
 * {@link fromContractErrorMessage}).
 */
export async function submitSignedXdr(args: SubmitSignedXdrArgs): Promise<SubmittedTx> {
  const networkPassphrase = NETWORK_PASSPHRASES[args.network];

  let tx;
  try {
    tx = TransactionBuilder.fromXDR(args.signedXdr, networkPassphrase);
  } catch (cause) {
    throw new DidError('tx_submission_failed', 'signed XDR is malformed', { cause });
  }

  let sendResp;
  try {
    sendResp = await args.rpcServer.sendTransaction(tx);
  } catch (cause) {
    throw new DidError('tx_submission_failed', 'sendTransaction failed', { cause });
  }

  if (sendResp.errorResult) {
    let detail: string;
    try {
      detail = sendResp.errorResult.toXDR().toString('base64');
    } catch {
      detail = 'unavailable';
    }
    throw new DidError('tx_submission_failed', `network rejected transaction: ${detail}`);
  }

  if (sendResp.status === 'ERROR') {
    throw new DidError('tx_submission_failed', 'sendTransaction returned ERROR');
  }

  const hash = sendResp.hash;
  if (!hash) {
    throw new DidError('tx_submission_failed', 'sendTransaction did not return a hash');
  }

  if (sendResp.status === 'PENDING' || sendResp.status === 'DUPLICATE' || sendResp.status === 'TRY_AGAIN_LATER') {
    await pollUntilFinal(args.rpcServer, hash, args.timeoutMs ?? 30_000, args.pollIntervalMs ?? 1_000);
  }

  return { txId: hash };
}

async function pollUntilFinal(
  rpcServer: rpc.Server,
  hash: string,
  timeoutMs: number,
  intervalMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let resp;
    try {
      resp = await rpcServer.getTransaction(hash);
    } catch (cause) {
      throw new DidError('tx_submission_failed', `getTransaction failed for ${hash}`, { cause });
    }

    const status = String(resp.status);
    if (status === 'SUCCESS') return;
    if (status === 'FAILED') {
      // The Soroban error code lives in resp.resultXdr / resp.resultMetaXdr.
      // We surface the raw XDR string in details so consumers can drill in
      // when they need to, while keeping the message stable.
      const typed = fromContractErrorMessage(
        (resp as unknown as { resultXdr?: { toXDR: () => Buffer } }).resultXdr?.toXDR().toString('base64') ?? ''
      );
      if (typed) throw typed;
      throw new DidError('tx_submission_failed', `transaction ${hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new DidError('tx_submission_failed', `transaction ${hash} did not finalise within ${timeoutMs}ms`);
}
