/**
 * [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) (JCS).
 *
 * `did:stellar` v0.1 §6.3 mandates JCS as the canonicalization step
 * before signing a proof-of-control challenge. Two implementations must
 * agree byte-for-byte on the resulting bytes, regardless of map key
 * insertion order, number formatting, or whitespace.
 *
 * This implementation is intentionally minimal — the spec only requires
 * canonicalising small JSON objects (the challenge has 4 short keys).
 * It covers:
 *
 *  - Object keys sorted lexicographically by UTF-16 code unit.
 *  - Numbers serialised per ECMA-262 `Number.prototype.toString`, with
 *    JCS-mandated rejection of non-finite values.
 *  - Strings encoded with the JSON minimum-escape rule (only the
 *    characters JSON requires).
 *  - Arrays preserved in input order (RFC 8785 §3.2.1).
 *  - `null`, `true`, `false` as literals.
 *
 * Output is always a `Uint8Array` of UTF-8 bytes.
 */

import { DidError } from '../errors';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | readonly JsonValue[]
  | JsonValue[];

/** Canonicalise an arbitrary JSON value to its JCS UTF-8 byte sequence. */
export function jcsCanonicalize(value: unknown): Uint8Array {
  const text = jcsStringify(value as JsonValue);
  return new TextEncoder().encode(text);
}

/** Canonicalise to a UTF-8 string. Same output as {@link jcsCanonicalize} decoded. */
export function jcsStringify(value: JsonValue): string {
  return serialize(value);
}

function serialize(v: JsonValue): string {
  if (v === null) return 'null';

  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return serializeNumber(v as number);
  if (t === 'string') return serializeString(v as string);

  if (Array.isArray(v)) {
    return '[' + v.map((entry) => serialize(entry)).join(',') + ']';
  }

  if (t === 'object') {
    const obj = v as { [k: string]: JsonValue };
    // JCS §3.2.3: lexicographic sort of property keys by UTF-16 code unit.
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const sv = obj[k];
      if (sv === undefined) continue; // `undefined` is not JSON; skip silently.
      parts.push(serializeString(k) + ':' + serialize(sv));
    }
    return '{' + parts.join(',') + '}';
  }

  throw new DidError('challenge_invalid', `JCS cannot serialise value of type ${t}`);
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) {
    throw new DidError('challenge_invalid', 'JCS rejects non-finite numbers (NaN, Infinity)');
  }
  // ES2020+ Number.prototype.toString already matches JCS §3.2.2.4 for the
  // value subset used by `did:stellar` (no challenge field is numeric;
  // this branch is defensive future-proofing).
  return n.toString();
}

const ESCAPE: Readonly<Record<number, string>> = Object.freeze({
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
});

function serializeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    const esc = ESCAPE[cp];
    if (esc !== undefined) {
      out += esc;
    } else if (cp < 0x20) {
      out += `\\u${cp.toString(16).padStart(4, '0')}`;
    } else {
      out += s[i];
    }
  }
  out += '"';
  return out;
}
