/**
 * Submit a signed XDR for any `did-stellar-registry` mutation.
 *
 * Public re-export of the internal {@link submitSignedXdrInternal}, with
 * an ergonomic options shape: the caller provides the RPC URL and the
 * network so the SDK does not have to re-parse the DID at submit time
 * (the signed XDR already commits to a network passphrase).
 */

import { buildRpcServer } from '../internal/rpc';
import { submitSignedXdr as submitSignedXdrInternal, type SubmittedTx } from '../internal/tx';

import type { NetworkType } from '../network';

export interface SubmitSignedXdrOptions {
  readonly signedXdr: string;
  readonly network: NetworkType;
  /** Override the RPC URL. Defaults to {@link DEFAULT_RPC_URLS}. */
  readonly rpcUrl?: string;
  readonly allowHttp?: boolean;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export async function submitSignedXdr(opts: SubmitSignedXdrOptions): Promise<SubmittedTx> {
  const { DEFAULT_RPC_URLS } = await import('../network');
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URLS[opts.network];
  const rpcServer = buildRpcServer(
    rpcUrl,
    opts.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}
  );
  return submitSignedXdrInternal({
    rpcServer,
    network: opts.network,
    signedXdr: opts.signedXdr,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
  });
}

export type { SubmittedTx };
