---
description: Add a new WebSocket channel to a TriadJS router — connection params, `clientMessages`/`serverMessages`, `onConnect`/`onDisconnect`, handlers, and behaviors.
---

Load the `triad-channel` skill for the authoritative `channel()` signature and state typing rules. Load `triad-behaviors` for channel-specific assertion phrases.

Add a new WebSocket channel to the project based on the user's description ($ARGUMENTS).

## Prerequisites

1. **Confirm the project uses `@triadjs/fastify`** — Express and Hono adapters do NOT support channels. If the project is on a non-Fastify adapter, tell the user and stop.
2. **Install `@fastify/websocket`** if not already present: `npm install @fastify/websocket`.

## Steps

1. **Place the channel** in `src/channels/<name>.ts`.

2. **Define the state interface** and use the phantom witness pattern:
   ```ts
   interface ChatRoomState {
     userId: string;
     userName: string;
     roomId: string;
   }

   channel({
     state: {} as ChatRoomState, // phantom — value ignored, type used for ctx.state
     // ...
   });
   ```
   Without the witness, `ctx.state` is `Record<string, any>`.

3. **Declare `clientMessages`** (what clients send) and **`serverMessages`** (what the server emits). Every `clientMessages` key must have a matching `handlers[key]` — missing or extra keys are compile errors.

4. **Implement `onConnect`** — validate the handshake (via schemas or `ctx.reject(code, msg)`), seed `ctx.state`, optionally broadcast a join event.

5. **Implement `onDisconnect`** — optionally broadcast a leave event. Don't throw.

6. **Implement per-message handlers** — call repositories via `ctx.services`, then:
   - `ctx.broadcast.eventName(payload)` to send to everyone including the sender
   - `ctx.broadcastOthers.eventName(payload)` to exclude the sender
   - `ctx.send.eventName(payload)` to reply only to this client

7. **If the channel is browser-facing**, use `auth.strategy: 'first-message'` — browsers cannot set custom headers on `new WebSocket()`. Declare an `__auth` client message and cast `ctx.authPayload` inside `onConnect`.

8. **Add channel behaviors**:
   ```ts
   behaviors: [
     scenario('broadcasting a message reaches every client')
       .given('two connected clients')
       .setup(async () => ({ /* ... */ }))
       .when('alice sends a sendMessage')
       .then('all clients receive a message event')
       .and('bob receives a message with text "hello"'),
   ]
   ```
   Use channel-specific phrases from the `triad-behaviors` skill — `<client> receives a <type> event`, `all clients receive...`, `connection is rejected with code N`.

9. **Register the channel** in `src/app.ts`:
   ```ts
   router.context('Chat', { description: 'Real-time chat', models: [ChatMessage] }, (ctx) => {
     ctx.add(chatRoom); // channels go alongside endpoints in the same context
   });
   ```

10. **Regenerate docs**: `triad docs` will now emit `asyncapi.yaml` alongside `openapi.yaml`.

11. **Verify**: `triad test --filter <channelName>` — the channel test runner (`runChannelBehaviors`) picks it up automatically.

## Rules

- `ctx.broadcast.notDeclared(...)` is a compile error — broadcast/send/broadcastOthers are derived from `serverMessages`.
- `handlers` keys must exactly match `clientMessages` keys — no more, no less.
- Channel behaviors use the SAME `scenario()` builder as HTTP, but different `then` phrases.
- Do not throw from `onConnect` / `onDisconnect` — use `ctx.reject(code, msg)` in `onConnect` for handshake rejection.
- If `connection.validateBeforeConnect: false`, your `onConnect` MUST handle `ctx.validationError` or the adapter falls back to closing with 4400.

After adding the channel, run `triad test --filter <name>` and `triad docs`, then report.
