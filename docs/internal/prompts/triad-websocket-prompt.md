# Triad Framework — WebSocket Support via `channel()`

## Prompt for Claude Code

You are extending **Triad**, a TypeScript/Node.js API framework where specification, implementation, validation, and testing are a single source of truth.

Triad already supports HTTP endpoints via `endpoint()`. This extension adds WebSocket support via `channel()` — using the same schema DSL (`t.*`), the same behavior builder (`scenario/given/when/then`), and the same CLI outputs, but for bidirectional real-time communication.

**Pre-requisite**: The core Triad framework (Phases 1-8) must be built before starting this. This is Phase 9.

---

## Design Philosophy

WebSocket support follows the same Triad principles:

1. **Single source of truth** — A `channel()` definition produces types, validation, AsyncAPI docs, Gherkin behaviors, and tests
2. **Code-first** — No YAML, no AsyncAPI files to maintain by hand
3. **Declarative** — Channels are configuration objects, same as endpoints
4. **Schema DSL is protocol-agnostic** — `t.model()` works for HTTP request bodies AND WebSocket message payloads
5. **AI-legible** — An AI reading a channel definition understands the full real-time contract from one file

---

## Core Concept: `channel()` alongside `endpoint()`

HTTP has request → response (one-shot). WebSockets have connection → bidirectional messages → disconnection. The abstractions differ:

| HTTP (`endpoint()`)       | WebSocket (`channel()`)           |
|---------------------------|-----------------------------------|
| `request.body`            | `clientMessages` (what client sends) |
| `responses`               | `serverMessages` (what server sends) |
| `handler`                 | `handlers` (one per client message type) |
| `ctx.respond[status]`     | `ctx.broadcast.*` / `ctx.send.*`  |
| One request, one response | Continuous bidirectional stream    |
| Stateless                 | Stateful (connection lifecycle)   |

---

## The `channel()` API

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
  userId: t.string().format('uuid').doc('User who is typing'),
  isTyping: t.boolean().doc('Whether they are currently typing'),
});

const UserPresence = t.model('UserPresence', {
  userId: t.string().format('uuid').doc('User ID'),
  username: t.string().doc('Display name'),
  action: t.enum('joined', 'left').doc('What happened'),
});

const ErrorMessage = t.model('ErrorMessage', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});

