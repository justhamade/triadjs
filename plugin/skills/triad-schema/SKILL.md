---
name: triad-schema
description: Use when designing TriadJS schemas — `t.model()`, `t.value()`, primitives (`t.string`, `t.int32`, `t.enum`, `t.datetime`, `t.file`), collections (`t.array`, `t.record`, `t.tuple`, `t.union`), model operations (`.pick`, `.omit`, `.partial`, `.extend`, `.merge`, `.named`), or DDD entities and value objects. Loaded by `using-triadjs` when schema work is required.
---

# Schema DSL — the `t` namespace

Every schema builder is a subclass of `SchemaNode<TOutput>`. Chainable methods return **new instances**; schemas are immutable. Import the namespace:

```ts
import { t } from '@triadjs/core';
```

## Base metadata methods (on every schema)

| Method | Purpose |
|---|---|
| `.doc(description)` | Human description (→ OpenAPI `description`) |
| `.example(value)` | Example value for docs |
| `.deprecated(flag?)` | Mark deprecated |
| `.default(value)` | Default value — removes field from `required[]` and applies when undefined |
| `.optional()` | Field may be `undefined` — output type becomes `T \| undefined` |
| `.nullable()` | Value may be `null` — output type becomes `T \| null` |
| `.identity(flag?)` | DDD identity marker (emits `x-triad-identity` in OpenAPI) |
| `.storage(meta)` | Persistence hints consumed by `@triadjs/drizzle` — see the `triad-drizzle` skill |

Runtime methods: `.validate(data)` (→ `{ success, data } \| { success, errors }`), `.parse(data)` (throws `ValidationException`), `.toOpenAPI(ctx?)`.

Type inference:

```ts
type Pet = t.infer<typeof Pet>;
```

## Primitives

### Strings

```ts
const email = t.string().format('email').minLength(3).maxLength(255);
const uuid  = t.string().format('uuid');
const slug  = t.string().pattern(/^[a-z0-9-]+$/).minLength(1);
```

**Constraints:** `.minLength(n)`, `.maxLength(n)`, `.pattern(regex)`, `.format(fmt)`.

**Valid formats:** `'uuid' | 'email' | 'uri' | 'url' | 'hostname' | 'ipv4' | 'ipv6' | 'date' | 'date-time' | 'time' | 'duration' | 'byte' | 'binary' | 'password' | 'regex'`.

> Prefer `t.datetime()` over `t.string().format('date-time')` — semantically clearer, identical OpenAPI output.

### Numbers

```ts
const age   = t.int32().min(0).max(120);
const price = t.float64().min(0).multipleOf(0.01);
const bigId = t.int64();
```

**Constraints:** `.min(n)`, `.max(n)`, `.exclusiveMin(n)`, `.exclusiveMax(n)`, `.multipleOf(n)`.

- `int32` — enforces `-2^31..2^31-1`, `Number.isInteger`
- `int64` — enforces `Number.isSafeInteger` (±2^53)
- `float32` / `float64` — require finite numbers

### Other primitives

```ts
const isAdmin  = t.boolean().default(false);
const createdAt = t.datetime().storage({ defaultNow: true }); // ISO 8601 string
const status   = t.enum('available', 'adopted', 'pending');
const kind     = t.literal('pet');                             // type: 'pet'
const details  = t.record(t.string(), t.unknown()).optional(); // any value
```

### `t.empty()` — for 204/205/304 responses

```ts
responses: { 204: { schema: t.empty(), description: 'Deleted' } }
handler: async (ctx) => {
  await ctx.services.petRepo.delete(ctx.params.id);
  return ctx.respond[204](); // zero arguments — passing a body is a compile error
}
```

`t.empty()` omits the `content` field from the OpenAPI response (per spec), narrows `ctx.respond[status]` to a zero-arg function, and tells adapters to send no body and no `Content-Type`. **Do NOT** use `t.unknown().optional()` — that was the pre-Phase-10.2 workaround and is obsolete.

