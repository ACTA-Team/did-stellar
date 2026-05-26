/**
 * Type augmentations for Express.
 *
 * `pino-http` populates `req.id` (typed as its own `ReqId`) and the
 * request-id middleware honours any inbound `X-Request-ID` header.
 * Declaring it explicitly here means the rest of the codebase can
 * read `req.id` without a cast.
 */

import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Per-request correlation ID. Always populated by request-id middleware. */
    id?: string;
  }
}
