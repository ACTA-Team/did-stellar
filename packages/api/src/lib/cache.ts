/**
 * KV cache abstraction with two backends.
 *
 *  - In-memory (Map + per-entry expiry). Default in dev / tests.
 *  - Redis (`ioredis`) when `REDIS_URL` is configured. Shared across
 *    horizontally scaled instances.
 *
 * The interface is intentionally minimal — `get`, `set`, `close` — so
 * we never reach for the Redis client API beyond what the resolver and
 * rate-limiter actually need.
 */

import type { Redis } from 'ioredis';

export interface Cache {
  /** Returns the stored JSON value or `null` if missing / expired. */
  get<T>(key: string): Promise<T | null>;
  /** Stores `value` as JSON with a TTL (seconds). */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  /** Increment a counter atomically, returning the new value. Initialises with `ttlSeconds`. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  /** Close any backing connection. Idempotent. */
  close(): Promise<void>;
}

/**
 * In-memory cache. Uses `setTimeout`-free lazy expiry (checked on read).
 *
 * Methods return `Promise` to match the {@link Cache} contract but the
 * implementation is synchronous; we wrap with `Promise.resolve` so
 * `await` becomes a free no-op rather than an awkward microtask cost.
 */
export class InMemoryCache implements Cache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return Promise.resolve(null);
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value as T);
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }

  incr(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.store.get(key);
    const now = Date.now();
    if (!entry || entry.expiresAt <= now) {
      this.store.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return Promise.resolve(1);
    }
    const next = (entry.value as number) + 1;
    entry.value = next;
    return Promise.resolve(next);
  }

  close(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }
}

/** Redis-backed cache. Caller owns the connection so tests can swap it. */
export class RedisCache implements Cache {
  constructor(private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    // Use a pipeline so INCR + EXPIRE travel in one round-trip; EXPIRE
    // only takes effect on the first increment when the key is fresh.
    const pipeline = this.client.multi();
    pipeline.incr(key);
    pipeline.expire(key, ttlSeconds, 'NX');
    const replies = await pipeline.exec();
    const first = replies?.[0]?.[1];
    return typeof first === 'number' ? first : 0;
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => {
      /* ignore on shutdown */
    });
  }
}

/**
 * Build a {@link Cache} from a Redis URL, falling back to in-memory if
 * the URL is `null` or the connection fails. The `onError` callback
 * receives Redis transport errors so the caller (typically the server
 * factory) can log them through pino.
 */
export async function buildCache(opts: {
  redisUrl: string | null;
  onError?: (err: unknown) => void;
}): Promise<Cache> {
  if (!opts.redisUrl) return new InMemoryCache();

  const { default: IORedis } = await import('ioredis');
  const client = new IORedis(opts.redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  if (opts.onError) client.on('error', opts.onError);
  return new RedisCache(client);
}
