# Triad Framework — Claude Code Bootstrap Prompt (v3)

## Copy everything below this line into Claude Code

---

## Project: Triad

**Triad** is a TypeScript/Node.js framework where API specification, implementation, validation, and testing are a single source of truth. You write TypeScript code once using Triad's declarative DSL, and Triad gives you runtime validation, OpenAPI documentation, executable BDD tests, and generated Gherkin `.feature` files — all from the same definitions.

### Philosophy

The API definition IS the spec. The API definition IS the validation. The API definition IS the test. There is no drift between documentation, implementation, and tests because they are the same artifact.

Triad is **code-first** (not spec-first, not YAML-first). Developers write TypeScript. Everything else (OpenAPI docs, Gherkin feature files, test reports) is a derived output.

### Why NOT Zod?

Zod is a validation library that happens to be useful for API schemas. But Triad's schema layer needs to be more than validation — it needs to be an **API-native type system** that carries API metadata (descriptions, examples, deprecation, format hints, parameter location) as first-class concerns, not afterthoughts bolted on via `.describe()` or `.openapi()` extensions.

### Why NOT plain TypeScript interfaces?

TypeScript types are erased at runtime. An `interface Pet { name: string }` cannot validate data, cannot carry constraints like `minLength(1)`, cannot generate OpenAPI docs, and cannot produce meaningful error messages. If you start with types, you always need a second runtime schema alongside them — and now you have two things to maintain. That's the exact drift problem Triad exists to kill.

### The Triad approach: Schema declarations that read like types

Triad's `t.model()` declarations read like TypeScript interfaces but carry everything: types, validation, constraints, documentation, examples, and OpenAPI metadata. The model IS the type — developers should rarely need to explicitly extract the type with `t.infer<>` because Triad's endpoint builder infers it automatically in handler contexts and response signatures.

### Core Principles

1. **Single source of truth** — One definition produces types, validation, docs, and tests
2. **Code-first** — TypeScript is the authoring language, not YAML/JSON/Gherkin
3. **Declarative style** — Endpoints are configuration objects, not fluent chains
4. **Behaviors are co-located** — Test behaviors live next to the handler
5. **Gherkin is an output, not an input** — `.feature` files are generated from code
6. **Framework-agnostic runtime** — Plugs into Express, Fastify, Hono, or standalone
7. **Zero drift by design** — If the code compiles and tests pass, the docs are correct
8. **AI-legible by design** — Every definition is self-describing so AI coding assistants can understand the full context (data shape, business rules, edge cases, expected behaviors) from a single file without chasing imports across a codebase
9. **CQRS-extensible** — The architecture accommodates event sourcing, command/event/projection patterns, and read/write model separation as a future extension without restructuring the core

---

## Triad's Schema DSL — The Type System

### Schema Primitives

```typescript
import { t } from '@triad/core';

// Primitives with API-native metadata
const name = t.string()
  .doc('The pet name')
  .example('Buddy')
  .minLength(1)
  .maxLength(100);

const age = t.int32()
  .doc('Age in years')
  .example(3)
  .min(0)
  .max(100);

const price = t.float64()
  .doc('Price in USD')
  .example(29.99);

const id = t.string()
  .format('uuid')
  .doc('Unique identifier');

const email = t.string()
  .format('email')
  .doc('Email address');

const createdAt = t.datetime()
  .doc('When the record was created');

const isActive = t.boolean()
  .doc('Whether the pet is available')
  .default(true);

// Enums
const species = t.enum('dog', 'cat', 'bird', 'fish')
  .doc('The species of pet');

// Literal types
const status = t.literal('active');
```

### Models — Named Object Schemas

Models read like interface declarations but carry everything needed at runtime:

```typescript
const Pet = t.model('Pet', {
  id: t.string().format('uuid').doc('Unique pet identifier'),
  name: t.string().minLength(1).doc('Pet name').example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish').doc('Species'),
  age: t.int32().min(0).max(100).doc('Age in years').example(3),
  status: t.enum('available', 'adopted', 'pending').doc('Adoption status').default('available'),
  tags: t.array(t.string()).doc('Searchable tags').optional(),
  createdAt: t.datetime().doc('Record creation timestamp'),
});

// The TypeScript type is inferred automatically where needed.
// Developers should RARELY need this explicit extraction:
// type Pet = t.infer<typeof Pet>;
//
// Instead, the endpoint builder handles type inference internally.
// When you pass Pet to an endpoint definition, the handler context
// is automatically typed with the correct shape.

// Derive models from existing models
const CreatePet = Pet.pick('name', 'species', 'age', 'tags')
  .named('CreatePet')
  .doc('Payload for creating a new pet');

const UpdatePet = Pet.pick('name', 'species', 'age', 'status', 'tags')
  .partial()
  .named('UpdatePet')
  .doc('Payload for updating a pet');

const PetSummary = Pet.pick('id', 'name', 'species', 'status')
  .named('PetSummary')
  .doc('Abbreviated pet representation for list views');

// Extend models
const PetWithOwner = Pet.extend({
  ownerId: t.string().format('uuid').doc('Owner ID'),
  ownerName: t.string().doc('Owner display name'),
}).named('PetWithOwner');

// Error model
const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code').example('NOT_FOUND'),
  message: t.string().doc('Human-readable error message').example('Pet not found'),
  details: t.record(t.string(), t.unknown()).optional().doc('Additional error context'),
});
```

