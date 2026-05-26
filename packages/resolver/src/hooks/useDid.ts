/**
 * `useDid` — minimal React hook around the core SDK.
 *
 * Provides four callbacks (`register`, `update`, `transfer`,
 * `deactivate`) that mirror the prepare/sign/submit flow, plus two
 * read helpers (`resolve`, `getRecord`).
 *
 * The hook is intentionally bare. The "Signer" abstraction is the same
 * one used in `@acta-team/credentials`: a function that takes an
 * unsigned XDR plus a `networkPassphrase` and returns the signed XDR.
 * Wiring it to Freighter, Albedo, Hana, or a server-side key is the
 * integrator's responsibility.
 */

import { useCallback } from 'react';

import { resolveDidStellar } from '../resolver/resolve';
import { readDidRecord } from '../record/reader';
import {
  prepareDeactivateDidXdr,
  prepareRegisterDidXdr,
  prepareTransferControllerXdr,
  prepareUpdateDidXdr,
  submitSignedXdr,
} from '../prepare';
import type { CommonPrepareOptions } from '../prepare/common';
import type { PrepareRegisterDidArgs } from '../prepare/register';
import type { PrepareUpdateDidArgs } from '../prepare/update';
import type { PrepareTransferControllerArgs } from '../prepare/transfer-controller';
import type { PrepareDeactivateDidArgs } from '../prepare/deactivate';
import type { DidResolutionResult } from '../document/types';
import type { DidRecord } from '../record/types';
import { parseDidStellar } from '../identifier';
import { buildRpcServer } from '../internal/rpc';
import { DEFAULT_REGISTRY_CONTRACT_IDS, DEFAULT_RPC_URLS } from '../network';

/** Function that signs an unsigned XDR with the given network passphrase. */
export type Signer = (
  unsignedXdr: string,
  opts: { networkPassphrase: string }
) => Promise<string>;

type MutationResult = { readonly txId: string };

async function runMutation(
  prepared: { xdr: string; networkPassphrase: string; network: 'mainnet' | 'testnet' },
  sign: Signer,
  submitOpts?: Pick<CommonPrepareOptions, 'rpcUrl' | 'allowHttp'>
): Promise<MutationResult> {
  const signedXdr = await sign(prepared.xdr, { networkPassphrase: prepared.networkPassphrase });
  const result = await submitSignedXdr({
    signedXdr,
    network: prepared.network,
    ...(submitOpts?.rpcUrl !== undefined ? { rpcUrl: submitOpts.rpcUrl } : {}),
    ...(submitOpts?.allowHttp !== undefined ? { allowHttp: submitOpts.allowHttp } : {}),
  });
  return { txId: result.txId };
}

/** Read helpers + the four mutation callbacks for `did-stellar-registry`. */
export function useDid() {
  const register = useCallback(
    async (
      args: PrepareRegisterDidArgs & { sign: Signer }
    ): Promise<MutationResult> => {
      const prepared = await prepareRegisterDidXdr(args);
      return runMutation(prepared, args.sign, args);
    },
    []
  );

  const update = useCallback(
    async (args: PrepareUpdateDidArgs & { sign: Signer }): Promise<MutationResult> => {
      const prepared = await prepareUpdateDidXdr(args);
      return runMutation(prepared, args.sign, args);
    },
    []
  );

  const transfer = useCallback(
    async (
      args: PrepareTransferControllerArgs & { sign: Signer }
    ): Promise<MutationResult> => {
      const prepared = await prepareTransferControllerXdr(args);
      return runMutation(prepared, args.sign, args);
    },
    []
  );

  const deactivate = useCallback(
    async (
      args: PrepareDeactivateDidArgs & { sign: Signer }
    ): Promise<MutationResult> => {
      const prepared = await prepareDeactivateDidXdr(args);
      return runMutation(prepared, args.sign, args);
    },
    []
  );

  const resolve = useCallback(
    (did: string, opts?: Parameters<typeof resolveDidStellar>[1]): Promise<DidResolutionResult> => {
      return resolveDidStellar(did, opts);
    },
    []
  );

  const getRecord = useCallback(
    async (
      did: string,
      opts?: {
        rpcUrl?: string;
        registryContractId?: string;
        allowHttp?: boolean;
      }
    ): Promise<DidRecord | null> => {
      const parsed = parseDidStellar(did);
      const rpcUrl = opts?.rpcUrl ?? DEFAULT_RPC_URLS[parsed.network];
      const registryContractId =
        opts?.registryContractId ?? DEFAULT_REGISTRY_CONTRACT_IDS[parsed.network];
      const rpcServer = buildRpcServer(
        rpcUrl,
        opts?.allowHttp !== undefined ? { allowHttp: opts.allowHttp } : {}
      );
      return readDidRecord({
        rpcServer,
        registryContractId,
        didIdBytes: parsed.didIdBytes,
      });
    },
    []
  );

  return { register, update, transfer, deactivate, resolve, getRecord };
}
