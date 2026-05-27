/**
 * Express 5 final error handler.
 *
 * Catches unhandled rejections from any async route, maps them via
 * {@link httpFromUnknown}, and emits the canonical JSON error
 * envelope. Logs every 5xx through the request-scoped pino logger.
 */

import { httpFromUnknown } from '../lib/errors';

import type { ErrorRequestHandler, Request, Response } from 'express';

export const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, _next) => {
  const http = httpFromUnknown(err);
  if (http.status >= 500) {
    req.log?.error({ err, code: http.body.code }, 'unhandled error');
  } else if (http.status >= 400 && req.log?.debug) {
    req.log.debug({ code: http.body.code }, 'client error');
  }
  if (!res.headersSent) {
    res.status(http.status).json(http.body);
  }
};
