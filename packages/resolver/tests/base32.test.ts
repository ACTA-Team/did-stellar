import { describe, expect, it } from 'vitest';

import { decodeBase32Lower, encodeBase32Lower } from '../src/base32';
import { DidError } from '../src/errors';

describe('base32 (RFC 4648 lowercase, no padding)', () => {
  it('encodes the all-zero 16-byte input to the spec vector', () => {
    const zeros = new Uint8Array(16);
    expect(encodeBase32Lower(zeros)).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
    expect(Array.from(decodeBase32Lower(encodeBase32Lower(bytes)))).toEqual(Array.from(bytes));
  });

  it('rejects empty input', () => {
    expect(() => decodeBase32Lower('')).toThrow(DidError);
  });

  it('rejects non-base32 characters', () => {
    expect(() => decodeBase32Lower('aaaaaaa!aaaa')).toThrow(DidError);
  });
});
