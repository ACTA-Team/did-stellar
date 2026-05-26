/**
 * ScVal encoding/decoding helpers tailored to the `did-stellar-registry`
 * ABI.
 *
 * The Stellar SDK's `nativeToScVal` / `scValToNative` cover the common
 * cases but fall short for two `did:stellar` shapes:
 *
 *  1. **Optional fields** — `metadata_uri: Option<String>` and
 *     `metadata_hash: Option<BytesN<32>>` map to a Soroban enum with
 *     `None`/`Some(T)` variants, not a JS `undefined`.
 *  2. **Storage key** — reading a `DidRecord` directly from the ledger
 *     requires building a `DidDataKey::Record(BytesN<16>)` enum-variant
 *     ScVal, encoded as `ScVec[Symbol, BytesN<16>]`.
 *
 * These helpers encapsulate both cases so the rest of the SDK never
 * touches raw `xdr.ScVal` constructors.
 */

import { Address, nativeToScVal, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';

import { DidError } from '../errors';

/** Build an `Option<T>` `ScVal` from a possibly-undefined inner value. */
export function optionScVal(inner: xdr.ScVal | null | undefined): xdr.ScVal {
  if (inner === null || inner === undefined) {
    return xdr.ScVal.scvVoid();
  }
  return inner;
}

/** Decode an `Option<T>` `ScVal` to a JS native value or `null`. */
export function decodeOption<T>(val: xdr.ScVal): T | null {
  if (val.switch().name === 'scvVoid') return null;
  return scValToNative(val) as T;
}

/** Encode a JS string as an `ScString`. */
export function stringScVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: 'string' });
}

/** Encode a JS unsigned integer as a `u32`. */
export function u32ScVal(n: number): xdr.ScVal {
  if (!Number.isInteger(n) || n < 0 || n > 0xff_ff_ff_ff) {
    throw new DidError('unknown', `value out of u32 range: ${n}`);
  }
  return nativeToScVal(n, { type: 'u32' });
}

/** Encode a 16-byte `BytesN<16>` from a `Uint8Array`. */
export function bytesN16ScVal(bytes: Uint8Array): xdr.ScVal {
  if (bytes.length !== 16) {
    throw new DidError('did_id_invalid', `BytesN<16> requires exactly 16 bytes, got ${bytes.length}`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** Encode a 32-byte `BytesN<32>` (used for `metadata_hash`). */
export function bytesN32ScVal(bytes: Uint8Array): xdr.ScVal {
  if (bytes.length !== 32) {
    throw new DidError('unknown', `BytesN<32> requires exactly 32 bytes, got ${bytes.length}`);
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/** Encode a Stellar `G...` classic account as an `Address` ScVal. */
export function addressScVal(stellarAccount: string): xdr.ScVal {
  if (!StrKey.isValidEd25519PublicKey(stellarAccount)) {
    throw new DidError('controller_invalid', `controller must be a valid G... address, got: ${stellarAccount}`);
  }
  return Address.fromString(stellarAccount).toScVal();
}

/**
 * Build the `DidDataKey::Record(BytesN<16>)` storage key as
 * `ScVec[Symbol("Record"), BytesN<16>]`.
 *
 * Mirrors the Soroban enum-with-payload serialisation used by the
 * registry contract's `storage::DidDataKey`.
 */
export function didRecordStorageKey(didIdBytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Record'), bytesN16ScVal(didIdBytes)]);
}

/**
 * Decode an Address ScVal back to its strkey representation. Returns the
 * canonical `G...` (or `C...`) string. Falls back to `String(native)`
 * for any unexpected shape.
 */
export function decodeAddress(val: xdr.ScVal): string {
  // `scValToNative` returns an `Address` instance for address ScVals,
  // which serialises to a strkey via toString(). We intentionally
  // re-bind to `unknown` so `String(...)` doesn't trip the
  // no-unsafe-assignment lint.
  const native: unknown = scValToNative(val);
  return String(native);
}
