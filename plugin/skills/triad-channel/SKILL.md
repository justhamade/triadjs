---
name: triad-channel
description: Use when declaring TriadJS WebSocket channels with `channel()`, wiring `onConnect`/`onDisconnect`/`handlers`, typing per-connection state via the phantom witness, using `ctx.broadcast`/`ctx.broadcastOthers`/`ctx.send`, or implementing first-message auth for browsers.
---

# Channels (WebSockets)

Channels are the real-time counterpart to endpoints. Same schema DSL, same behavior builder, same router. **Currently supported by the Fastify adapter only.** The AsyncAPI generator (`@triadjs/asyncapi`) produces `asyncapi.yaml` alongside `openapi.yaml` when the router has channels.

## `channel()` signature

```ts
import { channel, t } from '@triadjs/core';

interface ChatRoomState {
  userId: string;
  userName: string;
  roomId: string;
}

export const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat room',
  description: 'Bidirectional chat for a room',
  tags: ['Chat'],

  // Phantom witness for typed ctx.state — value is ignored, type is used
  state: {} as ChatRoomState,

  connection: {
    params:  { roomId: t.string().format('uuid') },
    headers: {
      'x-user-id':   t.string().format('uuid'),
      'x-user-name': t.string().minLength(1),
    },
    // query: optional, same shape
  },

  clientMessages: {
    sendMessage: { schema: SendMessagePayload, description: 'Post a message' },
    typing:      { schema: TypingPayload,      description: 'Typing state' },
  },

  serverMessages: {
    message:  { schema: ChatMessage,     description: 'New message' },
    typing:   { schema: TypingIndicator, description: 'Typing indicator' },
    presence: { schema: UserPresence,    description: 'Join/leave' },
    error:    { schema: ChannelError,    description: 'Error' },
  },

  onConnect: async (ctx) => {
    if (!isValidRoom(ctx.params.roomId)) {
      return ctx.reject(404, 'Room not found');
    }
    ctx.state.userId   = ctx.headers['x-user-id'];
    ctx.state.userName = ctx.headers['x-user-name'];
    ctx.state.roomId   = ctx.params.roomId;

    ctx.broadcast.presence({
      userId:   ctx.state.userId,
      userName: ctx.state.userName,
      action:   'joined',
    });
  },

  onDisconnect: async (ctx) => {
    if (ctx.state.userId) {
      ctx.broadcast.presence({ /* ... */ action: 'left' });
    }
  },

  handlers: {
    // One handler per clientMessage. Missing or extra keys = compile error.
    sendMessage: async (ctx, data) => {
      const message = await ctx.services.messageStore.create({ /* ... */ });
      ctx.broadcast.message(message);          // to everyone including sender
    },
    typing: async (ctx, data) => {
      ctx.broadcastOthers.typing({ /* ... */ }); // to everyone EXCEPT sender
    },
  },

  behaviors: [ /* channel behavior scenarios */ ],
});
```

## Connection context (`onConnect` / `onDisconnect`)

| Field | Description |
|---|---|
| `ctx.params` | Path parameters |
| `ctx.query` | Query string arguments |
| `ctx.headers` | Request headers |
| `ctx.services` | Module-augmented `ServiceContainer` |
| `ctx.state` | Mutable per-connection bag (type from phantom `state` witness) |
| `ctx.reject(code, message)` | Refuse the handshake (HTTP-style status) |
| `ctx.broadcast.*` | Send to every connected client including the current one |
| `ctx.authPayload` | Parsed first-message auth payload when `auth.strategy: 'first-message'` — `unknown`, cast inside the handler |
| `ctx.validationError` | Handshake schema errors when `connection.validateBeforeConnect: false` |

## Per-message handler context

| Field | Description |
|---|---|
| `ctx.params` | Connection params (same for the whole connection) |
| `ctx.services` | Service container |
| `ctx.state` | The same bag `onConnect` populated |
| `ctx.broadcast.*` | Push a server message to every client |
| `ctx.broadcastOthers.*` | Same as broadcast, excluding the sender |
| `ctx.send.*` | Push to **this** client only (e.g. errors) |

`ctx.broadcast`, `ctx.broadcastOthers`, and `ctx.send` are derived from `serverMessages`, so calling `ctx.broadcast.notDeclared(...)` is a compile error.

## Channel state typing — the phantom witness pattern

TypeScript can't infer `TState` at the same time as every other generic in `channel<TState, ...>(config)`. Use the **phantom witness**:

```ts
interface ChatRoomState {
  userId: string;
  userName: string;
}

channel({
  state: {} as ChatRoomState, // value ignored, type used for ctx.state
  // ...
});
```

Without a state witness, `ctx.state` is `Record<string, any>`.

## Deferring handshake validation

By default, missing or invalid handshake params/query/headers are rejected with close code `4400` **before** `onConnect` runs — schema validation wins. Set `connection.validateBeforeConnect: false` to defer errors into `ctx.validationError` so your `onConnect` can inspect them:

```ts
channel({
  name: 'secureRoom',
  path: '/ws/secure',
  summary: 'Auth header required',
  connection: {
    headers: { authorization: t.string() },
    validateBeforeConnect: false,
  },
  clientMessages: { /* ... */ },
  serverMessages: { /* ... */ },
  onConnect: (ctx) => {
    if (ctx.validationError) {
      ctx.reject(401, 'missing or invalid authorization header');
      return;
    }
    // normal auth / state seeding
  },
  handlers: { /* ... */ },
});
```

If `onConnect` does NOT call `ctx.reject` when `validationError` is present, the adapter falls back to closing with 4400. You opt into handling the error, never into silently proceeding with malformed input.

## First-message auth (browser-friendly)

Browsers cannot set custom headers on `new WebSocket()`, so header-based handshake auth doesn't work from a browser. Use `auth.strategy: 'first-message'`:

```ts
channel({
  name: 'chatRoom',
  // ...
  auth: {
    strategy: 'first-message',
    firstMessageType: '__auth', // default
    timeoutMs: 5000,             // default
  },
  clientMessages: {
    __auth: {
      schema: t.model('AuthPayload', { token: t.string() }),
      description: 'First-message auth payload',
    },
    sendMessage: { /* ... */ },
  },
  onConnect: (ctx) => {
    const payload = ctx.authPayload as { token: string };
    const user = lookup(payload.token);
    if (!user) return ctx.reject(401, 'Invalid token');
    ctx.state.userId = user.id;
  },
});
```

The Fastify adapter waits up to `timeoutMs` for the first frame. If no message arrives in time, or the first frame isn't `firstMessageType`, or the payload fails schema validation, the socket closes with code **4401**. Successful auth then proceeds to the normal message loop.

## Channel behaviors

Channel scenarios use the same `scenario().given().when().then()` builder. The assertions operate on received messages — see the `triad-behaviors` skill for the channel phrase table (`<client> receives a <messageType> event`, `all clients receive...`, etc.).

## Checklist when adding a channel

1. Did you declare a `state` witness for typed `ctx.state`? `state: {} as MyState`.
2. Does every `clientMessages[key]` have a corresponding `handlers[key]`? Missing or extra keys are compile errors.
3. Is `broadcast` vs `broadcastOthers` vs `send` chosen correctly? Sender-included vs sender-excluded vs this-client-only.
4. If the channel will be consumed from a browser, do you need `auth.strategy: 'first-message'`?
5. Is the Fastify peer dep installed (`@fastify/websocket`)? Express and Hono don't support channels.
6. Are channel behaviors attached to exercise `onConnect`, broadcast shapes, and handler logic?