### Collection & Utility Types

```typescript
const petList = t.array(Pet).doc('List of pets');
const metadata = t.record(t.string(), t.string()).doc('Key-value metadata');
const petOrError = t.union(Pet, ApiError);
const nickname = t.string().nullable().doc('Optional nickname');
const bio = t.string().optional().doc('Pet biography');
const coordinates = t.tuple(t.float64(), t.float64()).doc('Lat/Lng pair');
```

### Key Design Decisions for the Schema DSL (`t.*`)

1. **Every schema node carries metadata** — `.doc()`, `.example()`, `.deprecated()`, `.default()` are first-class
2. **API-specific numeric types** — `t.int32()`, `t.int64()`, `t.float32()`, `t.float64()` map directly to OpenAPI `type` + `format`
3. **Named models produce OpenAPI `$ref` components** — `t.model('Pet', {...})` generates `$ref: '#/components/schemas/Pet'`
4. **`.format()` is typed** — `t.string().format('uuid')` only accepts known formats, providing autocomplete
5. **Type inference is automatic** — `t.infer<typeof Pet>` is available but developers should rarely need it; the endpoint builder infers types internally
6. **Validation is built-in** — `.parse(data)` for validated parsing, `.validate(data)` for error collection
7. **Schemas are composable** — `.pick()`, `.omit()`, `.partial()`, `.required()`, `.extend()`, `.merge()`
8. **Schemas are immutable** — Every builder method returns a new schema instance

---

## Endpoint Definition — Declarative Style

Endpoints are defined as declarative configuration objects, not fluent chains. The `given/when/then` behavior builder remains fluent because BDD reads like a sentence.

### The `ctx.respond` Pattern

Response schemas are declared once in `responses`. The handler uses `ctx.respond[statusCode](data)` which is type-safe: it only accepts status codes you declared, and the data must match the schema for that status. No redundancy between declaration and handler.

```typescript
import { endpoint, scenario } from '@triad/core';

export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  description: 'Add a new pet to the store inventory',
  tags: ['Pets'],

  request: {
    body: CreatePet,
  },

  responses: {
    201: { schema: Pet, description: 'Pet created successfully' },
    400: { schema: ApiError, description: 'Validation error' },
    409: { schema: ApiError, description: 'Pet already exists' },
  },

  handler: async (ctx) => {
    // ctx.body is typed as the CreatePet shape (inferred from request.body)
    // ctx.respond[201] only accepts data matching Pet
    // ctx.respond[400] only accepts data matching ApiError
    // ctx.respond[500] would be a compile error — not declared
    const pet = await ctx.services.petStore.create(ctx.body);
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

    scenario('Invalid enum values are rejected')
      .given('a pet payload with invalid species')
      .body({ name: 'Rex', species: 'dragon', age: 5 })
      .when('I create a pet')
      .then('response status is 400'),
  ],
});

export const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get a pet by ID',
  tags: ['Pets'],

  request: {
    params: {
      id: t.string().format('uuid').doc('The pet ID'),
    },
  },

  responses: {
    200: { schema: Pet, description: 'Pet found' },
    404: { schema: ApiError, description: 'Pet not found' },
  },

  handler: async (ctx) => {
    // ctx.params.id is typed as string
    const pet = await ctx.services.petStore.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });
    }
    return ctx.respond[200](pet);
  },

  behaviors: [
    scenario('Existing pets can be retrieved by ID')
      .given('a pet exists with id {petId}')
      .setup(async (services) => {
        const pet = await services.petStore.create({ name: 'Buddy', species: 'dog', age: 3 });
        return { petId: pet.id };
      })
      .when('I GET /pets/{petId}')
      .then('response status is 200')
      .and('response body has name "Buddy"'),

    scenario('Non-existent pet IDs return 404')
      .given('no pet exists with id {petId}')
      .fixtures({ petId: '00000000-0000-0000-0000-000000000000' })
      .when('I GET /pets/{petId}')
      .then('response status is 404'),
  ],
});

export const listPets = endpoint({
  name: 'listPets',
  method: 'GET',
  path: '/pets',
  summary: 'List all pets',
  tags: ['Pets'],

  request: {
    query: {
      species: t.enum('dog', 'cat', 'bird', 'fish').optional().doc('Filter by species'),
      status: t.enum('available', 'adopted', 'pending').optional().doc('Filter by status'),
      limit: t.int32().min(1).max(100).default(20).doc('Page size'),
      offset: t.int32().min(0).default(0).doc('Page offset'),
    },
  },

  responses: {
    200: { schema: t.array(PetSummary), description: 'List of pets' },
  },

  handler: async (ctx) => {
    // ctx.query is typed as { species?: string, status?: string, limit: number, offset: number }
    const pets = await ctx.services.petStore.list(ctx.query);
    return ctx.respond[200](pets);
  },

  behaviors: [
    scenario('All pets are returned when no filters applied')
      .given('pets exist in the store')
      .setup(async (services) => {
        await services.petStore.create({ name: 'Buddy', species: 'dog', age: 3 });
        await services.petStore.create({ name: 'Whiskers', species: 'cat', age: 5 });
      })
      .when('I list all pets')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 2'),
  ],
});
```

