# Triad

[![CI](https://github.com/justhamade/triad/actions/workflows/ci.yml/badge.svg)](https://github.com/justhamade/triad/actions/workflows/ci.yml)

**One TypeScript definition. Validation, OpenAPI, AsyncAPI, BDD tests, Gherkin, and database schemas — all generated from the same source of truth.**

Triad is a TypeScript-first API framework built on the idea that an API's *specification*, *implementation*, *validation*, and *tests* should never drift apart, because they are the same thing. You write TypeScript once using Triad's declarative DSL, and you get:

- **Runtime validation** at the edges (parse + reject with structured errors)
- **Static types** derived from the same schemas (`t.infer<typeof X>`)
- **OpenAPI 3.1** documentation for HTTP endpoints
- **AsyncAPI 3.0** documentation for WebSocket channels
- **Executable BDD scenarios** that run as tests (`triad test`)
- **Automatic adversarial tests** derived from your schema constraints (`scenario.auto()`)
- **Gherkin `.feature` files** generated for non-technical stakeholders
- **Typed frontend hooks** for React Query, Solid Query, Vue Query, Svelte Query (`triad frontend generate`)
- **Database schemas** via a dialect-neutral Drizzle bridge (`triad db generate`)

No codegen round-trips. No hand-maintained OpenAPI YAML. No duplicate Zod + OpenAPI + test-fixture schemas that fall out of sync.

### Built for humans *and* AI

Triad's north star is that **an AI coding assistant should be able to understand an entire API by reading one place**. When schemas, handlers, responses, channel payloads, tests, and docs all live in the same typed definitions, an LLM (or a new engineer) doesn't have to stitch context together from a Zod file, an OpenAPI YAML, a separate test fixture, and a README that's three commits out of date. There is one source of truth, and every other artifact is a deterministic projection of it. That's what keeps humans productive — and it's what lets AI reason about your API without guessing.

---

## Taste of it

```typescript
import { t, endpoint, scenario, createRouter } from '@triadjs/core';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  name: t.string().minLength(1).example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const createPet = endpoint({
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  body: CreatePet,
  responses: { 201: Pet, 400: ApiError },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('creates a pet with valid input')
      .when('POST /pets', { body: { name: 'Rex', species: 'dog', age: 3 } })
      .then('status is 201')
      .and('response body matches { name: "Rex", species: "dog" }'),

    // One line — the framework generates ~20 boundary/adversarial
    // tests from the schema constraints you already declared above.
    ...scenario.auto(),
  ],
});

const router = createRouter({ title: 'Petstore', version: '1.0.0' });
router.add(createPet);
```

From this single file:

- `triad test` runs your hand-written scenario AND the auto-generated boundary tests
- `triad fuzz` generates adversarial tests for every endpoint without touching any file
- `triad docs` emits `openapi.yaml`
- `triad gherkin` emits `features/pets.feature`
- `triad frontend generate` emits typed React/Solid/Vue/Svelte Query hooks
- `ctx.body` is fully typed — `{ name: string; species: 'dog' | 'cat' | ... }`

`scenario.auto()` reads `minLength(1)`, `max(100)`, `enum('dog', 'cat')` and generates missing-field, boundary-value, invalid-enum, type-confusion, and random-fuzzing scenarios automatically. You write the business logic tests; the framework generates the boundary tests.

For WebSocket channels, `channel()` works the same way and produces AsyncAPI + typed client libraries.

---

## Packages

| Package | Purpose |
|---|---|
| [`@triadjs/core`](packages/core) | Schema DSL, `endpoint()`, `channel()`, `scenario()`, `scenario.auto()`, `createRouter()` |
| [`@triadjs/openapi`](packages/openapi) | Router → OpenAPI 3.1 (YAML/JSON) |
| [`@triadjs/asyncapi`](packages/asyncapi) | Router → AsyncAPI 3.0 (YAML/JSON) |
| [`@triadjs/gherkin`](packages/gherkin) | Behaviors → `.feature` files |
| [`@triadjs/test-runner`](packages/test-runner) | In-process BDD runner + schema-derived auto-scenario generation |
| [`@triadjs/fastify`](packages/fastify) | Fastify HTTP + WebSocket adapter |
| [`@triadjs/express`](packages/express) | Express HTTP adapter |
| [`@triadjs/hono`](packages/hono) | Hono adapter (Node, Deno, Bun, Cloudflare Workers) |
| [`@triadjs/lambda`](packages/lambda) | AWS Lambda adapter (API Gateway v1/v2, ALB, Function URL) |
| [`@triadjs/drizzle`](packages/drizzle) | Triad schemas → Drizzle tables + SQL migrations (SQLite, Postgres, MySQL) |
| [`@triadjs/tanstack-query`](packages/tanstack-query) | Router → typed React Query hooks |
| [`@triadjs/solid-query`](packages/solid-query) | Router → typed Solid Query hooks |
| [`@triadjs/vue-query`](packages/vue-query) | Router → typed Vue Query composables |
| [`@triadjs/svelte-query`](packages/svelte-query) | Router → typed Svelte Query store factories |
| [`@triadjs/channel-client`](packages/channel-client) | Router → typed WebSocket clients (vanilla TS, React, Solid, Vue, Svelte) |
| [`@triadjs/forms`](packages/forms) | Router → form validators (react-hook-form, @tanstack/form) |
| [`@triadjs/jwt`](packages/jwt) | `requireJWT` BeforeHandler factory wrapping jose |
| [`@triadjs/otel`](packages/otel) | OpenTelemetry tracing (opt-in router wrapper) |
| [`@triadjs/metrics`](packages/metrics) | Prometheus metrics (opt-in router wrapper) |
| [`@triadjs/logging`](packages/logging) | Structured logging with AsyncLocalStorage (opt-in router wrapper) |
| [`@triadjs/security-headers`](packages/security-headers) | Security headers middleware (Fastify, Express, Hono) |
| [`@triadjs/cli`](packages/cli) | `triad test`, `triad fuzz`, `triad docs`, `triad new`, `triad mock`, `triad db`, `triad validate`, `triad frontend` |

---

## Documentation

Start at the **[docs index](docs/README.md)** — it points at everything below based on what you're trying to do.

**Learn by building**
- [**Tutorial**](docs/tutorial/README.md) — Build the "Bookshelf" app from hello-world to production-ready in 7 steps

**Pick your stack**
- [**Choosing an adapter**](docs/guides/choosing-an-adapter.md) — Fastify vs Express vs Hono
- [**Choosing an ORM**](docs/guides/choosing-an-orm.md) — Drizzle (the default), Prisma, Kysely, or raw SQL

**Work with AI**
- [**Working with AI assistants**](docs/guides/working-with-ai.md) — Prompt library + how to use the AI Agent Guide
- [**AI Agent Guide**](docs/ai-agent-guide.md) — Canonical source-grounded reference for Claude Code, Cursor, Copilot, Aider

**Reference**
- [**Schema DSL**](docs/schema-dsl.md) · [**DDD patterns**](docs/ddd-patterns.md) · [**Drizzle integration**](docs/drizzle-integration.md) · [**WebSocket design**](docs/phase-9-websockets.md)

**Project**
- [**Roadmap**](ROADMAP.md) · [**Contributing**](CONTRIBUTING.md) · [**Code of Conduct**](CODE_OF_CONDUCT.md) · [**License**](LICENSE)

Four reference implementations live under [`examples/`](examples) — [`petstore`](examples/petstore) (Fastify + channels), [`tasktracker`](examples/tasktracker) (Express + auth + pagination), [`bookshelf`](examples/bookshelf) (all features combined — the tutorial's final state), and [`supabase-edge`](examples/supabase-edge) (Hono + Supabase + Deno edge deployment). Each has both in-process behavior tests and real HTTP/WebSocket e2e tests.

---

## Status

Triad is **pre-1.0** and under active development. Feature-complete through Phase 26:

- ✅ Schema DSL with full DDD composition (`t.model`, `t.value`, `t.file`, 14 primitive types)
- ✅ Endpoint + router + `beforeHandler` auth extension + `checkOwnership` helper
- ✅ `scenario.auto()` — schema-derived adversarial test generation (missing fields, boundary values, type confusion, random fuzzing)
- ✅ OpenAPI 3.1 + AsyncAPI 3.0 generators
- ✅ Gherkin generator (HTTP + channels)
- ✅ In-process BDD test runner + `triad fuzz` CLI fuzzer + `triad validate --coverage` linter
- ✅ Four HTTP adapters: Fastify (+ channels), Express, Hono (edge runtimes), Lambda (AWS)
- ✅ Drizzle bridge with SQL migration codegen (SQLite, Postgres, MySQL)
- ✅ Frontend codegen: TanStack Query, Solid Query, Vue Query, Svelte Query, form validators, typed WebSocket clients
- ✅ Observability: OpenTelemetry tracing, Prometheus metrics, structured logging (all opt-in router wrappers)
- ✅ Auth: `@triadjs/jwt` with JWKS/HS256 + security headers middleware
- ✅ Developer tooling: `triad new` scaffolding, `triad mock` server, `triad docs check` breaking-change detection

**21 packages, 4 reference examples, 83 behavior scenarios, 1000+ unit/integration/property tests.** APIs may still shift before 1.0 — pin exact versions if you adopt early.

See [ROADMAP.md](ROADMAP.md) for phase-by-phase detail.

---

## Why Triad?

Most TypeScript API stacks stitch together four or five libraries to get what Triad gives you in one:

| Need | Typical stack | Triad |
|---|---|---|
| Runtime validation | Zod / Yup | `t.model()` |
| Static types | `z.infer<>` | `t.infer<>` |
| OpenAPI | `zod-to-openapi` + hand edits | `triad docs` |
| BDD tests | Cucumber + step defs + fixtures | `scenario().when().then()` |
| Boundary/fuzz tests | Schemathesis (external, Python) | `scenario.auto()` (built-in, zero-config) |
| Frontend hooks | hand-written fetch wrappers | `triad frontend generate` |
| WebSocket clients | hand-written WS wrappers | `triad frontend generate --target channel-client-react` |
| WebSocket docs | hand-written AsyncAPI | `triad docs` |
| DB schema | Drizzle (separate definitions) | `triad db generate` |
| Breaking-change detection | manual OpenAPI diff | `triad docs check` |

The point isn't just fewer dependencies — it's that a change to a schema is **impossible** to forget to propagate, because there is nothing to propagate to. And the boundary tests you'd never think to write? The framework writes them for you from the constraints you already declared.

---

## License

[MIT](LICENSE)