export const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat room',
  description: 'Bidirectional messaging channel for a specific chat room',
  tags: ['Chat'],

  // ──────────────────────────────────────────────
  // Connection parameters — validated on handshake
  // ──────────────────────────────────────────────
  connection: {
    params: {
      roomId: t.string().format('uuid').doc('Room to join'),
    },
    headers: {
      authorization: t.string().doc('Bearer token for authentication'),
    },
    query: {
      reconnectToken: t.string().optional().doc('Token for resuming a previous session'),
    },
  },

  // ──────────────────────────────────────────────
  // Messages the CLIENT can send to the server
  // ──────────────────────────────────────────────
  clientMessages: {
    sendMessage: {
      schema: t.model('SendMessagePayload', {
        text: t.string().minLength(1).maxLength(2000).doc('Message text'),
      }),
      description: 'Send a chat message to the room',
    },
    typing: {
      schema: t.model('TypingPayload', {
        isTyping: t.boolean().doc('Whether the user is typing'),
      }),
      description: 'Indicate typing status',
    },
    editMessage: {
      schema: t.model('EditMessagePayload', {
        messageId: t.string().format('uuid').doc('Message to edit'),
        text: t.string().minLength(1).maxLength(2000).doc('New text'),
      }),
      description: 'Edit a previously sent message',
    },
  },

  // ──────────────────────────────────────────────
  // Messages the SERVER can send to the client
  // ──────────────────────────────────────────────
  serverMessages: {
    message: {
      schema: ChatMessage,
      description: 'A new or updated message in the room',
    },
    typing: {
      schema: TypingIndicator,
      description: 'A user started or stopped typing',
    },
    presence: {
      schema: UserPresence,
      description: 'A user joined or left the room',
    },
    error: {
      schema: ErrorMessage,
      description: 'An error occurred processing a client message',
    },
  },

  // ──────────────────────────────────────────────
  // Connection lifecycle
  // ──────────────────────────────────────────────
  onConnect: async (ctx) => {
    // ctx.params.roomId is typed as string
    // ctx.headers.authorization is typed as string
    // ctx.query.reconnectToken is typed as string | undefined

    const room = await ctx.services.roomRepo.findById(ctx.params.roomId);
    if (!room) {
      return ctx.reject(404, 'Room not found');
    }

    const user = await ctx.services.auth.verifyToken(ctx.headers.authorization);
    if (!user) {
      return ctx.reject(401, 'Invalid token');
    }

    // Store user in connection state
    ctx.state.user = user;
    ctx.state.roomId = ctx.params.roomId;

    // Add user to room and broadcast their arrival
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

  // ──────────────────────────────────────────────
  // Message handlers — one per client message type
  // ──────────────────────────────────────────────
  handlers: {
    sendMessage: async (ctx, data) => {
      // data is typed as { text: string } — inferred from clientMessages.sendMessage.schema
      const message = await ctx.services.messageRepo.create({
        roomId: ctx.state.roomId,
        userId: ctx.state.user.id,
        text: data.text,
      });

      // Type-safe: ctx.broadcast.message only accepts ChatMessage shape
      ctx.broadcast.message(message);
    },

    typing: async (ctx, data) => {
      // data is typed as { isTyping: boolean }
      // Broadcast to others in the room (not back to sender)
      ctx.broadcastOthers.typing({
        userId: ctx.state.user.id,
        isTyping: data.isTyping,
      });
    },

    editMessage: async (ctx, data) => {
      // data is typed as { messageId: string, text: string }
      const message = await ctx.services.messageRepo.findById(data.messageId);

      if (!message) {
        ctx.send.error({ code: 'NOT_FOUND', message: 'Message not found' });
        return;
      }

      if (message.userId !== ctx.state.user.id) {
        ctx.send.error({ code: 'FORBIDDEN', message: 'Can only edit your own messages' });
        return;
      }

      const updated = await ctx.services.messageRepo.update(data.messageId, { text: data.text });
      ctx.broadcast.message(updated);
    },
  },

  // ──────────────────────────────────────────────
  // Behaviors — same scenario/given/when/then pattern
  // ──────────────────────────────────────────────
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
      .and('message has text "Hello everyone"')
      .and('message has userId matching the sender'),

    scenario('Typing indicators are broadcast to other users only')
      .given('two users are connected to the same room')
      .setup(async (services) => {
        const room = await services.roomRepo.create({ name: 'General' });
        const alice = await services.userRepo.create({ name: 'Alice' });
        const bob = await services.userRepo.create({ name: 'Bob' });
        return { roomId: room.id, aliceToken: alice.token, bobToken: bob.token };
      })
      .when('Alice sends typing with isTyping true')
      .then('Bob receives a typing event with isTyping true')
      .and('Alice does NOT receive a typing event'),

    scenario('Users cannot edit other users messages')
      .given('Alice sent a message in the room')
      .setup(async (services) => {
        const room = await services.roomRepo.create({ name: 'General' });
        const alice = await services.userRepo.create({ name: 'Alice' });
        const bob = await services.userRepo.create({ name: 'Bob' });
        const message = await services.messageRepo.create({
          roomId: room.id,
          userId: alice.id,
          text: 'Original message',
        });
        return { roomId: room.id, bobToken: bob.token, messageId: message.id };
      })
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
      .setup(async (services) => {
        const room = await services.roomRepo.create({ name: 'General' });
        return { roomId: room.id };
      })
      .when('client connects without authorization header')
      .then('connection is rejected with code 401'),

    scenario('Other users are notified when a user joins')
      .given('Bob is connected to a room')
      .setup(async (services) => {
        const room = await services.roomRepo.create({ name: 'General' });
        const bob = await services.userRepo.create({ name: 'Bob' });
        const alice = await services.userRepo.create({ name: 'Alice' });
        return { roomId: room.id, bobToken: bob.token, aliceToken: alice.token };
      })
      .when('Alice connects to the room')
      .then('Bob receives a presence event with action "joined"')
      .and('presence has username "Alice"'),

    scenario('Other users are notified when a user disconnects')
      .given('Alice and Bob are connected to a room')
      .when('Alice disconnects')
      .then('Bob receives a presence event with action "left"')
      .and('presence has username "Alice"'),
  ],
});
```

---

## The Channel Context Types

```typescript
// Connection context — available in onConnect
interface ChannelConnectContext<TParams, TQuery, THeaders> {
  params: InferObjectSchema<TParams>;
  query: InferObjectSchema<TQuery>;
  headers: InferObjectSchema<THeaders>;
  services: ServiceContainer;
  state: Record<string, any>;                     // Mutable connection state
  reject: (code: number, message: string) => void; // Reject the connection
  broadcast: BroadcastMap<TServerMessages>;       // Send to all in channel
}

