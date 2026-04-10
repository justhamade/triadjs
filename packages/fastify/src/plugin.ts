/**
 * Fastify plugin that mounts a Triad router into a Fastify instance.
 *
 * ```ts
 * import Fastify from 'fastify';
 * import { triadPlugin } from '@triad/fastify';
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
import { Router } from '@triad/core';
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
}

export const triadPlugin: FastifyPluginAsync<TriadPluginOptions> = async (
  fastify,
  options,
) => {
  const { router, services, logError } = options;

  if (!Router.isRouter(router)) {
    throw new TypeError(
      '@triad/fastify: `router` option must be a Triad Router instance created with createRouter().',
    );
  }

  const handlerOptions: CreateHandlerOptions = {};
  if (services !== undefined) handlerOptions.services = services;
  if (logError !== undefined) handlerOptions.logError = logError;

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
      '@triad/fastify: the router contains WebSocket channels but `@fastify/websocket` is not installed. ' +
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

// Re-export so users don't have to add a second import for the default.
export default triadPlugin;
