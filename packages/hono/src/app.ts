/**
 * `createTriadApp` — build a `Hono` app with every HTTP endpoint in a
 * Triad router mounted as a native Hono route.
 *
 * ```ts
 * import { createTriadApp } from '@triadjs/hono';
 * import router from './src/app.js';
 *
 * const app = createTriadApp(router, {
 *   services: { petRepo, adoptionSaga },
 * });
 *
 * // Node.js
 * import { serve } from '@hono/node-server';
 * serve({ fetch: app.fetch, port: 3000 });
 *
 * // Cloudflare Workers / Bun / Deno: just `export default app`.
 * ```
 *
 * Per-request services factories receive the standard Fetch `Request`
 * so you can read headers for tenant lookups, auth, etc:
 *
 * ```ts
 * createTriadApp(router, {
 *   services: (req) => ({
 *     petRepo: petRepoFor(req.headers.get('x-tenant') ?? 'default'),
 *   }),
 * });
 * ```
 *
 * Triad uses express-style path syntax (`/pets/:id`) internally, which
 * is the same as Hono — no path conversion is needed.
 *
 * The returned `Hono` app is composable: mount it under a prefix via
 * `parent.route('/api/v1', triadApp)`.
 *
 * WebSocket channels are **not** supported by this adapter in v1 —
 * Hono's websocket helpers are runtime-specific (different on Bun,
 * Cloudflare, Node). Use `@triadjs/fastify` if you need channels.
 */

import { Hono } from 'hono';
import { Router as TriadRouter } from '@triadjs/core';

import {
  createRouteHandler,
  type ServicesResolver,
  type CreateHandlerOptions,
} from './adapter.js';

export interface CreateTriadAppOptions {
  /**
   * Services injected into `ctx.services`. Either a static object or a
   * factory function called once per request receiving the standard
   * Fetch `Request`.
   */
  services?: ServicesResolver;
  /** Override the default error logger (used for 500s on response-validation failures). */
  logError?: CreateHandlerOptions['logError'];
}

const METHOD_MAP = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

/**
 * Build a fresh `Hono` app containing one route per endpoint in the
 * Triad router.
 */
export function createTriadApp(
  router: TriadRouter,
  options: CreateTriadAppOptions = {},
): Hono {
  if (!TriadRouter.isRouter(router)) {
    throw new TypeError(
      '@triadjs/hono: `router` argument must be a Triad Router instance created with createRouter().',
    );
  }

  const handlerOptions: CreateHandlerOptions = {};
  if (options.services !== undefined) handlerOptions.services = options.services;
  if (options.logError !== undefined) handlerOptions.logError = options.logError;

  const app = new Hono();

  for (const endpoint of router.allEndpoints()) {
    const method = METHOD_MAP[endpoint.method];
    const handler = createRouteHandler(endpoint, handlerOptions);
    app[method](endpoint.path, handler);
  }

  return app;
}
