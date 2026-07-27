/**
 * Stellar address helpers.
 *
 * The `did-stellar-registry` contract types `controller` (and
 * `new_controller`) as a Soroban `Address`, which accepts BOTH classic
 * accounts (`G...`) and contracts (`C...`) — the latter being smart
 * accounts that authorize via their own `__check_auth`. Validation here
 * mirrors that: a controller may be either form.
 *
 * Note: this is distinct from a transaction's `sourcePublicKey`, which
 * must remain a classic `G...` account (a contract cannot be the classic
 * source that funds/signs the envelope). That check lives in `internal/tx.ts`.
 */

import { StrKey } from '@stellar/stellar-sdk';

/**
 * Type guard for a Stellar address that may be a classic account (`G...`)
 * or a contract (`C...`) — i.e. anything the contract's `Address` type
 * accepts.
 */
export function isValidAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}
