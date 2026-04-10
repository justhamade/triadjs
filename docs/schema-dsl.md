# Schema DSL Reference

The `t` namespace is Triad's schema builder. Every schema is:

- **Immutable** — chainable methods return new instances
- **Type-inferring** — `t.infer<typeof X>` resolves to the TypeScript type
- **Validating** — `X.parse(data)` throws on invalid input; `X.validate(data)` returns a Result
- **OpenAPI-ready** — `X.toOpenAPI(ctx)` emits a JSON Schema fragment

```typescript
import { t } from '@triad/core';
```

---

## Shared methods (on every schema)

Every schema node inherits these from `SchemaNode`:

| Method                      | What it does                                                           |
|-----------------------------|------------------------------------------------------------------------|
| `.doc(description)`         | Human-readable description (emitted in OpenAPI `description`)          |
| `.example(value)`           | Example value (OpenAPI `example`)                                      |
| `.deprecated(flag?)`        | Mark as deprecated (OpenAPI `deprecated: true`)                        |
| `.default(value)`           | Default value, applied on missing input during validation              |
| `.identity(flag?)`          | Mark a field as the entity identity (DDD; emits `x-triad-identity`)    |
| `.parse(data)`              | Validate + return typed data; throws `ValidationException` on failure  |
| `.validate(data)`           | Validate and return `{ success, data | errors }`                        |
| `.toOpenAPI(ctx?)`          | Emit OpenAPI 3.1 JSON Schema fragment                                  |

Concrete schemas also add `.optional()` and `.nullable()` which widen `TOutput`.

**`.default()` semantics:** if `data === undefined`, the default is substituted before validation proceeds. A default does not short-circuit validation of other fields.

---

## Primitives

### `t.string()`

```typescript
t.string()
  .minLength(1)
  .maxLength(100)
  .pattern(/^[a-z]+$/)
  .format('email')  // uuid, email, uri, url, hostname, ipv4, ipv6,
                    // date, date-time, time, duration, byte,
                    // binary, password, regex
```

`format()` is typed — only valid formats are accepted and `uuid`, `email`, `url`, `date`, `date-time`, `ipv4`, and more are validated at runtime.

### Numeric types

```typescript
t.int32()    // integer, OpenAPI format: int32, range ±2^31
t.int64()    // integer, OpenAPI format: int64, JS safe-integer range
t.float32()  // number,  OpenAPI format: float
t.float64()  // number,  OpenAPI format: double
```

Shared numeric constraints:

```typescript
t.int32()
  .min(0)
  .max(100)
  .exclusiveMin(0)
  .exclusiveMax(1)
  .multipleOf(5)
```

### `t.boolean()`

```typescript
t.boolean().default(true);
```

### `t.datetime()`

ISO 8601 date-time string. Output type is `string` (not `Date`) — API boundaries stay wire-format.

```typescript
t.datetime(); // validates strings like "2026-04-10T12:00:00Z"
```

### `t.enum(...values)`

```typescript
const species = t.enum('dog', 'cat', 'bird', 'fish');
// Inferred type: 'dog' | 'cat' | 'bird' | 'fish'
```

Factory uses `const` type parameters to preserve literal union types.

### `t.literal(value)`

```typescript
const status = t.literal('active'); // type: 'active'
const forty = t.literal(42);        // type: 42
const yes = t.literal(true);        // type: true
```

### `t.unknown()`

Accepts any value. Used for catch-all fields (`Record<string, unknown>`).

```typescript
const metadata = t.record(t.string(), t.unknown());
```

---

## Collections

### `t.array(item)`

```typescript
t.array(t.string()).minItems(1).maxItems(10).uniqueItems();

const pets = t.array(Pet);
// Inferred: Pet[]
```

### `t.record(keySchema, valueSchema)`

```typescript
const headers = t.record(t.string(), t.string());
// Inferred: Record<string, string>

const metadata = t.record(t.string(), t.unknown());
// Inferred: Record<string, unknown>
```

### `t.tuple(...items)`

```typescript
const coordinates = t.tuple(t.float64(), t.float64());
// Inferred: [number, number]

const labeled = t.tuple(t.string(), t.int32(), t.boolean());
// Inferred: [string, number, boolean]
```

Factory uses `const` type parameters so tuple positions stay narrow.

### `t.union(...options)`

```typescript
const idOrError = t.union(Pet, ApiError);
// Inferred: Pet | ApiError
```

At runtime, the union tries each option; if any succeeds, that value is accepted.

---

## Models — the DDD unit

`t.model(name, shape)` is a **named object schema**. Named models produce OpenAPI `$ref` components and establish the ubiquitous language of your API.

```typescript
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
  tags: t.array(t.string()).optional(),
});
```

### Inference

Optional fields become optional TypeScript keys automatically:

