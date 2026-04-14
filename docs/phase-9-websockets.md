# Phase 9 — WebSocket Channels (Design Spec)

> **Status:** Design. Not implemented. Do not start until Phases 2–8 are complete.

Triad already supports HTTP endpoints via `endpoint()`. Phase 9 adds WebSocket support via `channel()` — using the **same schema DSL**, the **same behavior builder**, and the **same CLI outputs**, but for bidirectional real-time communication.

---

## Philosophy

WebSocket support follows every existing Triad principle:

1. **Single source of truth** — A `channel()` definition produces types, validation, AsyncAPI docs, Gherkin behaviors, and tests.
2. **Code-first** — No YAML, no AsyncAPI files to maintain by hand.
3. **Declarative** — Channels are configuration objects, same style as endpoints.
4. **Schema DSL is protocol-agnostic** — `t.model()` works for HTTP request bodies AND WebSocket message payloads.
5. **AI-legible** — An AI reading a channel definition understands the full real-time contract from one file.

---

## `channel()` vs `endpoint()`

HTTP has request → response. WebSockets have connection → bidirectional stream → disconnection. The abstractions differ:

| HTTP (`endpoint()`)       | WebSocket (`channel()`)              |
|---------------------------|--------------------------------------|
| `request.body`            | `clientMessages` (client → server)   |
| `responses`               | `serverMessages` (server → client)   |
| `handler`                 | `handlers` (one per client message)  |
| `ctx.respond[status]`     | `ctx.broadcast.*` / `ctx.send.*`     |
| One request, one response | Continuous bidirectional stream      |
| Stateless                 | Stateful (connection lifecycle)      |

---

## Example: A Chat Room Channel