// Message handler context — available in handlers.*
interface ChannelMessageContext<TParams, TServerMessages> {
  params: InferObjectSchema<TParams>;
  services: ServiceContainer;
  state: Record<string, any>;                     // Connection state set in onConnect
  broadcast: BroadcastMap<TServerMessages>;       // Send to ALL clients in channel
  broadcastOthers: BroadcastMap<TServerMessages>; // Send to all EXCEPT sender
  send: SendMap<TServerMessages>;                 // Send to THIS client only
}

// BroadcastMap and SendMap are type-safe — same pattern as ctx.respond for HTTP
type BroadcastMap<TServerMessages> = {
  [K in keyof TServerMessages]: (
    data: InferSchema<TServerMessages[K]['schema']>
  ) => void;
};

// ctx.broadcast.message(chatMessage)    — type-safe, only accepts ChatMessage shape
// ctx.broadcast.typing(indicator)       — type-safe, only accepts TypingIndicator shape
// ctx.broadcast.notAReal('x')           — compile error, not a declared server message
```

### Connection State

Unlike HTTP endpoints (stateless), WebSocket channels maintain state per connection via `ctx.state`. This is set in `onConnect` and available in all message handlers and `onDisconnect`:

```typescript
// In onConnect:
ctx.state.user = user;           // Store authenticated user
ctx.state.roomId = roomId;       // Store which room they're in

// In handlers:
ctx.state.user.id               // Access stored user
ctx.state.roomId                // Access stored room
```

`ctx.state` is an untyped `Record<string, any>` by default. For type safety, channels can declare their state shape:

```typescript
interface ChatRoomState {
  user: { id: string; name: string };
  roomId: string;
}

export const chatRoom = channel<ChatRoomState>({
  // ... now ctx.state is typed as ChatRoomState in all handlers
});
```

---

## Wire Protocol

Triad uses a simple JSON envelope for WebSocket messages:

```typescript
// Client → Server
{
  "type": "sendMessage",           // Matches key in clientMessages
  "data": { "text": "Hello" }     // Validated against clientMessages.sendMessage.schema
}

// Server → Client
{
  "type": "message",              // Matches key in serverMessages
  "data": { ... }                 // Matches serverMessages.message.schema
}
```

Triad validates incoming messages against `clientMessages` schemas and validates outgoing messages against `serverMessages` schemas. Invalid messages receive an error event:

```typescript
// Server → Client (validation error)
{
  "type": "error",
  "data": {
    "code": "INVALID_MESSAGE",
    "message": "Validation failed for 'sendMessage': text must be at least 1 character"
  }
}
```

---

## CLI Outputs — AsyncAPI

WebSocket channels generate **AsyncAPI 3.0** specs, alongside OpenAPI for HTTP endpoints:

```bash
triad docs --output ./generated/
# Produces:
#   ./generated/openapi.yaml     (HTTP endpoints)
#   ./generated/asyncapi.yaml    (WebSocket channels)
```

The AsyncAPI output maps directly from the channel definition:

- `channel.path` → AsyncAPI channel
- `clientMessages` → AsyncAPI `publish` operations (client publishes to server)
- `serverMessages` → AsyncAPI `subscribe` operations (client subscribes to server)
- `connection.params/headers/query` → AsyncAPI channel bindings
- Schemas → AsyncAPI components/schemas (shared with OpenAPI where models overlap)

### Generated AsyncAPI Example

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
        description: Room to join
        schema:
          type: string
          format: uuid
    messages:
      sendMessage:
        payload:
          $ref: '#/components/schemas/SendMessagePayload'
      typing:
        payload:
          $ref: '#/components/schemas/TypingPayload'
      message:
        payload:
          $ref: '#/components/schemas/ChatMessage'
      presence:
        payload:
          $ref: '#/components/schemas/UserPresence'
```

---

## Gherkin Output for WebSocket Behaviors

