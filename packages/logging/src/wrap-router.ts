/**
 * `withLoggingInstrumentation` — opt-in structured-logging wrapper for a
 * Triad router. Mirrors the shape of `@triadjs/otel`'s
 * `withOtelInstrumentation`: walks every endpoint and channel, replaces
 * the handler with one that creates a request-scoped child logger, and
 * runs the original handler inside an `AsyncLocalStorage` so
 * `getLogger()` inside the handler (and anything it `await`s) returns
 * that child logger.
 *
 * ## Why AsyncLocalStorage, not ctx.services.logger
 *
 * Attaching the logger to `ctx.services` would force users to declare
 * `logger: Logger` on their `ServiceContainer` type. Attaching to
 * `ctx.state` is even worse — it would collide with beforeHandler's
 * typed state. `AsyncLocalStorage` is the idiomatic Node pattern for
 * request-scoped context and works without any type coordination.
 *
 * ## Lifecycle
 *
 * Per request:
 *   1. Build a child logger with the request context fields.
 *   2. Run the original handler inside `loggerStorage.run(childLogger, ...)`.
 *   3. Inside the handler, `getLogger()` calls `loggerStorage.getStore()`.
 *   4. After the handler resolves, the store is popped automatically.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Router,
  Endpoint,
  Channel,
  HandlerResponse,
} from '@triadjs/core';
import type { Logger } from './logger.js';

// ---------------------------------------------------------------------------
// AsyncLocalStorage — one per module, shared across all wrappers
// ---------------------------------------------------------------------------

const loggerStorage = new AsyncLocalStorage<Logger>();

/**
 * Retrieve the request-scoped logger. Throws if called outside a
 * logging-wrapped handler (use `tryGetLogger()` for the safe variant).
 */
export function getLogger(): Logger {
  const logger = loggerStorage.getStore();
  if (!logger) {
    throw new Error(
      'getLogger() called outside a logging-wrapped handler. Did you forget to call withLoggingInstrumentation(router, { logger })?',
    );
  }
  return logger;
}

/** Retrieve the request-scoped logger, or `undefined` if none is bound. */
export function tryGetLogger(): Logger | undefined {
  return loggerStorage.getStore();
}

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface LoggingInstrumentationOptions {
  /** The base logger. A child of this logger is bound per request. */
  logger: Logger;
  /** Extract a request id from the handler context. */
  requestId?: (rawCtx: unknown) => string | undefined;
  /** Extract a user id from ctx.state. */
  includeUserFromState?: (state: unknown) => string | undefined;
  /** Static fields added to every request-scoped child logger. */
  staticFields?: Record<string, unknown>;
  /**
   * If `true`, emit `handler.start`, `handler.end`, and `handler.error`
   * lines automatically for each request. Default `false`.
   */
  autoLog?: boolean;
  /** Instrument channel handlers and onConnect. Default `true`. */
  instrumentChannels?: boolean;
}

type ResolvedOptions = {
  logger: Logger;
  requestId?: (rawCtx: unknown) => string | undefined;
  includeUserFromState?: (state: unknown) => string | undefined;
  staticFields: Record<string, unknown>;
  autoLog: boolean;
  instrumentChannels: boolean;
};

