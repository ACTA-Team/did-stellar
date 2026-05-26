/**
 * HTTPS URL validation matching the contract's rules.
 *
 * The contract accepts a URL when it starts with the literal prefix
 * `https://`, contains at least one character after that prefix, and is
 * no longer than {@link MAX_URL_LEN}. The host itself is not parsed
 * on-chain, so the SDK applies the same conservative rule to stay in
 * sync.
 */

import { DidError } from '../errors';
import { MAX_URL_LEN } from '../record/types';
import type { Url } from './branded';

/** Type guard for {@link Url}. */
export function isHttpsUrl(s: string): s is Url {
  return typeof s === 'string' && s.length > 8 && s.length <= MAX_URL_LEN && s.startsWith('https://');
}

/** Brand a string as {@link Url} or throw `metadata_uri_invalid`. */
export function asHttpsUrl(s: string, code: 'metadata_uri_invalid' | 'service_endpoint_invalid'): Url {
  if (!isHttpsUrl(s)) {
    throw new DidError(code, `expected absolute https:// URL (max ${MAX_URL_LEN} chars), got: ${s}`);
  }
  return s;
}
