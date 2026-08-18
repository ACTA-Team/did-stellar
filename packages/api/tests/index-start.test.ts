/**
 * Index startup retry.
 *
 * The behaviour under test is not "does it call start()". It is that a
 * transient failure at boot does not permanently strand the index: with
 * the index down, `GET /v1/dids/stellar` answers an empty list for every
 * wallet and nothing in the response says anything is wrong. Before the
 * retry, one `ENOTFOUND` while a private network was still coming up
 * left the service in that state until someone redeployed.
 */

import { describe, expect, it, vi } from 'vitest';

import { startIndexWithRetry, type StartableIndex } from '../src/lib/index-start';

import type { Logger } from '../src/logger';

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

/** An index whose `start()` follows a script of failures then success. */
function scripted(failures: number): StartableIndex & {
  attempts: () => number;
  errors: () => (string | null)[];
} {
  let attempts = 0;
  const errors: (string | null)[] = [];
  return {
    start: () => {
      attempts += 1;
      if (attempts <= failures) {
        return Promise.reject(
          Object.assign(new Error('getaddrinfo ENOTFOUND postgres.railway.internal'), {
            code: 'ENOTFOUND',
          })
        );
      }
      return Promise.resolve();
    },
    noteStartError: (message) => errors.push(message),
    attempts: () => attempts,
    errors: () => errors,
  };
}

/** Let the retry timers and their promise chains drain. */
async function drain(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('startIndexWithRetry', () => {
  it('recovers from a transient failure at boot', async () => {
    vi.useFakeTimers();
    const index = scripted(2);

    startIndexWithRetry(index, silentLogger, () => false, { baseDelayMs: 10, maxDelayMs: 100 });
    await drain(1_000);

    expect(index.attempts()).toBe(3);
    // The failures are recorded, then cleared once it comes up, so
    // `/health` does not keep reporting a problem that is over.
    expect(index.errors().at(-1)).toBeNull();
    vi.useRealTimers();
  });

  it('reports the failure while it is still failing', async () => {
    vi.useFakeTimers();
    const index = scripted(Number.POSITIVE_INFINITY);

    startIndexWithRetry(index, silentLogger, () => false, { baseDelayMs: 10, maxDelayMs: 50 });
    await drain(200);

    expect(index.attempts()).toBeGreaterThan(1);
    expect(index.errors().every((e) => typeof e === 'string')).toBe(true);
    expect(index.errors().at(-1)).toMatch(/ENOTFOUND/);
    vi.useRealTimers();
  });

  it('backs off instead of hammering a database that is down', async () => {
    vi.useFakeTimers();
    const index = scripted(Number.POSITIVE_INFINITY);

    startIndexWithRetry(index, silentLogger, () => false, { baseDelayMs: 100, maxDelayMs: 400 });
    // 0ms: attempt 1. Then +100, +200, +400, +400...
    await drain(100);
    expect(index.attempts()).toBe(2);
    await drain(200);
    expect(index.attempts()).toBe(3);
    await drain(400);
    expect(index.attempts()).toBe(4);
    // Capped: another 400ms buys exactly one more attempt, not more.
    await drain(400);
    expect(index.attempts()).toBe(5);
    vi.useRealTimers();
  });

  it('stops retrying once the process is shutting down', async () => {
    vi.useFakeTimers();
    const index = scripted(Number.POSITIVE_INFINITY);
    let stopping = false;

    startIndexWithRetry(index, silentLogger, () => stopping, {
      baseDelayMs: 10,
      maxDelayMs: 10,
    });
    await drain(50);
    const before = index.attempts();
    stopping = true;
    await drain(1_000);

    expect(index.attempts()).toBe(before);
    vi.useRealTimers();
  });

  it('does not retry a start that succeeds first time', async () => {
    vi.useFakeTimers();
    const index = scripted(0);

    startIndexWithRetry(index, silentLogger, () => false, { baseDelayMs: 10 });
    await drain(1_000);

    expect(index.attempts()).toBe(1);
    expect(index.errors()).toEqual([null]);
    vi.useRealTimers();
  });
});
