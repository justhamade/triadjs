# Step 7 — Production-ready Bookshelf

**Goal:** turn Bookshelf from a dev toy into a service you can actually deploy. Config and secrets, structured logging, graceful shutdown, error monitoring, migrations, a Dockerfile, CI, and deployment walkthroughs for Fastify, Express, and Hono (edge). None of this is specific to Triad — it's the "what do I need before I put this on the internet" checklist that every Node service has to tick.

If you stopped at [step 6](06-websockets.md), Bookshelf is already a working API. This step hardens it.

## 1. Environment config

Hard-coded values in source are the fastest way to ship a security incident. Centralize every environment variable in one module with clear error messages when something required is missing.

Create `src/config.ts`:

```ts
interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for the full list.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export function loadConfig(): AppConfig {
  const nodeEnv = optional('NODE_ENV', 'development') as AppConfig['nodeEnv'];
  const port = Number(optional('PORT', '3000'));
  const host = optional('HOST', '0.0.0.0');
  const databaseUrl =
    nodeEnv === 'production' ? required('DATABASE_URL') : optional('DATABASE_URL', ':memory:');
  const logLevel = optional('LOG_LEVEL', 'info') as AppConfig['logLevel'];

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number; got "${process.env.PORT}"`);
  }

  return { nodeEnv, port, host, databaseUrl, logLevel };
}
```

The split between `required()` and `optional()` matters. In development you want `:memory:` as a default so `npm start` just works; in production you want the process to **refuse to boot** if `DATABASE_URL` is missing, because silently defaulting to an ephemeral DB is one of those mistakes that takes a week to diagnose.

Create a `.env.example` checked into the repository:

```
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DATABASE_URL=./bookshelf.db
LOG_LEVEL=info
```

Never check in the real `.env`. Add it to `.gitignore`.

## 2. Structured logging

Fastify ships with pino. Use it. Update `src/server.ts` to pass structured log config and add request-scoped logging for the authenticated user:

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const app = Fastify({
  logger: {
    level: config.logLevel,
    // Production: JSON logs, one per line, easy for Loki/Datadog/Honeycomb
    // Development: human-friendly pretty output via pino-pretty if installed
    ...(config.nodeEnv === 'production'
      ? {}
      : { transport: { target: 'pino-pretty' } }),
  },
  // Generate a request id for every request. Downstream logs can correlate
  // on req.id so you can follow one request through your whole stack.
  genReqId: () => crypto.randomUUID(),
});

const db = createDatabase(config.databaseUrl);
const services = createServices({ db });

await app.register(triadPlugin, { router, services });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { port: config.port, host: config.host, nodeEnv: config.nodeEnv },
    'Bookshelf API ready',
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown — see section 3.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    try {
      await app.close();
      db.$raw.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  });
}
```

Install `pino-pretty` as a dev dependency for readable local logs:

```bash
npm install -D pino-pretty
```

Every log line now includes `reqId`, the Fastify request id, which you can forward from the client by honoring an `X-Request-Id` header if you like.

## 3. Graceful shutdown

The signal handlers above are a real graceful shutdown — not the "exit fast and let the orchestrator deal with it" pattern that breaks in-flight requests. The sequence matters:

1. **`app.close()`** tells Fastify to stop accepting new connections and wait for in-flight requests to finish. This also closes any WebSocket channels cleanly.
2. **`db.$raw.close()`** closes the SQLite connection after no handler can ask for it again.
3. **`process.exit(0)`** terminates the process.

If any step hangs, your orchestrator's grace period will kill the process — that's acceptable, because the ordering means you never drop a half-processed request on the floor.

## 4. Error monitoring

Triad does not ship an error-monitoring integration because every team uses a different vendor. The hook you need is Fastify's `setErrorHandler`:

```ts
app.setErrorHandler((error, request, reply) => {
  // Let Triad handle known API errors — validation failures, schema mismatches,
  // intentional 4xx responses. Only forward genuine 5xx surprises to your
  // error tracker.
  const statusCode = reply.statusCode >= 500 ? reply.statusCode : error.statusCode;
  if (statusCode === undefined || statusCode >= 500) {
    // Pseudocode for your vendor of choice:
    //   Sentry.captureException(error, { extra: { reqId: request.id, user: request.user?.id } });
    //   Honeycomb.send({ event: 'error', reqId: request.id, ... });
    request.log.error({ err: error, reqId: request.id }, 'unhandled error');
  }
  reply.send(error);
});
```

Register this after `triadPlugin` so Triad's own error envelope takes precedence for declared 4xx responses. You only forward the unexpected failures — database disconnects, null pointer exceptions, OOM crashes — because those are the ones that need human attention.

## 5. Database migrations in production