### Request Parameter Shorthand

For `request.params` and `request.query`, you can pass either:
- A named model: `params: PetIdParams` (a model defined elsewhere)
- An inline object of schema fields: `params: { id: t.string().format('uuid') }` (Triad wraps this in an anonymous model internally)

For `request.body`, pass the model directly: `body: CreatePet`

For `request.headers`, same pattern: `headers: { authorization: t.string().doc('Bearer token') }`

### How `ctx.respond` Works Internally

The `ctx.respond` object is a Proxy or mapped type generated from the `responses` declaration:

```typescript
// Given this declaration:
responses: {
  201: { schema: Pet, description: 'Created' },
  404: { schema: ApiError, description: 'Not found' },
}

// The handler receives ctx where:
// ctx.respond[201] is (data: t.infer<typeof Pet>) => HandlerResponse
// ctx.respond[404] is (data: t.infer<typeof ApiError>) => HandlerResponse
// ctx.respond[500] does not exist — compile error if accessed

// The returned HandlerResponse bundles status + validated body
// The framework validates the response body against the schema before sending
```

This eliminates the redundancy of declaring responses in the schema AND returning `{ status, body }` in the handler. The response declaration is the contract, and `ctx.respond` is the only way to fulfill it.

---

---

## AI Readability — Design for Machine Comprehension

A primary design goal of Triad is that AI coding assistants (Claude Code, Copilot, Cursor, etc.) can understand the full context of an API endpoint from a single file. This is achieved through several deliberate design decisions:

### 1. Co-location eliminates context fragmentation

In a traditional Express/NestJS app, an AI needs to piece together the route file, controller, DTO, validation pipe, OpenAPI decorator, and test file to understand one endpoint. In Triad, everything is in one `endpoint()` declaration. An AI reading a Triad endpoint immediately knows: what data it accepts, what it returns, what the business rules are, what edge cases exist, and what constitutes success or failure.

### 2. Named models create a shared semantic vocabulary

When an AI sees `CreatePet` in the request body, in a behavior fixture, and in a test assertion, it knows they're the same concept. The `t.model('CreatePet', ...)` naming does semantic work that anonymous schemas cannot.

### 3. Behaviors ARE the specification an AI needs

The behaviors tell an AI not just *what* the endpoint does but *why* — what the edge cases are, what inputs trigger errors, what the expected outputs look like. When an AI is asked to "add validation for duplicate pet names," the existing behaviors show the AI exactly how validation errors are structured and tested in this codebase.

### 4. Scenarios on behaviors give AI business context

Instead of a separate `rules` field (which would create redundancy with behaviors), each behavior has a `.scenario()` that describes the business rule being tested in plain language. This gives AI both the intent AND the proof in one place:

```typescript
behaviors: [
  scenario('Pets can be created with valid data')
    .given('a valid pet payload')
    .body({ name: 'Buddy', species: 'dog', age: 3 })
    .when('I create a pet')
    .then('response status is 201'),

  scenario('Pet names must be unique within the same species')
    .given('a pet already exists with name "Buddy" as a dog')
    .body({ name: 'Buddy', species: 'dog', age: 5 })
    .when('I create a pet')
    .then('response status is 409'),
]
```

When an AI reads this, it doesn't just see test steps — it understands the business rule. `triad validate` can warn about endpoints with no scenarios (undocumented behavior).

