import { DidError } from '@acta-team/did-stellar';
import { describe, expect, it } from 'vitest';

import { httpFromDidError, httpFromUnknown } from '../src/lib/errors';

describe('httpFromDidError', () => {
  it('maps did_invalid to 400', () => {
    const out = httpFromDidError(new DidError('did_invalid', 'bad'));
    expect(out.status).toBe(400);
    expect(out.body.code).toBe('did_invalid');
  });

  it('maps version_mismatch to 409', () => {
    expect(httpFromDidError(new DidError('version_mismatch', 'x')).status).toBe(409);
  });

  it('maps did_deactivated to 410', () => {
    expect(httpFromDidError(new DidError('did_deactivated', 'x')).status).toBe(410);
  });

  it('maps rpc_error to 502', () => {
    expect(httpFromDidError(new DidError('rpc_error', 'x')).status).toBe(502);
  });

  it('includes details when present', () => {
    const err = new DidError('version_mismatch', 'x', { details: { onChainVersion: 5 } });
    const out = httpFromDidError(err);
    expect(out.body.details).toEqual({ onChainVersion: 5 });
  });
});

describe('httpFromUnknown', () => {
  it('routes DidError instances through httpFromDidError', () => {
    expect(httpFromUnknown(new DidError('did_invalid', 'x')).status).toBe(400);
  });

  it('maps SyntaxError (bad JSON body) to 400', () => {
    expect(httpFromUnknown(new SyntaxError('bad JSON')).status).toBe(400);
  });

  it('maps any other error to 500', () => {
    expect(httpFromUnknown(new Error('boom')).status).toBe(500);
    expect(httpFromUnknown('boom').status).toBe(500);
  });
});
