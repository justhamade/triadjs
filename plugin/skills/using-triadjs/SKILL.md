---
name: using-triadjs
description: Use whenever the user mentions TriadJS, the `@triadjs/*` packages, `t.model()`, `endpoint()`, `channel()`, `scenario()`, `triad test`, `triad docs`, or asks to build a TypeScript backend with validation + OpenAPI + BDD tests from one definition. Overview of the framework and pointer to the focused sub-skills.
user_invocable: true
---

# TriadJS

TriadJS is a TypeScript-first API framework where **one declarative definition** produces runtime validation, static types, OpenAPI 3.1, AsyncAPI 3.0, Gherkin `.feature` files, executable BDD tests, and Drizzle database schemas. Every downstream artifact is a deterministic projection of the router.

```
                +-------------------+
                |  Triad Router     |
                |  (source of       |
                |   truth)          |
                +---------+---------+
                          |
   +---------+------------+------------+-----------+
   |         |            |            |           |
   v         v            v            v           v
OpenAPI  AsyncAPI     Gherkin      BDD tests    Drizzle
 3.1      3.0        features     (in-proc)     tables
```

## When to use each sub-skill

| Task | Skill |
|---|---|
| Design schemas (`t.model`, `t.value`, DDD entities/value objects) | `triad-schema` |
| Declare HTTP endpoints, handlers, `beforeHandler` auth hooks, request/response shapes | `triad-endpoint` |
| Declare WebSocket channels, per-connection state, broadcast/send typing | `triad-channel` |
| Write BDD `scenario().given().when().then()` tests and learn the assertion phrase table | `triad-behaviors` |
| Wire up a test runner (`test-setup.ts`, fixtures, `scenario.auto()`, per-scenario DB isolation) | `triad-testing` |
| Mount the router on Fastify, Express, or Hono | `triad-adapters` |
| Generate Drizzle tables from `.storage()` hints | `triad-drizzle` |
| Reference the `triad` CLI (`test`, `docs`, `gherkin`, `db generate`, `validate`, `fuzz`) | `triad-cli` |
| Register services on `ServiceContainer` and inject repositories/clients | `triad-services` |

These sub-skills each load progressively — read only the ones needed for the task at hand.

## Slash commands

The plugin ships these `/triadjs:*` commands for common workflows:

- `/triadjs:new` — scaffold a new TriadJS project from scratch (package.json, router, server, test config)
- `/triadjs:model` — add a new `t.model` or value object to an existing project
- `/triadjs:endpoint` — add a new HTTP endpoint with behaviors
- `/triadjs:channel` — add a new WebSocket channel
- `/triadjs:scenario` — add BDD behavior scenarios to an existing endpoint
- `/triadjs:test` — run `triad test` and explain any failures
- `/triadjs:docs` — regenerate OpenAPI/AsyncAPI via `triad docs`
- `/triadjs:validate` — run `triad validate --strict` and fix any issues

## Golden rules — memorize these

1. **Never redefine schemas in tests.** Import the exact model used by the endpoint. Tests are black-box consumers of the router.
2. **Never hand-write OpenAPI.** Run `triad docs`. Hand edits will be overwritten.
3. **Handlers orchestrate — schemas validate.** Do not re-check types inside handlers; the schema already rejected invalid input.
4. **Always use `ctx.respond[status](body)`.** Never `return { status, body }` — the runtime validates outgoing payloads only through `ctx.respond`.
5. **Every endpoint should have behaviors.** A scenario is documentation, a test, and a Gherkin line in one. Writing an endpoint without behaviors defeats the framework.
6. **Tests run in-process.** `triad test` invokes the handler directly, not through HTTP. Behaviors must not depend on adapter middleware.
7. **Module-augment `ServiceContainer`.** Put your repositories/clients on `ctx.services` by `declare module '@triadjs/core' { interface ServiceContainer { ... } }` — never cast in handlers.
8. **Behaviors use a heuristic assertion parser.** If your `then` text doesn't match a supported pattern exactly, the assertion fails as "unrecognized." See the `triad-behaviors` skill for the phrase table.
9. **`.identity()` and `.storage({ primaryKey: true })` are different.** `.identity()` is DDD (the entity's identity). `.storage()` is persistence hints for the Drizzle bridge. Real fields usually need both.
10. **`t.empty()` for 204/205/304.** Never `t.unknown().optional()`. `ctx.respond[204]()` is zero-argument; passing a body is a compile error.

## Package map

| Package | Exports |
|---|---|
| `@triadjs/core` | `t`, `endpoint`, `channel`, `scenario`, `createRouter`, `Router`, types `Infer`, `HandlerContext`, `ServiceContainer`, `BeforeHandler`, `TriadFile` |
| `@triadjs/test-runner` | `runBehaviors`, `runChannelBehaviors`, `defineConfig`, `TriadConfig` |
| `@triadjs/openapi` | `generateOpenAPI`, `toYaml`, `toJson` |
| `@triadjs/asyncapi` | `generateAsyncAPI`, `toYaml`, `toJson` |
| `@triadjs/gherkin` | `generateGherkin`, `writeGherkinFiles` |
| `@triadjs/fastify` | `triadPlugin` (HTTP + WebSocket) |
| `@triadjs/express` | `createTriadRouter`, `triadErrorHandler` (HTTP only) |
| `@triadjs/hono` | `createTriadHono` (HTTP, edge-friendly) |
| `@triadjs/drizzle` | `generateDrizzleSchema`, `isUniqueViolation`, `DbError` |
| `@triadjs/jwt` | JWT verification helpers for `beforeHandler` auth |
| `@triadjs/security-headers` | Security header middleware |
| `@triadjs/otel` | `withOtelInstrumentation` — OpenTelemetry spans |
| `@triadjs/metrics` | `withMetricsInstrumentation` — Prometheus histograms |
| `@triadjs/logging` | `withLoggingInstrumentation`, `getLogger` — AsyncLocalStorage loggers |
| `@triadjs/cli` | the `triad` binary |

## Minimal working example

```ts
// src/app.ts
import { t, endpoint, scenario, createRouter } from '@triadjs/core';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  name: t.string().minLength(1).maxLength(100).example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    400: { schema: ApiError, description: 'Validation error' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('creates a pet with valid input')
      .given('a valid payload')
      .body({ name: 'Rex', species: 'dog', age: 3 })
      .when('POST /pets')
      .then('response status is 201')
      .and('response body matches Pet'),
  ],
});

const router = createRouter({ title: 'Petstore', version: '1.0.0' });
router.add(createPet);

export default router;
```

From this one file: `triad test` runs the scenarios as real tests, `triad docs` emits `openapi.yaml`, `triad gherkin` emits `features/pets.feature`, and `ctx.body` is fully typed (`{ name: string; species: 'dog' | 'cat' | 'bird' | 'fish'; age: number }`).

## Where to go from here

When the user's request goes beyond this overview, load the focused sub-skill from the table above. The sub-skills carry the authoritative phrase tables, signatures, and gotchas — don't guess; read.
