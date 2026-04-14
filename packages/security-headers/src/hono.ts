/**
 * Hono middleware that sets opinionated security headers on every
 * response.
 *
 * ```ts
 * import { Hono } from 'hono';
 * import { securityHeadersHono } from '@triadjs/security-headers';
 *
 * const app = new Hono();
 * app.use('*', securityHeadersHono({ frameOptions: 'SAMEORIGIN' }));
 * ```
 */

import type { Context, MiddlewareHandler } from 'hono';
import { computeHeaders } from './compute-headers.js';
import { generateNonce } from './nonce.js';
import type { SecurityHeadersOptions } from './types.js';

declare module 'hono' {
  interface ContextVariableMap {
    /** CSP nonce for this request, set when `csp.useNonce` is enabled. */
    cspNonce?: string;
  }
}

export function securityHeadersHono(
  options: SecurityHeadersOptions = {},
): MiddlewareHandler {
  const factory = computeHeaders(options);
  const removePoweredBy = options.removePoweredBy !== false;

  return async (c: Context, next) => {
    let nonce: string | undefined;
    if (factory.requiresNonce) {
      nonce = generateNonce();
      c.set('cspNonce', nonce);
    }
    await next();
    const headers = factory.requiresNonce ? factory(nonce) : factory();
    for (const [name, value] of Object.entries(headers)) {
      c.header(name, value);
    }
    if (removePoweredBy) {
      // Hono's c.header with undefined deletes the header.
      c.header('X-Powered-By', undefined);
    }
  };
}
