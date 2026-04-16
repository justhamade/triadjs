/**
 * Fastify plugin that mounts a Triad router into a Fastify instance.
 *
 * ```ts
 * import Fastify from 'fastify';
 * import { triadPlugin } from '@triadjs/fastify';
 * import router from './src/app.js';
 *
 * const app = Fastify({ logger: true });
 * await app.register(triadPlugin, {
 *   router,
 *   services: { petRepo, adoptionSaga },
 * });
 * await app.listen({ port: 3000 });
 * ```
 *
 * Per-request services are also supported — useful for request-scoped DB
 * connections, auth scopes, or multi-tenant apps:
 *
 * ```ts
 * await app.register(triadPlugin, {
 *   router,
 *   services: (request) => ({
 *     petRepo: petRepoFor(request.user.tenantId),
 *     currentUser: request.user,
 *   }),
 * });
 * ```
 *
 * The plugin registers one Fastify route per endpoint. Triad's path
 * syntax (`/pets/:id`) is already what Fastify expects, so no path
 * conversion is needed.
 */

import type { FastifyPluginAsync } from 'fastify';
import { Router, hasFileFields } from '@triadjs/core';
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
import {
  createChannelHandler,
  type CreateChannelHandlerOptions,
} from './channel-adapter.js';

export interface TriadPluginOptions {
  /** The Triad router to mount. */
  router: Router;
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
   * The OpenAPI document is generated once at plugin registration time
   * (not per request), so the dev server pays the cost at startup only.
   */
  docs?: DocsOption;
}

