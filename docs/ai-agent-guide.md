# Triad AI Agent Guide

> Canonical "how to use Triad" reference for AI coding assistants (Claude Code, Cursor, Copilot, Aider, etc.). Read this once, then produce idiomatic Triad code without guessing.

This guide is task-oriented. If you find yourself inventing syntax, stop and reread the relevant section — everything here is mirrored against the real source files in `packages/core`, `packages/test-runner`, and `packages/cli`.

---

## 1. What Triad is (30-second version)

Triad is a TypeScript-first API framework where **one declarative definition** produces validation, types, OpenAPI, AsyncAPI, Gherkin, executable BDD tests, and Drizzle database schemas. You write schemas and endpoints once using the `t` namespace and the `endpoint()` / `channel()` builders. Every artifact (OpenAPI YAML, `.feature` files, Drizzle tables, tests) is a deterministic projection of that single source of truth.

### Mental model

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

Everything downstream (docs, tests, db schema) is regenerated from the router. There is nothing to hand-sync.

### Packages

| Package | What it exports |
|---|---|
| `@triad/core` | `t`, `endpoint`, `channel`, `scenario`, `createRouter`, `Router`, `SchemaNode`, types `Infer`, `HandlerContext`, `ServiceContainer` |
| `@triad/test-runner` | `runBehaviors`, `runChannelBehaviors`, `defineConfig`, `TriadConfig` |
| `@triad/openapi` | `generateOpenAPI`, `toYaml`, `toJson` |
| `@triad/asyncapi` | `generateAsyncAPI`, `toYaml`, `toJson` |
| `@triad/gherkin` | `generateGherkin`, `writeGherkinFiles` |
| `@triad/fastify` | `triadPlugin` (HTTP + WebSocket) |
| `@triad/express` | `createTriadRouter`, `triadErrorHandler` (HTTP only — no channels) |
| `@triad/drizzle` | `generateDrizzleSchema`, `CodegenError` |
| `@triad/cli` | the `triad` binary (`triad test`, `triad docs`, `triad gherkin`, `triad db generate`, `triad validate`) |

### Golden rules (memorize these)

