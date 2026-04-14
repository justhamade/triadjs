# @triadjs/core

The foundation of the Triad framework. Provides a schema DSL (`t.*`), declarative `endpoint()` and `channel()` definitions, a BDD `scenario()` behavior builder, a `beforeHandler` lifecycle hook, and a `createRouter()` to group everything into bounded contexts. One definition produces types, validation, OpenAPI, Gherkin, and tests.

## Install

```bash
npm install @triadjs/core
```

## Quick Start

```ts
import { t, endpoint, scenario, createRouter } from '@triadjs/core';

const Pet = t.model('Pet', {
  id:      t.string().format('uuid').identity(),
  name:    t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird'),
  age:     t.int32().min(0),
});

const CreatePet = Pet.omit('id');
const ApiError  = t.model('ApiError', { code: t.string(), message: t.string() });

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a new pet',
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Pet created' },
    400: { schema: ApiError, description: 'Validation error' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('Valid pet is created')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet'),
  ],
});

const router = createRouter({ title: 'Petstore', version: '1.0.0' });
router.add(createPet);
```

## Schema DSL

All schemas start with the `t` namespace. Every schema supports `.optional()`, `.nullable()`, `.description()`, `.default()`, and `.examples()`.

```ts
t.string()                        // string, chainable: .minLength(), .maxLength(), .format(), .pattern()
t.int32()                         // 32-bit integer; also t.int64(), t.float32(), t.float64()
t.boolean()                       // boolean
t.datetime()                      // ISO 8601 date-time string
t.enum('dog', 'cat', 'bird')     // string enum
t.literal('active')              // literal type
t.array(t.string())              // typed array, chainable: .minItems(), .maxItems()
t.record(t.string(), t.int32())  // Record<string, number>
t.tuple(t.string(), t.int32())   // [string, number]
t.union(t.string(), t.int32())   // string | number
t.file()                         // binary file upload (multipart/form-data)
t.empty()                        // no body (204, 205, 304)
t.unknown()                      // passthrough

// Named models and composition
const Pet = t.model('Pet', { id: t.string(), name: t.string(), age: t.int32() });
Pet.pick('id', 'name')           // new model with subset of fields
Pet.omit('id')                   // new model without specified fields
Pet.partial()                    // all fields optional
Pet.required()                   // all fields required
Pet.extend({ color: t.string() }) // add fields

// Value objects
const Email = t.value('Email', t.string().format('email'));

// Type inference
type Pet = t.infer<typeof Pet>;
```

## Endpoints

An `endpoint()` bundles method, path, schemas, handler, and behaviors into one object.

```ts
const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:petId',
  summary: 'Get a pet by ID',
  request: { params: { petId: t.string().format('uuid') } },
  responses: {
    200: { schema: Pet, description: 'Found' },
    404: { schema: ApiError, description: 'Not found' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.findById(ctx.params.petId);
    if (!pet) return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });
    return ctx.respond[200](pet);
  },
});
```

## Channels (WebSocket)

`channel()` defines a WebSocket channel with typed client/server messages.

```ts
const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat',
  connection: { params: { roomId: t.string() } },
  clientMessages: {
    sendMessage: { schema: t.model('SendMsg', { text: t.string() }), description: 'Send a message' },
  },
  serverMessages: {
    newMessage:  { schema: ChatMessage, description: 'Broadcasted message' },
  },
  onConnect: async (ctx) => { /* authenticate, seed state */ },
  handlers: {
    sendMessage: async (ctx, data) => {
      ctx.broadcast.newMessage({ user: 'Alice', text: data.text });
    },
  },
});
```

## Behaviors (BDD)

Attach BDD scenarios to endpoints. The test runner and CLI execute them automatically.

```ts
scenario('Duplicate pet names are rejected')
  .given('a pet already exists with name "Buddy" as a dog')
  .body({ name: 'Buddy', species: 'dog', age: 5 })
  .when('I create a pet')
  .then('response status is 409')
  .and('response body has code "DUPLICATE"')
```

Use `scenario.auto()` to generate adversarial tests from schemas:

```ts
behaviors: [
  scenario('creates a pet').given('valid input').body({...}).when('I create').then('response status is 201'),
  ...scenario.auto(),
]
```

## Router

`createRouter()` groups endpoints and channels, optionally within DDD bounded contexts.

```ts
const router = createRouter({ title: 'Petstore', version: '1.0.0' });

// Flat registration
router.add(createPet, getPet, listPets);

// Bounded contexts
router.context('Adoption', {
  description: 'Manages the pet adoption lifecycle',
  models: [Pet, AdoptionRequest, ApiError],
}, (ctx) => {
  ctx.add(createPet, adoptPet);
});
```

## beforeHandler

A single lifecycle hook that runs before request validation. Use it for auth, feature flags, and cross-cutting concerns. Returns `{ ok: true, state }` to proceed or `{ ok: false, response }` to short-circuit.

```ts
const createPet = endpoint({
  // ...schemas and responses including 401...
  beforeHandler: async (ctx) => {
    const token = ctx.rawHeaders['authorization'];
    if (!token) return { ok: false, response: ctx.respond[401]({ code: 'UNAUTHORIZED', message: 'Missing token' }) };
    const user = await ctx.services.auth.verify(token);
    return { ok: true, state: { user } };
  },
  handler: async (ctx) => {
    // ctx.state.user is typed and readonly
  },
});
```

## Links

- [Tutorial](./docs/quickstart.md)
- [AI Agent Guide](./docs/ai-agent-guide.md)
- [Schema DSL Reference](./docs/schema-dsl.md)
