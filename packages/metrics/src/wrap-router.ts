/**
 * `withMetricsInstrumentation` — opt-in Prometheus metrics
 * instrumentation for a Triad router.
 *
 * Mirrors `@triadjs/otel`'s `withOtelInstrumentation`: walks every
 * endpoint on the router (root + bounded contexts) and replaces the
 * handler with one that measures latency and records a request into
 * the provided collector.
 *
 * The wrapper is a mutation: it modifies `endpoint.handler` in place
 * on the references returned by `router.allEndpoints()` and then
 * returns the same router instance for chainable usage.
 */

import type { Router, Endpoint, Channel, HandlerResponse } from '@triadjs/core';
import type { MetricsCollector } from './collector.js';

export type MetricsInstrumentationOptions = {
  /**
   * Wrap per-message channel handlers too. Default `false` — HTTP
   * endpoints are the primary target and channels introduce an extra
   * metric family.
   */
  instrumentChannels?: boolean;
};

type ResolvedOptions = {
  instrumentChannels: boolean;
};

function resolveOptions(
  options: MetricsInstrumentationOptions,
): ResolvedOptions {
  return {
    instrumentChannels: options.instrumentChannels ?? false,
  };
}

function endpointContextName(router: Router, ep: Endpoint): string {
  return router.contextOf(ep)?.name ?? '';
}

function channelContextName(router: Router, ch: Channel): string {
  return router.contextOf(ch)?.name ?? '';
}

function nowSeconds(): number {
  // process.hrtime.bigint() returns nanoseconds as bigint. Divide by
  // 1e9 through Number() so we stay in the JS float domain.
  return Number(process.hrtime.bigint()) / 1e9;
}

function wrapEndpointHandler(
  endpoint: Endpoint,
  contextName: string,
  collector: MetricsCollector,
): void {
  const originalHandler = endpoint.handler;
  const meta = {
    method: endpoint.method,
    route: endpoint.path,
    endpointName: endpoint.name,
    context: contextName,
  };

  endpoint.handler = async (ctx) => {
    const start = nowSeconds();
    try {
      const result: HandlerResponse = await originalHandler(ctx);
      const latencySeconds = nowSeconds() - start;
      collector.recordRequest({
        ...meta,
        status: result.status,
        latencySeconds,
        error: false,
      });
      return result;
    } catch (err) {
      const latencySeconds = nowSeconds() - start;
      collector.recordRequest({
        ...meta,
        status: 500,
        latencySeconds,
        error: true,
      });
      throw err;
    }
  };
}

function wrapBeforeHandler(
  endpoint: Endpoint,
  contextName: string,
  collector: MetricsCollector,
): void {
  if (!endpoint.beforeHandler) return;
  const original = endpoint.beforeHandler;
  const meta = {
    method: endpoint.method,
    route: endpoint.path,
    endpointName: endpoint.name,
    context: contextName,
  };

  endpoint.beforeHandler = async (ctx) => {
    const start = nowSeconds();
    try {
      const result = await original(ctx);
      const latencySeconds = nowSeconds() - start;
      collector.recordBeforeHandler({
        ...meta,
        latencySeconds,
        outcome: result.ok === false ? 'shortcircuit' : 'ok',
      });
      return result;
    } catch (err) {
      const latencySeconds = nowSeconds() - start;
      collector.recordBeforeHandler({
        ...meta,
        latencySeconds,
        outcome: 'error',
      });
      throw err;
    }
  };
}

function wrapChannelHandlers(
  channel: Channel,
  contextName: string,
  collector: MetricsCollector,
): void {
  for (const messageType of Object.keys(channel.handlers)) {
    const original = channel.handlers[messageType];
    if (!original) continue;
    channel.handlers[messageType] = async (ctx: unknown, data: unknown) => {
      const start = nowSeconds();
      try {
        const result = await original(ctx, data);
        const latencySeconds = nowSeconds() - start;
        collector.recordChannelMessage({
          channel: channel.name,
          messageType,
          context: contextName,
          latencySeconds,
          error: false,
        });
        return result;
      } catch (err) {
        const latencySeconds = nowSeconds() - start;
        collector.recordChannelMessage({
          channel: channel.name,
          messageType,
          context: contextName,
          latencySeconds,
          error: true,
        });
        throw err;
      }
    };
  }
}

/**
 * Instrument a Triad router with Prometheus metrics. Mutates the
 * router's endpoints in place and returns the same router instance.
 *
 * ```ts
 * const collector = createMetricsCollector();
 * const router = createRouter({ ... });
 * router.add(...);
 * withMetricsInstrumentation(router, collector);
 * await app.register(triadPlugin, { router });
 * ```
 *
 * Call once, after all endpoints have been added, and before passing
 * the router to any adapter.
 */
export function withMetricsInstrumentation(
  router: Router,
  collector: MetricsCollector,
  options: MetricsInstrumentationOptions = {},
): Router {
  const resolved = resolveOptions(options);

  for (const endpoint of router.allEndpoints()) {
    const contextName = endpointContextName(router, endpoint);
    wrapEndpointHandler(endpoint, contextName, collector);
    wrapBeforeHandler(endpoint, contextName, collector);
  }

  if (resolved.instrumentChannels) {
    for (const channel of router.allChannels()) {
      const contextName = channelContextName(router, channel);
      wrapChannelHandlers(channel, contextName, collector);
    }
  }

  return router;
}
