import { describe, expect, it } from 'vitest';

import {
  contractErrorCodeFromNumber,
  DidError,
  fromContractErrorMessage,
} from '../src/errors';

describe('DidError', () => {
  it('exposes the code string for narrowing', () => {
    const e = new DidError('did_invalid', 'oops');
    expect(e.code).toBe('did_invalid');
    expect(e.name).toBe('DidError');
    expect(e.message).toBe('oops');
  });

  it('DidError.is recognises instances across realm boundaries', () => {
    const real = new DidError('did_invalid', 'x');
    const lookalike = { name: 'DidError', code: 'did_invalid', message: 'x' };
    expect(DidError.is(real)).toBe(true);
    expect(DidError.is(lookalike)).toBe(true);
    expect(DidError.is(new Error('not'))).toBe(false);
  });
});

describe('contractErrorCodeFromNumber', () => {
  it('maps every published number to a stable code', () => {
    expect(contractErrorCodeFromNumber(1)).toBe('did_already_exists');
    expect(contractErrorCodeFromNumber(3)).toBe('version_mismatch');
    expect(contractErrorCodeFromNumber(20)).toBe('metadata_inconsistent');
  });

  it('returns unknown for unmapped numbers', () => {
    expect(contractErrorCodeFromNumber(999)).toBe('unknown');
  });
});

describe('fromContractErrorMessage', () => {
  it('extracts a DidError from a Soroban error string', () => {
    const e = fromContractErrorMessage(new Error('failed: Error(Contract, #3) at line 1'));
    expect(e).not.toBeNull();
    expect(e?.code).toBe('version_mismatch');
    expect(e?.details?.contractErrorNumber).toBe(3);
  });

  it('returns null for non-contract errors', () => {
    expect(fromContractErrorMessage(new Error('connection reset'))).toBeNull();
  });
});
