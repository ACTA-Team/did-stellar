/**
 * Build an unsigned XDR for `did-stellar-registry.register(did_id, initial_record)`.
 *
 * Per spec §4.6.1 the caller assembles a fresh `DidRecord`, the SDK
 * validates it client-side (so most malformed inputs fail before a
 * round-trip), and the resulting XDR is returned for the controller
 * wallet to sign.
 */

import { bytesN16ScVal } from '../internal/scval';
import { prepareInvokeXdr, type PreparedTx } from '../internal/tx';
import type { NetworkType } from '../network';
import { encodeDidRecord } from '../record/encode';
import type { DidRecordInput } from '../record/types';
import { validateDidRecordInput } from '../record/validate';
import { resolveContext, type CommonPrepareOptions } from './common';

export interface PrepareRegisterDidArgs extends CommonPrepareOptions {
  /** Canonical `did:stellar:...` to register. */
  readonly did: string;
  /** Initial `DidRecord` to register on-chain. */
  readonly record: DidRecordInput;
}

/**
 * Prepare a `register` invocation. The caller still needs to sign the
 * returned XDR with the controller wallet and submit it via
 * {@link submitSignedXdr}.
 *
 * If `record.controller !== sourcePublicKey` the contract will still
 * accept the call as long as the signer is `record.controller`; the
 * SDK does not enforce a tighter constraint, but recommends keeping
 * them aligned to avoid wallet confusion.
 */
export async function prepareRegisterDidXdr(args: PrepareRegisterDidArgs): Promise<PreparedTx & { network: NetworkType }> {
  validateDidRecordInput(args.record);
  const ctx = resolveContext(args.did, args);

  const prepared = await prepareInvokeXdr({
    rpcServer: ctx.rpcServer,
    network: ctx.network,
    contractId: ctx.registryContractId,
    fn: 'register',
    args: [bytesN16ScVal(ctx.didIdBytes), encodeDidRecord(args.record)],
    sourcePublicKey: args.sourcePublicKey,
    ...(args.baseFee !== undefined ? { baseFee: args.baseFee } : {}),
    ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: args.timeoutSeconds } : {}),
  });

  return { ...prepared, network: ctx.network };
}
