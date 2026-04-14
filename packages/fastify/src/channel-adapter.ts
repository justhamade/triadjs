/**
 * Channel adapter: convert a single Triad `Channel` into a Fastify
 * WebSocket handler suitable for `@fastify/websocket`.
 *
 * The HTTP adapter (`./adapter.ts`) has a one-shot shape: validate the
 * incoming request, run the handler, dispatch the response, done. A
 * WebSocket adapter is different in three structural ways:
 *
 *   1. **Two validation moments, not one.** The handshake validates
 *      params/query/headers — same machinery as HTTP. After that, every
 *      incoming envelope needs its own schema lookup against the
 *      channel's `clientMessages[type]`.
 *   2. **Outgoing messages instead of a single response.** A handler can
 *      emit any number of server messages via `ctx.broadcast.*`,
 *      `ctx.broadcastOthers.*`, or `ctx.send.*`. Each of those is
 *      validated against `serverMessages[type]` on the way out — the
 *      same guarantee `ctx.respond[status]` gives HTTP endpoints.
 *   3. **A per-channel connection registry.** "Broadcast" means "push
 *      to every other connection in the same room". `ChannelHub` is
 *      that registry, scoped by the resolved path parameters so
 *      `/ws/rooms/abc` and `/ws/rooms/xyz` are isolated rooms without
 *      the user having to implement that plumbing themselves.
 *
 * Wire format: JSON envelopes `{ type: string, data: unknown }`. Both
 * directions use the same shape. Adapter-level errors (bad JSON,
 * unknown message type, handshake rejection, internal errors) are sent
 * as `{ type: 'error', data: { code, message, details? } }` and are
 * NOT validated against the channel's `serverMessages.error` — the
 * channel may not declare an `error` server message at all, and even
 * when it does, the adapter's error shape is a framework concern, not
 * a domain message.
 *
 * Close codes:
 *   - `4400` — request validation error on the handshake
 *   - `4500` — internal server error (thrown from `onConnect` etc.)
 *   - `4000 + httpCode` — user rejected via `ctx.reject(httpCode, msg)`
 *
 * We use structural `kind` checks rather than `instanceof` everywhere
 * we introspect schemas or channels, so this module keeps working when
 * routers are loaded through jiti or bundler aliases that produce a
 * second copy of `@triadjs/core`.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import {
  type Channel,
  type ModelShape,
  type ServiceContainer,
  type ValidationError,
  ValidationException,
} from '@triadjs/core';

import { RequestValidationError } from './errors.js';
import { coerceByShape } from './coerce.js';
import type { ServicesResolver } from './adapter.js';

// ---------------------------------------------------------------------------
// Connection registry
// ---------------------------------------------------------------------------

/**
 * One live connection tracked by the hub. We deliberately keep this
 * shape small and mutable — the socket is the source of truth, the
 * params/query/headers are the validated handshake data, and `state`
 * is the per-connection bag that handlers mutate.
 *
 * `rejected` is flipped on by `ctx.reject()` during `onConnect` so the
 * outer handler knows to skip registration and abort without running
 * the message loop.
 */
export interface ChannelConnection {
  socket: WebSocket;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  state: Record<string, unknown>;
  rejected: boolean;
}

/**
 * Stable key for grouping connections by their resolved path params.
 *
 * Broadcasts in a Triad channel are scoped to the same "room", and a
 * room is defined by the path parameters — two clients on
 * `/ws/rooms/abc` share a room, a client on `/ws/rooms/xyz` does not.
 * Sorting the entries before joining guarantees that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash to the same key regardless
 * of iteration order.
 *
 * A channel with no path params produces the empty string — all its
 * connections land in one global room, which is the correct behavior
 * for channels like `/ws/notifications` that have no room dimension.
 */
