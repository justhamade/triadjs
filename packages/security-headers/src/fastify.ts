/**
 * Fastify plugin that sets opinionated security headers on every
 * response.
 *
 * ```ts
 * import Fastify from 'fastify';
 * import { securityHeadersFastify } from '@triad/security-headers';
 *
 * const app = Fastify();
 * await app.register(securityHeadersFastify, {
 *   csp: { directives: { 'script-src': ["'self'", 'https://cdn.example.com'] } },
 * });
 * ```
 *
 * Register BEFORE `@triad/fastify`'s `triadPlugin` so security headers
 * apply to every Triad route without further wiring.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { computeHeaders } from './compute-headers.js';
import { generateNonce } from './nonce.js';
import type { SecurityHeadersOptions } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** CSP nonce for this request, set when `csp.useNonce` is enabled. */
    cspNonce?: string;
  }
}

const plugin: FastifyPluginAsync<SecurityHeadersOptions> =
  async (fastify, options) => {
    const factory = computeHeaders(options);
    const removePoweredBy = options.removePoweredBy !== false;

    fastify.addHook('onRequest', async (request: FastifyRequest) => {
      if (factory.requiresNonce) {
        request.cspNonce = generateNonce();
      }
    });

    fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
      const headers = factory.requiresNonce
        ? factory(request.cspNonce)
        : factory();
      for (const [name, value] of Object.entries(headers)) {
        reply.header(name, value);
      }
      if (removePoweredBy) {
        reply.removeHeader('x-powered-by');
      }
      return payload;
    });
  };

export const securityHeadersFastify = fp(plugin, {
  fastify: '4.x || 5.x',
  name: '@triad/security-headers',
});
