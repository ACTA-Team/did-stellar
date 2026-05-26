import { describe, expect, it } from 'vitest';

import { InMemoryCache } from '../src/lib/cache';

describe('InMemoryCache', () => {
  it('returns null for missing keys', async () => {
    const cache = new InMemoryCache();
    expect(await cache.get('missing')).toBeNull();
  });

  it('stores and retrieves JSON values', async () => {
    const cache = new InMemoryCache();
    await cache.set('a', { x: 1 }, 60);
    expect(await cache.get<{ x: number }>('a')).toEqual({ x: 1 });
  });

  it('expires entries after the TTL', async () => {
    const cache = new InMemoryCache();
    await cache.set('a', 'v', 0); // expires immediately
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.get('a')).toBeNull();
  });

  it('incr counts within the window', async () => {
    const cache = new InMemoryCache();
    expect(await cache.incr('k', 60)).toBe(1);
    expect(await cache.incr('k', 60)).toBe(2);
    expect(await cache.incr('k', 60)).toBe(3);
  });

  it('incr resets after expiry', async () => {
    const cache = new InMemoryCache();
    await cache.incr('k', 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(await cache.incr('k', 60)).toBe(1);
  });
});