1. **Never redefine schemas in tests.** Import the exact model used by the endpoint. Tests are black-box consumers of the router.
2. **Never hand-write OpenAPI.** Run `triad docs`. Hand edits will be overwritten.
3. **Handlers orchestrate — schemas validate.** Do not re-check types inside handlers; the schema already rejected invalid input.
4. **Always use `ctx.respond[status](body)`.** Never `return { status, body }` — the runtime validates outgoing payloads only through `ctx.respond`.
5. **Every endpoint must have behaviors.** A scenario is documentation, a test, and a Gherkin line in one. Writing an endpoint without behaviors defeats the framework.
6. **Tests run in-process.** `triad test` invokes the handler directly, not through HTTP. Behaviors must not depend on adapter middleware.
7. **Module-augment `ServiceContainer`.** Put your repositories/clients on `ctx.services` by `declare module '@triad/core' { interface ServiceContainer { ... } }` — never cast in handlers.
8. **Behaviors use a heuristic assertion parser.** If your `then` text doesn't match a supported pattern exactly, the assertion fails as "unrecognized." See §5 for the phrase table.
9. **`.identity()` and `.storage({ primary: true })` are different.** `.identity()` is DDD (the entity's identity). `.storage()` is persistence hints for the Drizzle bridge. Real fields usually need both.

---

## 2. Schema DSL — the `t` namespace

Every schema builder is a subclass of `SchemaNode<TOutput>`. Chainable methods return **new instances**; schemas are immutable. The base class provides these methods on every schema:

| Method | Purpose |
|---|---|
| `.doc(description)` | Human description (→ OpenAPI `description`) |
| `.example(value)` | Example value for docs |
| `.deprecated(flag?)` | Mark deprecated |
| `.default(value)` | Default value — removes the field from `required[]` in OpenAPI and applies at validation time when the value is `undefined` |
| `.optional()` | Field may be `undefined` — returns a new schema with the output type `T \| undefined` |
| `.nullable()` | Value may be `null` — output type `T \| null` |
| `.identity(flag?)` | DDD identity marker (used for `x-triad-identity` in OpenAPI) |
| `.storage(meta)` | Persistence hints consumed by `@triad/drizzle`. Accumulates across calls. |

Plus runtime methods: `.validate(data)` (→ `{ success, data } \| { success, errors }`), `.parse(data)` (throws `ValidationException`), `.toOpenAPI(ctx?)`.

Type inference: `type Pet = t.infer<typeof Pet>` (or import `Infer` and use `Infer<typeof Pet>`).

### 2.1 Primitives

#### `t.string()`

```ts
import { t } from '@triad/core';

const email = t.string().format('email').minLength(3).maxLength(255);
const uuid = t.string().format('uuid');
const slug = t.string().pattern(/^[a-z0-9-]+$/).minLength(1);

type Email = t.infer<typeof email>; // string
```

**Constraints:** `.minLength(n)`, `.maxLength(n)`, `.pattern(regex)`, `.format(fmt)`.

**Valid formats** (from `packages/core/src/schema/string.ts`):
`'uuid' | 'email' | 'uri' | 'url' | 'hostname' | 'ipv4' | 'ipv6' | 'date' | 'date-time' | 'time' | 'duration' | 'byte' | 'binary' | 'password' | 'regex'`

> GOTCHA: `.format('date-time')` on a `t.string()` does format validation but prefer `t.datetime()` which is semantically clearer and emits the same OpenAPI.

#### `t.int32()`, `t.int64()`, `t.float32()`, `t.float64()`

```ts
const age = t.int32().min(0).max(120);
const price = t.float64().min(0).multipleOf(0.01);
const id = t.int64();
```

**Constraints:** `.min(n)`, `.max(n)`, `.exclusiveMin(n)`, `.exclusiveMax(n)`, `.multipleOf(n)`.

**Runtime differences:**
- `int32` enforces `-2^31 .. 2^31 - 1` range and `Number.isInteger`.
- `int64` enforces `Number.isSafeInteger` (±2^53).
- `float32`/`float64` require finite numbers.

OpenAPI emission: `{ type: 'integer', format: 'int32' }`, `{ type: 'number', format: 'double' }`, etc.

#### `t.boolean()`

```ts
const isAdmin = t.boolean().default(false);
```

No constraint methods; just the base metadata methods.

#### `t.datetime()`

ISO 8601 string. Output type is `string`, not `Date`.

```ts
const createdAt = t.datetime().storage({ defaultNow: true });
```

OpenAPI: `{ type: 'string', format: 'date-time' }`.

#### `t.enum(...values)`

Const tuple → literal union type.

```ts
const status = t.enum('available', 'adopted', 'pending');
// t.infer<typeof status> === 'available' | 'adopted' | 'pending'
```

#### `t.literal(value)`

```ts
const kind = t.literal('pet'); // type: 'pet'
```

Emits `{ const: value }`.

#### `t.unknown()`

```ts
const details = t.record(t.string(), t.unknown()).optional();
```

Accepts any value at runtime. Use sparingly.

### 2.2 Collections

#### `t.array(item)`

```ts
const tags = t.array(t.string()).minItems(1).maxItems(50).uniqueItems();
const pets = t.array(Pet);
```

**Constraints:** `.minItems(n)`, `.maxItems(n)`, `.uniqueItems(flag?)`.

> GOTCHA: Calling `.optional()` on the array itself makes the **field** optional. It does NOT make items nullable. To allow `null` items, do `t.array(t.string().nullable())`.

#### `t.record(keySchema, valueSchema)`

```ts
const headers = t.record(t.string(), t.string());
const details = t.record(t.string(), t.unknown()).optional();
```

First argument MUST be a `StringSchema` (used for key-shape validation). Maps to `{ type: 'object', additionalProperties: ... }`.

#### `t.tuple(...items)`

```ts
const point = t.tuple(t.float64(), t.float64()); // [number, number]
```

Enforces exact length.

#### `t.union(...options)`

```ts
const id = t.union(t.string().format('uuid'), t.int64());
```

Tries each option in order; first success wins. Maps to `oneOf` in OpenAPI.

### 2.3 Models and Value Objects (DDD)

#### `t.model(name, shape)`

Models are your **entities** — things with identity and lifecycle. They emit `$ref` components in OpenAPI.

```ts
export const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  name: t.string().minLength(1).maxLength(100).example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
  status: t.enum('available', 'adopted', 'pending').default('available'),
  tags: t.array(t.string()).optional(),
  createdAt: t.datetime().storage({ defaultNow: true }),
});

type Pet = t.infer<typeof Pet>;
```

Derived-model operations (all return new `ModelSchema` instances, do not mutate):

| Method | Effect |
|---|---|
| `.pick('a', 'b')` | Keep only those fields |
| `.omit('a', 'b')` | Drop those fields |
| `.partial()` | Make every field optional |
| `.required()` | Make every field required |
| `.extend({ field: ... })` | Add new fields (overwrites existing names) |
| `.merge(otherModel)` | Merge two models |
| `.named('NewName')` | Rename the model (used when deriving) |
| `.identityField()` | Returns the name of the field with `.identity()` |

Canonical derivation pattern (from `examples/petstore/src/schemas/pet.ts`):

```ts
export const Pet = t.model('Pet', { /* ... */ });
export const CreatePet = Pet.pick('name', 'species', 'age', 'tags').named('CreatePet');
export const UpdatePet = Pet.pick('name', 'age', 'tags').partial().named('UpdatePet');
```

> TIP: Always `.named('XyzName')` when you derive. Otherwise the component in OpenAPI keeps the parent's name and collisions become silent.

#### `t.value(name, inner)`

Value objects are DDD **value semantics** — no identity, immutable by convention. Two shapes:

```ts
// Primitive wrapper
export const Email = t.value('Email', t.string().format('email'));

// Composite value
export const Money = t.value('Money', {
  amount: t.float64().min(0),
  currency: t.enum('USD', 'EUR', 'GBP'),
});
```

**Differences from `t.model`:**
- No `.partial() / .pick() / .omit() / .identity()`.
- Emits **inline** OpenAPI schemas (with `title`), not `$ref` components.
- Cannot be referenced from `body_matches` assertions (only models can).

#### When to use which

- **Entity with an `id` field** → `t.model`. Repositories return them.
- **Reusable, comparable-by-value shape** (Email, Money, DateRange) → `t.value`.
- **Request DTOs (`CreatePet`, `UpdatePet`)** → derived from a `t.model` via `.pick/.partial/.named`.

---

## 3. Endpoints

### 3.1 The `endpoint()` signature

```ts
import { endpoint, scenario, t } from '@triad/core';

export const createPet = endpoint({
  name: 'createPet',            // operationId in OpenAPI — must be unique
  method: 'POST',               // 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: '/pets',                // Express-style (/pets/:id)
  summary: 'Create a new pet',  // one-line human summary
  description: 'Longer prose.', // optional, flows into OpenAPI
  tags: ['Pets'],               // used to group operations in OpenAPI
  request: {
    body: CreatePet,            // SchemaNode
    params: { id: t.string() }, // inline shape OR a named ModelSchema
    query: { limit: t.int32().default(20) },
    // headers: { xRequestId: t.string().optional() },  // only for business headers
  },
  beforeHandler: requireAuth,   // optional hook — see §6. For auth, tenant, etc.
  responses: {
    201: { schema: Pet,      description: 'Created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    409: { schema: ApiError, description: 'Duplicate' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create({
      ownerId: ctx.state.user.id,  // typed state from beforeHandler
      ...ctx.body,
    });
    return ctx.respond[201](pet);
  },
  behaviors: [ /* ... scenarios ... */ ],
});
```

The return value is a normalized `Endpoint` — pass it to `router.add(...)`.

### 3.2 `HandlerContext` — what `ctx` contains

Everything on `ctx` is inferred from the `request` and `responses` declarations:

| Field | Type |
|---|---|
| `ctx.params` | Inferred from `request.params` (or `{}`) |
| `ctx.query` | Inferred from `request.query` |
| `ctx.body` | Inferred from `request.body` (or `undefined`) |
| `ctx.headers` | Inferred from `request.headers` |
| `ctx.services` | `ServiceContainer` (module-augmented by you) |
| `ctx.state` | `Readonly<TBeforeState>` — state produced by the endpoint's `beforeHandler`. `{}` when no hook is declared. |
| `ctx.respond` | `{ [status]: (data) => HandlerResponse }` — only declared statuses are present |

`ctx.respond[201](body)` validates `body` against the schema declared for status 201 and wraps it as `{ status: 201, body }`. Calling `ctx.respond[500](...)` when 500 is not declared is a **compile error**.

### 3.3 Defining `request.params`, `request.query`, `request.headers`

Two forms are allowed — both produce a `ModelSchema` internally:

```ts
// Inline shape (wrapped in an anonymous model named `${endpointName}Params`)
request: {
  params: { id: t.string().format('uuid') },
  query: { limit: t.int32().default(20), cursor: t.string().optional() },
}

// Named ModelSchema (reusable, emitted as a component)
const AuthHeaders = t.model('AuthHeaders', {
  authorization: t.string(),
});
request: { headers: AuthHeaders }
```

Pass an **inline plain object of SchemaNodes** for one-off shapes; use a named `ModelSchema` when you want the shape to appear as a reusable OpenAPI component or when you're sharing it across endpoints.

### 3.4 Router + bounded contexts

```ts
import { createRouter } from '@triad/core';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description: 'Pets and adoptions',
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
});

// Flat registration
router.add(createPet, getPet, listPets);

// OR group by DDD bounded context
router.context(
  'Pets',
  {
    description: 'Pet catalog and CRUD',
    models: [Pet, CreatePet, UpdatePet, ApiError],
  },
  (ctx) => {
    ctx.add(createPet, getPet, listPets, updatePet);
  },
);

export default router;
```

Bounded contexts do three things:
1. Group endpoints in Gherkin output (one `.feature` file per context).
2. Declare the context's ubiquitous language via `models[]`. `triad validate` warns if an endpoint inside the context uses a model that isn't on the list.
3. Can hold both HTTP endpoints and WebSocket channels — `ctx.add(createPet, chatRoom)` works.

> TIP: Always export the router as the default export. The CLI loads it via `import(...)`.

### 3.5 Common patterns

#### CRUD

```ts
export const createPet = endpoint({ name: 'createPet', method: 'POST', path: '/pets', /* ... */ });
export const getPet    = endpoint({ name: 'getPet',    method: 'GET',    path: '/pets/:id', /* ... */ });
export const listPets  = endpoint({ name: 'listPets',  method: 'GET',    path: '/pets', /* ... */ });
export const updatePet = endpoint({ name: 'updatePet', method: 'PATCH',  path: '/pets/:id', /* ... */ });
export const deletePet = endpoint({ name: 'deletePet', method: 'DELETE', path: '/pets/:id', /* ... */ });
```

#### Paginated list with filters (from `examples/petstore`)

```ts
request: {
  query: {
    species: t.enum('dog', 'cat', 'bird', 'fish').optional().doc('Filter by species'),
    limit:   t.int32().min(1).max(100).default(20).doc('Page size'),
    offset:  t.int32().min(0).default(0).doc('Page offset'),
  },
},
handler: async (ctx) => {
  const pets = await ctx.services.petRepo.list({
    limit: ctx.query.limit,
    offset: ctx.query.offset,
    ...(ctx.query.species !== undefined && { species: ctx.query.species }),
  });
  return ctx.respond[200](pets);
},
```

#### Bearer auth (from `examples/tasktracker`) — `beforeHandler`

Triad ships a single **`beforeHandler`** extension point on `endpoint()` (Phase 10.3). It is the declarative hook for authentication, tenant resolution, feature flags, and any other cross-cutting concern that needs to inspect the raw request before schema validation runs.

Key properties:

- **Singular, not an array.** One endpoint, one `beforeHandler`. Compose multiple concerns with plain function calls inside your own hook — middleware stacks hide the request lifecycle that makes Triad readable.
- **Runs BEFORE request schema validation.** Auth can reject missing/malformed headers as 401 without the validator 400-ing first. You therefore do NOT need to declare the `authorization` header on the endpoint's `request.headers` at all.
- **Returns either `{ ok: true, state }` or `{ ok: false, response }`.** On success, `state` is threaded into `ctx.state` (readonly) on the main handler, with its type inferred from the return. On short-circuit, the main handler is NEVER called.
- **Type-safe short-circuits.** The `ctx.respond[...]` map inside `beforeHandler` is keyed on the same `responses` config as the main handler, so a 401 short-circuit only compiles when 401 is in the endpoint's declared responses.

```ts
// auth.ts — a reusable hook
import type { BeforeHandler } from '@triad/core';

export type AuthState = { user: User };

export const requireAuth: BeforeHandler<AuthState, { 401: { schema: typeof ApiError; description: string } }> = async (ctx) => {
  const token = parseBearer(ctx.rawHeaders['authorization']);
  if (!token) {
    return {
      ok: false,
      response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'Missing bearer token' }),
    };
  }
  const userId = ctx.services.tokens.lookup(token);
  if (!userId) return { ok: false, response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'Invalid token' }) };
  const user = await ctx.services.userRepo.findById(userId);
  if (!user) return { ok: false, response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'User not found' }) };
  return { ok: true, state: { user } };
};

// endpoint — no three-line preamble, no authorization header in request.headers
export const createProject = endpoint({
  // ...
  beforeHandler: requireAuth,
  request: { body: CreateProject },
  responses: {
    201: { schema: Project, description: 'Created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const project = await ctx.services.projectRepo.create({
      ownerId: ctx.state.user.id,  // typed; no .ok check, no unpack
      name: ctx.body.name,
    });
    return ctx.respond[201](project);
  },
});
```

**Composing multiple beforeHandlers:** call them as plain functions inside one hook. There is no `beforeHandler: [a, b]` form and there is no router-level hook. Users who want "every endpoint in this context uses auth" write a thin wrapper:

```ts
const protectedEndpoint = <P, Q, B, H, R, S>(cfg: EndpointConfig<P, Q, B, H, R, S>) =>
  endpoint({ ...cfg, beforeHandler: requireAuth });
```

#### Error envelope

Use one `ApiError` model across every endpoint:

```ts
export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable message'),
  details: t.record(t.string(), t.unknown()).optional(),
});
```

Return it via `ctx.respond[4xx](apiError)`.

#### 204 No Content (current workaround)

Triad does not yet ship `t.empty()`. The idiomatic workaround:

```ts
export const NoContent = t.unknown().optional().doc('Empty response body');

responses: { 204: { schema: NoContent, description: 'Deleted' } },
handler: async (ctx) => {
  await ctx.services.taskRepo.delete(ctx.params.id);
  return ctx.respond[204](undefined);
},
```

> GOTCHA: If you use a non-optional schema for 204, the runtime validator will reject `undefined`.

---

## 4. Channels (WebSockets)

Channels are the real-time counterpart to endpoints. Same schema DSL, same behavior builder. Currently supported by the Fastify adapter only.

### 4.1 The `channel()` signature

```ts
import { channel, t } from '@triad/core';

interface ChatRoomState {
  userId: string;
  userName: string;
  roomId: string;
}

export const chatRoom = channel({
  name: 'chatRoom',
  path: '/ws/rooms/:roomId',
  summary: 'Real-time chat room',
  description: 'Bidirectional chat for a room',
  tags: ['Chat'],

  // Phantom witness for typed ctx.state — value is ignored, type matters
  state: {} as ChatRoomState,

  connection: {
    params:  { roomId: t.string().format('uuid') },
    headers: {
      'x-user-id':   t.string().format('uuid'),
      'x-user-name': t.string().minLength(1),
    },
    // query: optional, same shape as params/headers
  },

  clientMessages: {
    sendMessage: { schema: SendMessagePayload, description: 'Post a message' },
    typing:      { schema: TypingPayload,      description: 'Typing state' },
  },

  serverMessages: {
    message:  { schema: ChatMessage,    description: 'New message' },
    typing:   { schema: TypingIndicator, description: 'Typing indicator' },
    presence: { schema: UserPresence,   description: 'Join/leave' },
    error:    { schema: ChannelError,   description: 'Error' },
  },

  onConnect: async (ctx) => {
    // Reject invalid handshakes
    if (!isValidRoom(ctx.params.roomId)) {
      return ctx.reject(404, 'Room not found');
    }
    ctx.state.userId = ctx.headers['x-user-id'];
    ctx.state.userName = ctx.headers['x-user-name'];
    ctx.state.roomId = ctx.params.roomId;

    ctx.broadcast.presence({
      userId: ctx.state.userId,
      userName: ctx.state.userName,
      action: 'joined',
    });
  },

  onDisconnect: async (ctx) => {
    if (ctx.state.userId) {
      ctx.broadcast.presence({ /* ... */ action: 'left' });
    }
  },

  handlers: {
    // One handler per clientMessage. Missing or extra keys = compile error.
    sendMessage: async (ctx, data) => {
      const message = await ctx.services.messageStore.create({ /* ... */ });
      ctx.broadcast.message(message);      // to everyone including sender
    },
    typing: async (ctx, data) => {
      ctx.broadcastOthers.typing({ /* ... */ }); // to everyone EXCEPT sender
    },
  },

  behaviors: [ /* channel behavior scenarios */ ],
});
```

### 4.2 Connection context (`onConnect` / `onDisconnect`)

| Field | Description |
|---|---|
| `ctx.params` | Path parameters |
| `ctx.query` | Query string arguments |
| `ctx.headers` | Request headers |
| `ctx.services` | Module-augmented `ServiceContainer` |
| `ctx.state` | Mutable per-connection bag (type from phantom `state` witness) |
| `ctx.reject(code, message)` | Refuse the handshake (HTTP-style status) |
| `ctx.broadcast.*` | Send to every connected client including the current one |

### 4.3 Per-message handler context

| Field | Description |
|---|---|
| `ctx.params` | Connection params (same for the whole connection) |
| `ctx.services` | Service container |
| `ctx.state` | The same bag `onConnect` populated |
| `ctx.broadcast.*` | Push a server message to every client |
| `ctx.broadcastOthers.*` | Same as broadcast, excluding the sender |
| `ctx.send.*` | Push to **this** client only (e.g. errors) |

`ctx.broadcast`, `ctx.broadcastOthers`, and `ctx.send` are derived from `serverMessages`, so calling `ctx.broadcast.notDeclared(...)` is a compile error.

### 4.4 Channel state typing

TypeScript can't infer `TState` at the same time as every other generic in `channel<TState, ...>(config)`. Instead, use the **phantom witness pattern**:

```ts
interface ChatRoomState {
  userId: string;
  userName: string;
}

channel({
  state: {} as ChatRoomState, // value ignored, type used for ctx.state
  // ...
});
```

Without a state witness, `ctx.state` is `Record<string, any>`.

### 4.5 Channel behaviors

Channel scenarios use the **same** `scenario().given().when().then()` builder as HTTP, but the assertions operate on received messages rather than HTTP responses. See §5.6 for the channel assertion phrases.

---

## 5. Behaviors — the BDD DSL

**This section is the most important for AI agents.** The assertion parser is heuristic — phrases that don't match a supported pattern exactly fail as `"Unrecognized assertion"`. Memorize the phrase table in §5.5.

### 5.1 The builder

```ts
import { scenario } from '@triad/core';

scenario('Pets can be created with valid data')  // the Scenario: line in Gherkin
  .given('a valid pet payload')                  // narrative (string only)
  .body({ name: 'Buddy', species: 'dog', age: 3 })
  .when('I create a pet')                        // narrative (string only)
  .then('response status is 201')                // parsed assertion
  .and('response body matches Pet')              // parsed assertion
  .and('response body has name "Buddy"');        // parsed assertion
```

### 5.2 `given()` stage methods

Everything between `.given(...)` and `.when(...)` sets up the request and the fixture bag.

| Method | Effect |
|---|---|
| `.body(data)` | Sets the request body (object). Placeholders interpolated from fixtures. |
| `.params({ id: '{petId}' })` | Path params. `{placeholder}` substituted from fixtures. |
| `.query({ limit: 10 })` | Query string. |
| `.headers({ authorization: 'Bearer {token}' })` | Request headers. |
| `.setup(async (services) => { ... })` | Seed the database. Return value is merged into fixtures. |
| `.fixtures({ key: value })` | Inline fixtures (merged on top of `setup()` return). |

### 5.3 Fixtures and `{placeholder}` substitution

Two sources of fixtures, merged at run time:

1. **`.setup()` return value** — anything it returns becomes fixtures.
2. **`.fixtures({...})`** — static values.

Inside strings, `{key}` is replaced with `String(fixtures[key])`. **Special case:** if a string is *entirely* one token (e.g. `'{petId}'`) and the fixture value is not a string, the raw non-string value is substituted (so numbers stay numbers).

```ts
scenario('Existing pets can be retrieved by ID')
  .given('a pet exists')
  .setup(async (services) => {
    const pet = await services.petRepo.create({ name: 'Rex', species: 'dog', age: 5 });
    return { petId: pet.id };       // becomes fixtures.petId
  })
  .params({ id: '{petId}' })        // substituted
  .when('I GET /pets/{petId}')      // narrative — substituted for gherkin output only
  .then('response status is 200')
  .and('response body has id "{petId}"')  // substituted in assertion value
```

### 5.4 The test-runner flow (what happens per scenario)

From `packages/test-runner/src/runner.ts`:

1. Call `servicesFactory()` → fresh `ServiceContainer` (test isolation).
2. Call `behavior.given.setup(services)` if defined; merge return value with `.fixtures`.
3. Substitute `{placeholder}` tokens in body/params/query/headers.
4. Validate each request part against the endpoint's declared schemas (catches scenario mistakes early).
5. Invoke `endpoint.handler(ctx)` directly.
6. Validate the response `body` against the declared schema for the returned status.
7. Run every `then[]` assertion.
8. Call `teardown(services)` in `finally`.

**Tests do not go through HTTP.** There is no adapter, no middleware, no JSON serialization. The handler is called with a synthetic `HandlerContext`.

### 5.5 HTTP assertion phrase reference

Source: `packages/test-runner/src/assertions.ts` + `packages/core/src/behavior.ts`.

| Phrase | What it does |
|---|---|
| `response status is <N>` | Asserts HTTP status code |
| `response body matches <ModelName>` | Validates body against a named `ModelSchema` registered on the router (must be reachable from an endpoint's request or response) |
| `response body is an array` | `Array.isArray(body)` |
| `response body has length <N>` | `body.length === N` (body must be an array) |
| `response body has <path> "<string>"` | Dotted path equality, string literal |
| `response body has <path> <number>` | Dotted path equality, numeric literal (integers or decimals, negative allowed) |
| `response body has <path> true` / `... false` | Dotted path equality, boolean literal |
| `response body has code "<CODE>"` | Shortcut for `body.code === "<CODE>"` |

**Literal forms:**
- Strings MUST use double quotes: `"Buddy"`, never `'Buddy'`.
- Numbers bare: `42`, `-3.14`.
- Booleans: `true`, `false`.
- **`null` is NOT supported** by the parser. Workaround: let the response schema enforce nullability (if the schema says `.nullable()`, a non-null of the wrong type would fail response-schema validation). See the tasktracker's `listTasks` comment for the idiom.

**Dotted paths:** `body.has items.length 10` reads `response.body.items.length`.

**Anything else** falls through to `{ type: 'custom' }` — which **fails** at run time unless a `customMatchers` entry is registered. The runner's stance is: no silent passes.

### 5.6 Channel assertion phrases

Source: same file. Channels produce a stream of received messages rather than one response body.

| Phrase | Meaning |
|---|---|
| `<clientName> receives a <messageType> event` | Client received a message of that type |
| `all clients receive a <messageType> event` | Every connected client received it |
| `<clientName> does not receive a <messageType> event` (case-insensitive `NOT`) | Negative assertion |
| `<clientName> receives a <messageType> with <field> "<value>"` | The most recent `<messageType>` has `field === value` |
| `message has <field> "<value>"` | Equivalent to "any client, any message type, most recent" |
| `connection is rejected with code <N>` | `onConnect` called `ctx.reject(N, ...)` |

`<clientName>` is a named client ID in the channel test harness. `"client"` is conventional when you only have one.

### 5.7 A full worked example

```ts
scenario('A subsequent page picks up where the cursor left off')
  .given('15 tasks and a first-page cursor at task 10')
  .setup(async (services) => {
    const user = await services.userRepo.create({ email: 'alice@example.com', password: 'pw', name: 'Alice' });
    const project = await services.projectRepo.create({ ownerId: user.id, name: 'Alpha' });
    const created: { createdAt: string }[] = [];
    for (let i = 1; i <= 15; i++) {
      const task = await services.taskRepo.create({ projectId: project.id, title: `Task ${i}` });
      created.push({ createdAt: task.createdAt });
      await new Promise((r) => setTimeout(r, 2));
    }
    const cursor = Buffer.from(created[9]!.createdAt, 'utf8').toString('base64url');
    const token = services.tokens.issue(user.id);
    return { token, projectId: project.id, cursor };
  })
  .headers({ authorization: 'Bearer {token}' })
  .params({ projectId: '{projectId}' })
  .query({ limit: 10, cursor: '{cursor}' })
  .when('I GET /projects/{projectId}/tasks?limit=10&cursor=...')
  .then('response status is 200')
  .and('response body matches TaskPage')
  .and('response body has items.length 5');
```

---

## 6. Services + Dependency Injection

### 6.1 Declaring your services

Define a `createServices(...)` factory and an interface:

```ts
// src/services.ts
import { PetRepository } from './repositories/pet.js';
import { AdopterRepository } from './repositories/adoption.js';
import type { Db } from './db/client.js';

export interface PetstoreServices {
  db: Db;
  petRepo: PetRepository;
  adopterRepo: AdopterRepository;
}

declare module '@triad/core' {
  interface ServiceContainer extends PetstoreServices {}
}

export function createServices({ db }: { db: Db }): PetstoreServices {
  return {
    db,
    petRepo: new PetRepository(db),
    adopterRepo: new AdopterRepository(db),
  };
}
```

The `declare module` augmentation makes `ctx.services.petRepo` typed in every handler — **no import required in the endpoint file**. This is the single place where your container type is defined.

### 6.2 Per-scenario isolation (test setup)

Create `src/test-setup.ts` that **default-exports** a factory function:

```ts
// src/test-setup.ts
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

interface TestServices extends ReturnType<typeof createServices> {
  cleanup(): Promise<void>;
}

export default function createTestServices(): TestServices {
  const db = createDatabase(':memory:'); // fresh DB per scenario
  const services = createServices({ db });
  return {
    ...services,
    async cleanup() {
      services.db.$raw.close();
    },
  };
}
```

Wire it through `triad.config.ts`:

```ts
export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',  // method name on the services object
  },
});
```

The CLI calls the default export before every scenario and `services.cleanup()` after every scenario. Each test gets a clean database.

### 6.3 Repository pattern

Put DB code in `src/repositories/`. Handlers call `ctx.services.xRepo.method(...)` and do nothing else.

```ts
handler: async (ctx) => {
  const pet = await ctx.services.petRepo.create(ctx.body);
  return ctx.respond[201](pet);
}
```

---

## 7. CLI — command reference

The `triad` CLI dispatches to subcommands. Top-level flags work on every subcommand:

| Flag | Purpose |
|---|---|
| `-c, --config <path>` | Override `triad.config.ts` path |
| `-r, --router <path>` | Override the router file (bypasses config) |

### 7.1 `triad test`

Runs every behavior in the router as an in-process test. Also runs channel behaviors.

```bash
triad test
triad test --bail
triad test --filter createPet
```

| Flag | Effect |
|---|---|
| `--bail` | Stop on first failure |
| `--filter <pattern>` | Only run endpoints/channels whose `name` contains `<pattern>` |

Reads from config: `test.setup`, `test.teardown`, `test.bail`. Exits 1 if any scenario fails or errors.

### 7.2 `triad docs`

Generates OpenAPI 3.1 from HTTP endpoints; also generates AsyncAPI 3.0 **sibling file** if the router has channels.

```bash
triad docs
triad docs --output ./generated/api.yaml
triad docs --format json
```

| Flag | Effect |
|---|---|
| `-o, --output <path>` | Output path (default: `./generated/openapi.yaml`) |
| `-f, --format <format>` | `yaml` or `json` (defaults to file extension) |

Reads from config: `docs.output`, `docs.format`. When channels exist, writes `asyncapi.yaml` (or `.json`) beside the OpenAPI file.

### 7.3 `triad gherkin`

Emits `.feature` files — one per bounded context (or one for the root endpoints).

```bash
triad gherkin
triad gherkin --output ./docs/features
```

| Flag | Effect |
|---|---|
| `-o, --output <dir>` | Output directory (default: `./generated/features`) |

Reads from config: `gherkin.output`.

### 7.4 `triad db generate`

Walks the router, reads `.storage()` hints, and emits a Drizzle schema file for a given dialect.

```bash
triad db generate
triad db generate --dialect postgres --output ./src/db/schema.generated.ts
```

| Flag | Effect |
|---|---|
| `-o, --output <path>` | Output path (default: `./src/db/schema.generated.ts`) |
| `-d, --dialect <dialect>` | `sqlite`, `postgres`, or `mysql` (default: `sqlite`) |

Any model that contains **at least one** `.storage({ primaryKey: true })` field becomes a table. Models without primary-key hints are skipped. See §10.

### 7.5 `triad validate`

Cross-artifact consistency checks:

1. No duplicate endpoint `name`s.
2. No duplicate `METHOD path` combinations.
3. Every endpoint declares at least one response.
4. Every `body matches <ModelName>` assertion references a model that exists in the router.
5. Endpoints inside a bounded context only use models declared in that context's `models[]` (warning — not error).

```bash
triad validate
triad validate --strict   # treat warnings as errors
```

---

## 8. `triad.config.ts`

```ts
import { defineConfig } from '@triad/test-runner';

export default defineConfig({
  router: './src/app.ts',       // path to the module default-exporting a Router
  test: {
    setup: './src/test-setup.ts',  // default-exports a services factory
    teardown: 'cleanup',            // method name on the returned services object
    bail: false,
  },
  docs: {
    output: './generated/openapi.yaml',
    format: 'yaml',                 // or 'json'
  },
  gherkin: {
    output: './generated/features',
  },
});
```

| Field | Purpose |
|---|---|
| `router` | Path to the Router module (default export), resolved relative to the config file |
| `test.setup` | Path to a module whose default export is a `servicesFactory` |
| `test.teardown` | Name of a method to call on the services object after each scenario |
| `test.bail` | Stop on first failure |
| `test.include` / `test.exclude` | Glob patterns over endpoint names (reserved) |
| `docs.output` | Output path for `triad docs` |
| `docs.format` | `'yaml'` or `'json'` |
| `gherkin.output` | Output directory for `triad gherkin` |

The CLI loads the config with `jiti`, so TypeScript configs work out-of-the-box without a build step. Configs are discovered by walking upward from the cwd unless `--config` is passed.

---

## 9. Adapters

### 9.1 Fastify (recommended)

Supports HTTP endpoints **and** WebSocket channels.

```ts
// src/server.ts
import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createServices } from './services.js';
import { createDatabase } from './db/client.js';

const app = Fastify({ logger: true });
const db = createDatabase(process.env.DATABASE_URL ?? ':memory:');
const services = createServices({ db });

await app.register(triadPlugin, { router, services });
await app.listen({ port: 3000, host: '0.0.0.0' });
```

Per-request services:

```ts
await app.register(triadPlugin, {
  router,
  services: (request) => ({
    petRepo: petRepoFor(request.user.tenantId),
  }),
});
```

For channels, install `@fastify/websocket` as an optional peer. The plugin will throw a targeted error if the router has channels but the peer is missing.

### 9.2 Express

HTTP endpoints only — **no channels in v1**.

```ts
// src/server.ts
import express from 'express';
import { createTriadRouter, triadErrorHandler } from '@triad/express';
import router from './app.js';
import { createServices } from './services.js';

const app = express();
app.use(express.json());        // REQUIRED before the Triad router
app.use(createTriadRouter(router, { services: createServices({ /* ... */ }) }));
app.use(triadErrorHandler());   // optional — formats stray Triad errors
app.listen(3000);
```

> GOTCHA: Forgetting `express.json()` means `ctx.body` is `undefined`. Fastify parses JSON internally; Express does not.

### 9.3 Hono

A `@triad/hono` adapter package exists in the repository but may not be complete at the time you read this guide. Check `packages/hono/src/` for the current state before importing from it.

---

## 10. Drizzle bridge

The bridge is **not** a migration tool. It reads `.storage()` hints on your models and emits a Drizzle schema file that you then check in. `triad db generate` regenerates the file when schemas change.

### 10.1 Marking a model as a table

Every field that should become a column must be on a `t.model` that has at least one field marked `.storage({ primaryKey: true })`:

```ts
export const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity().storage({ primaryKey: true }),
  name: t.string().minLength(1).maxLength(100).storage({ indexed: true }),
  species: t.enum('dog', 'cat', 'bird', 'fish').storage({ indexed: true }),
  age: t.int32().min(0).max(100),
  status: t.enum('available', 'adopted', 'pending').default('available'),
  createdAt: t.datetime().storage({ defaultNow: true }),
});
```

### 10.2 `.storage()` options

| Option | Effect |
|---|---|
| `primaryKey: true` | Marks the field as the table's PK (required to become a table) |
| `unique: true` | Unique constraint |
| `indexed: true` | Secondary index |
| `columnName: 'user_id'` | Override the SQL column name |
| `defaultNow: true` | Default to `CURRENT_TIMESTAMP` |
| `defaultRandom: true` | Default to a random UUID |
| `references: 'projects.id'` | Foreign key reference |
| `custom: { ... }` | Dialect-specific hints |

### 10.3 Dialects

`sqlite`, `postgres`, `mysql`. All three emit valid Drizzle `sqliteTable`/`pgTable`/`mysqlTable` definitions. Type mapping is logical:

| Triad type | Drizzle (SQLite) | Drizzle (Postgres) |
|---|---|---|
| `t.string()` | `text` | `text` |
| `t.string().format('uuid')` | `text` | `uuid` |
| `t.datetime()` | `text` (ISO) | `text` (ISO) |
| `t.int32()` | `integer` | `integer` |
| `t.int64()` | `integer` | `bigint` |
| `t.float64()` | `real` | `doublePrecision` |
| `t.boolean()` | `integer` (0/1) | `boolean` |
| `t.enum(...)` | `text` + CHECK | `text` (or `pgEnum` if configured) |
| `t.array / t.record / ...` | `text` JSON | `jsonb` |

### 10.4 Using the generated schema

The generator writes one file. Import it into your Drizzle client:

```ts
// src/db/client.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.generated.js';

export function createDatabase(url = ':memory:') {
  const raw = new Database(url);
  const db = drizzle(raw, { schema });
  return Object.assign(db, { $raw: raw });
}
export type Db = ReturnType<typeof createDatabase>;
```

Your repositories then use standard Drizzle queries against the generated tables. Handlers stay agnostic — they only talk to the repository.

---

## 11. DDD patterns used by Triad

Triad is intentionally DDD-flavored. The key mappings:

| DDD concept | Triad mechanism |
|---|---|
| **Entity / Aggregate** | `t.model('Name', { ... })` with `.identity()` on the ID field |
| **Value object** | `t.value('Name', t.xxx)` or `t.value('Name', { fields })` |
| **Ubiquitous language** | `router.context('Name', { models: [A, B, C] }, ...)` — models listed here form the context's vocabulary |
| **Repository** | Classes under `src/repositories/` exposed via `ctx.services` |
| **Bounded context** | `router.context(...)` — groups endpoints + channels and enforces model boundaries |
| **Domain service** | Plain class in `src/services/` injected through `createServices()` |
| **Domain event** | User-defined; publish from repository/service using an injected event bus |

Handlers stay **thin** — they parse `ctx.params`/`ctx.query`/`ctx.body`, call a repository or service, and map the result to `ctx.respond[...]`. Business logic lives in aggregates and services, not in endpoint handlers.

For the deeper discussion see `docs/ddd-patterns.md`.

---

## 12. Common pitfalls

These are the mistakes most likely to trip up an AI coding assistant writing Triad code.

1. **Redefining schemas in test files.** The behavior scenarios live next to the endpoint in the same file — they reuse the actual schemas by reference. Do not create a `test-fixtures.ts` that duplicates the shape.

2. **`any` in handlers.** `ctx.body`, `ctx.params`, `ctx.query`, `ctx.headers`, `ctx.services`, and `ctx.respond[n]` are all inferred. If a handler needs a cast, the schema is wrong — fix the schema.

3. **Assertion phrasings that don't parse.** The parser fails fast on unrecognized patterns. If your assertion isn't in the §5.5 table, rewrite it. Favorites that DON'T work: `"response body.name should equal 'Buddy'"`, `"expect body.name to be Buddy"`, `"body.name == Buddy"`. Correct: `'response body has name "Buddy"'`.

4. **Using single quotes inside assertion literals.** Only `"double quotes"` are recognized for string values.

5. **Asserting against `null`.** Not supported by the parser. Let the schema (`.nullable()`) and the response validator enforce the nullable invariant, or add a `customMatchers` entry.

6. **Declaring the `authorization` header on the endpoint's `request.headers`** — don't. Use `beforeHandler: requireAuth` (see §6). The beforeHandler reads `ctx.rawHeaders['authorization']` before validation runs, so the header does not belong in the declared request shape at all. The old "declare it `.optional()` so missing-auth reaches the handler" workaround is obsolete.

7. **Forgetting to return from `ctx.respond`.** Every branch of a handler must `return ctx.respond[n](...)`. Falling off the end returns `undefined`, which the test runner treats as a schema failure.

8. **Forgetting `express.json()`** with the Express adapter — `ctx.body` will be `undefined`.

9. **Forgetting `ServiceContainer` module augmentation.** Without it, `ctx.services` is `{}` and every access is a compile error.

10. **Hand-writing OpenAPI or Gherkin.** Never do this — use `triad docs` / `triad gherkin`. Hand edits will be blown away.

11. **Forgetting `.storage({ primaryKey: true })`** on the PK field. The Drizzle bridge only treats a model as a table when it sees a primary key hint.

12. **Creating a new example and wondering why tests don't find it.** The CLI loads the router by path (via `triad.config.ts`), not by monorepo glob, so this usually means the `router` field in config is wrong.

13. **Using `setup()` fixtures without returning them.** `.setup(async (svc) => { await svc.petRepo.create(...) })` runs but contributes no fixtures. If you need `{petId}` substitution, `return { petId: pet.id }`.

14. **Writing `return ctx.respond[201]` (no call).** Common typo. The correct form is `return ctx.respond[201](pet)` — `respond[n]` is a function, not a plain response object.

15. **Mixing HTTP and channel tests by using the same phrases.** Channel tests use `client receives ...` patterns (§5.6), not `response status ...`.

---

## 13. End-to-end cheat sheet

A minimal Triad app in one pass.

### 13.1 `package.json`

```json
{
  "name": "my-api",
  "type": "module",
  "scripts": {
    "dev": "tsx src/server.ts",
    "test": "triad test",
    "docs": "triad docs",
    "db:generate": "triad db generate"
  },
  "dependencies": {
    "@triad/core": "*",
    "@triad/fastify": "*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@triad/cli": "*",
    "@triad/test-runner": "*",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

### 13.2 `src/schemas/pet.ts`

```ts
import { t } from '@triad/core';

export const Pet = t.model('Pet', {
  id:   t.string().format('uuid').identity().storage({ primaryKey: true }),
  name: t.string().minLength(1).maxLength(100).example('Buddy'),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age:  t.int32().min(0).max(100),
});

export const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

export const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});
```

### 13.3 `src/services.ts`

```ts
export interface PetRepository {
  create(input: { name: string; species: string; age: number }): Promise<{ id: string; name: string; species: string; age: number }>;
}

