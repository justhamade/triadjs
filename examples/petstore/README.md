# Triad Example — Petstore API

A full working Triad application. It shows, in one place, how every piece of the framework fits together.

## What's here

```
examples/petstore/
├── triad.config.ts           # CLI config (router path, test setup, output dirs)
├── src/
│   ├── schemas/              # Triad API schemas — the API contract
│   │   ├── pet.ts            # Pet, CreatePet, UpdatePet (+ .storage() hints)
│   │   ├── adoption.ts       # Adopter, Adoption, AdoptionRequest
│   │   └── common.ts         # ApiError, Money (value object)
│   ├── db/                   # Drizzle storage contract
│   │   ├── schema.ts         # sqliteTable() definitions (pets, adopters, adoptions)
│   │   └── client.ts         # better-sqlite3 + drizzle factory with DDL
│   ├── repositories/         # Translation layer: API schemas ↔ DB rows
│   │   ├── pet.ts            # PetRepository (rowToApi / apiToRow)
│   │   └── adoption.ts       # AdopterRepository + AdoptionRepository
│   ├── endpoints/            # Declarative endpoint() definitions with behaviors
│   │   ├── pets.ts           # POST/GET/PATCH pets
│   │   └── adoptions.ts      # Adopter registration + adoption lifecycle
│   ├── services.ts           # Service container wiring (injects the Drizzle db)
│   ├── test-setup.ts         # Per-scenario fresh in-memory SQLite
│   ├── app.ts                # Router with Pets + Adoption bounded contexts
│   └── server.ts             # Fastify entry point with DB lifecycle
└── generated/                # Output from `triad docs` and `triad gherkin`
```

## What it demonstrates

- **Single-source-of-truth schemas** — `Pet` is defined once; `CreatePet` and `UpdatePet` are derived via `.pick()` / `.partial()`.
- **Value objects** — `Money` is a `t.value()` composite (integer cents + currency enum), inlined into OpenAPI instead of becoming a separate `$ref` component.
- **Bounded contexts** — endpoints are grouped into `Pets` and `Adoption` contexts, each declaring its own ubiquitous language via `models[]`.
- **Behavior-as-test-as-docs** — every endpoint has `scenario/given/when/then` behaviors that run as tests, become Gherkin `.feature` files, and serve as human-readable business rules.
- **Thin handlers** — no validation logic, no type annotations on `ctx.*`, no error plumbing for schemas. The handler body is almost purely "call the repository".
- **Fastify integration** — `@triadjs/fastify`'s `triadPlugin` mounts the router onto a real HTTP server with full request and response validation.
- **Drizzle + SQLite** — real database, real SQL, type-safe query builder. The repository layer maps between the Triad API shape (`adoptionFee: Money`) and the storage shape (two integer columns `adoption_fee_amount` + `adoption_fee_currency`). Tags (`string[]` in the API) are stored as JSON text since SQLite has no array type.
- **`.storage()` hints on schemas** — fields carry storage metadata (`primaryKey`, `indexed`, `defaultNow`) alongside their validation rules. Today the Drizzle table is hand-written in `src/db/schema.ts`; a future `triad db` command will generate it from these hints.
- **Per-scenario DB isolation via fresh in-memory SQLite** — every behavior gets a brand-new `:memory:` database with the schema DDL applied. No test can leak data into another.

## Running it

From the monorepo root, install once:

```bash
npm install
```

Then from this directory (`examples/petstore/`), every CLI command works:

### Run the API

```bash
npm start
# → listening on http://localhost:3000 with an in-memory SQLite database
```

To persist pets across restarts, point the server at a file:

```bash
DATABASE_URL=./petstore.db npm start
```

Then `curl` it:

```bash
# Create a pet
curl -X POST http://localhost:3000/pets \
  -H "content-type: application/json" \
  -d '{"name":"Buddy","species":"dog","age":3}'

# List pets
curl http://localhost:3000/pets

# Invalid request → structured 400 with every error
curl -X POST http://localhost:3000/pets \
  -H "content-type: application/json" \
  -d '{"species":"dragon","age":-1}'
```

### Generate OpenAPI

```bash
npm run docs
# → wrote ./generated/openapi.yaml
```

The spec has every endpoint, every model as a component (`$ref`), path parameters, query parameters with defaults, and response bodies — all derived from the TypeScript you already wrote.

### Generate Gherkin `.feature` files

```bash
npm run gherkin
# → ./generated/features/pets.feature
# → ./generated/features/adoption.feature
```

One file per bounded context. Give these to your PM.

### Run the behavior test suite

```bash
npm test
```

The `triad test` command loads the config, spins up the services factory before every scenario, runs each behavior against the handler in-process (no HTTP server needed), and reports results. Per-scenario isolation means the "duplicate name" scenario can't see data from "pets can be created" — each test gets a fresh repository.

### Validate cross-artifact consistency

```bash
npm run validate
```

Runs `triad validate`. Checks for duplicate endpoint names, duplicate method+path combos, unknown model references in `body matches Pet` assertions, and bounded-context model leakage (endpoints using models not declared in their context's `models[]`).

## How the `triad.config.ts` ties it all together

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  router: './src/app.ts',        // → triad docs/gherkin/validate load this
  test: {
    setup: './src/test-setup.ts', // → default export is the services factory
    teardown: 'cleanup',          // → method on services called after each test
  },
  docs: { output: './generated/openapi.yaml' },
  gherkin: { output: './generated/features' },
});
```

## Things to try

1. **Add a new field to `Pet`** (e.g. `microchipId`). Run `npm run docs` — the OpenAPI component updates. Run `npm test` — any behavior that creates a pet now has to provide or default the new field.
2. **Add a scenario** to `createPet`'s `behaviors` array like `scenario('Pet ages must be non-negative').given('x').body({name:'X',species:'dog',age:-1}).when('y').then('response status is 400')`. Run `npm test` — it runs alongside the existing scenarios.
3. **Break the contract**: change the `Pet` schema's `age` to `.min(10)`. Run `npm test` — the existing "Pets can be created" scenario fails because `age: 3` no longer validates. This is what zero drift looks like.
4. **Add a bounded context** for, say, `Medical` (vaccinations, checkups). Add an endpoint, group it under `router.context('Medical', ...)`. Run `npm run gherkin` — you get a new `medical.feature` file automatically.
5. **Point `npm run docs` at your favorite OpenAPI viewer** (Swagger UI, Stoplight, Redoc) to see the full spec render.

## What's NOT here (yet)

- **Real migrations.** The `CREATE TABLE` DDL lives inline in `src/db/client.ts` so in-memory databases self-initialize. For production you'd switch to `drizzle-kit generate` + `migrate()` on startup. See [`docs/drizzle-integration.md`](../../docs/drizzle-integration.md).
- **Authentication / authorization.** Would add a `headers` schema to endpoints and an auth check in the handler or a Fastify preHandler.
- **Sagas / process managers.** The `completeAdoption` handler touches two aggregates inline. In a real app you'd extract a domain service and run the two updates in a transaction. See [`docs/ddd-patterns.md`](../../docs/ddd-patterns.md#5-saga--process-manager).
- **WebSocket channels.** Phase 9 — see [`docs/phase-9-websockets.md`](../../docs/phase-9-websockets.md).
- **Automatic Drizzle table generation from Triad schemas.** The `.storage()` hints on `src/schemas/pet.ts` are forward-compat for a future `triad db` command. Today the two schemas are maintained in parallel — which is the whole point: the repository's `rowToApi`/`apiToRow` makes the translation explicit and reviewable.