### 5. The `.doc()` calls are for AI, not just OpenAPI

Every `.doc('...')` on a schema field helps AI understand intent. A field named `status` is ambiguous; `t.enum('available', 'adopted', 'pending').doc('Adoption status')` is not. Treat `.doc()` as writing comments for your AI pair-programmer.

### 6. Generated Gherkin as AI context input

The `.feature` files Triad generates can be fed back to AI assistants as context: "Here's what the API currently does (Gherkin), now add a DELETE endpoint following the same patterns." The Gherkin gives behavioral context that raw source code doesn't.

---

## Domain-Driven Design Concepts in Triad

Triad borrows several DDD concepts that strengthen the single source of truth philosophy. These aren't bolted-on patterns — they're woven into the schema DSL and endpoint model.

### 1. Ubiquitous Language — Named Models ARE the Domain Vocabulary

In DDD, the ubiquitous language is the shared vocabulary between developers and domain experts. In Triad, `t.model('Pet', {...})` establishes that vocabulary. The name `Pet` appears everywhere — in the schema definition, in endpoint request/response declarations, in behavior assertions, in generated Gherkin, and in OpenAPI docs. It's always the same word meaning the same thing.

This is enforced by design: you can't use an anonymous inline schema where a named model should go. If a concept is important enough to be in an API response, it's important enough to have a name.

### 2. Value Objects — `t.value()`

DDD value objects are immutable, identity-less, and compared by their attributes. Triad should support these as a distinct schema kind because they carry semantic meaning that a plain model doesn't:

```typescript
// Value objects — immutable, no identity, equality by value
const EmailAddress = t.value('EmailAddress', t.string().format('email')
  .doc('A validated email address'));

const Money = t.value('Money', {
  amount: t.float64().min(0).doc('Monetary amount'),
  currency: t.enum('USD', 'CAD', 'EUR', 'GBP').doc('ISO 4217 currency code'),
});

const DateRange = t.value('DateRange', {
  start: t.datetime().doc('Range start'),
  end: t.datetime().doc('Range end'),
});

// Use value objects in models — they communicate domain intent
const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string().minLength(1),
  adoptionFee: Money,                    // Not just "price: number" — domain language
  contactEmail: EmailAddress,            // Not just "email: string" — validated concept
  availableWindow: DateRange.optional(), // Not two separate date fields
});
```

Value objects differ from models in Triad:
- They are always immutable (Triad enforces this in validation — no partial updates)
- They have no `id` field by convention
- In OpenAPI output, they generate inline schemas (not `$ref` components) since they represent attributes, not resources
- They can wrap a single primitive (`EmailAddress` wraps string) or compose multiple fields (`Money`)

### 3. Entities vs. Models — Identity Semantics

In DDD, an entity has a unique identity that persists over time. Two entities with the same attributes but different IDs are different. Triad models can optionally declare identity:

```typescript
// An entity — has identity, mutable over time
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),  // Marks this field as the entity identity
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  status: t.enum('available', 'adopted', 'pending'),
});

// .identity() on a field:
// - Signals to OpenAPI that this is the resource identifier
// - Used by the test runner to track entities across behaviors (setup → assertion)
// - Used by future CQRS extensions to route commands to the right aggregate
```

### 4. Bounded Contexts — Domain Modules

The router supports grouping endpoints by domain concept, not just by URL path. This maps to DDD bounded contexts:

```typescript
const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
});

// Group by domain context, not just URL prefix
router.context('Adoption', {
  description: 'Manages the pet adoption lifecycle',
  models: [Pet, CreatePet, AdoptionRequest, ApiError],  // Declares the ubiquitous language for this context
}, (ctx) => {
  ctx.add(createPet, getPet, listPets, adoptPet);
});

router.context('Inventory', {
  description: 'Tracks pet store inventory and suppliers',
  models: [InventoryItem, Supplier, StockLevel],
}, (ctx) => {
  ctx.add(addStock, getInventory, listSuppliers);
});
```

The `context()` method:
- Groups endpoints for Gherkin generation (one `.feature` file per context)
- Declares which models belong to this context (the ubiquitous language boundary)
- Provides `triad validate` the ability to check that endpoints only use models declared in their context
- Maps to OpenAPI tags, but with richer semantic meaning

For v1, `router.context()` is optional — `router.add()` still works for simple cases. But the architecture should support it.

### 5. What DDD concepts to EXCLUDE from v1

Not every DDD pattern belongs in an API framework. Specifically, do NOT implement:
- **Repositories** — That's a persistence concern, not an API contract concern
- **Domain Services** — The handler IS the application service; domain services are internal implementation
- **Factories** — Object creation is handled by the schema's parse/validate methods
- **Aggregate internals** — Triad defines the API boundary, not the internal aggregate structure