export interface AppServices {
  petRepo: PetRepository;
}

declare module '@triad/core' {
  interface ServiceContainer extends AppServices {}
}

export function createServices(): AppServices {
  const pets = new Map<string, { id: string; name: string; species: string; age: number }>();
  return {
    petRepo: {
      async create(input) {
        const id = crypto.randomUUID();
        const pet = { id, ...input };
        pets.set(id, pet);
        return pet;
      },
    },
  };
}
```

### 13.4 `src/endpoints/pets.ts`

```ts
import { endpoint, scenario } from '@triad/core';
import { Pet, CreatePet, ApiError } from '../schemas/pet.js';

export const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet,      description: 'Created' },
    400: { schema: ApiError, description: 'Invalid input' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('A pet can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I POST /pets')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),
  ],
});
```

### 13.5 `src/app.ts`

```ts
import { createRouter } from '@triad/core';
import { createPet } from './endpoints/pets.js';
import { Pet, CreatePet, ApiError } from './schemas/pet.js';

const router = createRouter({
  title: 'My API',
  version: '1.0.0',
});

router.context(
  'Pets',
  { description: 'Pet catalog', models: [Pet, CreatePet, ApiError] },
  (ctx) => ctx.add(createPet),
);

export default router;
```

### 13.6 `src/server.ts`

```ts
import Fastify from 'fastify';
import { triadPlugin } from '@triad/fastify';
import router from './app.js';
import { createServices } from './services.js';

