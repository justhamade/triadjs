# Triad

[![CI](https://github.com/justhamade/triad/actions/workflows/ci.yml/badge.svg)](https://github.com/justhamade/triad/actions/workflows/ci.yml)

**One TypeScript definition. Validation, OpenAPI, AsyncAPI, BDD tests, Gherkin, and database schemas — all generated from the same source of truth.**

Triad is a TypeScript-first API framework built on the idea that an API's *specification*, *implementation*, *validation*, and *tests* should never drift apart, because they are the same thing. You write TypeScript once using Triad's declarative DSL, and you get:

- **Runtime validation** at the edges (parse + reject with structured errors)
- **Static types** derived from the same schemas (`t.infer<typeof X>`)
- **OpenAPI 3.1** documentation for HTTP endpoints
- **AsyncAPI 3.0** documentation for WebSocket channels
- **Executable BDD scenarios** that run as tests (`triad test`)
- **Gherkin `.feature` files** generated for non-technical stakeholders
- **Database schemas** via a dialect-neutral Drizzle bridge (`triad db generate`)

No codegen round-trips. No hand-maintained OpenAPI YAML. No duplicate Zod + OpenAPI + test-fixture schemas that fall out of sync.

### Built for humans *and* AI

Triad's north star is that **an AI coding assistant should be able to understand an entire API by reading one place**. When schemas, handlers, responses, channel payloads, tests, and docs all live in the same typed definitions, an LLM (or a new engineer) doesn't have to stitch context together from a Zod file, an OpenAPI YAML, a separate test fixture, and a README that's three commits out of date. There is one source of truth, and every other artifact is a deterministic projection of it. That's what keeps humans productive — and it's what lets AI reason about your API without guessing.

---

## Taste of it

```typescript
import { t, endpoint, scenario, createRouter } from '@triad/core';

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
  ],
});

const router = createRouter({ title: 'Petstore', version: '1.0.0' });
router.add(createPet);
```

From this single file:

- `triad test` runs the scenario as a real test against your handler
- `triad docs` emits `openapi.yaml`
- `triad gherkin` emits `features/pets.feature`
- `ctx.body` is fully typed — `{ name: string; species: 'dog' | 'cat' | ... }`

For WebSocket channels, `channel()` works the same way and produces AsyncAPI.

---

## Packages

| Package | Purpose |
|---|---|
| [`@triad/core`](packages/core) | Schema DSL, `endpoint()`, `channel()`, `scenario()`, `createRouter()` |
| [`@triad/openapi`](packages/openapi) | Router → OpenAPI 3.1 (YAML/JSON) |
| [`@triad/asyncapi`](packages/asyncapi) | Router → AsyncAPI 3.0 (YAML/JSON) |
| [`@triad/gherkin`](packages/gherkin) | Behaviors → `.feature` files |
| [`@triad/test-runner`](packages/test-runner) | In-process BDD runner for HTTP endpoints and WebSocket channels |
| [`@triad/fastify`](packages/fastify) | Fastify HTTP + WebSocket adapter |
| [`@triad/drizzle`](packages/drizzle) | Triad schemas → Drizzle tables (SQLite + Postgres) |
| [`@triad/cli`](packages/cli) | `triad test`, `triad docs`, `triad db generate`, `triad validate` |

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

Two reference implementations live under [`examples/`](examples) — [`petstore`](examples/petstore) (Fastify + channels) and [`tasktracker`](examples/tasktracker) (Express + auth + pagination). Read their source for the most honest picture of idiomatic Triad.

---

## Status

Triad is **pre-1.0** and under active development. The core is feature-complete through Phase 9:

- ✅ Schema DSL with full DDD composition
- ✅ Endpoint + router + behavior builder
- ✅ OpenAPI 3.1 generator
- ✅ Gherkin generator
- ✅ In-process BDD test runner
- ✅ CLI (`triad test`, `triad docs`, `triad db generate`, `triad validate`)
- ✅ Fastify HTTP adapter
- ✅ Drizzle bridge (SQLite + Postgres dialects)
- ✅ WebSocket channels with AsyncAPI + channel test runner

**459 tests passing across 8 packages.** APIs may still shift before 1.0 — pin exact versions if you adopt early.

See [ROADMAP.md](ROADMAP.md) for phase-by-phase detail and the backlog (Express/Hono adapters, MySQL dialect, migration codegen, more).

---

## Why Triad?

Most TypeScript API stacks stitch together four or five libraries to get what Triad gives you in one:

| Need | Typical stack | Triad |
|---|---|---|
| Runtime validation | Zod / Yup | `t.model()` |
| Static types | `z.infer<>` | `t.infer<>` |
| OpenAPI | `zod-to-openapi` + hand edits | `triad docs` |
| BDD tests | Cucumber + step defs + fixtures | `scenario().when().then()` |
| WebSocket docs | hand-written AsyncAPI | `triad docs` |
| DB schema | Drizzle (separate definitions) | `triad db generate` |

The point isn't just fewer dependencies — it's that a change to a schema is **impossible** to forget to propagate, because there is nothing to propagate to.

---

## License

[MIT](LICENSE)
