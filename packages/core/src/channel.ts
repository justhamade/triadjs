/**
 * The `channel()` declarative API — WebSocket channels alongside
 * `endpoint()` for HTTP.
 *
 * Design goals (from `docs/phase-9-websockets.md`):
 *
 *   1. **Same schema DSL.** Message payloads use `t.model()` just like
 *      request bodies and response bodies. A `ChatMessage` model can be
 *      returned from an HTTP history endpoint *and* pushed over a
 *      WebSocket — defined once.
 *   2. **Same behavior builder.** The `scenario/given/when/then/and`
 *      chain from `endpoint()` works unchanged — `when` describes what
 *      the client sends or does, `then` describes what the server
 *      broadcasts back. A future runner phase interprets these.
 *   3. **Declarative style.** Channels are configuration objects, the
 *      same shape as `endpoint()`. No fluent builders for the channel
 *      definition itself.
 *   4. **Type-safe outgoing messages.** `ctx.broadcast.*` is derived
 *      from the `serverMessages` declaration so the compiler prevents
 *      sending undeclared message types — mirrors `ctx.respond[...]`
 *      for HTTP.
 *
 * This file defines the shape and the normalization pipeline. The
 * actual WebSocket transport (the plugin that maps channels onto
 * `@fastify/websocket` or another framework) ships in a follow-up
 * sub-phase.
 */

import type { SchemaNode } from './schema/types.js';
import { ModelSchema } from './schema/model.js';
import type { Behavior } from './behavior.js';
import type {
  ChannelConnectContext,
  ChannelMessageContext,
  ChannelMessageConfig,
  ChannelMessages,
  DefaultChannelState,
  ChannelBeforeHandler,
  ChannelBeforeHandlerContext,
  ChannelBeforeHandlerResult,
} from './channel-context.js';

// ---------------------------------------------------------------------------
// Author-facing config
// ---------------------------------------------------------------------------

/**
 * Connection-time parameters validated on the handshake. Same
 * conventions as `endpoint.request`:
 *
 *   - Pass a named `ModelSchema` to reuse an existing shape, or
 *   - Pass an inline object of `SchemaNode` fields and `channel()` will
 *     wrap it in an anonymous model named `{channelName}Params` etc.
 */
export interface ChannelConnectionConfig<TParams, TQuery, THeaders> {
  params?: TParams;
  query?: TQuery;
  headers?: THeaders;
  /**
   * Controls handshake validation ordering.
   *
   * When `true` (default), missing or invalid connection params/query/
   * headers are rejected at the adapter level with close code 4400
   * BEFORE `onConnect` ever runs. This matches the HTTP adapter's
   * request-validation semantics and is the safest default.
   *
   * When `false`, validation errors are deferred into
   * `ctx.validationError` on the `onConnect` context so the user can
   * inspect them and render a custom rejection via
   * `ctx.reject(code, message)`. This is the right flag to set when
   * you want a missing `authorization` header to produce a tailored
   * 401 response instead of a generic schema error — for instance to
   * match observability expectations, or to emit a domain-specific
   * error payload.
   *
   * Note: if `onConnect` does NOT reject explicitly, the adapter
   * still falls back to closing with the standard validation error
   * envelope. You opt into handling validation errors; the default
   * behavior is preserved for every other case.
   */
  validateBeforeConnect?: boolean;
}

/**
 * Authentication strategy for a channel.
 *
 * Channels support three authentication flows:
 *
 *   - `'header'` (default) — credentials are passed on the handshake
 *     as HTTP headers. Works for Node.js WebSocket clients that can
 *     set arbitrary headers. Browsers cannot set custom headers on a
 *     `new WebSocket()` call, so this strategy is not browser-friendly.
 *
 *   - `'first-message'` — the connection is accepted immediately, but
 *     `onConnect` is deferred until the client sends a specific
 *     "auth" message as its first frame. The adapter parses and
 *     validates that message against the declared `clientMessages`
 *     entry and exposes the parsed payload as `ctx.authPayload` in
 *     `onConnect`. If the client sends any other message type, or no
 *     message at all before the timeout, the socket is closed with
 *     code 4401. This is the browser-compatible flow.
 *
 *   - `'none'` — no built-in auth; `onConnect` runs immediately with
 *     whatever handshake data is available. Use this when the
 *     channel is public or when a framework-level auth layer
 *     handles credentials outside of Triad.
 */