```typescript
import { channel, scenario, t } from '@triadjs/core';

// Message schemas — regular Triad models, reusable across HTTP and WS
const ChatMessage = t.model('ChatMessage', {
  id: t.string().format('uuid').doc('Message ID'),
  roomId: t.string().format('uuid').doc('Room ID'),
  userId: t.string().format('uuid').doc('Sender ID'),
  text: t.string().minLength(1).maxLength(2000).doc('Message content'),
  timestamp: t.datetime().doc('When the message was sent'),
});

const TypingIndicator = t.model('TypingIndicator', {
  userId: t.string().format('uuid'),
  isTyping: t.boolean(),
});

const UserPresence = t.model('UserPresence', {
  userId: t.string().format('uuid'),
  username: t.string(),
  action: t.enum('joined', 'left'),
});

const ErrorMessage = t.model('ErrorMessage', {
  code: t.string(),
  message: t.string(),
});

export const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat room',
  description: 'Bidirectional messaging channel for a specific chat room',
  tags: ['Chat'],

  // Connection parameters — validated on handshake
  connection: {
    params: {
      roomId: t.string().format('uuid').doc('Room to join'),
    },
    headers: {
      authorization: t.string().doc('Bearer token'),
    },
    query: {
      reconnectToken: t.string().optional().doc('Token for resuming a session'),
    },
  },

  // Messages the CLIENT can send to the server
  clientMessages: {
    sendMessage: {
      schema: t.model('SendMessagePayload', {
        text: t.string().minLength(1).maxLength(2000),
      }),
      description: 'Send a chat message to the room',
    },
    typing: {
      schema: t.model('TypingPayload', { isTyping: t.boolean() }),
      description: 'Indicate typing status',
    },
    editMessage: {
      schema: t.model('EditMessagePayload', {
        messageId: t.string().format('uuid'),
        text: t.string().minLength(1).maxLength(2000),
      }),
      description: 'Edit a previously sent message',
    },
  },

  // Messages the SERVER can send to the client
  serverMessages: {
    message: { schema: ChatMessage, description: 'New or updated message' },
    typing: { schema: TypingIndicator, description: 'Typing status update' },
    presence: { schema: UserPresence, description: 'User joined or left' },
    error: { schema: ErrorMessage, description: 'Processing error' },
  },

  // Connection lifecycle
  onConnect: async (ctx) => {
    const room = await ctx.services.roomRepo.findById(ctx.params.roomId);
    if (!room) return ctx.reject(404, 'Room not found');

    const user = await ctx.services.auth.verifyToken(ctx.headers.authorization);
    if (!user) return ctx.reject(401, 'Invalid token');

    ctx.state.user = user;
    ctx.state.roomId = ctx.params.roomId;

    await ctx.services.roomRepo.addUser(ctx.params.roomId, user.id);
    ctx.broadcast.presence({ userId: user.id, username: user.name, action: 'joined' });
  },

  onDisconnect: async (ctx) => {
    if (ctx.state.user) {
      await ctx.services.roomRepo.removeUser(ctx.state.roomId, ctx.state.user.id);
      ctx.broadcast.presence({
        userId: ctx.state.user.id,
        username: ctx.state.user.name,
        action: 'left',
      });
    }
  },

  // Message handlers — one per client message type
  handlers: {
    sendMessage: async (ctx, data) => {
      const message = await ctx.services.messageRepo.create({
        roomId: ctx.state.roomId,
        userId: ctx.state.user.id,
        text: data.text,
      });
      ctx.broadcast.message(message);
    },

    typing: async (ctx, data) => {
      ctx.broadcastOthers.typing({
        userId: ctx.state.user.id,
        isTyping: data.isTyping,
      });
    },

    editMessage: async (ctx, data) => {
      const message = await ctx.services.messageRepo.findById(data.messageId);
      if (!message) {
        return ctx.send.error({ code: 'NOT_FOUND', message: 'Message not found' });
      }
      if (message.userId !== ctx.state.user.id) {
        return ctx.send.error({ code: 'FORBIDDEN', message: 'Can only edit your own messages' });
      }
      const updated = await ctx.services.messageRepo.update(data.messageId, { text: data.text });
      ctx.broadcast.message(updated);
    },
  },

  behaviors: [
    scenario('Users can send messages to a room')
      .given('a user is connected to room {roomId}')
      .setup(async (services) => {
        const room = await services.roomRepo.create({ name: 'General' });
        const user = await services.userRepo.create({ name: 'Alice' });
        return { roomId: room.id, userId: user.id, token: user.token };
      })
      .when('client sends sendMessage with text "Hello everyone"')
      .then('all clients in the room receive a message event')
      .and('message has text "Hello everyone"'),

    scenario('Typing indicators are broadcast to other users only')
      .given('two users are connected to the same room')
      .when('Alice sends typing with isTyping true')
      .then('Bob receives a typing event with isTyping true')
      .and('Alice does NOT receive a typing event'),

    scenario('Users cannot edit other users messages')
      .given('Alice sent a message in the room')
      .when('Bob sends editMessage for Alice\'s message')
      .then('Bob receives an error event')
      .and('error has code "FORBIDDEN"'),

    scenario('Connection is rejected for non-existent rooms')
      .given('no room exists with id {roomId}')
      .fixtures({ roomId: '00000000-0000-0000-0000-000000000000' })
      .when('client connects to /ws/rooms/{roomId}')
      .then('connection is rejected with code 404'),

    scenario('Unauthenticated connections are rejected')
      .given('a room exists')
      .when('client connects without authorization header')
      .then('connection is rejected with code 401'),
  ],
});
```

---

## Channel Context Types

```typescript
interface ChannelConnectContext<TParams, TQuery, THeaders> {
  params: InferObjectSchema<TParams>;
  query: InferObjectSchema<TQuery>;
  headers: InferObjectSchema<THeaders>;
  services: ServiceContainer;
  state: Record<string, any>;                        // Mutable connection state
  reject: (code: number, message: string) => void;  // Reject the connection
  broadcast: BroadcastMap<TServerMessages>;          // Send to all in channel
}

interface ChannelMessageContext<TParams, TServerMessages> {
  params: InferObjectSchema<TParams>;
  services: ServiceContainer;
  state: Record<string, any>;
  broadcast: BroadcastMap<TServerMessages>;          // Send to ALL clients in channel
  broadcastOthers: BroadcastMap<TServerMessages>;    // Send to all EXCEPT sender
  send: SendMap<TServerMessages>;                    // Send to THIS client only
}

type BroadcastMap<TServerMessages> = {
  [K in keyof TServerMessages]: (
    data: Infer<TServerMessages[K]['schema']>,
  ) => void;
};
// ctx.broadcast.message(chatMessage)    — type-safe, only accepts ChatMessage
// ctx.broadcast.notAReal('x')           — compile error
```

