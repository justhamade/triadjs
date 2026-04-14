/**
 * Express middleware that sets opinionated security headers on every
 * response.
 *
 * ```ts
 * import express from 'express';
 * import { securityHeadersExpress } from '@triadjs/security-headers';
 *
 * const app = express();
 * app.use(securityHeadersExpress({ frameOptions: 'SAMEORIGIN' }));
 * ```
 *
 * Mount this BEFORE your routes — Express runs middleware in
 * registration order, and headers must be set before the response is
 * sent.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { computeHeaders } from './compute-headers.js';
import { generateNonce } from './nonce.js';
import type { SecurityHeadersOptions } from './types.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** CSP nonce for this request, set when `csp.useNonce` is enabled. */
    cspNonce?: string;
  }
}

export function securityHeadersExpress(
  options: SecurityHeadersOptions = {},
): RequestHandler {
  const factory = computeHeaders(options);
  const removePoweredBy = options.removePoweredBy !== false;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (factory.requiresNonce) {
      req.cspNonce = generateNonce();
    }
    const headers = factory.requiresNonce ? factory(req.cspNonce) : factory();
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    if (removePoweredBy) {
      // Express adds X-Powered-By from `res.send` downstream of this
      // middleware — we can't just call removeHeader now. Intercept
      // subsequent writes so the header never reaches the wire.
      const originalSetHeader = res.setHeader.bind(res);
      res.setHeader = function patched(
        name: string,
        value: number | string | readonly string[],
      ): Response {
        if (typeof name === 'string' && name.toLowerCase() === 'x-powered-by') {
          return res;
        }
        originalSetHeader(name, value);
        return res;
      } as Response['setHeader'];
      res.removeHeader('X-Powered-By');
    }
    next();
  };
}