export interface ChannelAuthConfig {
  strategy: 'header' | 'first-message' | 'none';
  /**
   * Only meaningful for `strategy: 'first-message'`. The name of the
   * client message that carries the auth payload. Must match a key
   * declared on `clientMessages`. Defaults to `'__auth'`.
   */
  firstMessageType?: string;
  /**
   * Only meaningful for `strategy: 'first-message'`. Maximum time in
   * milliseconds to wait for the auth message before closing the
   * socket with code 4401. Defaults to 5000.
   */
  timeoutMs?: number;
}

type InferSchema<T> = T extends SchemaNode<infer U> ? U : never;

/**
 * The full declarative channel config. This is the only shape users
 * authoring a channel need to know about — `channel(config)` produces
 * a runtime `Channel` from it.
 */
/**
 * `TState` uses a phantom `state` field for type inference rather than
 * an explicit type argument. This is a deliberate workaround for
 * TypeScript's partial-inference limitation: providing `<MyState>` as
 * a type argument would block inference of `TParams`, `TQuery`, and
 * friends, forcing users to either annotate everything manually or
 * accept `ctx.params = {}`. Inferring `TState` from a witness value in
 * the config keeps every generic inferrable at the same time.
 *
 * Usage for typed state:
 *
 * ```ts
 * interface ChatRoomState {
 *   user: { id: string; name: string };
 *   roomId: string;
 * }
 *
 * channel({
 *   name: 'chatRoom',
 *   state: {} as ChatRoomState,  // phantom — only used for type inference
 *   // ...
 *   onConnect: async (ctx) => {
 *     ctx.state.user = { id: '1', name: 'Alice' };  // typed!
 *   },
 * });
 * ```
 */
export interface ChannelConfig<
  TState,
  TParams,
  TQuery,
  THeaders,
  TClientMessages extends ChannelMessages,
  TServerMessages extends ChannelMessages,
> {
  /** Unique identifier for this channel — used as the AsyncAPI operationId. */
  name: string;
  /** URL path pattern (Fastify-style, e.g. `/ws/rooms/:roomId`). */
  path: string;
  /** Short human-readable summary — one line. */
  summary: string;
  /** Long description for docs. Optional. */
  description?: string;
  /** Tags for grouping in AsyncAPI output. */
  tags?: readonly string[];
  /**
   * Phantom witness for the per-connection state type. The value is
   * ignored at runtime — only the type matters. Pattern:
   * `state: {} as ChatRoomState`. See the interface docs above.
   */
  state?: TState;
  /** Handshake parameters: path params, query, headers. */
  connection?: ChannelConnectionConfig<TParams, TQuery, THeaders>;
  /**
   * Authentication strategy for this channel. Defaults to `'header'`
   * (read credentials from handshake headers, the Node-client-friendly
   * flow). Use `'first-message'` to defer `onConnect` until the client
   * sends an auth message as its first frame — the browser-friendly
   * flow. See `ChannelAuthConfig` for details.
   */
  auth?: ChannelAuthConfig;
  /** Messages the client may send to the server. */
  clientMessages: TClientMessages;
  /** Messages the server may push to the client. */
  serverMessages: TServerMessages;
  /**
   * Optional connection-lifecycle hook that runs BEFORE handshake schema
   * validation. Use this for auth, tenant resolution, feature flags,
   * and any other cross-cutting concern that should be able to reject
   * raw connections without the validation pipeline 4400-ing first.
   *
   * Returns `{ ok: true, state }` to populate `ctx.state` for
   * `onConnect` and subsequent handlers, or `{ ok: false, code,
   * message }` to reject the connection before validation runs.
   *
   * This is a SINGLE function, not an array — same rationale as the
   * HTTP endpoint's `beforeHandler`. See `before-handler.ts`.
   */
  beforeHandler?: ChannelBeforeHandler<TState>;
  /**
   * Called once when a client successfully connects. Use it to
   * authenticate, seed `ctx.state`, register the connection with a
   * pubsub hub, and broadcast presence. Call `ctx.reject(code, msg)`
   * to refuse the connection.
   */
  onConnect?: (
    ctx: ChannelConnectContext<
      TParams,
      TQuery,
      THeaders,
      TServerMessages,
      TState
    >,
  ) => Promise<void> | void;
  /**
   * Called when a client disconnects — normal close, timeout, error,
   * or server-side termination. Use it to clean up state and
   * broadcast departure.
   */
  onDisconnect?: (
    ctx: ChannelConnectContext<
      TParams,
      TQuery,
      THeaders,
      TServerMessages,
      TState
    >,
  ) => Promise<void> | void;
  /**
   * Per-message-type handlers. The map must have exactly one entry
   * for every key in `clientMessages`. TypeScript enforces this — a
   * missing key is a compile error, an extra key is also a compile
   * error, and the `data` argument is typed from the declared schema.
   */
  handlers: {
    [K in keyof TClientMessages]: (
      ctx: ChannelMessageContext<TParams, TServerMessages, TState>,
      data: InferSchema<TClientMessages[K]['schema']>,
    ) => Promise<void> | void;
  };
  /** Behaviors — same shape as endpoint behaviors. */
  behaviors?: readonly Behavior[];
}