### Typed Connection State

```typescript
interface ChatRoomState {
  user: { id: string; name: string };
  roomId: string;
}

export const chatRoom = channel<ChatRoomState>({
  // ctx.state is now typed as ChatRoomState in all handlers
});
```

---

## Wire Protocol

Triad uses a simple JSON envelope:

```typescript
// Client → Server
{ "type": "sendMessage", "data": { "text": "Hello" } }

// Server → Client
{ "type": "message", "data": { ... } }

// Server → Client (validation error)
{
  "type": "error",
  "data": {
    "code": "INVALID_MESSAGE",
    "message": "Validation failed for 'sendMessage': text must be at least 1 character"
  }
}
```

Triad validates incoming messages against `clientMessages` schemas and outgoing messages against `serverMessages` schemas. Binary framing is out of scope for v1.

---

## CLI Outputs — AsyncAPI 3.0

```bash
triad docs --output ./generated/
# Produces:
#   ./generated/openapi.yaml     (HTTP endpoints)
#   ./generated/asyncapi.yaml    (WebSocket channels)
```

Mapping:

- `channel.path` → AsyncAPI channel address
- `clientMessages` → AsyncAPI `publish` operations
- `serverMessages` → AsyncAPI `subscribe` operations
- `connection.params` / `headers` / `query` → channel bindings
- Schemas → `components/schemas` (shared with OpenAPI where models overlap)

### Sample Generated AsyncAPI

```yaml
asyncapi: '3.0.0'
info:
  title: Petstore API — WebSocket Channels
  version: '1.0.0'
channels:
  chatRoom:
    address: /ws/rooms/{roomId}
    parameters:
      roomId:
        schema:
          type: string
          format: uuid
    messages:
      sendMessage:
        payload:
          $ref: '#/components/schemas/SendMessagePayload'
      message:
        payload:
          $ref: '#/components/schemas/ChatMessage'
      presence:
        payload:
          $ref: '#/components/schemas/UserPresence'
```

---

## Gherkin for WebSocket Behaviors

```gherkin
Feature: Chat Room

  Scenario: Users can send messages to a room
    Given a user is connected to room {roomId}
    When client sends sendMessage with text "Hello everyone"
    Then all clients in the room receive a message event
    And message has text "Hello everyone"

  Scenario: Typing indicators are broadcast to other users only
    Given two users are connected to the same room
    When Alice sends typing with isTyping true
    Then Bob receives a typing event with isTyping true
    And Alice does NOT receive a typing event
```

---

## WebSocket Test Runner

For each behavior:

1. **Setup** — Create test data via `.setup()`
2. **Connect** — Open WebSocket connection(s) with appropriate headers/params
3. **Send** — Emit client messages from the `when` clause
4. **Assert** — Verify received server messages match `then` assertions
5. **Teardown** — Close connections, clean up

Testing patterns the runner must support:

- **Multi-client** — Scenarios with 2+ connected clients (for broadcast behavior)
- **Ordering** — Assert messages arrive in the expected order
- **Negative delivery** — Assert a specific client does NOT receive a message (e.g., typing not echoed back)
- **Connection rejection** — Assert the WebSocket handshake is rejected with the right status
- **Disconnection events** — Assert disconnect triggers the right broadcasts

Server-side uses `ws`. Test client uses `ws`. **Not Socket.IO** — standard WebSockets.

---

## Router Registration

Channels register on the same router as endpoints:

