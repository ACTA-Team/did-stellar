/**
 * Build an unsigned XDR for `update(did_id, expected_version, next_record)`.
 *
 * Optimistic concurrency: the caller MUST have read the current
 * `version` beforehand and pass it as `expectedVersion`. If the
 * on-chain version drifts between read and submission the contract
 * surfaces `RegistryError::VersionMismatch (3)`, which the SDK maps to
 * `version_mismatch`.
 */

import { DidError } from '../errors';
import { bytesN16ScVal, u32ScVal } from '../internal/scval';
import { prepareInvokeXdr, type PreparedTx } from '../internal/tx';
import { encodeDidRecord } from '../record/encode';
import { validateDidRecordInput } from '../record/validate';

import { resolveContext, type CommonPrepareOptions } from './common';

import type { NetworkType } from '../network';
import type { DidRecordInput } from '../record/types';

export interface PrepareUpdateDidArgs extends CommonPrepareOptions {
  readonly did: string;
  /** Value of `DidRecord.version` observed by the caller before this update. */
  readonly expectedVersion: number;
  /** New record. Replaces every mutable field. */
  readonly nextRecord: DidRecordInput;
}

export async function prepareUpdateDidXdr(
  args: PrepareUpdateDidArgs
): Promise<PreparedTx & { network: NetworkType }> {
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) {
    throw new DidError(
      'expected_version_required',
      `expectedVersion must be an integer ≥ 1, got ${args.expectedVersion}`
    );
  }
  validateDidRecordInput(args.nextRecord);
  const ctx = resolveContext(args.did, args);

  const prepared = await prepareInvokeXdr({
    rpcServer: ctx.rpcServer,
    network: ctx.network,
    contractId: ctx.registryContractId,
    fn: 'update',
    args: [
      bytesN16ScVal(ctx.didIdBytes),
      u32ScVal(args.expectedVersion),
      encodeDidRecord(args.nextRecord),
    ],
    sourcePublicKey: args.sourcePublicKey,
    ...(args.baseFee !== undefined ? { baseFee: args.baseFee } : {}),
    ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: args.timeoutSeconds } : {}),
  });
  return { ...prepared, network: ctx.network };
}