// ---------------------------------------------------------------------------
// Runtime data structure
// ---------------------------------------------------------------------------

/**
 * Process-global brand so downstream tooling can identify channels
 * across duplicate module graphs. Mirrors the pattern used by
 * `Router.isRouter`.
 */
const CHANNEL_BRAND: unique symbol = Symbol.for(
  '@triad/core/Channel',
) as never;

/**
 * Runtime representation of a channel after normalization. Consumed by
 * the router, the AsyncAPI generator, the test runner, and the Fastify
 * WebSocket adapter.
 */
export interface Channel {
  /** Discriminant for structural checks (preferred over `instanceof`). */
  readonly kind: 'channel';
  /** Brand for cross-module-graph identity checks. See `isChannel`. */
  readonly [CHANNEL_BRAND]: true;

  name: string;
  path: string;
  summary: string;
  description?: string;
  tags: string[];

  connection: {
    params?: ModelSchema<Record<string, SchemaNode>>;
    query?: ModelSchema<Record<string, SchemaNode>>;
    headers?: ModelSchema<Record<string, SchemaNode>>;
    /**
     * When `false`, handshake validation errors are deferred into
     * `ctx.validationError` so `onConnect` can render a custom
     * rejection. Defaults to `true` — errors auto-close with 4400
     * before `onConnect` runs.
     */
    validateBeforeConnect: boolean;
  };

  clientMessages: Record<string, { schema: SchemaNode; description: string }>;
  serverMessages: Record<string, { schema: SchemaNode; description: string }>;

  /**
   * Normalized authentication config. `strategy` is always present
   * (defaults to `'header'`); `firstMessageType` defaults to
   * `'__auth'` and `timeoutMs` to 5000.
   */
  auth: {
    strategy: 'header' | 'first-message' | 'none';
    firstMessageType: string;
    timeoutMs: number;
  };

  /**
   * Optional connection-lifecycle hook that runs BEFORE handshake
   * schema validation. See `ChannelConfig.beforeHandler`.
   */
  beforeHandler?: (
    ctx: ChannelBeforeHandlerContext,
  ) => Promise<ChannelBeforeHandlerResult<unknown>> | ChannelBeforeHandlerResult<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onConnect?: (ctx: any) => Promise<void> | void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDisconnect?: (ctx: any) => Promise<void> | void;
  handlers: Record<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ctx: any, data: any) => Promise<void> | void
  >;

  behaviors: Behavior[];
}

/**
 * Structural check for Channel instances that works across duplicate
 * `@triad/core` module graphs. Use this instead of `channel instanceof
 * Channel` or a `kind === 'channel'` check in any code that might
 * receive values constructed by a different copy of `@triad/core` (CLI
 * + jiti, tests + bundler aliases, etc.).
 */
