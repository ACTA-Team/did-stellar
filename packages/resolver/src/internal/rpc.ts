/**
 * Stellar RPC factory.
 *
 * Centralises the construction of `rpc.Server` so the rest of the SDK
 * uses one consistent code path (timeouts, `allowHttp`, future tracing
 * hooks). Public callers pass an RPC URL string; the SDK does the rest.
 */

import { rpc } from '@stellar/stellar-sdk';

import { DidError } from '../errors';

export interface RpcServerOptions {
  /** Allow plain HTTP (development only). Defaults to `false`. */
  allowHttp?: boolean;
}

/**
 * Build a {@link rpc.Server} from an HTTPS (or, in dev, HTTP) URL.
 * Throws `rpc_url_invalid` for empty / non-string / non-http(s) input.
 */
export function buildRpcServer(rpcUrl: string, opts: RpcServerOptions = {}): rpc.Server {
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new DidError('rpc_url_invalid', 'rpcUrl must be a non-empty string');
  }
  if (!/^https?:\/\//i.test(rpcUrl)) {
    throw new DidError('rpc_url_invalid', `rpcUrl must start with http:// or https://, got: ${rpcUrl}`);
  }
  const allowHttp = opts.allowHttp ?? rpcUrl.startsWith('http://');
  return new rpc.Server(rpcUrl, { allowHttp });
}
