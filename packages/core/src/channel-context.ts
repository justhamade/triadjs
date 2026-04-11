/**
 * Handler context and outgoing-message typing for WebSocket channels.
 *
 * Channels are the real-time counterpart to HTTP endpoints. Instead of
 * a single request/response cycle they have:
 *
 *   1. A *connection* lifecycle (`onConnect`, `onDisconnect`) that sees
 *     the initial handshake parameters — path params, query string,
 *     headers — and gets to reject the connection or seed per-
 *     connection state.
 *   2. A set of *client messages* the client can send at any time after
 *     the handshake. Each message has its own `handler(ctx, data)` that
 *     runs once per incoming message.
 *   3. A set of *server messages* the handlers can push out via
 *     `ctx.broadcast.*`, `ctx.broadcastOthers.*`, or `ctx.send.*`.
 *
 * The types in this file mirror the HTTP `HandlerContext` pattern: the
 * incoming data is fully typed from the declared schemas, and outgoing
 * sends are type-safe because `BroadcastMap` / `SendMap` derive their
 * keys and argument types from the `serverMessages` declaration.
 *
 * Just like `ctx.respond[500]` is a compile error when 500 isn't
 * declared in an endpoint's responses, `ctx.broadcast.notAThing` is a
 * compile error when the channel doesn't declare that server message.
 */

import type { SchemaNode } from './schema/types.js';
import type { ServiceContainer } from './context.js';
import type { InferRequestPart } from './context.js';

// ---------------------------------------------------------------------------
// Message maps
// ---------------------------------------------------------------------------

/**
 * Shape of a single client- or server-message declaration. Mirrors the
 * `ResponseConfig` pattern used by HTTP endpoints — one `schema` plus a
 * `description` for docs.
 */
export interface ChannelMessageConfig {
  schema: SchemaNode;
  description: string;
}

/** A record of named messages, keyed by the message type string. */
export type ChannelMessages = Record<string, ChannelMessageConfig>;

type InferSchema<T> = T extends SchemaNode<infer U> ? U : never;

/**
 * Type-safe broadcast/send map. Given the channel's `serverMessages`
 * declaration, this produces an object keyed by message type where each
 * value is a function accepting the inferred schema type for that
 * message.
 *
 * ```ts
 * serverMessages: {
 *   message: { schema: ChatMessage, description: 'New message' },
 *   error:   { schema: ApiError,    description: 'Error' },
 * }
 *
 * ctx.broadcast.message(chatMessage);     // OK
 * ctx.broadcast.message({ wrong: 1 });    // compile error
 * ctx.broadcast.typing('x');              // compile error — not declared
 * ```
 */
export type BroadcastMap<TServerMessages extends ChannelMessages> = {
  [K in keyof TServerMessages]: (
    data: InferSchema<TServerMessages[K]['schema']>,
  ) => void;
};

/**
 * Alias for `BroadcastMap`, provided so handler code reads correctly:
 * `ctx.send.error(...)` reads as "send an error to just this client",
 * while `ctx.broadcast.error(...)` reads as "push an error to everyone".
 * The types are identical — the runtime behavior differs.
 */
export type SendMap<TServerMessages extends ChannelMessages> =
  BroadcastMap<TServerMessages>;

// ---------------------------------------------------------------------------
// Connection-scoped state
// ---------------------------------------------------------------------------

/**
 * Default shape for per-connection state. Channels are parameterized on
 * `TState` so users can declare a typed state bag:
 *
 * ```ts
 * interface ChatRoomState {
 *   user: { id: string; name: string };
 *   roomId: string;
 * }
 *
 * export const chatRoom = channel<ChatRoomState>({ ... });
 * ```
 *
 * Without that generic argument, `ctx.state` is a permissive
 * `Record<string, any>` so quick prototypes don't have to declare a
 * type up front. Locking it down later is a one-line change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefaultChannelState = Record<string, any>;

// ---------------------------------------------------------------------------
// Connection context — available in onConnect / onDisconnect
// ---------------------------------------------------------------------------

/**
 * Handshake-time rejection signal.
 *
 * Calling `ctx.reject(code, message)` inside `onConnect` tells the
 * adapter to refuse the WebSocket upgrade. The `code` is an HTTP-style
 * status (404 not found, 401 unauthorized, 403 forbidden, etc.) that
 * the adapter maps onto its framework's native rejection mechanism.
 */
export type ChannelReject = (code: number, message: string) => void;

export interface ChannelConnectContext<
  TParams,
  TQuery,
  THeaders,
  TServerMessages extends ChannelMessages,
  TState = DefaultChannelState,
> {
  /** Path parameters extracted from the channel's `:id`-style path. */
  params: InferRequestPart<TParams>;
  /** Query string arguments validated against the declared schema. */
  query: InferRequestPart<TQuery>;
  /** Request headers validated against the declared schema. */
  headers: InferRequestPart<THeaders>;
  /** The shared service container. */
  services: ServiceContainer;
  /**
   * Per-connection state. Handlers and `onDisconnect` see the same
   * object for a given connection — mutate it to remember the user,
   * room membership, timers, etc.
   */
  state: TState;
  /** Reject the incoming connection during the handshake. */
  reject: ChannelReject;
  /**
   * Push a server message to every connected client in this channel.
   * Includes the connection this handler is running on.
   */
  broadcast: BroadcastMap<TServerMessages>;
  /**
   * When the channel uses `auth.strategy: 'first-message'`, this is
   * the parsed and schema-validated payload of the first client
   * message. For other strategies this is `undefined`.
   *
   * The payload is typed as `unknown` in v1 — cast to the declared
   * payload type of the auth message inside `onConnect`. A future
   * enhancement can narrow the type automatically via conditional
   * types on `auth.firstMessageType`.
   */
  authPayload?: unknown;
}

// ---------------------------------------------------------------------------
// Per-message handler context
// ---------------------------------------------------------------------------

export interface ChannelMessageContext<
  TParams,
  TServerMessages extends ChannelMessages,
  TState = DefaultChannelState,
> {
  /** Path parameters — same for the lifetime of the connection. */
  params: InferRequestPart<TParams>;
  /** The shared service container. */
  services: ServiceContainer;
  /** Per-connection state bag set in `onConnect` or earlier handlers. */
  state: TState;
  /** Push a server message to every client in this channel. */
  broadcast: BroadcastMap<TServerMessages>;
  /**
   * Push a server message to every client EXCEPT the one that just
   * sent the message being handled. Useful for typing indicators and
   * similar features where echoing back to the sender is unwanted.
   */
  broadcastOthers: BroadcastMap<TServerMessages>;
  /** Send a message to just this client — not anyone else. */
  send: SendMap<TServerMessages>;
}
