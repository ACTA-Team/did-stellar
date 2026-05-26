/**
 * Build an unsigned XDR for `transfer_controller(did_id, expected_version, new_controller)`.
 *
 * Preserves every key, service, and metadata field; only `controller`,
 * `version` and `updated_ledger` are bumped. The current controller
 * MUST sign — the new controller does NOT need to be involved in this
 * transaction (asymmetric to the admin two-step in `vc-vault`).
 */

import { StrKey } from '@stellar/stellar-sdk';

import { DidError } from '../errors';
import { addressScVal, bytesN16ScVal, u32ScVal } from '../internal/scval';
import { prepareInvokeXdr, type PreparedTx } from '../internal/tx';
import type { NetworkType } from '../network';
import { resolveContext, type CommonPrepareOptions } from './common';

export interface PrepareTransferControllerArgs extends CommonPrepareOptions {
  readonly did: string;
  readonly expectedVersion: number;
  /** New controller `G...` address. */
  readonly newController: string;
}

export async function prepareTransferControllerXdr(
  args: PrepareTransferControllerArgs
): Promise<PreparedTx & { network: NetworkType }> {
  if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) {
    throw new DidError(
      'expected_version_required',
      `expectedVersion must be an integer ≥ 1, got ${args.expectedVersion}`
    );
  }
  if (!StrKey.isValidEd25519PublicKey(args.newController)) {
    throw new DidError(
      'controller_invalid',
      `newController must be a valid G... address, got: ${args.newController}`
    );
  }

  const ctx = resolveContext(args.did, args);

  const prepared = await prepareInvokeXdr({
    rpcServer: ctx.rpcServer,
    network: ctx.network,
    contractId: ctx.registryContractId,
    fn: 'transfer_controller',
    args: [
      bytesN16ScVal(ctx.didIdBytes),
      u32ScVal(args.expectedVersion),
      addressScVal(args.newController),
    ],
    sourcePublicKey: args.sourcePublicKey,
    ...(args.baseFee !== undefined ? { baseFee: args.baseFee } : {}),
    ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: args.timeoutSeconds } : {}),
  });
  return { ...prepared, network: ctx.network };
}