Triad sits at the **anti-corruption layer** boundary — it defines what goes in and out of the domain. What happens inside the domain (aggregates, repositories, domain services) is the developer's choice.

---

## CQRS & Event Sourcing — Future Extension Path

The DDD concepts above naturally support CQRS. Read/write model separation already works through schema composition (`.pick()`, `.partial()`). The declarative style makes it straightforward to add event sourcing as a future extension:

### What this could look like (NOT for v1 — design the core to accommodate it):

```typescript
// Commands (write side)
const CreatePetCommand = t.command('CreatePet', {
  input: CreatePet,
  emits: [PetCreatedEvent],
});

// Events (what happened)
const PetCreatedEvent = t.event('PetCreated', {
  petId: t.string().format('uuid'),
  name: t.string(),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  occurredAt: t.datetime(),
  actor: t.string(),
});

// Projections (read models built from events)
const PetListView = t.projection('PetListView', {
  sources: [PetCreatedEvent, PetUpdatedEvent, PetDeletedEvent],
  schema: PetSummary,
});
```

### What this means for v1 design decisions:

1. **Keep SchemaNode extensible** — The base schema type system should allow new schema "kinds" beyond model/array/enum. A `t.command()`, `t.event()`, and `t.value()` are specialized models with additional metadata.
2. **Don't hardcode HTTP-only assumptions in core types** — The `endpoint()` function is HTTP-specific, but the schema DSL and behavior builder should work for any protocol.
3. **The router supports grouping by domain context** — Not just by HTTP path, but by bounded context / aggregate. Design it in now even if most users start with `router.add()`.
4. **Models support `.storage()` hints** — Storage metadata (table name, database-only columns, indexes, default strategies) is declared on the model via `.storage({})`. This keeps one source of truth while cleanly separating API concerns from storage concerns. The `triad db` command generates Drizzle ORM schemas from these hints.

---

## Storage Hints — Database Schema Generation

Triad models can carry optional `.storage()` metadata that enables automatic generation of Drizzle ORM table definitions. This means the Triad model is the single source of truth for BOTH the API contract AND the database schema.

### Storage hints on schema fields

```typescript
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity()
    .doc('Unique pet identifier')
    .storage({ defaultRandom: true }),

  name: t.string().minLength(1).maxLength(100)
    .doc('Pet name'),

  species: t.enum('dog', 'cat', 'bird', 'fish')
    .doc('Species'),

  age: t.int32().min(0).max(100)
    .doc('Age in years'),

  status: t.enum('available', 'adopted', 'pending')
    .doc('Adoption status')
    .default('available'),

  tags: t.array(t.string()).optional()
    .doc('Searchable tags'),

  createdAt: t.datetime()
    .doc('Record creation timestamp')
    .storage({ defaultNow: true }),
});
```

### Storage extensions on the model (database-only columns, indexes)

```typescript
const Pet = t.model('Pet', { /* ... fields above ... */ })
  .storage({
    tableName: 'pets',
    columns: {
      updatedAt: { type: 'timestamp', defaultNow: true },
      deletedAt: { type: 'timestamp', nullable: true },
      internalNotes: { type: 'text', nullable: true },
    },
    indexes: [
      { columns: ['name', 'species'], unique: true },
      { columns: ['status'] },
    ],
  });
```

### CLI command

```bash
triad db --output ./src/db/schema.ts    # Generate Drizzle schema from Triad models
```

### Type mapping from Triad to Drizzle

```
t.string()                    → text() or varchar()
t.string().format('uuid')     → uuid()
t.string().maxLength(N)       → varchar(N)
t.int32()                     → integer()
t.int64()                     → bigint()
t.float64()                   → doublePrecision()
t.boolean()                   → boolean()
t.datetime()                  → timestamp()
t.enum('a', 'b')              → pgEnum(...)
t.array(t.string())           → text().array()
.identity()                   → .primaryKey()
.default(value)               → .default(value)
.optional()                   → nullable
.storage({ defaultRandom })   → .defaultRandom()
.storage({ defaultNow })      → .defaultNow()
```

### Design notes for implementation:

- `.storage()` on schema fields adds storage-specific metadata without affecting API behavior
- `.storage()` on models adds database-only columns and indexes
- Generated Drizzle files include `// AUTO-GENERATED by Triad — do not edit` header
- The `@triad/drizzle` package handles the generation (separate from `@triad/core`)
- If `.storage()` is not used, Triad infers reasonable defaults from the schema types
- The generated schema is a regular Drizzle schema — it works with `drizzle-kit generate` for migrations

