# Quickstart — Build a Petstore API in 5 minutes

This guide walks through defining a Triad endpoint, running its behaviors as tests, and generating OpenAPI — all from a single source file.

> **Status:** Every command and code sample in this guide runs today. See [`examples/petstore`](../examples/petstore) for the full reference app.

---

## 0. (Optional) Install the Claude Code plugin

If you're using [Claude Code](https://docs.anthropic.com/claude-code), the TriadJS repo ships a plugin that teaches Claude how to build TriadJS backends without guessing. It carries skills for the schema DSL, endpoints, WebSocket channels, the BDD assertion phrase table, testing, adapters, the Drizzle bridge, and the CLI — plus slash commands (`/triadjs:new`, `/triadjs:endpoint`, `/triadjs:model`, `/triadjs:channel`, `/triadjs:scenario`, `/triadjs:test`, `/triadjs:docs`, `/triadjs:validate`).

The repo itself is a Claude Code marketplace, so installation is two commands:

```
/plugin marketplace add justhamade/triad
/plugin install triadjs@triadjs
```

After that, you can describe what you want in plain English — *"scaffold a bookstore API with authors, books, and reviews"* — and Claude will invoke the right command and produce idiomatic Triad code. See [`plugin/README.md`](../plugin/README.md) for the full skill and command catalog.

You can complete this quickstart without the plugin; it just makes the rest of it faster.

---

## 1. Install

```bash
npm install @triadjs/core
# Later:
# npm install -D @triadjs/cli @triadjs/test-runner
```

Triad requires **Node 20+** and **TypeScript 5.x** with strict mode.

## 2. Define your first model

Create `src/schemas/pet.ts`:

```typescript
import { t } from '@triadjs/core';

export const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name').example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years'),
  status: t
    .enum('available', 'adopted', 'pending')
    .doc('Adoption status')
    .default('available'),
});

export const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});
```

**What you got for free:**

- Runtime validation: `Pet.parse(data)` throws on invalid input
- A TypeScript type: `t.infer<typeof Pet>` resolves to `{ id: string; name: string; species: 'dog' | ... }`
- OpenAPI 3.1 component: `Pet.toOpenAPI(ctx)` registers under `components/schemas/Pet`

No code generation. No YAML. No duplication.

## 3. Define your first endpoint

Create `src/endpoints/pets.ts`:

```typescript
import { endpoint, scenario, t } from '@triadjs/core';
import { Pet, CreatePet, ApiError } from '../schemas/pet';

export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  description: 'Add a new pet to the store inventory',
  tags: ['Pets'],

  request: { body: CreatePet },

  responses: {
    201: { schema: Pet, description: 'Pet created successfully' },
    400: { schema: ApiError, description: 'Validation error' },
    409: { schema: ApiError, description: 'Pet already exists' },
  },

  handler: async (ctx) => {
    // ctx.body is typed as { name: string; species: ...; age: number }
    // ctx.respond[201] only accepts data matching the Pet schema

    const pet = {
      id: crypto.randomUUID(),
      name: ctx.body.name,
      species: ctx.body.species,
      age: ctx.body.age,
      status: 'available' as const,
    };

    return ctx.respond[201](pet);
  },

  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),

    scenario('Missing required fields return a validation error')
      .given('a pet payload with missing name')
      .body({ species: 'cat', age: 2 })
      .when('I create a pet')
      .then('response status is 400')
      .and('response body has code "VALIDATION_ERROR"'),
  ],
});
```

**What just happened:**

- `ctx.body` is fully typed from the `CreatePet` schema — no imports, no manual type alignment
- `ctx.respond[201]` only accepts data matching `Pet`. Typing `ctx.respond[500](x)` is a **compile error** because 500 isn't declared
- The `behaviors` array is executable documentation: each scenario becomes a test, a Gherkin scenario, and an AI-readable explanation of the business rule

## 4. Register the endpoint on a router

Create `src/app.ts`:

```typescript
import { createRouter } from '@triadjs/core';
import { createPet } from './endpoints/pets';

export const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description: 'A sample Triad API',
});

router.add(createPet);

export default router;
```

Or group by DDD bounded context:

```typescript
router.context('Adoption', {
  description: 'Manages the pet adoption lifecycle',
  models: [Pet, CreatePet, ApiError],
}, (ctx) => {
  ctx.add(createPet, getPet, adoptPet);
});
```

## 5. Generate the OpenAPI spec

> Phase 3 — the `@triadjs/openapi` package.

```bash
triad docs --output ./generated/openapi.yaml
```

Your Pet model becomes a `$ref: '#/components/schemas/Pet'`. Your endpoint becomes a `paths./pets.post` operation. The `201` response body schema is `Pet`. The `400` response is `ApiError`. All of it derived from the TypeScript you already wrote.

## 6. Run the behavior tests

> Phase 5 — the `@triadjs/test-runner` package.

```bash
triad test
```

Each `scenario(...)` in each endpoint runs as a test against the live handler. The runner:

1. Calls `.setup()` if present, merging the result into `fixtures`
2. Substitutes `{placeholders}` in params/query/body
3. Invokes the handler with a constructed context
4. Validates the response against the declared schema
5. Runs each `then` assertion

If any step fails, the test fails with the scenario name — which tells you **which business rule broke**, not just which line of code threw.

## 7. Export Gherkin for non-developers

> Phase 4 — the `@triadjs/gherkin` package.

```bash
triad gherkin --output ./generated/features/
```

Your behaviors become `.feature` files:

```gherkin
Feature: Pets

  Scenario: Pets can be created with valid data
    Given a valid pet payload
      | field   | value |
      | name    | Buddy |
      | species | dog   |
      | age     | 3     |
    When I create a pet
    Then response status is 201
    And response body matches Pet
    And response body has name "Buddy"
```

Give these to your product manager. They're guaranteed to be current because they're generated.

## Next steps

- **[DDD patterns](ddd-patterns.md)** — how Triad integrates with repositories, aggregates, domain services, factories, and sagas
- **[Drizzle integration](drizzle-integration.md)** — the recommended data layer and repository pattern
- **[Schema DSL reference](schema-dsl.md)** — every primitive, composition, and constraint
- **[Roadmap](../ROADMAP.md)** — what's shipped and what's coming
