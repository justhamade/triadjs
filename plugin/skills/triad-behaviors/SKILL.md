---
name: triad-behaviors
description: Use when writing TriadJS BDD scenarios, wiring `.given().when().then().and()` chains, choosing assertion phrases, using `scenario.auto()` for schema-derived adversarial tests, or debugging "Unrecognized assertion" errors. Authoritative phrase table for the heuristic assertion parser.
---

# Behaviors — the BDD DSL

**This is the most load-bearing skill for writing correct TriadJS code.** The assertion parser is heuristic — phrases that don't match a supported pattern exactly fail with `"Unrecognized assertion"`. The phrase table in §Assertion phrases below is authoritative; don't guess.

## The builder

```ts
import { scenario } from '@triadjs/core';

scenario('Pets can be created with valid data')   // the Scenario: line in Gherkin
  .given('a valid pet payload')                   // narrative string
  .body({ name: 'Buddy', species: 'dog', age: 3 })
  .when('I create a pet')                         // narrative string
  .then('response status is 201')                 // parsed assertion
  .and('response body matches Pet')               // parsed assertion
  .and('response body has name "Buddy"');         // parsed assertion
```

A scenario is documentation, a test, and a Gherkin line in one. Writing an endpoint without behaviors defeats the framework.

## `.given()` stage methods

Everything between `.given(...)` and `.when(...)` sets up the request and the fixture bag.

| Method | Effect |
|---|---|
| `.body(data)` | Sets the request body. Placeholders interpolated from fixtures. |
| `.params({ id: '{petId}' })` | Path params. `{placeholder}` substituted from fixtures. |
| `.query({ limit: 10 })` | Query string. |
| `.headers({ authorization: 'Bearer {token}' })` | Request headers. |
| `.setup(async (services) => { ... })` | Seed the database. Return value is merged into fixtures. |
| `.fixtures({ key: value })` | Inline fixtures (merged on top of `setup()` return). |

## Fixtures and `{placeholder}` substitution

Two sources of fixtures, merged at run time:

1. **`.setup()` return value** — anything it returns becomes fixtures.
2. **`.fixtures({...})`** — static values.

Inside strings, `{key}` is replaced with `String(fixtures[key])`. **Special case:** if a string is *entirely* one token (e.g. `'{petId}'`) and the fixture value is not a string, the raw non-string value is substituted (so numbers stay numbers).

```ts
scenario('Existing pets can be retrieved by ID')
  .given('a pet exists')
  .setup(async (services) => {
    const pet = await services.petRepo.create({ name: 'Rex', species: 'dog', age: 5 });
    return { petId: pet.id };                 // becomes fixtures.petId
  })
  .params({ id: '{petId}' })                  // substituted
  .when('I GET /pets/{petId}')                // substituted for gherkin output
  .then('response status is 200')
  .and('response body has id "{petId}"');     // substituted in assertion value
```

## What the runner does per scenario

From `packages/test-runner/src/runner.ts`:

1. Call `servicesFactory()` → fresh `ServiceContainer` (test isolation).
2. Call `behavior.given.setup(services)` if defined; merge return value with `.fixtures`.
3. Substitute `{placeholder}` tokens in body/params/query/headers.
4. Validate each request part against the endpoint's declared schemas (catches scenario mistakes early).
5. Invoke `endpoint.handler(ctx)` directly — no HTTP, no adapter middleware.
6. Validate the response `body` against the declared schema for the returned status.
7. Run every `then[]` assertion.
8. Call `teardown(services)` in `finally`.

## Assertion phrases — HTTP

Authoritative table. If your assertion isn't here, it WILL fail with "Unrecognized assertion".