The `INIT_SQL` trick from [step 4](04-persistence.md) is fine for development but wrong for production: it only runs `CREATE TABLE IF NOT EXISTS`, so column changes silently don't apply. Use `triad db migrate` to generate migration files instead:

```bash
npx triad db migrate
```

This writes a timestamped `.sql` file under `./migrations/`. Commit it. On deploy, apply the migration before starting the server:

```bash
# In your deploy script, CI step, or startup hook:
for file in migrations/*.sql; do
  sqlite3 bookshelf.db < "$file"
done
```

For Postgres/MySQL use the appropriate client or `drizzle-kit migrate`. The details are orm-specific but the principle is the same: migrations are code, they live in git, and they run before the server accepts traffic.

Delete the `INIT_SQL` block from `src/db/client.ts` once you have real migrations — keeping both is a recipe for drift.

## 6. A multi-stage Dockerfile

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

# ---- Builder stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install build toolchain for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

# Copy manifests first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
COPY triad.config.ts ./
RUN npx triad docs && npx tsc

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated

USER app
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

Three things this buys you:

- **Smaller image.** The final runtime layer has no TypeScript compiler, no dev dependencies, and no build toolchain. On `node:20-alpine` the final image is typically under 150 MB.
- **Non-root user.** The container runs as `app`, not `root`. Standard hardening.
- **Layer caching.** Manifests come before sources, so dependency installs only rerun when `package*.json` changes, not on every source edit.

Add a `.dockerignore`:

```
node_modules
dist
generated
.env
.git
*.db
```

Build and run locally:

```bash
docker build -t bookshelf .
docker run -e DATABASE_URL=:memory: -p 3000:3000 bookshelf
```

## 7. Continuous integration

Put a CI workflow in `.github/workflows/ci.yml` that runs on every PR:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx triad validate
      - run: npx triad test
      - run: npx triad docs
      - uses: actions/upload-artifact@v4
        with:
          name: generated-docs
          path: generated/
```

This runs five checks in order: types, cross-artifact validation, behavior tests, doc generation, and an artifact upload for the generated OpenAPI/AsyncAPI/Gherkin. The `triad validate` step catches "your scenario references a model that isn't on the router" before you ever run the scenarios. The artifact makes it easy to review spec changes in PRs.

## 8. Deployment options

The whole point of keeping Triad decoupled from the HTTP adapter is that the same router works on three different runtimes. Pick the one that matches where you want to deploy.

### Option A — Fastify on a VPS or container platform

This is the default path for Bookshelf. The Dockerfile in section 6 produces an image that runs anywhere containers run: Railway, Fly.io, Render, AWS ECS, Google Cloud Run, a plain VPS, Kubernetes. No framework-specific tweaks.

Fastify is the recommended adapter when:

- You need WebSocket channels (step 6).
- You want the richest plugin ecosystem (rate limiting, CORS, compression, etc.).
- You're targeting standard Node hosting.

### Option B — Express for an existing Node stack

If you have an Express app already and you want to mount Bookshelf inside it — say, behind an auth proxy or alongside some legacy routes — swap the server file for the Express adapter. Rewrite `src/server.ts`:

```ts
import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triad/express';
import router from './app.js';
import { createDatabase } from './db/client.js';
import { createServices } from './services.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = express();
app.use(express.json()); // REQUIRED before the Triad router

const db = createDatabase(config.databaseUrl);
app.use(createTriadRouter(router, { services: createServices({ db }) }));
app.use(triadErrorHandler());

app.listen(config.port, config.host, () => {
  console.log(`Bookshelf (Express) ready on ${config.host}:${config.port}`);
});
```

The Express adapter does not support WebSocket channels in v1, so this path drops the real-time review feature from [step 6](06-websockets.md). If you need both, use Fastify, or split the WebSocket concern into a separate Fastify process and the HTTP concern into Express.

> **`express.json()` is required.** Forgetting the body parser is the #1 Express-adapter mistake. Fastify does JSON parsing internally; Express does not, and without it `ctx.body` is `undefined` in every handler.

### Option C — Hono on Cloudflare Workers (edge)

This is the payoff for Triad's adapter split. Hono runs anywhere the Fetch API runs — Cloudflare Workers, Deno Deploy, Bun, Fastly Compute@Edge. Your Bookshelf router can be deployed to the edge with no changes to endpoints, schemas, or behaviors.

```ts
// src/worker.ts
import { createTriadApp } from '@triad/hono';
import router from './app.js';
import { createServices } from './services.js';

// Cloudflare Workers cannot use better-sqlite3 — you would swap the
// in-process SQLite for a D1 database or an HTTP-based Postgres proxy
// (Neon, Supabase, PlanetScale) and adjust createDatabase() accordingly.
const app = createTriadApp(router, {
  services: createServices({ /* your edge-compatible db */ }),
});