```gherkin
Feature: Chat Room

  Scenario: Users can send messages to a room
    Given a user is connected to room {roomId}
    When client sends sendMessage with text "Hello everyone"
    Then all clients in the room receive a message event
    And message has text "Hello everyone"
    And message has userId matching the sender

  Scenario: Typing indicators are broadcast to other users only
    Given two users are connected to the same room
    When Alice sends typing with isTyping true
    Then Bob receives a typing event with isTyping true
    And Alice does NOT receive a typing event

  Scenario: Users cannot edit other users messages
    Given Alice sent a message in the room
    When Bob sends editMessage for Alice's message
    Then Bob receives an error event
    And error has code "FORBIDDEN"

  Scenario: Connection is rejected for non-existent rooms
    Given no room exists with id {roomId}
    When client connects to /ws/rooms/{roomId}
    Then connection is rejected with code 404

  Scenario: Other users are notified when a user joins
    Given Bob is connected to a room
    When Alice connects to the room
    Then Bob receives a presence event with action "joined"
    And presence has username "Alice"

  Scenario: Other users are notified when a user disconnects
    Given Alice and Bob are connected to a room
    When Alice disconnects
    Then Bob receives a presence event with action "left"
    And presence has username "Alice"
```

---

## Test Runner — WebSocket Behavior Execution

The test runner needs a WebSocket test client alongside supertest. For each behavior:

1. **Setup**: Create test data via `.setup()`
2. **Connect**: Open WebSocket connection(s) with appropriate headers/params
3. **Send**: Send client messages as specified in `when`
4. **Assert**: Verify received server messages match `then` assertions
5. **Teardown**: Close connections, clean up

Key testing patterns for WebSockets:
- **Multi-client tests**: Some scenarios need 2+ connected clients to verify broadcast behavior
- **Ordering**: Assert that messages arrive in the expected order
- **Negative delivery**: Assert that a specific client does NOT receive a message (e.g., typing indicators not sent back to sender)
- **Connection rejection**: Assert that the WebSocket handshake is rejected with the right status code
- **Disconnection events**: Assert that disconnect triggers the right broadcasts

The test runner should use the `ws` package for WebSocket client connections in tests.

---

## Router Registration

Channels register on the same router as endpoints:

```typescript
import { createRouter } from '@triadjs/core';
import { createPet, getPet, listPets } from './endpoints/pets';
import { chatRoom } from './channels/chat';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
});

// HTTP endpoints
router.add(createPet, getPet, listPets);

// WebSocket channels
router.add(chatRoom);

// Or grouped by domain context
router.context('Chat', {
  description: 'Real-time messaging',
  models: [ChatMessage, TypingIndicator, UserPresence],
}, (ctx) => {
  ctx.add(chatRoom);
  ctx.add(getRoomHistory);   // HTTP endpoint for loading chat history
});
```

Both `endpoint()` and `channel()` definitions register on the same router. The router knows which is which and routes them to the appropriate generators (OpenAPI vs AsyncAPI) and test runners (supertest vs ws client).

---

## Storage — Messages Need Persistence Too

Chat messages, events, and other WebSocket data often need storage. The same `.storage()` pattern works:

```typescript
const ChatMessage = t.model('ChatMessage', {
  id: t.string().format('uuid').identity().storage({ defaultRandom: true }),
  roomId: t.string().format('uuid').storage({ references: 'rooms.id' }),
  userId: t.string().format('uuid').storage({ references: 'users.id' }),
  text: t.string().minLength(1).maxLength(2000).doc('Message content'),
  timestamp: t.datetime().storage({ defaultNow: true }),
})
.storage({
  tableName: 'chat_messages',
  columns: {
    editedAt: { type: 'timestamp', nullable: true },
    deletedAt: { type: 'timestamp', nullable: true },
  },
  indexes: [
    { columns: ['roomId', 'timestamp'] },
    { columns: ['userId'] },
  ],
});
```

`triad db` generates the Drizzle table definition for this model regardless of whether it's used in an HTTP endpoint, a WebSocket channel, or both.

---

## Shared Models Between HTTP and WebSocket

One of Triad's strengths: the same model can be used in both HTTP endpoints and WebSocket channels.

```typescript
// This model is used in:
// - GET /rooms/:roomId/messages (HTTP endpoint, returns ChatMessage[])
// - chatRoom channel (WebSocket, broadcasts ChatMessage on new message)

const ChatMessage = t.model('ChatMessage', { /* ... */ });

// HTTP endpoint
export const getRoomHistory = endpoint({
  name: 'getRoomHistory',
  method: 'GET',
  path: '/rooms/:roomId/messages',
  responses: {
    200: { schema: t.array(ChatMessage), description: 'Message history' },
  },
  // ...
});

// WebSocket channel
export const chatRoom = channel({
  serverMessages: {
    message: { schema: ChatMessage, description: 'New message' },
  },
  // ...
});
```