### `t.file()` — multipart uploads

```ts
import { t, type TriadFile } from '@triadjs/core';

const AvatarUpload = t.model('AvatarUpload', {
  name: t.string().minLength(1),
  avatar: t.file()
    .maxSize(5 * 1024 * 1024)
    .mimeTypes('image/png', 'image/jpeg'),
});
```

**Constraints:** `.minSize(bytes)`, `.maxSize(bytes)`, `.mimeTypes(...types)`.

Any endpoint whose `request.body` contains at least one `t.file()` field auto-routes through multipart parsing on every adapter and auto-emits `multipart/form-data` content in OpenAPI. Handlers see the field as a typed `TriadFile` (`{ name, mimeType, size, buffer }`).

> **Security:** `TriadFile.mimeType` is whatever the client declared — never trust it for security-sensitive decisions. Sniff `file.buffer` yourself if the decision matters.

## Collections

```ts
const tags  = t.array(t.string()).minItems(1).maxItems(50).uniqueItems();
const hdrs  = t.record(t.string(), t.string());           // { type: 'object', additionalProperties }
const point = t.tuple(t.float64(), t.float64());          // [number, number]
const idUnion = t.union(t.string().format('uuid'), t.int64()); // oneOf
```

> `t.array(schema).optional()` makes the **field** optional. To allow `null` items, do `t.array(t.string().nullable())`.

> `t.record`'s first argument MUST be a `StringSchema` (used for key-shape validation).

> `t.union` tries each option in order; first success wins.

## Models and Value Objects (DDD)

### `t.model(name, shape)` — entities

Models are **entities** — things with identity and lifecycle. They emit `$ref` components in OpenAPI.

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

**Derived-model operations** (all return new instances, none mutate):

| Method | Effect |
|---|---|
| `.pick('a', 'b')` | Keep only those fields |
| `.omit('a', 'b')` | Drop those fields |
| `.partial()` | Make every field optional |
| `.required()` | Make every field required |
| `.extend({ field: ... })` | Add fields (overwrites existing names) |
| `.merge(otherModel)` | Merge two models |
| `.named('NewName')` | Rename the derived model |
| `.identityField()` | Returns the name of the `.identity()` field |

**Canonical request-DTO pattern:**

```ts
export const Pet = t.model('Pet', { /* ... */ });
export const CreatePet = Pet.pick('name', 'species', 'age', 'tags').named('CreatePet');
export const UpdatePet = Pet.pick('name', 'age', 'tags').partial().named('UpdatePet');
```

> **Always `.named('XyzName')` when you derive.** Otherwise the component in OpenAPI keeps the parent's name and collisions become silent.

### `t.value(name, inner)` — value objects

Value objects are **value semantics** — no identity, immutable by convention. Two shapes:

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
- Cannot be referenced from `body matches` assertions (only models can).

### When to use which

- **Entity with an `id` field** → `t.model`. Repositories return them. Can be `.pick`ed for DTOs.
- **Reusable, comparable-by-value shape** (Email, Money, DateRange, PhoneNumber) → `t.value`.
- **Request DTOs** (`CreatePet`, `UpdatePet`) → derived from a `t.model` via `.pick/.partial/.named`.

## Checklist when adding a new schema

1. Is it an entity (has identity) or a value (compare-by-value)? → `t.model` vs `t.value`.
2. Does it need to become a DB table? Add `.storage({ primaryKey: true })` to the ID field and other `.storage()` hints to persistent fields — see `triad-drizzle`.
3. Are request DTOs needed? Derive with `.pick/.omit/.partial/.named`, never redefine.
4. Are enum values stable? If they might change, consider `t.string()` + runtime checks instead.
5. Does any field carry sensitive data? Use `.doc()` to flag it; downstream tooling can redact.
6. Type inference working? `type X = t.infer<typeof X>` and hover `ctx.body` in a handler — inference should propagate through `.pick`, `.omit`, `.extend`.