export default app;
```

On Cloudflare Workers, `export default app` is the worker entry point. Deploy with `wrangler deploy` and your API is running on 300+ edge locations with zero cold-start overhead.

The Hono path comes with constraints:

- **No WebSocket channels** on Workers today (Hono supports them in certain runtimes, but Triad's channel adapter is Fastify-only in v1).
- **No `better-sqlite3`** — you need an edge-compatible database layer (D1, Turso, Neon, PlanetScale).
- **No long-running connections** — every request is a new isolate.

For the full comparison, see [`docs/guides/choosing-an-adapter.md`](../guides/choosing-an-adapter.md).

## 9. Observability checklist

Before you consider Bookshelf production-ready, tick every box:

1. **Structured logs** — JSON lines with `reqId`, forwarded to Loki / Datadog / CloudWatch / Honeycomb.
2. **Error tracking** — unhandled 5xx responses forwarded to Sentry / Honeycomb / BugSnag via `setErrorHandler`.
3. **Uptime monitoring** — a health check endpoint (`GET /health` returning 200) hit every minute by Pingdom / UptimeRobot / Better Uptime.
4. **Database backups** — automated daily snapshots, tested restores quarterly.
5. **Secret rotation** — `DATABASE_URL`, JWT signing keys, API tokens rotate on a schedule. Store them in a secret manager, not `.env` files.
6. **Rate limiting** — an adapter-level concern, not Triad's. For Fastify, `@fastify/rate-limit`. For Express, `express-rate-limit`. For Hono, `hono-rate-limiter`.
7. **Health and readiness endpoints** — Kubernetes and most orchestrators want separate `/healthz` (liveness) and `/readyz` (readiness) probes.
8. **Graceful shutdown verified** — test that SIGTERM actually drains in-flight requests (section 3).
9. **CI green on main** — no merges without passing `triad test` and `tsc`.
10. **Rollback plan** — you know exactly how to deploy the previous image tag, and you've rehearsed it.

None of these items are Triad-specific. They apply to any Node service.

## 10. Scaling beyond one instance

Triad endpoints are stateless (assuming your repositories are, which Drizzle is). Horizontal scaling is a load balancer in front of N identical processes.

**Channels are a different story.** Every connected WebSocket lives on exactly one server process. If you run two instances behind a round-robin load balancer, client A on instance 1 and client B on instance 2 will not see each other's broadcasts, because `ctx.broadcast.*` only iterates connections on the current process.

Two production patterns for multi-instance WebSocket apps:

- **Sticky sessions** — the load balancer pins each WebSocket connection to the same upstream, so clients on the same "room" all land on the same process. Simple, but limits your max connections per room to one process's socket capacity.
- **Pub/sub fanout** — every process subscribes to a shared Redis / NATS / Kafka topic, and `ctx.broadcast.*` publishes to the topic instead of iterating local connections. Every process then broadcasts to its own local sockets on receipt. Harder to set up but scales horizontally.

Triad does not ship either pattern out of the box. For small deployments, sticky sessions and a single process are enough. When you outgrow that, the channel handler is the right place to hook into a pub/sub bus — it's the one place broadcasts happen.

## 11. Congratulations

Bookshelf is production-ready. Over seven steps you built:

- A `Book` aggregate with derived request DTOs (steps 1–2).
- Five CRUD endpoints with behavior scenarios (step 2).
- A deep understanding of fixtures, placeholders, and the assertion parser (step 3).
- A Drizzle-backed repository with per-scenario database isolation and schema codegen (step 4).
- User accounts, bearer-token auth via `beforeHandler`, and ownership enforcement via `checkOwnership` (step 5).
- A real-time `bookReviews` WebSocket channel with typed state and broadcasts (step 6).
- Config management, structured logging, graceful shutdown, a Docker image, CI, and three deployment paths (step 7).

Where to go from here:

- Browse [`docs/guides/`](../guides/) for topical how-tos — pagination, error envelopes, working with AI assistants, choosing adapters and ORMs.
- Revisit [`docs/ai-agent-guide.md`](../ai-agent-guide.md) when you need a specific API reference or when an AI assistant needs context on Triad.
- Read the source. `examples/petstore/` is the canonical Fastify + channels reference; `examples/tasktracker/` is the canonical Express + auth + pagination reference. Both are more complete than Bookshelf — they're the source the tutorial was written against.
- Break things. Remove the `beforeHandler`, see what scenarios fail. Add a new bounded context for something of your own. The framework is small enough to hold in your head once you've done the round trip once.

Thank you for reading.
