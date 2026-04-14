# Choosing an adapter

Triad ships three first-party HTTP adapters: Fastify, Express, and Hono. They are interchangeable from the perspective of your router, endpoints, schemas, and tests — all three mount the same `Router` object and emit the same error envelope. Where they differ is in runtime support, WebSocket / channel support, and ecosystem fit.

This guide helps you pick one, shows the minimum viable `server.ts` for each, and walks through what breaks when you move between them.

For the underlying mechanics (how adapters dispatch requests, what `ctx.services` looks like), see [`docs/ai-agent-guide.md` §9](../ai-agent-guide.md#9-adapters).

---

## 1. Decision framework

### At a glance

| | `@triadjs/fastify` | `@triadjs/express` | `@triadjs/hono` |
|---|---|---|---|
| WebSocket / channel support | Yes | No (v1 HTTP only) | No (v1 HTTP only) |
| Runtimes | Node | Node | Node, Deno, Bun, Cloudflare Workers, Fastly, Lagon |
| Throughput (req/s) | Very high | Middle | Very high (native Web Fetch) |
| Ecosystem maturity | Growing | Very large | Growing, edge-focused |
| Bundle size | Medium | Largest | Smallest |
| TypeScript ergonomics | Good | Needs `@types/express` | Excellent (first-class) |
| Body parsing | Built in | Requires `express.json()` | Built in |
| Mounts under a prefix | `register(plugin, { prefix })` | `app.use('/api/v1', ...)` | `parent.route('/api/v1', triadApp)` |
| Peer dependency | `fastify` (+ optional `@fastify/websocket`) | `express` | `hono` (+ runtime adapter, e.g. `@hono/node-server`) |
| Recommended when... | Default; anything that needs channels | Legacy Express shops with a large middleware surface | Edge deployments, Workers, Bun, minimal footprint |

### When each is the right call

**Pick Fastify** if you are starting a greenfield Triad project. It is the default for good reasons: Triad's WebSocket channels run through `@triadjs/fastify` only, throughput is excellent, the logger is already wired, and every internal feature test in the Triad repo targets it. If you are unsure, pick Fastify and move on.

**Pick Express** if you already have a large Express application and want Triad as a mountable router alongside existing middleware. Triad's Express adapter is the narrow use case: you get the whole Express ecosystem (Passport, helmet, express-session, morgan, rate limiters) running as normal, and the Triad router lives under `app.use(createTriadRouter(router, { services }))` like any other middleware. The tradeoff: no channels, and `ctx.body` is silently `undefined` if you forget `express.json()`.

**Pick Hono** if you are deploying to an edge runtime. Cloudflare Workers, Deno Deploy, Bun, Fastly Compute, Lagon — none of these run Fastify. Hono is Web Fetch API native, ships nothing that depends on Node built-ins, and scales down to the tiny cold-start budgets edge runtimes impose. Pick Hono on Node too if you want the smallest dependency surface and the cleanest TypeScript ergonomics. The cost: no channels in v1, and services injection works differently on Workers (you close over the `env` binding inside a per-request factory instead of reading `process.env` at boot).

---

## 2. Fastify setup

Install the adapter and Fastify itself. Channels also need `@fastify/websocket`.

```bash
npm install @triadjs/core @triadjs/fastify fastify
npm install --save-optional @fastify/websocket   # only if your router has channels
```

A complete `src/server.ts`:

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

await app.register(triadPlugin, { router, services });

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info({ port, host }, 'API ready');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    db.$raw.close();
    process.exit(0);
  });
}
```

Line by line:

- `Fastify({ logger: ... })` — enables pino, which `triadPlugin` uses through the standard Fastify request logger.
- `createDatabase(...)` — your Drizzle (or any other) client, constructed once at boot. See [Choosing an ORM](./choosing-an-orm.md).
- `createServices({ db })` — the module-augmented `ServiceContainer` factory. See [`docs/ai-agent-guide.md` §6](../ai-agent-guide.md#6-services--dependency-injection).
- `app.register(triadPlugin, { router, services })` — registers one Fastify route per endpoint in the router. If the router has channels, the plugin also registers WebSocket routes via `@fastify/websocket`. It throws a targeted error if channels exist but the peer is not installed.
- `app.listen({ port, host })` — standard Fastify boot.
- The shutdown loop closes Fastify first (drain in-flight requests) and then the database. Order matters.

**Per-request services** (multi-tenancy, request-scoped DB connections):

```ts
await app.register(triadPlugin, {
  router,
  services: (request) => ({
    petRepo: petRepoFor(request.user.tenantId),
  }),
});
```

The factory runs once per request. Reference: `examples/petstore/src/server.ts`.

---

## 3. Express setup

```bash
npm install @triadjs/core @triadjs/express express
npm install --save-dev @types/express
```

A complete `src/server.ts`:

```ts
import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triadjs/express';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const app = express();

