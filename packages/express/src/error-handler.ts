/**
 * Express error-handling middleware that converts Triad adapter errors
 * into JSON responses matching the fastify adapter's envelope shape.
 *
 * The route handler factory catches `RequestValidationError` and
 * `ValidationException` in-band and responds directly, so this
 * middleware is primarily a safety net for errors that escape through
 * `next(err)` — for example, if a user throws a `RequestValidationError`
 * from their own code, or if a handler rejects with an unknown error
 * and the caller wants a JSON envelope instead of express's default
 * HTML error page.
 */

import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { ValidationException } from '@triad/core';
import { RequestValidationError } from './errors.js';

export interface TriadErrorHandlerOptions {
  /** Log hook for server-side 500s. Defaults to `console.error`. */
  logError?: (err: unknown, req: Request) => void;
}

const defaultLogError = (err: unknown, req: Request): void => {
  // eslint-disable-next-line no-console
  console.error('[triad/express] error-handler', { err, url: req.url });
};

/**
 * Create an express error middleware that formats Triad errors with the
 * same JSON envelope as `@triad/fastify`. Register it **after** the
 * Triad router:
 *
 * ```ts
 * app.use(createTriadRouter(router));
 * app.use(triadErrorHandler());
 * ```
 */
export function triadErrorHandler(
  options: TriadErrorHandlerOptions = {},
): ErrorRequestHandler {
  const logError = options.logError ?? defaultLogError;

  return function triadErrorMiddleware(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof RequestValidationError) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: err.message,
        errors: err.errors,
      });
      return;
    }

    if (err instanceof ValidationException) {
      logError(err, req);
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'The server produced an invalid response.',
      });
      return;
    }

    next(err);
  };
}
