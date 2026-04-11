# @triad/hono

First-party Hono adapter for Triad — mount a Triad router onto [Hono](https://hono.dev) and run it anywhere Hono runs: Cloudflare Workers, Deno, Bun, Node.js, Fastly, Lagon.

Use this adapter when you want Triad on an edge runtime. For a traditional Node server with WebSocket / channel support, use [`@triad/fastify`](../fastify). For a middleware-style integration into an existing Express app, use [`@triad/express`](../express).

## Install

```bash
npm install @triad/core @triad/hono hono
```

## Basic usage

```ts
import { createTriadApp } from '@triad/hono';
import router from './src/app.js';

const app = createTriadApp(router, {
  services: { petRepo, adoptionSaga },
});

export default app;
```

### Node.js

```ts
import { serve } from '@hono/node-server';
serve({ fetch: app.fetch, port: 3000 });
```

### Cloudflare Workers / Deno / Fastly

```ts
export default app;
```

### Bun

```ts
export default { fetch: app.fetch };
```

## Services injection

Pass a static object for simple apps:

```ts
createTriadApp(router, {
  services: { petRepo, adoptionSaga },
});
```

Or a factory called once per request. The factory receives the standard Fetch `Request`, so you can read headers for tenant lookups, auth scopes, and DB connections:

```ts
createTriadApp(router, {
  services: (req) => ({
    petRepo: petRepoFor(req.headers.get('x-tenant') ?? 'default'),
    user: authFromHeader(req.headers.get('authorization')),
  }),
});
```

Async factories are supported:

```ts
createTriadApp(router, {
  services: async (req) => {
    const tenant = await lookupTenant(req.headers.get('x-tenant'));
    return { petRepo: await petRepoFor(tenant) };
  },
});
```

## Mounting under a prefix

The returned app is a standard `Hono` instance, so compose it with `parent.route(prefix, triadApp)`:

```ts
import { Hono } from 'hono';
import { createTriadApp } from '@triad/hono';

const triadApp = createTriadApp(router, { services });

const app = new Hono();
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/v1', triadApp);

export default app;
```

## Error envelope

Request validation failures return a 400 with the same envelope as `@triad/express` and `@triad/fastify`:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request body failed validation: name: String must be at least 1 character",
  "errors": [
    { "path": "name", "message": "String must be at least 1 character", "code": "string_too_short" }
  ]
}
```

If a handler returns a body that does not match its declared response schema, the adapter returns 500 with:

```json
{
  "code": "INTERNAL_ERROR",
  "message": "The server produced an invalid response."
}
```

Response-validation failures are logged via the `logError` option (defaults to `console.error`), because they always indicate a server bug — never trust a handler that ships invalid data.

Malformed JSON in a POST/PUT/PATCH body also returns the validation envelope:

```json
{ "code": "VALIDATION_ERROR", "message": "Request body failed validation: <root>: Request body is not valid JSON", "errors": [...] }
```

## Empty responses (204, 205, 304)

For endpoints declared with `204` (or `205`, `304`) responses, the adapter calls `c.body(null, status)` to send an empty body — no `Content-Type` is set and `res.text()` yields `''`. Declare the response with an optional schema:

```ts
responses: {
  204: { schema: t.unknown().optional(), description: 'Deleted' },
}
```

And respond with `ctx.respond[204](undefined)`.

## File uploads

Endpoints whose request body contains at least one `t.file()` field are
automatically routed through Hono's built-in
`c.req.parseBody({ all: true })` and normalized into `TriadFile` instances
before handing the body to your handler. No extra dependencies are needed —
file uploads work out of the box on every Hono-supported runtime (Node,
Bun, Deno, Cloudflare Workers).

```ts
import { t, endpoint, type TriadFile } from '@triad/core';

const AvatarUpload = t.model('AvatarUpload', {
  name: t.string(),
  avatar: t.file().maxSize(5_000_000).mimeTypes('image/png', 'image/jpeg'),
});

export const uploadAvatar = endpoint({
  name: 'uploadAvatar',
  method: 'POST',
  path: '/avatars',
  summary: 'Upload an avatar',
  request: { body: AvatarUpload },
  responses: {
    201: { schema: t.model('Ok', { url: t.string() }), description: 'Uploaded' },
  },
  handler: async (ctx) => {
    const file: TriadFile = ctx.body.avatar;
    return ctx.respond[201]({ url: `/u/${file.name}` });
  },
});
```

Schema-level `maxSize` / `mimeTypes` / `minSize` violations produce the
standard `VALIDATION_ERROR` envelope, byte-for-byte identical across the
Fastify, Express, and Hono adapters.

## Runtime notes

- **Cloudflare Workers**: `console.error` works out of the box. `process.env` does not — pass services via `env` by constructing them inside a per-request factory that closes over the worker's `env` binding.
- **Bun**: native support, no shims needed.
- **Deno**: ESM imports work as-is.
- **Node.js**: use `@hono/node-server` for the HTTP server. The adapter itself has no Node dependencies.

## WebSocket / channels

**Not supported in v1.** Hono has runtime-specific websocket helpers (`hono/bun`, `hono/cloudflare-workers`, etc), but Triad's channel model requires a consistent server-side socket abstraction across runtimes. Use [`@triad/fastify`](../fastify) for channel support. Tracked in the roadmap.

## Comparison with other adapters

- **`@triad/hono`** — use when you want edge runtime support (Cloudflare, Deno, Bun) or the minimal Web Fetch API surface.
- **`@triad/fastify`** — use for traditional Node servers that need channels/WebSockets, plugins, or Fastify's schema compiler.
- **`@triad/express`** — use when integrating Triad into an existing Express app as middleware.