```typescript
import { createRouter } from '@triad/core';
import { createPet, getPet, listPets } from './endpoints/pets';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description: 'A sample Triad API',
  servers: [{ url: 'https://api.example.com', description: 'Production' }],
});

router.add(createPet, getPet, listPets);

export default router;
```

---

## CLI Outputs

```bash
# Generate OpenAPI spec (derived from the TypeScript definitions)
triad docs --output ./generated/openapi.yaml

# Run all behavior tests
triad test

# Export Gherkin feature files (derived from the behavior definitions)
triad gherkin --output ./generated/features/

# Validate all schemas and endpoint definitions
triad validate
```

### Generated Gherkin Output (`pets.feature`)

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

  Scenario: Missing required fields return a validation error
    Given a pet payload with missing name
      | field   | value |
      | species | cat   |
      | age     | 2     |
    When I create a pet
    Then response status is 400
    And response body has code "VALIDATION_ERROR"

  Scenario: Existing pets can be retrieved by ID
    Given a pet exists with id {petId}
    When I GET /pets/{petId}
    Then response status is 200
    And response body has name "Buddy"

  Scenario: Non-existent pet IDs return 404
    Given no pet exists with id {petId}
    When I GET /pets/{petId}
    Then response status is 404
```

---

## Technical Architecture

### Package Structure

Set up as a monorepo using npm workspaces (NOT pnpm, NOT yarn workspaces):

```
triad/
├── package.json                    # Root workspace config
├── tsconfig.base.json              # Shared TS config
├── packages/
│   ├── core/                       # @triad/core — schema DSL, endpoint, behavior, router
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # Public API barrel export
│   │   │   ├── schema/
│   │   │   │   ├── index.ts        # `t` namespace export
│   │   │   │   ├── types.ts        # SchemaNode base types and t.infer type utility
│   │   │   │   ├── string.ts       # StringSchema builder
│   │   │   │   ├── number.ts       # Int32Schema, Int64Schema, Float32Schema, Float64Schema
│   │   │   │   ├── boolean.ts      # BooleanSchema builder
│   │   │   │   ├── datetime.ts     # DateTimeSchema builder
│   │   │   │   ├── enum.ts         # EnumSchema builder
│   │   │   │   ├── literal.ts      # LiteralSchema builder
│   │   │   │   ├── array.ts        # ArraySchema builder
│   │   │   │   ├── model.ts        # ModelSchema builder (named object types)
│   │   │   │   ├── value.ts        # ValueSchema builder (DDD value objects)
│   │   │   │   ├── record.ts       # RecordSchema builder
│   │   │   │   ├── union.ts        # UnionSchema builder
│   │   │   │   ├── tuple.ts        # TupleSchema builder
│   │   │   │   ├── validate.ts     # Runtime validation engine
│   │   │   │   └── openapi.ts      # Schema → OpenAPI 3.1 JSON Schema conversion
│   │   │   ├── endpoint.ts         # endpoint() function with type inference
│   │   │   ├── behavior.ts         # given/when/then BDD builder
│   │   │   ├── router.ts           # Router that collects endpoints
│   │   │   └── context.ts          # HandlerContext + ctx.respond type definitions
│   │   └── __tests__/
│   │       ├── schema/
│   │       │   ├── string.test.ts
│   │       │   ├── number.test.ts
│   │       │   ├── model.test.ts
│   │       │   ├── composition.test.ts  # pick, omit, partial, extend
│   │       │   ├── validate.test.ts
│   │       │   └── openapi.test.ts
│   │       ├── endpoint.test.ts
│   │       ├── behavior.test.ts
│   │       └── router.test.ts
│   │
│   ├── openapi/                    # @triad/openapi — full OpenAPI 3.1 document generator
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── generator.ts
│   │   └── __tests__/
│   │       └── generator.test.ts
│   │
│   ├── test-runner/                # @triad/test-runner — executes behaviors as tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── runner.ts
│   │   │   ├── assertions.ts
│   │   │   └── fixtures.ts
│   │   └── __tests__/
│   │       └── runner.test.ts
│   │
│   ├── gherkin/                    # @triad/gherkin — generates .feature files
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── generator.ts
│   │   └── __tests__/
│   │       └── generator.test.ts
│   │
│   ├── drizzle/                    # @triad/drizzle — generates Drizzle ORM schemas from Triad models
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── generator.ts        # Walks models → emits Drizzle pgTable/mysqlTable definitions
│   │   │   └── type-map.ts         # Triad schema type → Drizzle column type mapping
│   │   └── __tests__/
│   │       └── generator.test.ts
│   │
│   └── cli/                        # @triad/cli — CLI entry point
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           └── commands/
│               ├── docs.ts
│               ├── test.ts
│               ├── gherkin.ts
│               ├── db.ts           # `triad db` — generate Drizzle schema
│               └── validate.ts
│
├── examples/
│   └── petstore/                   # Working example app
│       ├── package.json
│       ├── src/
│       │   ├── app.ts
│       │   ├── endpoints/
│       │   │   ├── pets.ts
│       │   │   └── users.ts
│       │   └── schemas/
│       │       ├── pet.ts
│       │       ├── user.ts
│       │       └── common.ts
│       └── generated/
│           ├── openapi.yaml
│           └── features/
│               ├── pets.feature
│               └── users.feature
│
└── README.md
```

### Technology Choices

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.x, strict mode
- **Schema/Validation**: Triad's own DSL (`t.*`) — NO external schema library
- **Testing**: Vitest (for framework internal tests AND as the behavior test runner)
- **CLI**: Commander.js
- **HTTP Testing**: Supertest (for running behaviors against endpoints)
- **YAML**: `yaml` package for OpenAPI YAML output
- **Build**: `tsup` for building each package
- **Linting**: ESLint with `@typescript-eslint`

---

## Key Type Signatures

### The `endpoint()` function

```typescript
function endpoint<
  TParams extends Record<string, SchemaNode>,
  TQuery extends Record<string, SchemaNode>,
  TBody extends SchemaNode,
  THeaders extends Record<string, SchemaNode>,
  TResponses extends Record<number, { schema: SchemaNode; description: string }>,
