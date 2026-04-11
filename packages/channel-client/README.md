# @triad/channel-client

Generate fully-typed vanilla TypeScript WebSocket clients from Triad
`channel()` declarations.

This is the channel counterpart to `@triad/tanstack-query`: just as that
package generates typed React Query hooks from HTTP endpoints, this one
generates typed WebSocket clients from `channel()` declarations. The
runtime is dependency-free — the output is plain TypeScript over the
standard `WebSocket` global.

## Install

```bash
npm install --save-dev @triad/channel-client
```

The generator only runs at build time; the emitted output has no
runtime dependency on this package.

## Usage

```bash
triad frontend generate --target channel-client --output ./src/generated/api
```

Multiple targets:

```bash
triad frontend generate --target tanstack-query,channel-client --output ./src/generated/api
```

When run with both targets, HTTP hooks land in
`src/generated/api/` and WebSocket clients land in
`src/generated/api/channels/` so the two file sets never collide.

## What gets generated

For a router with one `channel()` named `bookReviews`, the output
directory contains:

```
channels/
  client.ts            # Shared runtime wrapper
  types.ts             # Every named schema referenced by any channel
  index.ts             # Barrel re-export
  book-reviews.ts      # Typed factory + client interface for bookReviews
```

Usage in application code:

```ts
import { createBookReviewsClient } from './generated/api/channels';

const client = createBookReviewsClient({
  url: 'wss://api.example.com',
  params: { bookId: 'abc-123' },
  auth: 'first-message',
  token: 'eyJ...',
  reconnect: { enabled: true, maxAttempts: 5 },
});

client.on('open', () => console.log('connected'));
client.on('review', (review) => console.log('new review', review.rating));
client.on('close', ({ code, reason }) => console.log('closed', code, reason));

client.send.submitReview({ rating: 5, comment: 'A masterpiece.' });

await client.close();
```

Both `send.submitReview` and `on('review', …)` are compile-time
checked against the channel's declared schemas. Passing the wrong
payload shape or subscribing to an undeclared server message is a
type error.

## Auth strategies

`BaseChannelClientOptions.auth` selects the handshake strategy:

- `'subprotocol'` — passes `['bearer', token]` as the WebSocket
  subprotocol array. Clean and browser-friendly but requires a
  server that reads the subprotocol.
- `'query'` — appends `?token=…` to the URL. Simple but leaks the
  token into server logs and proxy access logs. Avoid unless you
  understand the risk.
- `'first-message'` — connects without credentials, then sends an
  `{ type: '__auth', data: { token } }` envelope as the first
  client message. The server's `onConnect` runs against the parsed
  payload. This is the only flow that works for browsers against
  Triad's first-message auth (`auth.strategy: 'first-message'` on
  the channel).
- `'header'` — sets an `Authorization` header on the handshake.
  Only works in Node.js clients — browsers cannot set custom
  headers on `new WebSocket()`.

The first-message type defaults to `'__auth'` and the payload
defaults to `{ token }`. Both are configurable via
`firstMessageType` and `firstMessagePayload`.

## Reconnect

```ts
createBookReviewsClient({
  url: 'wss://api.example.com',
  params: { bookId: 'abc' },
  reconnect: {
    enabled: true,
    maxAttempts: 10,
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    factor: 2,
    jitter: true,
  },
});
```

Reconnect uses capped exponential backoff with optional jitter.
The client transitions through `'connecting'` → `'open'` →
`'reconnecting'` → `'open'` on every reconnect; subscribe to
`stateChange` if you need to reflect this in a UI.

## Swapping the runtime

The emitted `client.ts` is regular TypeScript. If you need a
different wrapper — say, one that integrates with your state
store or uses a different WebSocket implementation — replace
`client.ts` with your own module that exports the same types
and `BaseChannelClient` class. The per-channel factories only
depend on that public surface.

Alternatively, pass `emitRuntime: false` to the generator in a
build script to skip `client.ts` entirely and drop in your own.

## Non-goals (v1)

- No React hook wrapper. That's a follow-up phase.
- No shared connection pooling across multiple channel clients.
- No offline message queueing.
- No framework-specific variants (Solid, Svelte, Vue).

All of these are intentional — the value of the generator is the
type safety across send/receive boundaries, not a particular
runtime strategy. Bring your own.
