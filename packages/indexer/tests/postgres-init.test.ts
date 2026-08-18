/**
 * `PostgresIndexStore.init()` resilience.
 *
 * These cover the failure that motivated the retry: a private network
 * that is not up the instant the container is, so the very first connect
 * resolves nothing and throws `ENOTFOUND` while the database is in fact
 * fine. Before the retry, that one miss left the index dead for the life
 * of the process and every controller listing silently empty.
 *
 * The `pg` module is mocked rather than a real database started - what is
 * under test is the retry policy and the pool's error wiring, neither of
 * which needs Postgres to exercise.
 */

import { describe, expect, it, vi } from 'vitest';

import { DidIndexer } from '../src/indexer';
import { isTransientConnectionError, PostgresIndexStore } from '../src/store/postgres';

/** A Node socket error, shaped the way `pg` propagates one. */
function connectError(code: string): Error & { code: string } {
  return Object.assign(new Error(`getaddrinfo ${code} postgres.railway.internal`), { code });
}

interface FakePool {
  query: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  handlers: Record<string, (err: unknown) => void>;
}

/**
 * Install a fake `pg` whose `Pool.query` runs the supplied script: each
 * entry is either an error to throw or `null` to succeed.
 */
function mockPg(script: (Error | null)[]): { pools: FakePool[] } {
  const pools: FakePool[] = [];
  let step = 0;

  vi.doMock('pg', () => {
    class Pool {
      readonly handlers: Record<string, (err: unknown) => void> = {};
      query = vi.fn(() => {
        const next = script[Math.min(step, script.length - 1)];
        step += 1;
        return next ? Promise.reject(next) : Promise.resolve({ rows: [] });
      });
      on = vi.fn((event: string, handler: (err: unknown) => void) => {
        this.handlers[event] = handler;
        return this;
      });
      end = vi.fn(() => Promise.resolve());
      constructor() {
        pools.push(this);
      }
    }
    return { Pool, default: { Pool } };
  });

  return { pools };
}

function store(overrides: Partial<ConstructorParameters<typeof PostgresIndexStore>[0]> = {}) {
  return new PostgresIndexStore({
    connectionString: 'postgres://user:pw@postgres.railway.internal:5432/railway',
    // Keep the tests fast; the policy under test is the retry, not the wait.
    connectBackoffMs: 1,
    ...overrides,
  });
}

describe('PostgresIndexStore.init', () => {
  it('retries a private network that has not come up yet', async () => {
    vi.resetModules();
    mockPg([connectError('ENOTFOUND'), connectError('ENOTFOUND'), null]);

    await expect(store().init()).resolves.toBeUndefined();
  });

  it('gives up after the configured number of attempts', async () => {
    vi.resetModules();
    mockPg([connectError('ECONNREFUSED')]);

    await expect(store({ connectAttempts: 3 }).init()).rejects.toThrow(/ECONNREFUSED/);
  });

  it('does not retry a configuration error', async () => {
    vi.resetModules();
    const denied = Object.assign(new Error('permission denied for schema public'), {
      code: '42501',
    });
    mockPg([denied]);
    const s = store();

    await expect(s.init()).rejects.toThrow(/permission denied/);
    // One attempt only: retrying would just delay a report the operator
    // needs immediately.
    expect(vi.mocked((await poolOf(s)).query)).toHaveBeenCalledTimes(1);
  });

  it('registers a pool error handler, without which an idle client kills the process', async () => {
    vi.resetModules();
    const { pools } = mockPg([null]);
    const seen: unknown[] = [];

    await store({ onError: (err) => seen.push(err) }).init();

    const pool = pools[0];
    expect(pool?.on).toHaveBeenCalledWith('error', expect.any(Function));
    pool?.handlers['error']?.(new Error('idle client died'));
    expect(seen).toHaveLength(1);
  });

  it('verifies the connection even when the schema is under migration control', async () => {
    vi.resetModules();
    const { pools } = mockPg([null]);

    await store({ skipSchema: true }).init();

    // `SELECT 1` rather than nothing: init must not report success on a
    // database it never reached.
    expect(pools[0]?.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('is a no-op once initialised', async () => {
    vi.resetModules();
    const { pools } = mockPg([null]);
    const s = store();

    await s.init();
    await s.init();

    expect(pools[0]?.query).toHaveBeenCalledTimes(1);
  });
});

/** Reach the pool the store created, for call-count assertions. */
async function poolOf(s: PostgresIndexStore): Promise<FakePool> {
  const pool = Reflect.get(s, 'pool') as FakePool | null;
  if (!pool) throw new Error('store has no pool');
  return Promise.resolve(pool);
}

describe('isTransientConnectionError', () => {
  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', '08006', '57P03'])(
    'treats %s as worth retrying',
    (code) => {
      expect(isTransientConnectionError(connectError(code))).toBe(true);
    }
  );

  it.each(['42501', '28P01', '3D000'])('treats %s as fatal', (code) => {
    expect(isTransientConnectionError(connectError(code))).toBe(false);
  });

  it('recognises a client that died mid-query, which carries no code', () => {
    expect(isTransientConnectionError(new Error('Connection terminated unexpectedly'))).toBe(true);
  });

  it('is false for anything that is not an error object', () => {
    expect(isTransientConnectionError(null)).toBe(false);
    expect(isTransientConnectionError('boom')).toBe(false);
  });
});

describe('DidIndexer.start', () => {
  it('stays startable after a store failure, so a retry is not a silent no-op', async () => {
    let attempts = 0;
    const flakyStore = {
      kind: 'memory' as const,
      init: () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(connectError('ENOTFOUND'));
        return Promise.resolve();
      },
      applyEvents: () => Promise.resolve({ seen: 0, written: 0 }),
      putStates: () => Promise.resolve(),
      removeDids: () => Promise.resolve(),
      getStates: () => Promise.resolve(new Map()),
      listByController: () => Promise.resolve([]),
      listDidIds: () => Promise.resolve([]),
      countDids: () => Promise.resolve(0),
      getCursor: () => Promise.resolve(null),
      setCursor: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };

    const indexer = new DidIndexer({
      store: flakyStore,
      networks: {},
      bootstrap: { mode: 'off' },
    });

    await expect(indexer.start()).rejects.toThrow(/ENOTFOUND/);
    // The retry must actually run. Before the fix, `running` stayed true
    // and this resolved immediately without ever opening the store.
    await expect(indexer.start()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
    expect(indexer.isBackfilled).toBe(true);
    indexer.stop();
  });
});