>(config: EndpointConfig<TParams, TQuery, TBody, THeaders, TResponses>): Endpoint;

// EndpointConfig includes:
interface EndpointConfig<...> {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  summary: string;
  description?: string;
  tags?: string[];
  request?: { params?, query?, body?, headers? };
  responses: TResponses;
  handler: (ctx: HandlerContext<...>) => Promise<HandlerResponse>;
  behaviors?: Behavior[];              // Each behavior starts with scenario()
}
```

### The `ctx.respond` type

```typescript
// Given TResponses, generate a respond object where each key is a status code
// and each value is a function that accepts the inferred type of that response's schema
type RespondMap<TResponses> = {
  [S in keyof TResponses & number]: (
    data: InferSchema<TResponses[S]['schema']>
  ) => HandlerResponse;
};

interface HandlerContext<TParams, TQuery, TBody, THeaders, TResponses> {
  params: InferObjectSchema<TParams>;
  query: InferObjectSchema<TQuery>;
  body: InferSchema<TBody>;
  headers: InferObjectSchema<THeaders>;
  services: ServiceContainer;
  respond: RespondMap<TResponses>;
}
```

### The `ctx.respond` validates on the way out

When `ctx.respond[201](pet)` is called:
1. At compile time: TypeScript ensures `pet` matches the Pet schema shape
2. At runtime: Triad validates the response body against the schema before sending
3. In tests: The behavior runner validates the response matches the declared schema

This means response validation is automatic and always-on — not something you opt into.

---

## Schema DSL Implementation Guide

### 1. Base Schema Node

Every schema type carries metadata and a phantom type for inference:

```typescript
// Each schema builder class is generic over its output type T
// Methods like .optional() return a new builder with type T | undefined
// Methods like .nullable() return a new builder with type T | null

// The t.infer utility extracts the phantom type:
type Infer<T extends SchemaNode<any>> = T extends SchemaNode<infer U> ? U : never;
```

### 2. Numeric Types Map to OpenAPI Format

```typescript
t.int32()    → { type: 'integer', format: 'int32' }
t.int64()    → { type: 'integer', format: 'int64' }
t.float32()  → { type: 'number', format: 'float' }
t.float64()  → { type: 'number', format: 'double' }
```

### 3. Validation Engine

- Deeply validate nested objects, arrays, unions
- Collect ALL errors (not fail on first)
- Return: `{ success: true, data: T } | { success: false, errors: ValidationError[] }`
- Error paths as dot-notation: `"pets[0].name"`

### 4. OpenAPI Schema Output

Every schema node has `.toOpenAPI()` returning OpenAPI 3.1 JSON Schema. Named models produce `$ref` references and populate `components/schemas`.

---

## Behavior Builder

`scenario()` is the entry point for the behavior builder. It names the scenario (which becomes the Gherkin `Scenario:` line), then chains `given/when/then` as the steps inside it:

```typescript
scenario('Pet names must be unique within the same species')
  .given('a pet already exists with name "Buddy" as a dog')
  .body({ name: 'Buddy', species: 'dog', age: 5 })
  .when('I create a pet')
  .then('response status is 409')