function paramsKey(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${String(v)}`).join('|');
}

/**
 * Per-channel connection registry, grouped by params key.
 *
 * This is intentionally an in-process `Map` — enough for single-
 * instance deployments and test scenarios. Multi-node fan-out is a
 * separate concern that would sit behind a pubsub interface in a
 * later phase; it doesn't change the shape of this API.
 */
export class ChannelHub {
  private readonly groups = new Map<string, Set<ChannelConnection>>();

  register(record: ChannelConnection): void {
    const key = paramsKey(record.params);
    let group = this.groups.get(key);
    if (!group) {
      group = new Set();
      this.groups.set(key, group);
    }
    group.add(record);
  }

  unregister(record: ChannelConnection): void {
    const key = paramsKey(record.params);
    const group = this.groups.get(key);
    if (!group) return;
    group.delete(record);
    if (group.size === 0) {
      this.groups.delete(key);
    }
  }

  /**
   * Every connection that shares the same room as `record`, including
   * `record` itself. Returns an empty set when the record is not
   * registered (e.g. during `onConnect` before registration happens).
   */
  groupOf(record: ChannelConnection): Set<ChannelConnection> {
    const key = paramsKey(record.params);
    return this.groups.get(key) ?? new Set();
  }

  /** Diagnostic helper — total number of live connections in every group. */
  size(): number {
    let count = 0;
    for (const group of this.groups.values()) count += group.size;
    return count;
  }
}

// ---------------------------------------------------------------------------
// Handshake validation
// ---------------------------------------------------------------------------

type NormalizedPart = {
  readonly shape: ModelShape;
  readonly validate: (
    data: unknown,
  ) =>
    | { success: true; data: unknown }
    | { success: false; errors: ValidationError[] };
};

function connectionPart(
  channel: Channel,
  part: 'params' | 'query' | 'headers',
): NormalizedPart | undefined {
  const model = channel.connection[part];
  if (!model) return undefined;
  return {
    shape: model.shape as ModelShape,
    validate: (data) => model.validate(data),
  };
}

/**
 * Validate a single handshake part. URL-sourced data arrives as strings
 * (query, path params, headers) so we run the same `coerceByShape`
 * helper the HTTP adapter uses before calling `validate`. A failure
 * throws the shared `RequestValidationError` — the caller maps it to
 * an error envelope + 4400 close.
 */
function validateHandshakePart(
  channel: Channel,
  part: 'params' | 'query' | 'headers',
  raw: unknown,
): Record<string, unknown> {
  const spec = connectionPart(channel, part);
  if (!spec) {
    // No declared schema — pass through whatever the framework gave us,
    // normalized to an object so handlers always see a consistent shape.
    if (raw === null || raw === undefined || typeof raw !== 'object') {
      return {};
    }
    return { ...(raw as Record<string, unknown>) };
  }
  const coerced = coerceByShape(spec.shape, raw);
  const result = spec.validate(coerced);
  if (!result.success) {
    throw new RequestValidationError(part, result.errors);
  }
  return result.data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Outgoing maps
// ---------------------------------------------------------------------------

type OutgoingScope = 'send' | 'broadcast' | 'broadcastOthers';

/**
 * The raw `ws` constants aren't re-exported cleanly across dual
 * CJS/ESM builds, so we inline the value. `1` is OPEN per the
 * WebSocket spec — every `ws` version agrees on this.
 */
const WS_OPEN = 1;

function safeWrite(socket: WebSocket, payload: string): void {
  if ((socket as unknown as { readyState: number }).readyState !== WS_OPEN) {
    return;
  }
  socket.send(payload);
}

function encodeEnvelope(type: string, data: unknown): string {
  return JSON.stringify({ type, data });
}

/**
 * Build the `ctx.broadcast` / `ctx.broadcastOthers` / `ctx.send` map
 * for a specific scope and connection.
 *
 * Each entry validates its argument against the channel's declared
 * server-message schema via `.parse()`, which throws
 * `ValidationException` on mismatch. We deliberately let that
 * exception propagate — the caller (the message handler wrapper)
 * catches it, logs, and emits an adapter-level error envelope. This
 * preserves the HTTP guarantee that a handler can never ship an
 * undeclared payload shape to a client.
 */
function buildOutgoingMap(
  channel: Channel,
  scope: OutgoingScope,
  hub: ChannelHub,
  record: ChannelConnection,
): Record<string, (data: unknown) => void> {
  const map: Record<string, (data: unknown) => void> = {};
  for (const [type, config] of Object.entries(channel.serverMessages)) {
    map[type] = (data: unknown) => {
      const validated = config.schema.parse(data);
      const envelope = encodeEnvelope(type, validated);

      if (scope === 'send') {
        safeWrite(record.socket, envelope);
        return;
      }

      const group = hub.groupOf(record);
      for (const peer of group) {
        if (scope === 'broadcastOthers' && peer === record) continue;
        safeWrite(peer.socket, envelope);
      }
    };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Adapter-level error envelopes
// ---------------------------------------------------------------------------

interface AdapterErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Adapter-level errors are framework-owned, not domain-owned — they
 * describe what the transport couldn't do (bad JSON, unknown message
 * type, handshake failure) rather than a business-level problem. We
 * therefore do NOT validate them against `channel.serverMessages.error`.
 * The channel is free to declare its own `error` server message with a
 * totally different shape; there's no collision because these only
 * ever flow from the adapter itself.
 */
function sendAdapterError(
  socket: WebSocket,
  payload: AdapterErrorPayload,
): void {
  safeWrite(socket, encodeEnvelope('error', payload));
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export interface CreateChannelHandlerOptions {
  services?: ServicesResolver;
  /** Log hook for server-side failures (defaults to `fastify.log.error`). */
  logError?: (err: unknown, request: FastifyRequest) => void;
}

/**
 * A Fastify-websocket handler signature: `(socket, request)`. We
 * return `Promise<void>` so async work (service resolution, onConnect)
 * can happen before the message loop starts.
 */
export type ChannelHandler = (
  socket: WebSocket,
  request: FastifyRequest,
) => Promise<void>;

async function resolveServices(
  services: ServicesResolver | undefined,
  request: FastifyRequest,
): Promise<ServiceContainer> {
  if (services === undefined) return {} as ServiceContainer;
  if (typeof services === 'function') {
    return await services(request);
  }
  return services;
}

/**
 * Build a `@fastify/websocket` handler for a single Triad channel.
 *
 * Each channel gets its own hub — the scoping-by-path-params logic
 * lives inside the hub, not in any cross-channel registry, so two
 * channels never share connections even if they happen to produce the
 * same params key.
 */
export function createChannelHandler(
  fastify: FastifyInstance,
  channel: Channel,
  options: CreateChannelHandlerOptions = {},
): ChannelHandler {
  const hub = new ChannelHub();
  const logError =
    options.logError ??
    ((err, request) =>
      fastify.log.error(
        { err, url: request.url, channel: channel.name },
        'Triad channel error',
      ));

  return async function triadChannelHandler(
    socket: WebSocket,
    request: FastifyRequest,
  ) {
    // ---- 0. beforeHandler ------------------------------------------------
    // Runs BEFORE schema validation so auth can reject before 4400.
    // If beforeHandler needs services, we resolve them early and
    // reuse the same instance for step 2.
    let beforeState: Record<string, unknown> = {};
    let earlyServices: ServiceContainer | undefined;
    if (channel.beforeHandler) {
      try {
        earlyServices = await resolveServices(options.services, request);

        const rawParams =
          typeof request.params === 'object' && request.params !== null
            ? { ...(request.params as Record<string, unknown>) }
            : {};
        const rawQuery =
          typeof request.query === 'object' && request.query !== null
            ? { ...(request.query as Record<string, unknown>) }
            : {};
        const rawHeaders =
          typeof request.headers === 'object' && request.headers !== null
            ? { ...(request.headers as Record<string, unknown>) }
            : {};

        const beforeResult = await channel.beforeHandler({
          rawParams,
          rawQuery,
          rawHeaders,
          services: earlyServices,
        });
        if (!beforeResult.ok) {
          sendAdapterError(socket, {
            code: 'CONNECTION_REJECTED',
            message: beforeResult.message,
            details: { httpCode: beforeResult.code },
          });
          socket.close(4000 + beforeResult.code, beforeResult.message);
          return;
        }
        beforeState = (beforeResult.state ?? {}) as Record<string, unknown>;
      } catch (err) {
        logError(err, request);
        sendAdapterError(socket, {
          code: 'INTERNAL_ERROR',
          message: 'beforeHandler failed.',
        });
        socket.close(4500, 'internal error');
        return;
      }
    }

    // ---- 1. Handshake validation -----------------------------------------
    //
    // When `channel.connection.validateBeforeConnect` is `true` (the
    // default), any schema failure here closes the socket with 4400
    // BEFORE `onConnect` runs. When it's `false`, we capture the first
    // validation error and defer it into `ctx.validationError` so
    // `onConnect` can render a custom rejection. If `onConnect` does
    // NOT call `reject` explicitly when a validationError is present,
    // we fall back to the standard close below.
    let params: Record<string, unknown> = {};
    let query: Record<string, unknown> = {};
    let headers: Record<string, unknown> = {};
    let deferredValidationError: RequestValidationError | undefined;
    const validateDeferred =
      channel.connection.validateBeforeConnect === false;

    const runValidation = (): RequestValidationError | undefined => {
      try {
        params = validateHandshakePart(channel, 'params', request.params);
        query = validateHandshakePart(channel, 'query', request.query);
        headers = validateHandshakePart(channel, 'headers', request.headers);
        return undefined;
      } catch (err) {
        if (err instanceof RequestValidationError) {
          return err;
        }
        throw err;
      }
    };

    try {
      const validationErr = runValidation();
      if (validationErr) {
        if (!validateDeferred) {
          sendAdapterError(socket, {
            code: 'VALIDATION_ERROR',
            message: validationErr.message,
            details: validationErr.errors,
          });
          socket.close(4400, 'validation error');
          return;
        }
        // Defer: best-effort populate params/query/headers with the
        // raw request values so onConnect still has something to
        // inspect. The user is opting into seeing malformed input.
        params =
          typeof request.params === 'object' && request.params !== null
            ? { ...(request.params as Record<string, unknown>) }
            : {};
        query =
          typeof request.query === 'object' && request.query !== null
            ? { ...(request.query as Record<string, unknown>) }
            : {};
        headers =
          typeof request.headers === 'object' && request.headers !== null
            ? { ...(request.headers as Record<string, unknown>) }
            : {};
        deferredValidationError = validationErr;
      }
    } catch (err) {
      logError(err, request);
      sendAdapterError(socket, {
        code: 'INTERNAL_ERROR',
        message: 'Handshake failed.',
      });
      socket.close(4500, 'internal error');
      return;
    }

    // ---- 2. Service resolution -------------------------------------------
    // Reuse services if already resolved by beforeHandler.
    let services: ServiceContainer;
    if (earlyServices) {
      services = earlyServices;
    } else {
      try {
        services = await resolveServices(options.services, request);
      } catch (err) {
        logError(err, request);
        sendAdapterError(socket, {
          code: 'INTERNAL_ERROR',
          message: 'Service resolution failed.',
        });
        socket.close(4500, 'internal error');
        return;
      }
    }

    // ---- 3. Connection record --------------------------------------------
    const record: ChannelConnection = {
      socket,
      params,
      query,
      headers,
      state: { ...beforeState },
      rejected: false,
    };

    // ---- 4. onConnect context --------------------------------------------
    // The broadcast map here is built BEFORE registration, so an
    // `onConnect` that emits a presence broadcast only reaches
    // existing peers — the newcomer isn't in the hub yet, which
    // matches the "who's already here" semantics users expect.
    const connectBroadcast = buildOutgoingMap(
      channel,
      'broadcast',
      hub,
      record,
    );
    const buildConnectCtx = (authPayload?: unknown): {
      params: Record<string, unknown>;
      query: Record<string, unknown>;
      headers: Record<string, unknown>;
      services: ServiceContainer;
      state: Record<string, unknown>;
      reject: (code: number, message: string) => void;
      broadcast: Record<string, (data: unknown) => void>;
      authPayload?: unknown;
      validationError?: readonly ValidationError[];
    } => {
      const ctx: {
        params: Record<string, unknown>;
        query: Record<string, unknown>;
        headers: Record<string, unknown>;
        services: ServiceContainer;
        state: Record<string, unknown>;
        reject: (code: number, message: string) => void;
        broadcast: Record<string, (data: unknown) => void>;
        authPayload?: unknown;
        validationError?: readonly ValidationError[];
      } = {
        params,
        query,
        headers,
        services,
        state: record.state,
        reject: (code: number, message: string) => {
          record.rejected = true;
          sendAdapterError(socket, {
            code: 'CONNECTION_REJECTED',
            message,
            details: { httpCode: code },
          });
          socket.close(4000 + code, message);
        },
        broadcast: connectBroadcast,
        authPayload,
      };
      if (deferredValidationError) {
        ctx.validationError = deferredValidationError.errors;
      }
      return ctx;
    };

    // ---- 4a. First-message auth: defer onConnect ------------------------
    // When the channel opts into first-message auth, we install a
    // temporary `message` listener that awaits exactly one frame of
    // the declared auth type. If it arrives in time and validates,
    // we run `onConnect` with the parsed payload in `ctx.authPayload`
    // and hand off to the normal message loop. Anything else closes
    // the socket with 4401.
    const runOnConnect = async (authPayload?: unknown): Promise<boolean> => {
      if (!channel.onConnect) return true;
      const ctx = buildConnectCtx(authPayload);
      try {
        await channel.onConnect(ctx);
        return true;
      } catch (err) {
        if (err instanceof ValidationException) {
          logError(err, request);
          sendAdapterError(socket, {
            code: 'INTERNAL_ERROR',
            message: 'onConnect produced an invalid outgoing message.',
          });
        } else {
          logError(err, request);
          sendAdapterError(socket, {
            code: 'INTERNAL_ERROR',
            message: 'onConnect failed.',
          });
        }
        socket.close(4500, 'internal error');
        return false;
      }
    };

    // Build the message-context base factory — used by both the
    // normal flow and the first-message auth flow once onConnect
    // completes. It references `record` which is stable for the life
    // of the connection.
    const buildMessageCtxBase = (): {
      params: Record<string, unknown>;
      services: ServiceContainer;
      state: Record<string, unknown>;
      broadcast: Record<string, (data: unknown) => void>;
      broadcastOthers: Record<string, (data: unknown) => void>;
      send: Record<string, (data: unknown) => void>;
    } => ({
      params,
      services,
      state: record.state,
      broadcast: buildOutgoingMap(channel, 'broadcast', hub, record),
      broadcastOthers: buildOutgoingMap(
        channel,
        'broadcastOthers',
        hub,
        record,
      ),
      send: buildOutgoingMap(channel, 'send', hub, record),
    });

    if (channel.auth.strategy === 'first-message') {
      await runFirstMessageAuthFlow({
        channel,
        socket,
        request,
        record,
        hub,
        runOnConnect,
        buildMessageCtxBase,
        logError,
      });
      return;
    }

    // ---- 4b. Header / none strategy: run onConnect now ------------------
    if (channel.onConnect) {
      const ok = await runOnConnect(undefined);
      if (!ok) return;
    }

    if (record.rejected) {
      // `ctx.reject` already sent the envelope and closed the socket.
      return;
    }

    // Deferred-validation fallback: if validation failed earlier and
    // onConnect did NOT reject explicitly, close now with the standard
    // validation envelope. The channel opted into seeing the error;
    // we don't silently let a malformed handshake proceed.
    if (deferredValidationError) {
      sendAdapterError(socket, {
        code: 'VALIDATION_ERROR',
        message: deferredValidationError.message,
        details: deferredValidationError.errors,
      });
      socket.close(4400, 'validation error');
      return;
    }

    // ---- 5. Register and wire message loop -------------------------------
    hub.register(record);

    const messageCtxBase = buildMessageCtxBase();

    installMessageLoop({
      channel,
      socket,
      request,
      hub,
      record,
      messageCtxBase,
      logError,
    });
    return;
  };
}

// ---------------------------------------------------------------------------
// Message loop installation (shared by header-auth and first-message flows)
// ---------------------------------------------------------------------------

interface InstallMessageLoopArgs {
  channel: Channel;
  socket: WebSocket;
  request: FastifyRequest;
  hub: ChannelHub;
  record: ChannelConnection;
  messageCtxBase: {
    params: Record<string, unknown>;
    services: ServiceContainer;
    state: Record<string, unknown>;
    broadcast: Record<string, (data: unknown) => void>;
    broadcastOthers: Record<string, (data: unknown) => void>;
    send: Record<string, (data: unknown) => void>;
  };
  logError: (err: unknown, request: FastifyRequest) => void;
}

function installMessageLoop(args: InstallMessageLoopArgs): void {
  const { channel, socket, request, hub, record, messageCtxBase, logError } =
    args;

  const onMessage = async (rawMessage: unknown): Promise<void> => {
      // `ws` hands us Buffers by default — coerce to string for JSON
      // parsing. We tolerate pre-stringified input too in case a
      // caller configured the socket differently.
      const text =
        typeof rawMessage === 'string'
          ? rawMessage
          : Buffer.isBuffer(rawMessage)
            ? rawMessage.toString('utf8')
            : String(rawMessage);

      // ---- 5a. Envelope parse -------------------------------------------
      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        sendAdapterError(socket, {
          code: 'INVALID_JSON',
          message: 'Message payload was not valid JSON.',
        });
        return;
      }

      if (
        typeof envelope !== 'object' ||
        envelope === null ||
        typeof (envelope as { type?: unknown }).type !== 'string'
      ) {
        sendAdapterError(socket, {
          code: 'INVALID_ENVELOPE',
          message: 'Messages must be objects with a string `type` field.',
        });
        return;
      }

      const { type, data } = envelope as { type: string; data: unknown };

      // ---- 5b. Unknown type ---------------------------------------------
      const messageConfig = channel.clientMessages[type];
      if (!messageConfig) {
        sendAdapterError(socket, {
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Channel does not accept messages of type "${type}".`,
        });
        return;
      }

      // ---- 5c. Payload validation ---------------------------------------
      const result = messageConfig.schema.validate(data);
      if (!result.success) {
        sendAdapterError(socket, {
          code: 'VALIDATION_ERROR',
          message: `Invalid payload for message "${type}".`,
          details: result.errors,
        });
        return;
      }

      // ---- 5d. Handler dispatch -----------------------------------------
      const handler = channel.handlers[type];
      if (!handler) {
        // Declared in clientMessages but no handler — user bug. Surface
        // it loudly but keep the socket open so other types still work.
        sendAdapterError(socket, {
          code: 'NO_HANDLER',
          message: `Channel has no handler for message "${type}".`,
        });
        return;
      }

      try {
        await handler(messageCtxBase, result.data);
      } catch (err) {
        if (err instanceof ValidationException) {
          // A server-message outgoing validation failure — server bug,
          // never leak the bad payload, but don't tear down the socket.
          logError(err, request);
          sendAdapterError(socket, {
            code: 'INTERNAL_ERROR',
            message: 'The server produced an invalid outgoing message.',
          });
          return;
        }
        logError(err, request);
        sendAdapterError(socket, {
          code: 'INTERNAL_ERROR',
          message: 'Message handler failed.',
        });
      }
    };

  socket.on('message', (raw: unknown) => {
    void onMessage(raw);
  });

  socket.on('error', (err: unknown) => {
    logError(err, request);
  });

  socket.on('close', () => {
    hub.unregister(record);
    if (channel.onDisconnect) {
      try {
        const disconnectCtx = {
          params: messageCtxBase.params,
          query: record.query,
          headers: record.headers,
          services: messageCtxBase.services,
          state: record.state,
          reject: () => {
            /* no-op after disconnect */
          },
          broadcast: messageCtxBase.broadcast,
        };
        const maybePromise = channel.onDisconnect(disconnectCtx);
        if (
          maybePromise &&
          typeof (maybePromise as Promise<void>).then === 'function'
        ) {
          (maybePromise as Promise<void>).catch((err: unknown) => {
            logError(err, request);
          });
        }
      } catch (err) {
        logError(err, request);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// First-message auth flow
// ---------------------------------------------------------------------------

interface FirstMessageAuthArgs {
  channel: Channel;
  socket: WebSocket;
  request: FastifyRequest;
  record: ChannelConnection;
  hub: ChannelHub;
  runOnConnect: (authPayload: unknown) => Promise<boolean>;
  buildMessageCtxBase: () => {
    params: Record<string, unknown>;
    services: ServiceContainer;
    state: Record<string, unknown>;
    broadcast: Record<string, (data: unknown) => void>;
    broadcastOthers: Record<string, (data: unknown) => void>;
    send: Record<string, (data: unknown) => void>;
  };
  logError: (err: unknown, request: FastifyRequest) => void;
}

/**
 * Run the first-message auth dance: wait for exactly one message of
 * the declared `auth.firstMessageType`, validate it against the
 * corresponding `clientMessages[type]` schema, then run `onConnect`
 * with the parsed payload in `ctx.authPayload`. Any other first
 * message, or a timeout, closes the socket with code 4401.
 */
async function runFirstMessageAuthFlow(
  args: FirstMessageAuthArgs,
): Promise<void> {
  const {
    channel,
    socket,
    request,
    record,
    hub,
    runOnConnect,
    buildMessageCtxBase,
    logError,
  } = args;
  const authType = channel.auth.firstMessageType;
  const timeoutMs = channel.auth.timeoutMs;

  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    socket.off('message', firstMessageHandler);
    sendAdapterError(socket, {
      code: 'AUTH_TIMEOUT',
      message: 'Auth timeout',
    });
    socket.close(4401, 'Auth timeout');
  }, timeoutMs);

  function firstMessageHandler(rawMessage: unknown): void {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.off('message', firstMessageHandler);

    const text =
      typeof rawMessage === 'string'
        ? rawMessage
        : Buffer.isBuffer(rawMessage)
          ? rawMessage.toString('utf8')
          : String(rawMessage);

    let envelope: unknown;
    try {
      envelope = JSON.parse(text);
    } catch {
      sendAdapterError(socket, {
        code: 'INVALID_JSON',
        message: 'Auth message was not valid JSON.',
      });
      socket.close(4401, 'Expected auth message');
      return;
    }

    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      typeof (envelope as { type?: unknown }).type !== 'string'
    ) {
      sendAdapterError(socket, {
        code: 'INVALID_ENVELOPE',
        message: 'Auth message must be an object with a string `type` field.',
      });
      socket.close(4401, 'Expected auth message');
      return;
    }

    const { type, data } = envelope as { type: string; data: unknown };
    if (type !== authType) {
      sendAdapterError(socket, {
        code: 'EXPECTED_AUTH_MESSAGE',
        message: `Expected auth message of type "${authType}" but received "${type}".`,
      });
      socket.close(4401, 'Expected auth message');
      return;
    }

    const messageConfig = channel.clientMessages[authType];
    if (!messageConfig) {
      sendAdapterError(socket, {
        code: 'AUTH_NOT_DECLARED',
        message: `Auth message type "${authType}" is not declared in clientMessages.`,
      });
      socket.close(4500, 'internal error');
      return;
    }

    const result = messageConfig.schema.validate(data);
    if (!result.success) {
      sendAdapterError(socket, {
        code: 'VALIDATION_ERROR',
        message: `Invalid payload for auth message "${authType}".`,
        details: result.errors,
      });
      socket.close(4401, 'Invalid auth payload');
      return;
    }

    // Run onConnect with the parsed payload. We do this in a
    // microtask so the synchronous path returns first.
    void (async () => {
      const ok = await runOnConnect(result.data);
      if (!ok) return;
      if (record.rejected) return;

      hub.register(record);
      const messageCtxBase = buildMessageCtxBase();
      installMessageLoop({
        channel,
        socket,
        request,
        hub,
        record,
        messageCtxBase,
        logError,
      });
    })();
  }

  socket.on('message', firstMessageHandler);
  socket.on('close', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.off('message', firstMessageHandler);
  });
}