```typescript
type Pet = t.infer<typeof Pet>;
// {
//   id: string;
//   name: string;
//   species: 'dog' | 'cat' | 'bird' | 'fish';
//   age: number;
//   tags?: string[];
// }
```

You usually won't need to extract the type explicitly — the endpoint builder infers it for `ctx.body`, `ctx.params`, and `ctx.respond[...]` automatically.

### Composition

```typescript
// Pick fields — for input DTOs
const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

// Omit fields
const PetWithoutTags = Pet.omit('tags');

// All fields optional — for PATCH endpoints
const UpdatePet = Pet.pick('name', 'species', 'age').partial().named('UpdatePet');

// Undo partial — make required again
const RequiredUpdate = UpdatePet.required();

// Extend with new fields
const PetWithOwner = Pet.extend({
  ownerId: t.string().format('uuid'),
  ownerName: t.string(),
}).named('PetWithOwner');

// Merge two models
const Merged = Pet.merge(AnotherModel);

// Rename
const Renamed = Pet.named('DifferentName');
```

All composition methods are immutable — the original model is unchanged.

### Entity identity

Mark the field that uniquely identifies the entity:

```typescript
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(), // ← marks `id` as the identity
  // ...
});

Pet.identityField(); // → 'id'
```

The identity field is emitted in OpenAPI with `x-triad-identity: true` and is used by the test runner to track entities across behavior setup and assertions.

---

## Value objects — `t.value(name, innerOrShape)`

Value objects are immutable, identity-less, and compared by their attributes. Triad supports them as a first-class schema kind — distinct from models.

```typescript
// Wrapping a single primitive
const EmailAddress = t.value('EmailAddress', t.string().format('email'));

// Composite
const Money = t.value('Money', {
  amount: t.float64().min(0),
  currency: t.enum('USD', 'CAD', 'EUR'),
});

const DateRange = t.value('DateRange', {
  start: t.datetime(),
  end: t.datetime(),
});

// Use them inside models
const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  adoptionFee: Money,          // not just `price: number`
  contactEmail: EmailAddress,  // not just `email: string`
});
```

**Differences from models:**

- Always immutable — no `.partial()` / `.required()`
- No entity identity
- OpenAPI output is **inline** (not `$ref`) — value objects describe attributes, not resources

---

## Type inference — `t.infer<typeof X>`

```typescript
const Pet = t.model('Pet', { /* ... */ });

type Pet = t.infer<typeof Pet>;
```

This uses a TS value/namespace merge so `t` is both a runtime value and a type-level namespace. You rarely need this explicit extraction — `ctx.body`, `ctx.params`, and `ctx.respond[...]` infer types automatically inside handlers.

---

## Validation

Every schema exposes `.validate()` and `.parse()`:

```typescript
const result = Pet.validate(someData);
if (result.success) {
  // result.data is typed as Pet
} else {
  // result.errors is an array of { path, code, message }
  for (const err of result.errors) {
    console.log(`${err.path}: ${err.message}`);
  }
}

// Or throw-style
try {
  const pet = Pet.parse(someData);
  // pet is typed as Pet
} catch (e) {
  if (e instanceof ValidationException) {
    console.log(e.errors);
  }
}
```

Error paths use dot/bracket notation: `pets[0].name`, `owner.address.street`.

Validation **collects all errors** — it does not stop on the first failure — so users get the full picture on one response.

---

## OpenAPI emission

```typescript
import { createOpenAPIContext } from '@triad/core';

const ctx = createOpenAPIContext();
const petRef = Pet.toOpenAPI(ctx);
// petRef = { $ref: '#/components/schemas/Pet' }
// ctx.components has the full Pet schema

ctx.components.get('Pet');
// {
//   type: 'object',
//   title: 'Pet',
//   properties: { ... },
//   required: [ ... ]
// }
```

Usually the OpenAPI generator (Phase 3) handles this for you — you don't call `toOpenAPI()` directly.

---

## Best practices

1. **Always name models.** Anonymous inline shapes are fine for params/query/headers but top-level request/response bodies should use `t.model('Name', ...)` — this produces OpenAPI `$ref` components and establishes your ubiquitous language.

2. **Use `.doc()` on every field.** It serves three audiences: OpenAPI consumers, AI coding assistants, and your future self. The cost is zero.

3. **Prefer value objects for domain concepts.** `Money` beats `{ amount, currency }` scattered across five models.

4. **Compose, don't duplicate.** Use `.pick()`, `.omit()`, `.partial()` to derive input DTOs from your canonical model. If you find yourself maintaining two hand-written models that describe the same thing, stop and compose.

5. **Keep schemas in `src/schemas/`.** Separate them from endpoints (`src/endpoints/`) so they're reusable across HTTP, WebSocket channels (Phase 9), and internal code.

6. **Never use `t.unknown()` unless you mean it.** It's an escape hatch for truly open-ended fields (like metadata). For everything else, model the shape.