const app = Fastify({ logger: true });
await app.register(triadPlugin, { router, services: createServices() });
await app.listen({ port: 3000 });
```

### 13.7 `src/test-setup.ts`

```ts
import { createServices } from './services.js';

export default function createTestServices() {
  return { ...createServices(), async cleanup() { /* no-op for in-memory */ } };
}
```

### 13.8 `triad.config.ts`

```ts
import { defineConfig } from '@triad/test-runner';

export default defineConfig({
  router: './src/app.ts',
  test: {
    setup: './src/test-setup.ts',
    teardown: 'cleanup',
  },
  docs: { output: './generated/openapi.yaml' },
  gherkin: { output: './generated/features' },
});
```

### 13.9 Commands

```bash
npm run test    # runs every behavior as in-process tests
npm run docs    # writes generated/openapi.yaml
npx triad gherkin
npx triad validate
npx triad db generate --dialect sqlite
```

---

## 14. Where to look in the source

When this guide is ambiguous or you need ground truth, read these files.

| Question | Source file |
|---|---|
| Public exports of `@triad/core` | `packages/core/src/index.ts` |
| The `t` namespace | `packages/core/src/schema/index.ts` |
| `SchemaNode`, `.doc/.example/.default/.identity/.storage`, validation flow | `packages/core/src/schema/types.ts` |
| String `.format()` values | `packages/core/src/schema/string.ts` |
| `int32` vs `int64` range checks | `packages/core/src/schema/number.ts` |
| `t.model.pick/.omit/.partial/.required/.extend/.merge/.named` | `packages/core/src/schema/model.ts` |
| `t.value` vs `t.model` | `packages/core/src/schema/value.ts` |
| `endpoint()` signature, request normalization | `packages/core/src/endpoint.ts` |
| `HandlerContext`, `ctx.respond`, `ServiceContainer` augmentation | `packages/core/src/context.ts` |
| `createRouter`, `router.add`, `router.context` | `packages/core/src/router.ts` |
| `scenario().given().when().then()` builder + assertion parser | `packages/core/src/behavior.ts` |
| `channel()` signature, connection + handler contexts | `packages/core/src/channel.ts`, `packages/core/src/channel-context.ts` |
| HTTP assertion execution rules | `packages/test-runner/src/assertions.ts` |
| Test runner per-scenario flow | `packages/test-runner/src/runner.ts` |
| Channel test runner | `packages/test-runner/src/channel-runner.ts` |
| Placeholder substitution semantics | `packages/test-runner/src/substitute.ts` |
| `TriadConfig` / `defineConfig` shape | `packages/test-runner/src/config.ts` |
| CLI commands | `packages/cli/src/commands/{test,docs,gherkin,db,validate}.ts` |
| Fastify plugin wiring | `packages/fastify/src/plugin.ts` |
| Express router wiring | `packages/express/src/router.ts` |
| Drizzle codegen entry point, dialects | `packages/drizzle/src/codegen/index.ts`, `packages/drizzle/src/codegen/types.ts` |
| OpenAPI emission rules | `packages/openapi/src/generator.ts` |
| AsyncAPI emission rules | `packages/asyncapi/src/generator.ts` |
| Gherkin emission rules | `packages/gherkin/src/generator.ts` |

### Reference examples

| Concept | File |
|---|---|
| Full petstore router with bounded contexts + channels | `examples/petstore/src/app.ts` |
| CRUD endpoint with behaviors + fixtures + setup | `examples/petstore/src/endpoints/pets.ts` |
| Model derivation (`.pick/.partial/.named`) | `examples/petstore/src/schemas/pet.ts` |
| Channel with typed state + auth via headers | `examples/petstore/src/channels/chat-room.ts` |
| Fastify server wiring | `examples/petstore/src/server.ts` |
| Test setup with per-scenario isolation | `examples/petstore/src/test-setup.ts` |
| Bearer-token auth without middleware | `examples/tasktracker/src/auth.ts` + `examples/tasktracker/src/endpoints/tasks.ts` |
| Keyset pagination pattern | `examples/tasktracker/src/endpoints/tasks.ts` |
| Express server wiring | `examples/tasktracker/src/server.ts` |
| `triad.config.ts` | `examples/petstore/triad.config.ts`, `examples/tasktracker/triad.config.ts` |

---

**Final reminder:** if you find yourself writing code that *feels* like Triad but you're not sure — stop, read the source file listed above, and come back. There is exactly one right way to declare each primitive, each endpoint, each behavior, and each assertion. Guessing produces scenarios that fail to parse and endpoints that don't validate.