// REQUIRED before the Triad router — Express does not parse JSON
// automatically. Without this, ctx.body is undefined in every handler.
app.use(express.json());

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

app.use(createTriadRouter(router, { services }));

// Optional — formats stray Triad errors thrown from your own middleware
// using the same JSON envelope as the endpoint adapter.
app.use(triadErrorHandler());

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const server = app.listen(port, host, () => {
  console.log(`listening on http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.$raw.close();
      process.exit(0);
    });
  });
}
```

Line by line:

- `express.json()` — **the single biggest Express footgun**. The Triad adapter reads `req.body` *after* Express parses it. Forget this middleware and every POST/PUT/PATCH handler sees `ctx.body === undefined`, and the request schema validator will 400 on every call. The error envelope will tell you, but the symptom is confusing if you have just migrated from Fastify where JSON parsing is free.
- `createTriadRouter(router, { services })` — returns an Express `Router` you pass to `app.use()`. Mount it at `/` or under a prefix: `app.use('/api/v1', createTriadRouter(router, { services }))`.
- `triadErrorHandler()` — optional. It only formats Triad error types thrown from user middleware; errors from inside endpoint handlers are already caught and rendered by the adapter.
- Graceful shutdown uses `server.close()` which stops accepting new connections and waits for in-flight requests to finish. The DB closes inside the callback.

Reference: `examples/tasktracker/src/server.ts`.

---

## 4. Hono setup

```bash
npm install @triadjs/core @triadjs/hono hono
```

Hono runs on many runtimes. The Triad adapter builds a single Hono app; the runtime decides how to serve it.

### Node.js

Install the Node runtime adapter:

```bash
npm install @hono/node-server
```

```ts
// src/server.ts
import { serve } from '@hono/node-server';
import { createTriadApp } from '@triadjs/hono';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';

const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

const app = createTriadApp(router, { services });

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
```

### Bun

No extra dependency — Bun natively understands `{ fetch }`:

```ts
// src/server.ts
import { createTriadApp } from '@triadjs/hono';
import router from './app.js';
import { createServices } from './services.js';

const app = createTriadApp(router, { services: createServices() });

export default { fetch: app.fetch };
```

Run with `bun run src/server.ts`.

### Cloudflare Workers

Workers do not have `process.env` and cannot construct a database connection at import time. Close over the worker's `env` binding inside a per-request services factory:

```ts
// src/worker.ts
import { createTriadApp } from '@triadjs/hono';
import router from './app.js';
import { createServicesForRequest } from './services.js';

type Env = {
  DATABASE_URL: string;
  AUTH_SECRET: string;
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const app = createTriadApp(router, {
      services: () => createServicesForRequest({
        databaseUrl: env.DATABASE_URL,
        authSecret: env.AUTH_SECRET,
      }),
    });
    return app.fetch(request, env, ctx);
  },
};
```

The per-request factory is the idiomatic way to pass Workers-style bindings into Triad's service container. See `packages/hono/README.md` for the full Cloudflare notes.

### Deno / Fastly / Lagon

Export the app directly:

```ts
import { createTriadApp } from '@triadjs/hono';
import router from './app.js';

const app = createTriadApp(router, { services: createServices() });
export default app;
```

---

## 5. Side-by-side

The same router, three different `server.ts` files:

```ts
// Fastify
import Fastify from 'fastify';
import { triadPlugin } from '@triadjs/fastify';
import router from './app.js';
import { createServices } from './services.js';

const app = Fastify();
await app.register(triadPlugin, { router, services: createServices() });
await app.listen({ port: 3000 });
```

```ts
// Express
import express from 'express';
import { createTriadRouter } from '@triadjs/express';
import router from './app.js';
import { createServices } from './services.js';

const app = express();
app.use(express.json());                                   // required
app.use(createTriadRouter(router, { services: createServices() }));
app.listen(3000);
```

```ts
// Hono (Node)
import { serve } from '@hono/node-server';
import { createTriadApp } from '@triadjs/hono';
import router from './app.js';
import { createServices } from './services.js';

const app = createTriadApp(router, { services: createServices() });
serve({ fetch: app.fetch, port: 3000 });
```

What changes:

1. **Import line** — `triadPlugin` / `createTriadRouter` / `createTriadApp`.
2. **Mount call** — `register(plugin, opts)` / `use(router)` / passed to constructor.
3. **Body parsing** — built in (Fastify, Hono) vs `express.json()` (Express).
4. **Serving** — `app.listen(...)` (Fastify, Express) vs `serve({ fetch, port })` (Hono + Node).

What stays the same: the router, every endpoint, every schema, every scenario, every repository, `ctx.services`, `ctx.respond[n]`, and every test. That is the whole point of keeping the adapter at the edge.

---

## 6. Migrating between adapters

The migration mechanics are the same in every direction: the router is the source of truth, so you are only ever replacing `server.ts`, swapping one adapter package, and re-running tests.

### Fastify → Express

1. `npm uninstall @triadjs/fastify fastify` (and `@fastify/websocket` if installed).
2. `npm install @triadjs/express express && npm install -D @types/express`.
3. Replace `src/server.ts` with the Express version from §3.
4. Add `app.use(express.json())` **before** the Triad router. This is not optional.
5. Re-run `triad test`. The test runner calls handlers in-process and does not touch the adapter, so tests pass unchanged **unless** the router declares channels.

**Channels break.** If your router contains any `channel(...)` definitions, the Express adapter silently ignores them — WebSocket routes are not registered, channel behavior scenarios still pass under `triad test` (because the test runner is adapter-independent), but your deployed server will refuse WebSocket upgrades. The fix is either to delete the channels, move them to a separate Fastify process, or not migrate.

Run `triad validate` after the swap to catch dangling channel references.

### Fastify → Hono

1. `npm uninstall @triadjs/fastify fastify` (and `@fastify/websocket` if installed).
2. `npm install @triadjs/core @triadjs/hono hono` and the runtime adapter you need (`@hono/node-server` for Node).
3. Replace `src/server.ts` with the Hono version from §4, matching your target runtime.
4. If you are also changing runtime (Node → Workers/Bun/Deno), rewrite the services factory to construct the database client inside a per-request hook rather than at module load. On Cloudflare Workers, `process.env` does not exist — use the `env` binding.
5. Re-run `triad test`.

**Channels break** the same way as the Express migration — same fix.

### Express → Hono

The easiest migration: neither adapter supports channels, so there is nothing to break. The main work is rewriting services injection if you were reading from `req` (e.g. `req.user`), because Hono's per-request factory sees a standard `Request`, not an Express `req`.

Before (Express):

```ts
app.use(createTriadRouter(router, {
  services: (req) => ({ currentUser: req.user }),
}));
```

After (Hono):

```ts
const app = createTriadApp(router, {
  services: (req) => ({
    currentUser: authFromHeader(req.headers.get('authorization')),
  }),
});
```

### Migration checklist (any direction)

- [ ] Swap the adapter package in `package.json`.
- [ ] Replace `src/server.ts`.
- [ ] Re-add body parsing if moving to Express.
- [ ] Re-run `triad test` (expect identical output).
- [ ] Re-run `triad validate`.
- [ ] Re-run `triad docs` — the OpenAPI output is identical across adapters.
- [ ] Smoke-test a real HTTP request against a deployed instance.
- [ ] If the router has channels and the target adapter is not Fastify, reconcile the channels first.

---

## 7. Error envelope parity

All three adapters emit byte-for-byte identical error envelopes for both validation failures and response-schema safety-net errors. This is load-bearing: it means clients do not break during an adapter swap.

### Request validation failure (400)

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request body failed validation: name: String must be at least 1 character",
  "errors": [
    { "path": "name", "message": "String must be at least 1 character", "code": "string_too_short" }
  ]
}
```

### Response validation safety net (500)

Emitted when a handler returns a body that fails the declared response schema. Always a server bug.

```json
{
  "code": "INTERNAL_ERROR",
  "message": "The server produced an invalid response."
}
```

Sources: `packages/express/README.md`, `packages/hono/README.md`, and the Fastify adapter tests in `packages/fastify/__tests__/`. All three adapters construct the envelope via shared validation-error formatters.

---

## 8. Can I use something else?

Yes. Triad's router is just data: `router.allEndpoints()` returns a flat array of endpoints with `{ method, path, handler, request, responses, beforeHandler, behaviors }`. Writing a new adapter is a few hundred lines and mostly consists of:

1. Walking `router.allEndpoints()` and registering one route per endpoint on your host framework.
2. For each request: parse path params / query / headers / body, validate each part against the endpoint's declared schemas, build a `HandlerContext`, invoke `beforeHandler` (if any), then `handler`.
3. Validating the handler's response against the declared response schema for the returned status.
4. On any validation error, emitting the shared error envelope described above.

The three existing adapters are reference implementations:

- `packages/fastify/src/adapter.ts` — the core dispatcher, roughly 300 lines.
- `packages/express/src/router.ts` — the Express middleware version.
- `packages/hono/src/adapter.ts` — the Web Fetch version.

Candidates that make sense as third-party adapters: Koa, plain `node:http`, NestJS (as a custom decorator bridge), uWebSockets.js. NestJS is the trickiest because its request lifecycle is opinionated — you would likely wrap Triad endpoints as controllers rather than bypass Nest's DI.

Channels are harder to port than HTTP because Triad's channel model expects broadcast, per-client send, and connection lifecycle hooks. The Fastify channel adapter (`packages/fastify/src/channel-adapter.ts`) is the only reference.

---

## 9. FAQ

**Can I mix adapters in one app?**
Not in one process. A Triad router mounts on exactly one adapter. You can run two processes — e.g. a Fastify server for HTTP + channels and a Hono worker for edge traffic — but they should serve different routers, or at least different deployments of the same router.

**What about middleware from the Express ecosystem?**
The Express adapter works with any standard Express middleware: register it with `app.use(...)` before mounting the Triad router. Fastify and Hono have their own plugin systems (`app.register(plugin)` and `app.use(middleware)` respectively). Ecosystem plugins are not portable across adapters.

**What runtimes does each adapter support?**
Fastify: Node only. Express: Node only. Hono: Node, Deno, Bun, Cloudflare Workers, Fastly Compute, Lagon.

**How do I add rate limiting?**
Adapter-specific. Fastify: `@fastify/rate-limit`. Express: `express-rate-limit`. Hono: `hono/rate-limiter` or a Cloudflare-side rule. Register the plugin or middleware before the Triad router mounts.

**How do I add CORS?**
Same answer. Fastify: `@fastify/cors`. Express: `cors`. Hono: `hono/cors`. All three accept a standard CORS config.

**Does the adapter affect my tests?**
No. `triad test` calls endpoint handlers in-process without touching any adapter — see [`docs/ai-agent-guide.md` §5.4](../ai-agent-guide.md#54-the-test-runner-flow-what-happens-per-scenario). That is why adapter migrations do not change your test output.

**Where is OpenAPI served?**
Nowhere, by default. Generate `openapi.yaml` at build time with `triad docs` and serve it with whatever static hosting you already have. If you want a live UI at `/docs`, mount the static file under any of the three adapters using their standard static-asset support.

**I want channels on Express / Hono — what are my options?**
Run a side Fastify process that serves the channels on a different port or subdomain, and keep your HTTP endpoints on the adapter you prefer. Both servers can share the same router import — they will simply skip each other's unsupported route types. Express/Hono channel support is on the roadmap; see [ROADMAP.md](../../ROADMAP.md).
