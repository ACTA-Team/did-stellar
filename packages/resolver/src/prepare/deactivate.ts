/**
 * Build an unsigned XDR for `deactivate(did_id, expected_version)`.
 *
 * Irreversible (spec §4.6.4). Empties cryptographic material on-chain;
 * preserves `controller` and metadata for audit. UI layers SHOULD
 * confirm intent twice before signing.
 */

import { DidError } from '../errors';
import { bytesN16ScVal, u32ScVal } from '../internal/scval';
import { prepareInvokeXdr, type PreparedTx } from '../internal/tx';
import type { NetworkType } from '../network';
import { resolveContext, type CommonPrepareOptions } from './common';

export interface PrepareDeactivateDidArgs extends CommonPrepareOptions {
  readonly did: string;
  readonly expectedVersion: number;
}

export async function prepareDeactivateDidXdr(
  args: PrepareDeactivateDidArgs
): Promise<PreparedTx & { network: NetworkType }> {
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) {
    throw new DidError(
      'expected_version_required',
      `expectedVersion must be an integer ≥ 1, got ${args.expectedVersion}`
    );
  }
  const ctx = resolveContext(args.did, args);

  const prepared = await prepareInvokeXdr({
    rpcServer: ctx.rpcServer,
    network: ctx.network,
    contractId: ctx.registryContractId,
    fn: 'deactivate',
    args: [bytesN16ScVal(ctx.didIdBytes), u32ScVal(args.expectedVersion)],
    sourcePublicKey: args.sourcePublicKey,
    ...(args.baseFee !== undefined ? { baseFee: args.baseFee } : {}),
    ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: args.timeoutSeconds } : {}),
  });
  return { ...prepared, network: ctx.network };
}
