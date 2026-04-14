# @triadjs/fastify

Fastify HTTP and WebSocket adapter for Triad routers.

## Install

```bash
npm install @triadjs/fastify
```

Peer dependencies:

- `fastify` (required)
- `@fastify/websocket` (optional -- only needed if your router declares channels)
- `@fastify/multipart` (optional -- only needed if your router uses `t.file()` fields)

## Quick Start

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './src/app.js';

const app = Fastify({ logger: true });

await app.register(triadPlugin, {
  router,
  services: { petRepo, adoptionSaga },
});

await app.listen({ port: 3000 });
```

### Per-request services

For request-scoped DB connections, auth, or multi-tenant apps, pass a factory function:

```ts
await app.register(triadPlugin, {
  router,
  services: (request) => ({
    petRepo: petRepoFor(request.user.tenantId),
    currentUser: request.user,
  }),
});
```

### Prefix mounting

Use Fastify's built-in `prefix` option on `register`:

```ts
await app.register(triadPlugin, { router, services }, { prefix: '/api/v1' });
```

## Features

- **Automatic scalar coercion** -- path params, query strings, and headers arrive as strings; the adapter coerces them to their declared types (number, boolean) before validation.
- **Request validation** -- every request part (params, query, headers, body) is validated against the endpoint's declared schema. Failures return a structured `400` envelope.
- **Response validation** -- outgoing payloads are validated through `ctx.respond`. A schema mismatch produces a `500` so invalid data never reaches the client.
- **beforeHandler** -- runs before request validation, letting auth middleware reject with `401`/`403` before the adapter `400`s on missing fields.
- **Multipart / file uploads** -- endpoints with `t.file()` fields automatically register `@fastify/multipart`. A 100 MB safeguard cap is applied; schema-level `maxSize` enforces app-specific limits.
- **Custom response headers** -- handlers can set arbitrary response headers via `HandlerResponse.headers`.

## Channel Support

Routers that declare WebSocket channels are automatically wired up when `@fastify/websocket` is installed:

```bash
npm install @fastify/websocket
```

No additional configuration is needed -- `triadPlugin` detects channels on the router and registers the WebSocket plugin and routes automatically. Each channel gets its own `ChannelHub` that scopes broadcasts by path parameters, so `/ws/rooms/abc` and `/ws/rooms/xyz` are isolated rooms.

Wire format is JSON envelopes: `{ type: string, data: unknown }` in both directions. Adapter-level errors (bad JSON, unknown message type, validation failures) are sent as `{ type: "error", data: { code, message } }`.

## API

| Export                  | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `triadPlugin`           | Fastify plugin that mounts a router (`TriadPluginOptions`) |
| `createRouteHandler`    | Build a Fastify handler for a single endpoint            |
| `createChannelHandler`  | Build a WebSocket handler for a single channel           |
| `RequestValidationError`| Error class for request validation failures              |
| `coerceScalar`          | Coerce a string value to a target scalar type            |
| `ChannelHub`            | In-process connection registry for channel broadcasts    |

## Links

- [Choosing an adapter](../../docs/guides/choosing-an-adapter.md)
- [Triad documentation](../../docs/)
