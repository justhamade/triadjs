---
name: triad-testing
description: Use when wiring the TriadJS test runner — `triad.config.ts`, `test-setup.ts` default-exported services factory, per-scenario DB isolation, `teardown`, fixtures, and `scenario.auto()` for schema-derived adversarial tests. Tests run in-process — no HTTP, no adapter middleware.
---

# Testing with TriadJS

TriadJS tests run **in-process**. The runner invokes `endpoint.handler(ctx)` directly with a synthetic `HandlerContext`. No HTTP, no adapter, no JSON serialization. This makes tests fast and deterministic, and it means behaviors must not depend on Fastify/Express middleware.

## `triad.config.ts`

Project root config file. Loaded with `jiti`, so TypeScript works with no build step.

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  router: './src/app.ts',                // module default-exporting the Router
  test: {
    setup: './src/test-setup.ts',        // default-exports a services factory
    teardown: 'cleanup',                 // method name on the returned services object
    bail: false,
  },
  docs: {
    output: './generated/openapi.yaml',
    format: 'yaml',                      // or 'json'
  },
  gherkin: {
    output: './generated/features',
  },
});
```

| Field | Purpose |
|---|---|
| `router` | Path to the Router module (default export), resolved relative to the config file |
| `test.setup` | Path to a module whose default export is a services factory |
| `test.teardown` | Name of a method to call on the services object after each scenario |
| `test.bail` | Stop on first failure |
| `docs.output` / `docs.format` | Where `triad docs` writes |
| `gherkin.output` | Where `triad gherkin` writes |

Configs are discovered by walking upward from the cwd unless `--config` is passed.

## `test-setup.ts` — per-scenario isolation

Every scenario gets a fresh services container. The test setup file **default-exports** a factory:

```ts
// src/test-setup.ts
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

interface TestServices extends ReturnType<typeof createServices> {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const db = createDatabase(':memory:'); // fresh in-memory DB per scenario
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() {
      services.db.$raw.close();
    },
  };
}
```

The CLI calls the default export before every scenario and `services.cleanup()` (or whatever `teardown` name you set) after every scenario. Each test gets a clean database.

> **Do not share state between scenarios.** Every database, every in-memory store, every test double: fresh per scenario. That's what makes the runner deterministic and parallelizable.

## The runner loop — what happens per scenario

From `packages/test-runner/src/runner.ts`:

1. `servicesFactory()` → fresh `ServiceContainer` (test isolation).
2. `behavior.given.setup(services)` if defined; merge return value with `.fixtures`.
3. Substitute `{placeholder}` tokens in body/params/query/headers.
4. Validate each request part against the endpoint's declared schemas. **Catches scenario mistakes early** — if your `.body()` is missing a required field, you get a pre-handler failure with the schema path.
5. Invoke `endpoint.handler(ctx)` directly.
6. Validate the response body against the declared schema for the returned status. Handlers that sidestep `ctx.respond` are caught here.
7. Run every `then[]` assertion.
8. `teardown(services)` in `finally` — always runs, even on failure.

## Running the tests

```bash
triad test                    # run every behavior across HTTP endpoints and channels
triad test --bail             # stop on first failure
triad test --filter createPet # only endpoints/channels whose `name` contains the pattern
triad test --config triad.prod.config.ts
```

Exit code is 1 if any scenario fails or errors.

## `scenario.auto()` — boundary and adversarial tests for free

Add one line to any endpoint's behaviors array and the framework generates boundary, missing-field, invalid-enum, type-confusion, and random-fuzzing scenarios from the schema constraints you already declared. See the `triad-behaviors` skill for the full table; the short version:

```ts
behaviors: [
  scenario('creates a pet with valid input')
    .body({ name: 'Rex', species: 'dog', age: 3 })
    .when('POST /pets')
    .then('response status is 201'),

  ...scenario.auto(),   // ← boundary + missing + enum + type + random valid
],
```

## CI-time fuzzing

`triad fuzz` generates auto scenarios for every endpoint in the router at the CLI level, without code changes. Wire it into CI as a gate:

```bash
triad fuzz                    # deterministic + random
triad fuzz --random-valid 0   # deterministic only
triad fuzz --seed 42          # reproducible randomness
```

`triad validate --coverage` warns about endpoints missing boundary coverage without actually running tests.

## Common failure modes

- **"Unrecognized assertion"** → the `then` phrase doesn't match the parser's table. See `triad-behaviors` for the authoritative phrase list. Single-quoted strings, `expect... to be...` phrasing, and `==` comparisons all fail.
- **"Handler returned status N which is not declared in this endpoint's responses"** → the handler returned `{ status, body }` directly or used `ctx.respond[N](...)` where N wasn't in `responses`. Add N to `responses` or fix the handler.
- **"Response body for status N does not match declared schema"** → the handler's output doesn't satisfy the response schema. Usually means the repository returned extra fields the DTO doesn't declare. Fix the schema or map explicitly.
- **`servicesFactory failed`** → the default export of `test-setup.ts` throws. Usually a missing in-memory DB or a file not found. Run the factory manually to see the real error.
- **`teardown` errors** → silently swallowed by design. If cleanup is broken, tests still report their real outcome.

## Checklist when setting up testing

1. `triad.config.ts` at the project root with `router`, `test.setup`, `test.teardown`.
2. `src/test-setup.ts` has a **default export** — not a named export. The CLI imports the default.
3. The factory creates a FRESH database/services per call. Do not reuse state across invocations.
4. Teardown closes DB connections and releases resources. A leaking scenario will eventually run your host out of file handles.
5. `scenario.auto()` is added to high-value endpoints to catch schema boundary regressions.
6. CI runs `triad test`, `triad validate --strict`, and optionally `triad fuzz`.