function resolveOptions(
  options: LoggingInstrumentationOptions,
): ResolvedOptions {
  const resolved: ResolvedOptions = {
    logger: options.logger,
    staticFields: options.staticFields ?? {},
    autoLog: options.autoLog ?? false,
    instrumentChannels: options.instrumentChannels ?? true,
  };
  if (options.requestId !== undefined) {
    resolved.requestId = options.requestId;
  }
  if (options.includeUserFromState !== undefined) {
    resolved.includeUserFromState = options.includeUserFromState;
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Context-name helpers
// ---------------------------------------------------------------------------

function endpointContextName(router: Router, ep: Endpoint): string {
  return router.contextOf(ep)?.name ?? '';
}

function channelContextName(router: Router, ch: Channel): string {
  return router.contextOf(ch)?.name ?? '';
}

// ---------------------------------------------------------------------------
// Request-context assembly
// ---------------------------------------------------------------------------

function buildEndpointContext(
  endpoint: Endpoint,
  contextName: string,
  ctx: unknown,
  options: ResolvedOptions,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    'triad.endpoint.name': endpoint.name,
    'triad.endpoint.method': endpoint.method,
    'triad.endpoint.path': endpoint.path,
    'triad.context': contextName,
    ...options.staticFields,
  };
  if (options.requestId) {
    const id = options.requestId(ctx);
    if (id !== undefined) fields['request.id'] = id;
  }
  if (options.includeUserFromState) {
    const state = (ctx as { state?: unknown }).state;
    const userId = options.includeUserFromState(state);
    if (userId !== undefined) fields['user.id'] = userId;
  }
  return fields;
}

function buildChannelContext(
  channel: Channel,
  contextName: string,
  messageType: string,
  ctx: unknown,
  options: ResolvedOptions,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    'triad.channel.name': channel.name,
    'triad.channel.message.type': messageType,
    'triad.context': contextName,
    ...options.staticFields,
  };
  if (options.requestId) {
    const id = options.requestId(ctx);
    if (id !== undefined) fields['request.id'] = id;
  }
  if (options.includeUserFromState) {
    const state = (ctx as { state?: unknown }).state;
    const userId = options.includeUserFromState(state);
    if (userId !== undefined) fields['user.id'] = userId;
  }
  return fields;
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

  endpoint.handler = async (ctx) => {
    const fields = buildEndpointContext(endpoint, contextName, ctx, options);
    const childLogger = options.logger.child(fields);
    return loggerStorage.run(childLogger, async (): Promise<HandlerResponse> => {
      if (options.autoLog) childLogger.info('handler.start');
      try {
        const result = await originalHandler(ctx);
        if (options.autoLog) {
          childLogger.info('handler.end', {
            'http.status_code': result.status,
          });
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        childLogger.error('handler.error', { error: message });
        throw err;
      }
    });
  };
}

// ---------------------------------------------------------------------------
// beforeHandler wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap `endpoint.beforeHandler` so that `getLogger()` inside the
 * beforeHandler returns a child logger with endpoint context attached.
 * Without this, the AsyncLocalStorage scope only starts when the main
 * handler runs, so auth code calling `getLogger()` in a beforeHandler
 * would throw. The child logger bound here has an extra
 * `triad.phase: 'beforeHandler'` field so logs from the two phases
 * are trivially filterable in downstream aggregation.
 */
function wrapBeforeHandler(
  endpoint: Endpoint,
  contextName: string,
  options: ResolvedOptions,
): void {
  if (!endpoint.beforeHandler) return;
  const original = endpoint.beforeHandler;

  endpoint.beforeHandler = async (ctx) => {
    const fields = {
      ...buildEndpointContext(endpoint, contextName, ctx, options),
      'triad.phase': 'beforeHandler',
    };
    const childLogger = options.logger.child(fields);
    return loggerStorage.run(childLogger, async () => {
      if (options.autoLog) childLogger.info('beforeHandler.start');
      try {
        const result = await original(ctx);
        if (options.autoLog) {
          if (result.ok === false) {
            childLogger.info('beforeHandler.shortcircuit', {
              'http.status_code': result.response.status,
            });
          } else {
            childLogger.info('beforeHandler.end');
          }
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        childLogger.error('beforeHandler.error', { error: message });
        throw err;
      }
    });
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
  if (channel.onConnect) {
    const original = channel.onConnect;
    channel.onConnect = async (ctx: unknown) => {
      const fields = buildChannelContext(
        channel,
        contextName,
        'onConnect',
        ctx,
        options,
      );
      const childLogger = options.logger.child(fields);
      return loggerStorage.run(childLogger, async () => {
        if (options.autoLog) childLogger.info('channel.connect.start');
        try {
          const result = await original(ctx);
          if (options.autoLog) childLogger.info('channel.connect.end');
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          childLogger.error('channel.connect.error', { error: message });
          throw err;
        }
      });
    };
  }

  for (const messageType of Object.keys(channel.handlers)) {
    const original = channel.handlers[messageType];
    if (!original) continue;
    channel.handlers[messageType] = async (ctx: unknown, data: unknown) => {
      const fields = buildChannelContext(
        channel,
        contextName,
        messageType,
        ctx,
        options,
      );
      const childLogger = options.logger.child(fields);
      return loggerStorage.run(childLogger, async () => {
        if (options.autoLog) childLogger.info('channel.message.start');
        try {
          const result = await original(ctx, data);
          if (options.autoLog) childLogger.info('channel.message.end');
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          childLogger.error('channel.message.error', { error: message });
          throw err;
        }
      });
    };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Instrument a Triad router with structured logging. Mutates the
 * router's endpoints and channels in place and returns the same router
 * instance.
 *
 * ```ts
 * import pino from 'pino';
 * import {
 *   withLoggingInstrumentation,
 *   createPinoLogger,
 *   getLogger,
 * } from '@triadjs/logging';
 *
 * const instrumented = withLoggingInstrumentation(router, {
 *   logger: createPinoLogger(pino()),
 *   autoLog: true,
 *   requestId: (ctx) =>
 *     (ctx as { headers?: Record<string, string> }).headers?.['x-request-id'],
 *   includeUserFromState: (state) =>
 *     (state as { user?: { id: string } }).user?.id,
 * });
 *
 * // anywhere inside a handler:
 * getLogger().info('book.created', { bookId: book.id });
 * ```
 */
export function withLoggingInstrumentation(
  router: Router,
  options: LoggingInstrumentationOptions,
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
