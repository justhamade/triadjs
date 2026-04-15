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
  generateOpenAPI,
  generateSwaggerUIHtml,
  resolveDocsOption,
  type DocsOption,
} from '@triadjs/openapi';

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
  /**
   * Serve Swagger UI + the live OpenAPI JSON as built-in routes.
   *
   * - `undefined` (default): on when `NODE_ENV !== 'production'`, off otherwise.
   * - `true`: on with defaults (`path: '/api-docs'`).
   * - `false`: off.
   * - `{ path, title, swaggerUIVersion }`: on with overrides.
   *
   * When enabled, two routes are registered:
   *
   *   GET  {path}                → HTML page with Swagger UI
   *   GET  {path}/openapi.json   → the OpenAPI 3.1 document as JSON
   *
   * The OpenAPI document is generated once at app construction time
   * (not per request), so the dev server pays the cost at startup only.
   *
   * Note: on Cloudflare Workers / Deno Deploy, `NODE_ENV` is typically
   * unset — docs default to on. Set `docs: false` explicitly for edge
   * production deployments.
   */
  docs?: DocsOption;
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

  // Swagger UI + live OpenAPI JSON. Registered AFTER endpoints so a
  // colliding user endpoint at the same path is matched first (Hono
  // is first-match-wins within a route method).
  const resolvedDocs = resolveDocsOption(options.docs, router);
  if (resolvedDocs) {
    const openapiPath = joinDocsPath(resolvedDocs.path, '/openapi.json');
    const collision = router.allEndpoints().find(
      (e) =>
        e.method === 'GET' &&
        (e.path === resolvedDocs.path || e.path === openapiPath),
    );
    if (collision) {
      throw new Error(
        `@triadjs/hono: the router already has a GET ${collision.path} endpoint, ` +
          `which collides with the Swagger UI docs path "${resolvedDocs.path}". ` +
          `Move the docs to a different path via \`docs: { path: '/docs' }\`, ` +
          `or disable docs with \`docs: false\`.`,
      );
    }
    const doc = generateOpenAPI(router);
    const html = generateSwaggerUIHtml({
      title: resolvedDocs.title,
      openapiUrl: openapiPath,
      swaggerUIVersion: resolvedDocs.swaggerUIVersion,
    });
    app.get(openapiPath, (c) => c.json(doc));
    app.get(resolvedDocs.path, (c) => c.html(html));
  }

  return app;
}

/**
 * Concatenate a docs base path and a suffix, handling the root path `/`
 * so the result is never `//openapi.json`.
 */
function joinDocsPath(base: string, suffix: string): string {
  if (base === '/') return suffix;
  return base + suffix;
}