export function isChannel(value: unknown): value is Channel {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[CHANNEL_BRAND] === true
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeConnectionPart(
  value: unknown,
  anonymousName: string,
): ModelSchema<Record<string, SchemaNode>> | undefined {
  if (value === undefined) return undefined;
  if (value instanceof ModelSchema) {
    return value as ModelSchema<Record<string, SchemaNode>>;
  }
  const shape = value as Record<string, SchemaNode>;
  return new ModelSchema(anonymousName, shape);
}

function normalizeMessageMap(
  messages: ChannelMessages,
): Record<string, { schema: SchemaNode; description: string }> {
  const out: Record<string, { schema: SchemaNode; description: string }> = {};
  for (const [key, config] of Object.entries(messages)) {
    out[key] = { schema: config.schema, description: config.description };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Declare a WebSocket channel. Returns a runtime `Channel` while
 * preserving full type inference across connection params, message
 * handlers, and outgoing sends.
 */
export interface ChannelFn {
  <
    TState = DefaultChannelState,
    TParams = unknown,
    TQuery = unknown,
    THeaders = unknown,
    TClientMessages extends ChannelMessages = ChannelMessages,
    TServerMessages extends ChannelMessages = ChannelMessages,
  >(
    config: ChannelConfig<
      TState,
      TParams,
      TQuery,
      THeaders,
      TClientMessages,
      TServerMessages
    >,
  ): Channel;

  withState: <TState>() => <
    TParams = unknown,
    TQuery = unknown,
    THeaders = unknown,
    TClientMessages extends ChannelMessages = ChannelMessages,
    TServerMessages extends ChannelMessages = ChannelMessages,
  >(
    config: Omit<
      ChannelConfig<TState, TParams, TQuery, THeaders, TClientMessages, TServerMessages>,
      'state'
    >,
  ) => Channel;
}

export const channel: ChannelFn = function channel<
  TState = DefaultChannelState,
  TParams = unknown,
  TQuery = unknown,
  THeaders = unknown,
  TClientMessages extends ChannelMessages = ChannelMessages,
  TServerMessages extends ChannelMessages = ChannelMessages,
>(
  config: ChannelConfig<
    TState,
    TParams,
    TQuery,
    THeaders,
    TClientMessages,
    TServerMessages
  >,
): Channel {
  const connection = config.connection ?? {};
  const normalized: Channel['connection'] = {
    validateBeforeConnect: connection.validateBeforeConnect ?? true,
  };
  const params = normalizeConnectionPart(
    connection.params,
    `${config.name}Params`,
  );
  const query = normalizeConnectionPart(
    connection.query,
    `${config.name}Query`,
  );
  const headers = normalizeConnectionPart(
    connection.headers,
    `${config.name}Headers`,
  );
  if (params) normalized.params = params;
  if (query) normalized.query = query;
  if (headers) normalized.headers = headers;

  const result: Channel = {
    kind: 'channel',
    [CHANNEL_BRAND]: true,
    name: config.name,
    path: config.path,
    summary: config.summary,
    tags: config.tags ? [...config.tags] : [],
    connection: normalized,
    clientMessages: normalizeMessageMap(config.clientMessages),
    serverMessages: normalizeMessageMap(config.serverMessages),
    auth: {
      strategy: config.auth?.strategy ?? 'header',
      firstMessageType: config.auth?.firstMessageType ?? '__auth',
      timeoutMs: config.auth?.timeoutMs ?? 5000,
    },
    handlers: config.handlers as Record<
      string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx: any, data: any) => Promise<void> | void
    >,
    behaviors: config.behaviors ? [...config.behaviors] : [],
  };

  if (config.description !== undefined) result.description = config.description;
  if (config.beforeHandler !== undefined) {
    result.beforeHandler = config.beforeHandler as Channel['beforeHandler'];
  }
  if (config.onConnect !== undefined) {
    result.onConnect = config.onConnect as Channel['onConnect'];
  }
  if (config.onDisconnect !== undefined) {
    result.onDisconnect = config.onDisconnect as Channel['onDisconnect'];
  }

  return result;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// Runtime implementation of channel.withState — typed via the interface above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
channel.withState = function withState() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (config: any): Channel =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    channel({ ...config, state: {} } as any);
};

// Re-export the acknowledging types so consumers importing `channel` get
// everything they need from one module.
export type {
  ChannelConnectContext,
  ChannelMessageContext,
  ChannelMessages,
  ChannelMessageConfig,
  BroadcastMap,
  SendMap,
  DefaultChannelState,
  ChannelReject,
  ChannelBeforeHandler,
  ChannelBeforeHandlerContext,
  ChannelBeforeHandlerResult,
  ChannelBeforeHandlerSuccess,
  ChannelBeforeHandlerRejection,
} from './channel-context.js';
