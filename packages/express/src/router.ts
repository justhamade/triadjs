/**
 * `createTriadRouter` — build an `express.Router` that mounts every HTTP
 * endpoint in a Triad router.
 *
 * ```ts
 * import express from 'express';
 * import { createTriadRouter, triadErrorHandler } from '@triadjs/express';
 * import router from './src/app.js';
 *
 * const app = express();
 * app.use(express.json());
 * app.use(createTriadRouter(router, {
 *   services: { petRepo, adoptionSaga },
 * }));
 * app.use(triadErrorHandler());
 * app.listen(3000);
 * ```
 *
 * Per-request services factories work the same way they do in
 * `@triadjs/fastify`:
 *
 * ```ts
 * app.use(createTriadRouter(router, {
 *   services: (req) => ({
 *     petRepo: petRepoFor(req.header('x-tenant') ?? 'default'),
 *   }),
 * }));
 * ```
 *
 * Triad uses express-style path syntax (`/pets/:id`) internally, so no
 * path conversion is needed.
 *
 * WebSocket channels are **not** supported by this adapter in v1 — use
 * `@triadjs/fastify` if you need channels.
 */

import { Router as ExpressRouter, type Router as ExpressRouterType } from 'express';
import { Router as TriadRouter, hasFileFields } from '@triadjs/core';
import {
  generateOpenAPI,
  generateSwaggerUIHtml,
  generateAsyncAPIHtml,
  generateDocsLandingHtml,
  resolveDocsOption,
  type DocsOption,
} from '@triadjs/openapi';
import { generateAsyncAPI, toJson as asyncApiToJson } from '@triadjs/asyncapi';

import {
  createRouteHandler,
  type ServicesResolver,
  type CreateHandlerOptions,
} from './adapter.js';
import { createMultipartMiddleware } from './multipart.js';

export interface CreateTriadRouterOptions {
  /**
   * Services injected into `ctx.services`. Either a static object or a
   * factory function called once per request.
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
   * The OpenAPI document is generated once at router construction time
   * (not per request), so the dev server pays the cost at startup only.
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
 * Build an `express.Router` containing one route per endpoint in the
 * Triad router. Mount it with `app.use(...)` or `app.use('/prefix', ...)`.
 */
export function createTriadRouter(
  router: TriadRouter,
  options: CreateTriadRouterOptions = {},
): ExpressRouterType {
  if (!TriadRouter.isRouter(router)) {
    throw new TypeError(
      '@triadjs/express: `router` argument must be a Triad Router instance created with createRouter().',
    );
  }

  const handlerOptions: CreateHandlerOptions = {};
  if (options.services !== undefined) handlerOptions.services = options.services;
  if (options.logError !== undefined) handlerOptions.logError = options.logError;

  const expressRouter = ExpressRouter();

  // Lazily construct a single multer middleware instance shared by all
  // file-bearing endpoints. Endpoints without file fields skip multer
  // entirely and continue to rely on `express.json()` from the host app.
  let multipart: ReturnType<typeof createMultipartMiddleware> | undefined;
  const getMultipart = (): ReturnType<typeof createMultipartMiddleware> => {
    if (!multipart) multipart = createMultipartMiddleware();
    return multipart;
  };

  for (const endpoint of router.allEndpoints()) {
    const method = METHOD_MAP[endpoint.method];
    const handler = createRouteHandler(endpoint, handlerOptions);
    const needsMultipart =
      endpoint.request.body !== undefined && hasFileFields(endpoint.request.body);
    if (needsMultipart) {
      expressRouter[method](endpoint.path, getMultipart(), handler);
    } else {
      expressRouter[method](endpoint.path, handler);
    }
  }

  // API docs: Swagger UI + OpenAPI JSON + (if channels exist) AsyncAPI
  // JSON + AsyncAPI viewer + a landing page linking both.
  const resolvedDocs = resolveDocsOption(options.docs, router);
  if (resolvedDocs) {
    const hasChannels = router.allChannels().length > 0;
    const openapiJsonPath = joinDocsPath(resolvedDocs.path, '/openapi.json');
    const swaggerPath = hasChannels
      ? joinDocsPath(resolvedDocs.path, '/http')
      : resolvedDocs.path;

    // Collision check: Express silently ignores duplicate routes, so
    // check before registering and throw a clear error.
    const docsPaths = [openapiJsonPath, swaggerPath, resolvedDocs.path];
    if (hasChannels) {
      docsPaths.push(
        joinDocsPath(resolvedDocs.path, '/asyncapi.json'),
        joinDocsPath(resolvedDocs.path, '/ws'),
      );
    }
    const collision = router.allEndpoints().find(
      (e) => e.method === 'GET' && docsPaths.includes(e.path),
    );
    if (collision) {
      throw new Error(
        `@triadjs/express: the router already has a GET ${collision.path} endpoint, ` +
          `which collides with the API docs path "${resolvedDocs.path}". ` +
          `Move the docs to a different path via \`docs: { path: '/docs' }\`, ` +
          `or disable docs with \`docs: false\`.`,
      );
    }

    const openapiDoc = generateOpenAPI(router);
    const swaggerHtml = generateSwaggerUIHtml({
      title: resolvedDocs.title,
      openapiUrl: openapiJsonPath,
      swaggerUIVersion: resolvedDocs.swaggerUIVersion,
    });

    expressRouter.get(openapiJsonPath, (_req, res) => {
      res.type('application/json').send(openapiDoc);
    });
    expressRouter.get(swaggerPath, (_req, res) => {
      res.type('text/html; charset=utf-8').send(swaggerHtml);
    });

    if (hasChannels) {
      const asyncapiDoc = generateAsyncAPI(router);
      const asyncapiJsonPath = joinDocsPath(resolvedDocs.path, '/asyncapi.json');
      const asyncapiViewerPath = joinDocsPath(resolvedDocs.path, '/ws');
      const asyncapiJsonStr = asyncApiToJson(asyncapiDoc);
      const asyncapiHtml = generateAsyncAPIHtml({
        title: resolvedDocs.title,
        asyncapiUrl: asyncapiJsonPath,
        doc: asyncapiDoc,
      });
      expressRouter.get(asyncapiJsonPath, (_req, res) => {
        res.type('application/json').send(asyncapiJsonStr);
      });
      expressRouter.get(asyncapiViewerPath, (_req, res) => {
        res.type('text/html; charset=utf-8').send(asyncapiHtml);
      });

      const landingHtml = generateDocsLandingHtml({
        title: resolvedDocs.title,
        openapiPath: swaggerPath,
        asyncapiPath: asyncapiViewerPath,
      });
      expressRouter.get(resolvedDocs.path, (_req, res) => {
        res.type('text/html; charset=utf-8').send(landingHtml);
      });
    }
  }

  return expressRouter;
}

/**
 * Concatenate a docs base path and a suffix, handling the root path `/`
 * so the result is never `//openapi.json`.
 */
function joinDocsPath(base: string, suffix: string): string {
  if (base === '/') return suffix;
  return base + suffix;
}
