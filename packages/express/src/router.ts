/**
 * `createTriadRouter` — build an `express.Router` that mounts every HTTP
 * endpoint in a Triad router.
 *
 * ```ts
 * import express from 'express';
 * import { createTriadRouter, triadErrorHandler } from '@triad/express';
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
 * `@triad/fastify`:
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
 * `@triad/fastify` if you need channels.
 */

import { Router as ExpressRouter, type Router as ExpressRouterType } from 'express';
import { Router as TriadRouter, hasFileFields } from '@triad/core';

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
      '@triad/express: `router` argument must be a Triad Router instance created with createRouter().',
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

  return expressRouter;
}
