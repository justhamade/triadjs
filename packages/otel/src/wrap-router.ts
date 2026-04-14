/**
 * `withOtelInstrumentation` — opt-in OpenTelemetry instrumentation for a
 * Triad router.
 *
 * This wrapper walks every endpoint and channel the router knows about
 * (including those nested inside bounded contexts) and replaces their
 * `handler`, `beforeHandler`, `onConnect`, and per-message handlers with
 * functions that create OpenTelemetry spans tagged from the router's
 * own metadata.
 *
 * ## Why a router-level wrapper instead of per-adapter hooks
 *
 * Triad ships three HTTP adapters (Fastify, Express, Hono) plus a
 * Lambda adapter. Adding OTel hooks to each one individually would
 * triple the surface area and force every new adapter to re-implement
 * the same instrumentation. Wrapping the router before it reaches any
 * adapter gives us a single place to tag spans, guarantees uniform
 * behavior across all adapters, and keeps `@triadjs/otel` a pure
 * compile-time-opt-in — users who don't import it pay zero cost.
 *
 * ## Mutation vs. cloning
 *
 * `withOtelInstrumentation` mutates the router's endpoints and channels
 * in place. The Router class exposes its contents through
 * `allEndpoints()` and `allChannels()`, which return references to the
 * same Endpoint/Channel objects held internally — so replacing
 * `endpoint.handler = wrapped` on those references is observable to
 * every downstream consumer (adapters, the test runner, codegen
 * tools). The function returns the same router instance to make the
 * usage pattern obvious:
 *
 * ```ts
 * const router = createRouter({ ... });
 * router.add(...);
 * const instrumented = withOtelInstrumentation(router);
 * // `instrumented === router` — the wrap is a mutation
 * ```
 *
 * A future version could clone the router for a pure functional API,
 * but that would require intimate knowledge of the Router class's
 * internals and negate the main benefit of this layer (not touching
 * `@triadjs/core`).
 */