```typescript
const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
});

router.add(createPet, getPet, listPets);   // HTTP
router.add(chatRoom);                       // WebSocket

// Or grouped by bounded context
router.context('Chat', {
  description: 'Real-time messaging',
  models: [ChatMessage, TypingIndicator, UserPresence],
}, (ctx) => {
  ctx.add(chatRoom);
  ctx.add(getRoomHistory);                  // HTTP endpoint in the same context
});
```

The router knows which is HTTP and which is WebSocket and routes them to the appropriate generators (OpenAPI vs AsyncAPI) and test runners (supertest vs ws client).

---

## Shared Models Between HTTP and WebSocket

```typescript
const ChatMessage = t.model('ChatMessage', { /* ... */ });

// HTTP: returns ChatMessage[] as history
export const getRoomHistory = endpoint({
  method: 'GET',
  path: '/rooms/:roomId/messages',
  responses: {
    200: { schema: t.array(ChatMessage), description: 'Message history' },
  },
  // ...
});

// WebSocket: broadcasts ChatMessage on new message
export const chatRoom = channel({
  serverMessages: {
    message: { schema: ChatMessage, description: 'New message' },
  },
  // ...
});
```

In OpenAPI, `ChatMessage` appears as a schema component. In AsyncAPI, the same `ChatMessage` appears as a message payload. **The schema is defined once.**

---

## Package Structure (when Phase 9 lands)

```
packages/
├── core/
│   └── src/
│       ├── channel.ts               # channel() function
│       ├── channel-context.ts       # Connect/message context types
│       └── wire-protocol.ts         # JSON envelope + routing
│
├── asyncapi/                        # NEW — @triadjs/asyncapi
│   └── src/generator.ts             # Channels → AsyncAPI 3.0
│
├── test-runner/
│   └── src/
│       ├── ws-client.ts             # Wraps `ws` for tests
│       ├── ws-runner.ts             # Executes channel behaviors
│       └── ws-assertions.ts         # received / not-received / ordering / rejection
│
└── cli/
    └── src/commands/docs.ts         # Updated: emits both OpenAPI + AsyncAPI
```

---

## Implementation Order

1. `@triadjs/core/channel.ts` — The `channel()` function and type definitions
2. `@triadjs/core/channel-context.ts` — Context types, BroadcastMap, SendMap
3. `@triadjs/core/wire-protocol.ts` — JSON envelope and message routing
4. Update `@triadjs/core/router.ts` — Register channels alongside endpoints
5. `@triadjs/asyncapi/generator.ts` — Channels → AsyncAPI 3.0
6. Update `@triadjs/gherkin/generator.ts` — Channel behaviors in Gherkin
7. `@triadjs/test-runner/ws-client.ts` — WebSocket test client
8. `@triadjs/test-runner/ws-runner.ts` — Multi-client behavior execution
9. `@triadjs/test-runner/ws-assertions.ts` — WS-specific assertions
10. Update `@triadjs/cli` — `triad docs` emits both specs
11. Example: chat room channel in the petstore example app
12. Tests everywhere

---

## Constraints

1. **Same schema DSL** — No special WebSocket schema types.
2. **Same behavior builder** — `scenario/given/when/then`.
3. **Declarative channels** — Config object, not fluent chain.
4. **`ctx.broadcast` / `ctx.send` are type-safe** — Same pattern as `ctx.respond`.
5. **JSON envelope protocol** — `{ type, data }`. No binary framing in v1.
6. **Connection state is typed** — `channel<StateType>()`.
7. **`ws` package** — Server and test client. No Socket.IO.
8. **AsyncAPI 3.0** — Not 2.x.

---

## What This Enables

```bash
triad docs      # → OpenAPI 3.1 (REST) + AsyncAPI 3.0 (WebSocket)
triad gherkin   # → .feature files for HTTP and WS behaviors
triad test      # → Runs all behaviors (HTTP via supertest, WS via ws client)
triad db        # → Drizzle schemas for all models
triad validate  # → Validates endpoints, channels, schemas, behaviors
```

One source of truth. One CLI. One set of behaviors. Two protocols.