In OpenAPI, `ChatMessage` appears as a schema component. In AsyncAPI, the same `ChatMessage` appears as a message payload. The schema is defined once.

---

## Package Structure

Add a new package for AsyncAPI generation. The WebSocket test runner logic extends the existing test-runner package.

```
packages/
├── core/                       # channel() function added alongside endpoint()
│   └── src/
│       ├── channel.ts          # channel() declarative definition
│       ├── channel-context.ts  # ChannelConnectContext, ChannelMessageContext types
│       └── wire-protocol.ts    # JSON envelope format for WS messages
│
├── asyncapi/                   # @triadjs/asyncapi — AsyncAPI 3.0 generator (NEW)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   └── generator.ts       # Walks channels → emits AsyncAPI 3.0 document
│   └── __tests__/
│       └── generator.test.ts
│
├── test-runner/                # Extended to support WebSocket behaviors
│   └── src/
│       ├── ws-client.ts        # WebSocket test client (wraps `ws` package)
│       ├── ws-runner.ts        # Executes channel behaviors
│       └── ws-assertions.ts    # WS-specific assertions (received, not-received, ordering)
│
└── cli/
    └── src/
        └── commands/
            └── docs.ts         # Updated: generates both OpenAPI + AsyncAPI
```

---

## Implementation Order (Phase 9)

1. `@triadjs/core/channel.ts` — The `channel()` function and its type definitions
2. `@triadjs/core/channel-context.ts` — ChannelConnectContext, ChannelMessageContext, BroadcastMap, SendMap types
3. `@triadjs/core/wire-protocol.ts` — JSON envelope format, message routing logic
4. Update `@triadjs/core/router.ts` — Support registering channels alongside endpoints
5. `@triadjs/asyncapi/generator.ts` — Walk channels → produce AsyncAPI 3.0 spec
6. Update `@triadjs/gherkin/generator.ts` — Handle channel behaviors in Gherkin output
7. `@triadjs/test-runner/ws-client.ts` — WebSocket test client for behavior execution
8. `@triadjs/test-runner/ws-runner.ts` — Execute channel behaviors with multi-client support
9. `@triadjs/test-runner/ws-assertions.ts` — received, not-received, ordering, connection rejection assertions
10. Update `@triadjs/cli` — `triad docs` generates both OpenAPI + AsyncAPI
11. Example: Add a chat room channel to the petstore example app
12. Tests for everything

---

## Important Constraints

1. **Same schema DSL** — WebSocket message schemas use `t.model()`, same as HTTP. No special WebSocket schema types.
2. **Same behavior builder** — `scenario/given/when/then` works for both HTTP and WebSocket. The `when` and `then` descriptions just differ.
3. **Declarative channels** — `channel()` takes a config object, not a fluent chain. Same style as `endpoint()`.
4. **`ctx.broadcast` / `ctx.send` are type-safe** — Same pattern as `ctx.respond` for HTTP. Only declared server message types are available.
5. **JSON envelope protocol** — Triad uses `{ type, data }` JSON messages. Binary protocols or custom framing are out of scope for v1.
6. **Connection state is typed** — `channel<StateType>()` generic for typed `ctx.state`.
7. **The `ws` package** for the server-side WebSocket implementation and test client. NOT Socket.IO — Triad uses standard WebSockets.
8. **AsyncAPI 3.0** for the generated spec, not 2.x.

---

## What This Enables

With HTTP endpoints and WebSocket channels using the same schema DSL, the same router, and the same behavior pattern, Triad becomes a **full API framework** — not just a REST framework. A single Triad project produces:

```bash
triad docs      # → OpenAPI 3.1 (REST) + AsyncAPI 3.0 (WebSocket)
triad gherkin   # → .feature files for both HTTP and WS behaviors
triad test      # → Runs all behaviors (HTTP via supertest, WS via ws client)
triad db        # → Drizzle schemas for all models (used in HTTP, WS, or both)
triad validate  # → Validates all endpoints, channels, schemas, and behaviors
```

One source of truth. One CLI. One set of behaviors. Two protocols.