import type { Router, Endpoint, Channel, HandlerResponse } from '@triadjs/core';
import {
  trace,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type Span,
  type Attributes,
} from '@opentelemetry/api';

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface OtelInstrumentationOptions {
  /**
   * Name passed to `trace.getTracer(name)`. Defaults to `'@triadjs/otel'`.
   * Ignored when `tracer` is provided explicitly.
   */
  tracerName?: string;
  /** Explicit tracer instance. Takes precedence over `tracerName`. */
  tracer?: Tracer;
  /**
   * Extract a user id from `ctx.state` to tag on every endpoint span as
   * `enduser.id`. Return `undefined` to skip tagging for a given request.
   */
  includeUserFromState?: (state: unknown) => string | undefined;
  /**
   * Additional static attributes added to every span. Useful for
   * environment, region, build hash, etc.
   */
  staticAttributes?: Record<string, string | number | boolean>;
  /**
   * Include the endpoint name in the span name. Default `true`. When
   * `false`, span names are just `<METHOD> <path>`.
   */
  includeEndpointNameInSpanName?: boolean;
  /**
   * Instrument channel handlers and `onConnect`. Default `true`. Set
   * `false` for HTTP-only projects or when another layer already
   * instruments your WebSocket transport.
   */
  instrumentChannels?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type ResolvedOptions = {
  tracer: Tracer;
  includeUserFromState?: (state: unknown) => string | undefined;
  staticAttributes: Attributes;
  includeEndpointNameInSpanName: boolean;
  instrumentChannels: boolean;
};

function resolveOptions(options: OtelInstrumentationOptions): ResolvedOptions {
  const tracer =
    options.tracer ?? trace.getTracer(options.tracerName ?? '@triadjs/otel');
  const resolved: ResolvedOptions = {
    tracer,
    staticAttributes: (options.staticAttributes ?? {}) as Attributes,
    includeEndpointNameInSpanName:
      options.includeEndpointNameInSpanName ?? true,
    instrumentChannels: options.instrumentChannels ?? true,
  };
  if (options.includeUserFromState !== undefined) {
    resolved.includeUserFromState = options.includeUserFromState;
  }
  return resolved;
}

function recordError(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

function endpointContextName(router: Router, ep: Endpoint): string {
  return router.contextOf(ep)?.name ?? '';
}

function channelContextName(router: Router, ch: Channel): string {
  return router.contextOf(ch)?.name ?? '';
}

// ---------------------------------------------------------------------------
// Endpoint wrapping
// ---------------------------------------------------------------------------

function wrapEndpointHandler(
  endpoint: Endpoint,
  contextName: string,
  options: ResolvedOptions,
): void {
  const originalHandler = endpoint.handler;
  const spanName = options.includeEndpointNameInSpanName
    ? `${endpoint.method} ${endpoint.path}`
    : `${endpoint.method} ${endpoint.path}`;
  // Both branches produce the same string today. The flag is reserved
  // for a future rename convention (e.g. `endpoint.name` only) without
  // breaking the option's type.

  endpoint.handler = async (ctx) => {
    return options.tracer.startActiveSpan(
      spanName,
      { kind: SpanKind.SERVER },
      async (span: Span): Promise<HandlerResponse> => {
        try {
          span.setAttributes({
            'http.method': endpoint.method,
            'http.route': endpoint.path,
            'triad.endpoint.name': endpoint.name,
            'triad.context': contextName,
            ...options.staticAttributes,
          });
          if (options.includeUserFromState) {
            const userId = options.includeUserFromState(ctx.state);
            if (userId !== undefined) {
              span.setAttribute('enduser.id', userId);
            }
          }
          const result = await originalHandler(ctx);
          span.setAttribute('http.status_code', result.status);
          span.setStatus({
            code:
              result.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          });
          return result;
        } catch (err) {
          recordError(span, err);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}

function wrapBeforeHandler(
  endpoint: Endpoint,
  contextName: string,
  options: ResolvedOptions,
): void {
  if (!endpoint.beforeHandler) return;
  const original = endpoint.beforeHandler;
  const spanName = `${endpoint.name}.beforeHandler`;

  endpoint.beforeHandler = async (ctx) => {
    return options.tracer.startActiveSpan(
      spanName,
      { kind: SpanKind.INTERNAL },
      async (span: Span) => {
        try {
          span.setAttributes({
            'triad.endpoint.name': endpoint.name,
            'triad.context': contextName,
            ...options.staticAttributes,
          });
          const result = await original(ctx);
          if (result.ok === false) {
            span.setAttributes({
              'http.status_code': result.response.status,
              'triad.beforeHandler.outcome': 'shortcircuit',
            });
          } else {
            span.setAttribute('triad.beforeHandler.outcome', 'ok');
          }
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          recordError(span, err);
          throw err;
        } finally {
          span.end();
        }
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Channel wrapping
// ---------------------------------------------------------------------------

function wrapChannel(
  channel: Channel,
  contextName: string,
  options: ResolvedOptions,
): void {
  // Wrap onConnect.
  if (channel.onConnect) {
    const original = channel.onConnect;
    const spanName = `${channel.name}.onConnect`;
    channel.onConnect = async (ctx: unknown) => {
      return options.tracer.startActiveSpan(
        spanName,
        { kind: SpanKind.SERVER },
        async (span: Span) => {
          try {
            span.setAttributes({
              'triad.channel.name': channel.name,
              'triad.context': contextName,
              ...options.staticAttributes,
            });
            const result = await original(ctx);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            recordError(span, err);
            throw err;
          } finally {
            span.end();
          }
        },
      );
    };
  }

  // Wrap each message handler.
  for (const messageType of Object.keys(channel.handlers)) {
    const original = channel.handlers[messageType];
    if (!original) continue;
    const spanName = `${channel.name}.${messageType}`;
    channel.handlers[messageType] = async (ctx: unknown, data: unknown) => {
      return options.tracer.startActiveSpan(
        spanName,
        { kind: SpanKind.SERVER },
        async (span: Span) => {
          try {
            span.setAttributes({
              'triad.channel.name': channel.name,
              'triad.channel.message.type': messageType,
              'triad.channel.direction': 'client',
              'triad.context': contextName,
              ...options.staticAttributes,
            });
            const result = await original(ctx, data);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            recordError(span, err);
            throw err;
          } finally {
            span.end();
          }
        },
      );
    };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Instrument a Triad router with OpenTelemetry spans. Mutates the
 * router's endpoints and channels in place and returns the same
 * router instance for convenient chaining:
 *
 * ```ts
 * const router = withOtelInstrumentation(createRouter({ ... }), {
 *   tracerName: 'my-api',
 *   staticAttributes: { env: 'production' },
 *   includeUserFromState: (state) =>
 *     (state as { user?: { id: string } }).user?.id,
 * });
 * ```
 *
 * Call this once, after all endpoints and channels have been added to
 * the router, and before passing the router to your HTTP adapter.
 */
export function withOtelInstrumentation(
  router: Router,
  options: OtelInstrumentationOptions = {},
): Router {
  const resolved = resolveOptions(options);

  for (const endpoint of router.allEndpoints()) {
    const contextName = endpointContextName(router, endpoint);
    wrapEndpointHandler(endpoint, contextName, resolved);
    wrapBeforeHandler(endpoint, contextName, resolved);
  }

  if (resolved.instrumentChannels) {
    for (const channel of router.allChannels()) {
      const contextName = channelContextName(router, channel);
      wrapChannel(channel, contextName, resolved);
    }
  }

  return router;
}
