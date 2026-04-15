---
name: triad-adapters
description: Use when mounting a TriadJS router on Fastify (`triadPlugin`), Express (`createTriadRouter`), or Hono (`createTriadHono`), configuring per-request services, or choosing which adapter fits a deployment target. Fastify is the only adapter with WebSocket support.
---

# Adapters — Fastify, Express, Hono

The Triad router is framework-agnostic. Adapters mount it on a concrete HTTP framework.

| Adapter | HTTP | WebSockets | Swagger UI | Notes |
|---|---|---|---|---|
| `@triadjs/fastify` | ✅ | ✅ | ✅ | Recommended. Full feature support including channels. |
| `@triadjs/express` | ✅ | ❌ | ✅ | Mature ecosystem. HTTP only. |
| `@triadjs/hono` | ✅ | ❌ | ✅ | Edge-friendly (Cloudflare Workers, Deno, Bun). HTTP only. |

## Built-in Swagger UI — the `docs` option

Every adapter accepts the same `docs?: DocsOption` field. When enabled, the adapter registers two extra routes:

- `GET {path}` — Swagger UI HTML page
- `GET {path}/openapi.json` — the live OpenAPI 3.1 document as JSON

The OpenAPI document is generated **once** at plugin/app construction time, not per request, so the dev server pays the cost at startup only.

**Decision table:**

| `docs` value | Effect |
|---|---|
| `undefined` (default) | On when `NODE_ENV !== 'production'`, off otherwise |
| `true` | On with defaults (`path: '/api-docs'`, title from `router.config.title`) |
| `false` | Off |
| `{ path, title, swaggerUIVersion }` | On with overrides |

**Default path** is `/api-docs`. Example wiring:

```ts
// Fastify
await app.register(triadPlugin, { router, services, docs: true });

// Express
app.use(createTriadRouter(router, { services, docs: true }));

// Hono
const app = createTriadApp(router, { services, docs: true });
```

Then visit `http://localhost:3000/api-docs` in a browser — Swagger UI loads, lists every endpoint, and the "Try it out" button works against your running server. No extra install, no peer dependency; the page pulls Swagger UI assets from jsdelivr.

**When the user asks for docs**, default to `docs: true` — the user's intent is almost always "I want Swagger UI right now." Use `docs: { path: '/something-else' }` only when they explicitly name a different path.

**Route-collision check:** if the router already has a `GET /api-docs` endpoint, every adapter throws at construction time with a clear error pointing at the `docs.path` option. Move the docs to a different path or rename the colliding endpoint.

## Fastify (recommended)

Supports HTTP endpoints **and** WebSocket channels.

```ts
// src/server.ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

const app = Fastify({ logger: true });
const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

await app.register(triadPlugin, { router, services });
await app.listen({ port: 3000, host: '0.0.0.0' });
```

### Per-request services (tenancy, auth-scoped DBs)

```ts
await app.register(triadPlugin, {
  router,
  services: (request) => ({
    petRepo: petRepoFor(request.user.tenantId),
  }),
});
```

### Channels

For channels, install `@fastify/websocket` as an optional peer:

```bash
npm install @fastify/websocket
```

The plugin lazily imports it only when the router has channels, so HTTP-only routers keep working without the peer installed. If the router has channels but the peer is missing, you'll get a targeted error message pointing at the fix.

### Raw Fastify routes alongside the Triad plugin

Anything Triad doesn't model — exotic webhooks, streaming endpoints, one-off multipart handlers — can live as a raw Fastify route alongside the plugin. Triad never touches non-plugin routes:

```ts
await app.register(triadPlugin, { router, services });

app.post('/webhooks/stripe', async (req, reply) => {
  // raw route — not in OpenAPI, not covered by behaviors
});
```

Tradeoff: raw routes don't appear in `triad docs` OpenAPI output and aren't covered by the BDD test runner. You own their validation and their tests.

## Express

HTTP endpoints only.

```ts
// src/server.ts
import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triadjs/express';
import router from './app.js';
import { createServices } from './services.js';

const app = express();
app.use(express.json());        // REQUIRED before the Triad router
app.use(createTriadRouter(router, { services: createServices() }));
app.use(triadErrorHandler());   // optional — formats stray Triad errors
app.listen(3000);
```

> **GOTCHA:** Forgetting `express.json()` means `ctx.body` is `undefined`. Fastify parses JSON internally; Express does not.

### Raw Express routes

`createTriadRouter(router)` returns a standard `express.Router`. Mount your own routes next to it — same tradeoff as the Fastify raw-route story.

```ts
app.use('/api', createTriadRouter(router));
app.post('/webhooks/github', /* raw handler */);
```

## Hono (edge-friendly)

Edge runtimes: Cloudflare Workers, Deno Deploy, Bun. HTTP only.

```ts
import { Hono } from 'hono';
import { createTriadHono } from '@triadjs/hono';
import router from './app.js';
import { createServices } from './services.js';

const app = new Hono();
app.route('/', createTriadHono(router, { services: createServices() }));

export default app;
```

For Cloudflare Workers, export the Hono app as default; for Bun/Deno, use their native listeners. See `@triadjs/hono` README for runtime-specific guidance.

## Choosing an adapter

| Scenario | Pick |
|---|---|
| Need WebSocket channels | Fastify |
| Mature Node ecosystem, lots of existing Express middleware | Express |
| Deploying to Cloudflare Workers / edge | Hono |
| Best OOTB experience, least ceremony | Fastify |

## The "impossible to forget to propagate" scoping claim

Triad makes it impossible to forget to propagate a schema change *within the things Triad owns* — add a field to a `Pet` model and it flows through validation, types, OpenAPI, Gherkin, and tests automatically. **Raw adapter routes live outside that bubble.** Use them deliberately, document where they live, and the 80/20 tradeoff pays off.

## Checklist when wiring an adapter

1. For Fastify: pass `router` and `services` (either a value or a request-scoped factory).
2. For Express: `express.json()` BEFORE `createTriadRouter(...)`. Missing it is the #1 "ctx.body is undefined" debugging session.
3. If you're using channels, the Fastify adapter is the only option — and you need `@fastify/websocket` installed.
4. The Triad router stays the source of truth. Raw adapter routes are an escape hatch, not a first-class feature.
5. `triadErrorHandler()` (Express) catches stray Triad errors and formats them in the standard envelope — use it.
