/**
 * Configuration warnings.
 *
 * The case that produced this: `DID_INDEX_DATABASE_URL` was set to a
 * platform variable reference that did not resolve, so it arrived as an
 * empty string. The index fell back to the in-memory store exactly as it
 * does when no database is configured at all - correct by the letter of
 * the rule, and indistinguishable from success. `/health` said
 * `store: "memory"` with no error anywhere, and the only way to find out
 * was to reason backwards from the absence of a startError.
 */

import { describe, expect, it } from 'vitest';

import { loadIndexConfig } from '../src/config';

const URL = 'postgres://u:p@postgres.railway.internal:5432/railway';

describe('loadIndexConfig warnings', () => {
  it('warns when the database URL is set but empty', () => {
    const cfg = loadIndexConfig({ DID_INDEX_DATABASE_URL: '' });

    expect(cfg.store.kind).toBe('memory');
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.warnings[0]).toMatch(/set but empty/);
    // The message has to name the likely cause, not just the symptom.
    expect(cfg.warnings[0]).toMatch(/reference/i);
  });

  it('warns on whitespace too, which is what a blanked field leaves behind', () => {
    expect(loadIndexConfig({ DID_INDEX_DATABASE_URL: '   ' }).warnings).toHaveLength(1);
  });

  it('stays silent when no database is configured at all', () => {
    // Unset is a deliberate, documented default. Only set-but-empty is
    // evidence of a mistake.
    expect(loadIndexConfig({}).warnings).toEqual([]);
  });

  it('stays silent when the URL resolves', () => {
    const cfg = loadIndexConfig({ DID_INDEX_DATABASE_URL: URL });

    expect(cfg.store.kind).toBe('postgres');
    expect(cfg.warnings).toEqual([]);
  });

  it('still falls back to DATABASE_URL when the specific one is empty', () => {
    const cfg = loadIndexConfig({ DID_INDEX_DATABASE_URL: '', DATABASE_URL: URL });

    // The warning fires, because the empty reference is still a mistake,
    // but the fallback keeps the index durable rather than punishing it.
    expect(cfg.store.kind).toBe('postgres');
    expect(cfg.warnings).toHaveLength(1);
  });
});