| Phrase | What it does |
|---|---|
| `response status is <N>` | Asserts HTTP status code |
| `response body matches <ModelName>` | Validates body against a named `ModelSchema` registered on the router (must be reachable from an endpoint's request or response) |
| `response body is an array` | `Array.isArray(body)` |
| `response body is empty` | `body === undefined` / `null` / `""`. Use on 204 scenarios returning `t.empty()`. An empty object `{}` is NOT considered empty — use `response body matches <EmptyModel>` for that. |
| `response body has length <N>` | `body.length === N` (body must be an array) |
| `response body has <path> "<string>"` | Dotted path equality, string literal |
| `response body has <path> <number>` | Dotted path equality, numeric literal (integers or decimals, negative allowed) |
| `response body has <path> true` / `... false` | Dotted path equality, boolean literal |
| `response body has code "<CODE>"` | Shortcut for `body.code === "<CODE>"` |

**Literal forms:**
- Strings MUST use double quotes: `"Buddy"`, never `'Buddy'`.
- Numbers bare: `42`, `-3.14`.
- Booleans: `true`, `false`.
- **`null` is NOT supported** by the parser. Let the response schema enforce nullability — if the schema says `.nullable()`, a non-null of the wrong type would fail response-schema validation.

**Dotted paths:** `response body has items.length 10` reads `response.body.items.length`.

**Anything else** falls through to `{ type: 'custom' }` — which fails at run time unless a `customMatchers` entry is registered. The runner's stance is: no silent passes.

### Phrases that DO NOT work (common mistakes)

- ❌ `"response body.name should equal 'Buddy'"` → use `'response body has name "Buddy"'`
- ❌ `"expect body.name to be Buddy"` → same
- ❌ `"body.name == Buddy"` → same
- ❌ `"response body has name 'Buddy'"` (single quotes) → use double quotes
- ❌ `"status is 201"` → use `"response status is 201"`
- ❌ `"response body has name null"` → not supported, use `.nullable()` on the schema

## Assertion phrases — channels

For WebSocket channels the assertions operate on received messages rather than HTTP responses.

| Phrase | Meaning |
|---|---|
| `<clientName> receives a <messageType> event` | Client received a message of that type |
| `all clients receive a <messageType> event` | Every connected client received it |
| `<clientName> does not receive a <messageType> event` (case-insensitive `NOT`) | Negative assertion |
| `<clientName> receives a <messageType> with <field> "<value>"` | The most recent `<messageType>` has `field === value` |
| `message has <field> "<value>"` | Equivalent to "any client, any message type, most recent" |
| `connection is rejected with code <N>` | `onConnect` called `ctx.reject(N, ...)` |

`<clientName>` is a named client in the channel test harness. `"client"` is conventional when you only have one.

## A full worked example

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

## `scenario.auto()` — schema-derived adversarial tests

Add one line to any endpoint's behaviors array and the framework generates boundary, missing-field, invalid-enum, type-confusion, and random-fuzzing scenarios from the schema constraints you already declared:

```ts
behaviors: [
  // Your business-logic scenarios
  scenario('creates a pet with valid data')
    .body({ name: 'Rex', species: 'dog', age: 3 })
    .when('I create a pet')
    .then('response status is 201'),

  // Framework-generated boundary scenarios
  ...scenario.auto(),
]
```

What it generates:

| Category | Tests | Example |
|---|---|---|
| `[auto:missing]` | One per required field, that field removed | `name` missing → 400 |
| `[auto:boundary]` | ±1 at every `min`/`max`/`minLength`/`maxLength` | `age: -1` when `min(0)` → 400 |
| `[auto:enum]` | One per enum field with an invalid value | `species: 'lizard'` → 400 |
| `[auto:type]` | One per field with wrong JS type | `age: "not a number"` → 400 |
| `[auto:valid]` | N random valid inputs via fast-check | random valid body → not 500 |

**Configuration:**

```ts
...scenario.auto()                    // all categories, 10 random
...scenario.auto({ randomValid: 0 })  // deterministic only (no fast-check needed)
...scenario.auto({ boundaries: false }) // skip boundary tests
...scenario.auto({ seed: 42 })        // reproducible random generation
```

**CLI alternatives** (no code changes):
- `triad fuzz` — generates auto scenarios for every endpoint, good for CI gates
- `triad validate --coverage` — warns about missing boundary coverage

> **`scenario.auto()` generates boundary tests; you write business-logic tests.** The two are complementary — the framework catches what you'd never think to test (`name: ""` at `minLength(1)`), and you catch what the framework can't know (duplicate names should be rejected).

> `fast-check` is an optional peer dep. When not installed, the `[auto:valid]` random category is silently skipped. All deterministic categories work without it.

## Checklist when writing behaviors

1. Does every assertion phrase match a row in the phrase table? If not, rewrite it BEFORE running the test.
2. Are strings in assertions wrapped in `"double quotes"`? Single quotes fail.
3. Are fixtures substituted where they need to be? Check `.params({ id: '{petId}' })`, not `.params({ id: petId })`.
4. Does the scenario name describe business intent, not mechanics? Good: `"Duplicate pet names are rejected"`. Bad: `"POST /pets returns 409"`.
5. Is `...scenario.auto()` added to the behaviors array to catch schema boundary regressions?
6. For channels: is there a `customClients()` call if you need multiple named clients?
