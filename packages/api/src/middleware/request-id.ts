/**
 * Request-ID middleware.
 *
 * Adds a per-request UUID-like ID to every response (`X-Request-ID`)
 * and to the request-scoped logger context. Honours an inbound
 * `X-Request-ID` header so upstream proxies / clients can correlate
 * across hops.
 */

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// `Request.id` is augmented in `src/types/express.d.ts`; TS picks it
// up automatically via the tsconfig glob, so no runtime import is
// needed (which would fail under vitest since .d.ts has no JS).

export function requestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.headers['x-request-id'];
    const id =
      typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 128
        ? inbound
        : randomUUID();
    req.id = id;
    res.setHeader('X-Request-ID', id);
    next();
  };
}