export const triadPlugin: FastifyPluginAsync<TriadPluginOptions> = async (
  fastify,
  options,
) => {
  const { router, services, logError } = options;

  if (!Router.isRouter(router)) {
    throw new TypeError(
      '@triadjs/fastify: `router` option must be a Triad Router instance created with createRouter().',
    );
  }

  const handlerOptions: CreateHandlerOptions = {};
  if (services !== undefined) handlerOptions.services = services;
  if (logError !== undefined) handlerOptions.logError = logError;

  // If any endpoint accepts a file-bearing body, lazily register
  // `@fastify/multipart` so the adapter's multipart parser can run.
  // Defaults: 10MB per file, 10 files per request. Users can override
  // by registering the plugin themselves before `triadPlugin`.
  const needsMultipart = router
    .allEndpoints()
    .some((e) => e.request.body !== undefined && hasFileFields(e.request.body));
  if (needsMultipart) {
    let multipartPlugin: unknown;
    try {
      multipartPlugin = await import('@fastify/multipart');
    } catch (err) {
      throw new Error(
        '@triadjs/fastify: the router contains endpoints with t.file() fields but `@fastify/multipart` is not installed. ' +
          'Run `npm install @fastify/multipart` to enable file upload support.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { cause: err as any },
      );
    }
    const mod = multipartPlugin as {
      default?: unknown;
      fastifyMultipart?: unknown;
    };
    const plugin =
      (mod.default as unknown) ??
      (mod.fastifyMultipart as unknown) ??
      multipartPlugin;
    // Skip re-registering if the consumer already did it.
    const alreadyRegistered =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (fastify as any).hasContentTypeParser === 'function' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fastify as any).hasContentTypeParser('multipart/form-data');
    if (!alreadyRegistered) {
      await fastify.register(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugin as any,
        {
          // Hard ceiling — schema-level `t.file().maxSize(...)` enforces
          // the app-specific cap and produces a clean 400 envelope.
          // This 100MB is a last-resort safeguard against runaway uploads.
          limits: {
            fileSize: 100 * 1024 * 1024,
            files: 10,
          },
        },
      );
    }
  }

  // Intercept Fastify's built-in JSON parse errors and content-type
  // rejections, wrapping them in the standard Triad VALIDATION_ERROR
  // envelope for parity with Hono and Express adapters.
  fastify.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    const statusCode = error.statusCode ?? 0;
    const errorCode = error.code ?? '';

    // JSON parse error: SyntaxError with statusCode 400, or Fastify's
    // FST_ERR_CTP_INVALID_JSON_BODY error code in newer versions.
    if (
      (error instanceof SyntaxError && statusCode === 400) ||
      errorCode === 'FST_ERR_CTP_INVALID_JSON_BODY'
    ) {
      reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message:
          'Request body failed validation: Request body is not valid JSON',
        errors: [
          {
            path: '',
            message: 'Request body is not valid JSON',
            code: 'invalid_json',
          },
        ],
      });
      return;
    }

    // Content-type rejection: Fastify rejects unsupported media types
    // before the route handler runs. Wrap as VALIDATION_ERROR.
    if (
      statusCode === 415 ||
      errorCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      errorCode === 'FST_ERR_CTP_EMPTY_TYPE'
    ) {
      reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message:
          'Request body failed validation: Expected application/json content-type',
        errors: [
          {
            path: '',
            message: 'Expected application/json content-type',
            code: 'invalid_content_type',
          },
        ],
      });
      return;
    }

    // Non-Triad errors: re-throw so Fastify's default behavior continues.
    throw error;
  });

  // Fastify's `register(plugin, { prefix: '/api/v1' })` automatically
  // prefixes every route registered inside the plugin scope. We do NOT
  // apply an additional prefix here — doing so would produce routes like
  // `/api/v1/api/v1/pets`. Users who want a mount prefix should pass it
  // to `register`, not to the plugin options.
  for (const endpoint of router.allEndpoints()) {
    fastify.route({
      method: endpoint.method,
      url: endpoint.path,
      handler: createRouteHandler(fastify, endpoint, handlerOptions),
    });
  }

  // API docs: Swagger UI + OpenAPI JSON + (if channels exist) AsyncAPI
  // JSON + AsyncAPI viewer + a landing page linking both.
  // Registered AFTER endpoints so a user endpoint at the same path
  // wins on collision (it will already have been registered above, and
  // Fastify will throw a duplicate-route error below — we catch it and
  // rethrow with a pointer to the `docs.path` option).
  const resolvedDocs = resolveDocsOption(options.docs, router);
  if (resolvedDocs) {
    const hasChannels = router.allChannels().length > 0;

    // --- OpenAPI ---
    const openapiDoc = generateOpenAPI(router);
    const openapiJsonPath = joinDocsPath(resolvedDocs.path, '/openapi.json');
    const swaggerPath = hasChannels
      ? joinDocsPath(resolvedDocs.path, '/http')
      : resolvedDocs.path;
    const swaggerHtml = generateSwaggerUIHtml({
      title: resolvedDocs.title,
      openapiUrl: openapiJsonPath,
      swaggerUIVersion: resolvedDocs.swaggerUIVersion,
    });

    try {
      fastify.route({
        method: 'GET',
        url: openapiJsonPath,
        handler: async (_request, reply) => {
          reply.type('application/json').send(openapiDoc);
        },
      });
      fastify.route({
        method: 'GET',
        url: swaggerPath,
        handler: async (_request, reply) => {
          reply.type('text/html; charset=utf-8').send(swaggerHtml);
        },
      });

      // --- AsyncAPI (only when channels exist) ---
      if (hasChannels) {
        const asyncapiDoc = generateAsyncAPI(router);
        const asyncapiJsonPath = joinDocsPath(resolvedDocs.path, '/asyncapi.json');
        const asyncapiViewerPath = joinDocsPath(resolvedDocs.path, '/ws');
        const asyncapiHtml = generateAsyncAPIHtml({
          title: resolvedDocs.title,
          asyncapiUrl: asyncapiJsonPath,
        });
        const asyncapiJsonStr = asyncApiToJson(asyncapiDoc);

        fastify.route({
          method: 'GET',
          url: asyncapiJsonPath,
          handler: async (_request, reply) => {
            reply.type('application/json').send(asyncapiJsonStr);
          },
        });
        fastify.route({
          method: 'GET',
          url: asyncapiViewerPath,
          handler: async (_request, reply) => {
            reply.type('text/html; charset=utf-8').send(asyncapiHtml);
          },
        });

        // Landing page at the docs root that links to both
        const landingHtml = generateDocsLandingHtml({
          title: resolvedDocs.title,
          openapiPath: swaggerPath,
          asyncapiPath: asyncapiViewerPath,
        });
        fastify.route({
          method: 'GET',
          url: resolvedDocs.path,
          handler: async (_request, reply) => {
            reply.type('text/html; charset=utf-8').send(landingHtml);
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `@triadjs/fastify: failed to register API docs routes at "${resolvedDocs.path}". ` +
          `This usually means the router already has an endpoint that collides with one of ` +
          `the docs paths. Either remove the colliding endpoint, move the docs to a ` +
          `different path via \`docs: { path: '/docs' }\`, or disable docs with \`docs: false\`. ` +
          `Original error: ${message}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { cause: err as any },
      );
    }
  }

  // WebSocket channels. We register `@fastify/websocket` lazily — it's
  // an optional peer dependency, so HTTP-only routers never incur the
  // import cost and never force the consumer to install a package they
  // don't need. If the user registered a router that actually contains
  // channels but forgot to `npm install @fastify/websocket`, we produce
  // a targeted error message pointing at the missing package.
  const channels = router.allChannels();
  if (channels.length === 0) return;

  let websocketPlugin: unknown;
  try {
    websocketPlugin = await import('@fastify/websocket');
  } catch (err) {
    throw new Error(
      '@triadjs/fastify: the router contains WebSocket channels but `@fastify/websocket` is not installed. ' +
        'Run `npm install @fastify/websocket` (or the equivalent for your package manager) to enable channel support.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { cause: err as any },
    );
  }

  // `@fastify/websocket` ships a CJS module that exposes the plugin as
  // both a default export and a named export depending on how it's
  // imported. Handle both shapes so we're not married to a single
  // module-resolution strategy.
  const pluginModule = websocketPlugin as {
    default?: unknown;
    fastifyWebsocket?: unknown;
  };
  const plugin =
    (pluginModule.default as unknown) ??
    (pluginModule.fastifyWebsocket as unknown) ??
    websocketPlugin;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await fastify.register(plugin as any);

  const channelOptions: CreateChannelHandlerOptions = {};
  if (services !== undefined) channelOptions.services = services;
  if (logError !== undefined) channelOptions.logError = logError;

  for (const channel of channels) {
    fastify.get(
      channel.path,
      { websocket: true },
      // The handler shape is `(socket, request)` when `websocket: true`
      // is set — @fastify/websocket's type augmentation on fastify's
      // RouteShorthandOptions switches the handler signature. We cast
      // to `any` here because Triad's channel handler is declared
      // against `ws.WebSocket` directly and we don't want the plugin's
      // public surface to depend on those generic bounds.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createChannelHandler(fastify, channel, channelOptions) as any,
    );
  }
};

/**
 * Concatenate a docs base path and a suffix, handling the root path `/`
 * so the result is never `//openapi.json`.
 */
function joinDocsPath(base: string, suffix: string): string {
  if (base === '/') return suffix;
  return base + suffix;
}

// Re-export so users don't have to add a second import for the default.
export default triadPlugin;