```

This produces a `Behavior` data structure consumed by both the test runner and the Gherkin generator:

```typescript
{
  scenario: 'Pet names must be unique within the same species',
  given: {
    description: 'a pet already exists with name "Buddy" as a dog',
    body: { name: 'Buddy', species: 'dog', age: 5 },
    params: {},
    query: {},
    headers: {},
    setup: undefined,
    fixtures: {},
  },
  when: {
    description: 'I create a pet',
  },
  then: [
    { type: 'status', expected: 409 },
  ],
}
```

The scenario description serves triple duty:
- **In code** — tells AI and developers the business rule being tested
- **In Gherkin output** — becomes the `Scenario:` line
- **In test reports** — the scenario name is the test name

---

## Implementation Order

### Phase 1: Schema DSL (`@triad/core/schema/`)
1. `types.ts` — Base SchemaNode, SchemaMetadata, `t.infer` type utility
2. `string.ts` — StringSchema with format, constraints, metadata
3. `number.ts` — Int32, Int64, Float32, Float64 schemas
4. `boolean.ts`, `datetime.ts`, `literal.ts`, `enum.ts`
5. `array.ts`, `record.ts`, `union.ts`, `tuple.ts`
6. `model.ts` — ModelSchema with pick, omit, partial, extend, merge, named, `.identity()` field marker, and `.storage()` hints
7. `value.ts` — ValueSchema for DDD value objects (immutable, no identity, equality by value)
8. `validate.ts` — Runtime validation engine
9. `openapi.ts` — Schema → OpenAPI 3.1 conversion
10. `index.ts` — The `t` namespace
11. Comprehensive tests for every type

### Phase 2: Endpoint, Behavior, Router (`@triad/core/`)
1. `behavior.ts` — scenario/given/when/then builder (scenario is the entry point)
2. `context.ts` — HandlerContext + ctx.respond types
3. `endpoint.ts` — endpoint() with generic type inference
4. `router.ts` — Router with `add()` and `context()` for DDD bounded contexts
5. Tests for all

### Phase 3: OpenAPI Generation (`@triad/openapi/`)
1. Router → OpenAPI 3.1 document
2. Named models → components/schemas with $ref
3. YAML/JSON output
4. Snapshot tests against known-good spec

### Phase 4: Gherkin Generation (`@triad/gherkin/`)
1. Behaviors → Gherkin text
2. Grouping by tag
3. File output
4. Snapshot tests

### Phase 5: Drizzle Schema Generation (`@triad/drizzle/`)
1. `type-map.ts` — Mapping from Triad schema types to Drizzle column types
2. `generator.ts` — Walk models with `.storage()` → emit Drizzle `pgTable()` definitions
3. Handle enums, indexes, database-only columns, default strategies
4. Support PostgreSQL (primary), MySQL, SQLite as output targets
5. Snapshot tests against known-good Drizzle schema output

### Phase 6: Test Runner (`@triad/test-runner/`)
1. Execute behaviors via supertest
2. Assertion implementations
3. Fixture lifecycle
4. Reporter

### Phase 7: CLI (`@triad/cli/`)
1. Commander subcommands (`docs`, `gherkin`, `db`, `test`, `validate`)
2. Config file loading
3. Integration tests

### Phase 8: Example App (`examples/petstore/`)
1. Full petstore using Triad with `.storage()` hints on all models
2. Generate Drizzle schema, run migrations, seed data
3. Verify all outputs: OpenAPI, Gherkin, Drizzle schema, behavior tests

---

## Important Constraints

1. **NO external schema library** — Build validation from scratch
2. **NO HTTP framework dependency in `@triad/core`** — Core is framework-agnostic
3. **Each package has its own `package.json`** with proper exports, types, main
4. **ESM only** — `"type": "module"` everywhere
5. **Vitest** for all testing
6. **Declarative endpoints** — The endpoint config is an object, NOT a fluent chain. Only the `given/when/then` behavior builder is fluent.
7. **`ctx.respond[status](data)` pattern** — No separate `{ status, body }` returns. The response declaration IS the handler's return type contract.
8. **Immutable schema builders** — Every method returns a new instance
9. **Everything works without a running server** — Behaviors testable in-process

---

## Start Here

Begin with Phase 1 — the Schema DSL. Set up the monorepo, install dev dependencies, configure TypeScript strict mode and Vitest, and implement schema builders one by one with full test coverage.

Start with `StringSchema` as the reference implementation. Get construction → type inference → validation → OpenAPI output working end-to-end for strings, then replicate for other types.

After Phase 1, each phase is a clear commit boundary. Don't move forward until current phase tests all pass.

For every file, write the corresponding test file. Triad is a testing framework — it better be well-tested itself.
