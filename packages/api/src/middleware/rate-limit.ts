/**
 * Per-IP rate limit middleware backed by {@link Cache}.
 *
 * Since the service is auth-less (trust-minimised), the only natural
 * unit of accounting is the source IP. The implementation is a fixed
 * window — simpler than sliding window, accurate enough for resolver
 * traffic and easy to back with `INCR` + `EXPIRE NX` atomically.
 *
 * Trusts the standard `X-Forwarded-For` header when `app.set('trust
 * proxy', true)` is configured upstream. Otherwise falls back to
 * `req.socket.remoteAddress`.
 */

import type { NextFunction, Request, Response } from 'express';

import type { Cache } from '../lib/cache';

export interface RateLimitOptions {
  readonly cache: Cache;
  readonly max: number;
  readonly windowSeconds: number;
  /** Override IP extraction (tests). */
  readonly keyExtractor?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  const extract = opts.keyExtractor ?? defaultKeyExtractor;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = extract(req);
    const key = `did-stellar-api:rl:${ip}`;
    let count: number;
    try {
      count = await opts.cache.incr(key, opts.windowSeconds);
    } catch {
      // Fail-open on cache errors: a degraded rate-limiter MUST NOT
      // drop legitimate resolver traffic. The error is already
      // captured by the cache `onError` hook configured at startup.
      next();
      return;
    }

    res.setHeader('X-RateLimit-Limit', String(opts.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.max - count)));

    if (count > opts.max) {
      res.setHeader('Retry-After', String(opts.windowSeconds));
      res.status(429).json({
        code: 'rate_limited',
        message: `Rate limit exceeded: ${opts.max} requests per ${opts.windowSeconds}s`,
      });
      return;
    }
    next();
  };
}

function defaultKeyExtractor(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
