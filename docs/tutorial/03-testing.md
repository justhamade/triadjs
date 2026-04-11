# Step 3 — Behaviors, fixtures, and the assertion parser

**Goal:** master the behavior DSL. You already wrote six scenarios in [step 2](02-crud-api.md); now you will understand every piece of them, learn the exact phrases the assertion parser recognises, and add a couple of new scenarios that exercise the `.setup()` + fixtures + placeholder substitution pipeline end-to-end.

Nothing you add in this step changes the shape of Bookshelf — it stays at five endpoints, one `BookRepository`, one bounded context. What changes is your understanding of why `scenario('...').given(...).when(...).then(...)` works the way it does.

## 1. The mental model

In Triad, one declaration produces three artifacts:

```
scenario('An existing book can be retrieved by id')  ────┐
  .given('a book exists')                                │
  .setup(async (services) => { ... })                    │
  .params({ id: '{bookId}' })                            │
  .when('I GET /books/{bookId}')                         │
  .then('response status is 200')                        │
  .and('response body has title "Dune"')                 │
                                                         │
          ┌──────────────────┬──────────────────┐        │
          ▼                  ▼                  ▼        │
  Executable test     Gherkin .feature    Human-readable │
  (in-process)        file                documentation  │
          ▲                  ▲                  ▲        │
          └────────── same source ──────────────┘────────┘
```

There is no separate test file, no separate feature file, no separate doc. The scenario is all three at once. When you change the endpoint, every artifact moves in lockstep because they share the same source object.

This also means scenarios are not "test fixtures that happen to look like docs" — they are first-class declarations of business rules. A failing scenario reports "the `An existing book can be retrieved by id` rule is broken", not "line 217 threw".

## 2. The scenario builder

The full surface of `scenario()` is small. Everything between `.given(...)` and `.when(...)` configures the request; everything after `.then(...)` asserts against the response.

```ts
scenario(name)
  .given(narrative)              // string — appears in Gherkin output
    .setup(async (services) => ({/* fixtures */}))
    .fixtures({/* static key-values */})
    .params({/* path params */})
    .query({/* query string */})
    .headers({/* request headers */})
    .body({/* request body */})
  .when(narrative)               // string — appears in Gherkin output
  .then(assertion)               // parsed assertion
    .and(assertion)              // more parsed assertions
```

Both `.given(...)` and `.when(...)` take free-form narrative strings. They are **not parsed** — they only flow into the generated `.feature` file. If you write `.when('I sacrifice a goat to the dark gods')` the test will still run. The narrative is for humans.

`.then(...)` and `.and(...)` are the opposite: every string passed here goes through a strict parser. If the phrase doesn't match a known pattern, the assertion fails as `Unrecognized assertion`. No silent fallbacks.

## 3. `.setup()` and the fixtures bag

`.setup()` is where you put the "Given" clause's actual state — the rows you want in the database, the users you want registered, the files you want on disk. Its return value becomes **fixtures**.

```ts
scenario('An existing book can be retrieved by id')
  .given('a book exists')
  .setup(async (services) => {
    const book = await services.bookRepo.create({
      title: 'Dune',
      author: 'Frank Herbert',
      publishedYear: 1965,
    });
    return { bookId: book.id };   // ← this object becomes `fixtures`
  })
  .params({ id: '{bookId}' })     // ← '{bookId}' is substituted at run time
  .when('I GET /books/{bookId}')
  .then('response status is 200')
  .and('response body has id "{bookId}"')  // ← substituted here too
```

Two sources of fixtures, merged before substitution:

1. **`.setup()` return value** — dynamic values from the seeded state (usually ids).
2. **`.fixtures({...})`** — static values you just need interpolated. Merged **on top** of the setup return.

The runner calls `.setup()` with a **fresh** `services` object it built by invoking the default export of your `test-setup.ts` module. Between every scenario, the previous `services` is torn down (via `teardown: 'cleanup'`) and a new one is built. There is no shared state. If your test-setup module returns an in-memory `Map`, every scenario gets its own empty `Map`. If it returns a Drizzle client against an in-memory SQLite, every scenario gets its own empty database — which is exactly what [step 4](04-persistence.md) does.

## 4. `{placeholder}` substitution

The runner walks every string it is about to use in the scenario and replaces `{key}` tokens with `String(fixtures[key])`. Substitution happens in:

- `.params({...})` values
- `.query({...})` values
- `.headers({...})` values
- `.body({...})` values (including nested strings)
- **assertion strings** passed to `.then(...)` / `.and(...)`
- narrative strings in `.given(...)` / `.when(...)` (for Gherkin output only)

```ts
.fixtures({ token: 'abc123' })
.headers({ authorization: 'Bearer {token}' })   // → 'Bearer abc123'
.and('response body has user.token "{token}"') // → '... user.token "abc123"'
```

**Special case:** if a string is *entirely one token* (e.g. `'{bookId}'`) and the fixture value is a non-string, the raw value is substituted — so numeric or boolean fixtures stay numeric/boolean rather than getting stringified. This matters for query string numbers and body fields that need to stay as numbers.

```ts
.fixtures({ limit: 10 })
.query({ limit: '{limit}' })    // → query.limit === 10 (number, not "10")
```

If you forget to return a key from `.setup()`, the placeholder will not match anything and the substituted string will be the literal `{key}` — your assertion will fail with a confusing "expected `{bookId}`" message. Check the return value first when this happens.

## 5. The per-scenario run flow

When you run `triad test`, for each scenario the runner:

1. Calls the default export of `test-setup.ts` → fresh `ServiceContainer`.
2. Calls `behavior.given.setup(services)` if defined → merges the return with `.fixtures`.
3. Substitutes `{placeholder}` tokens in body/params/query/headers.
4. Validates each request part against the endpoint's declared schemas. If your scenario's body doesn't match `CreateBook`, the runner reports a scenario error before even calling the handler.
5. Calls `endpoint.handler(ctx)` directly. **No HTTP layer.**
6. Validates the returned body against the declared schema for the returned status code.
7. Runs every `.then[]` assertion against the response.
8. Calls `services.cleanup()` (or whatever `test.teardown` names) in `finally`.

Step 4 is the subtle one: because the runner validates scenario inputs against the endpoint's own schemas, scenario mistakes are caught at `triad test` time, not at `triad docs` time. If you write `.body({ title: 123 })` against `CreateBook`, you'll see a scenario validation failure, not a TypeScript error — so scenarios are also a runtime safety net against schema drift.

## 6. The assertion phrase reference

This is the part to memorize. The parser lives in `packages/core/src/behavior.ts` and runs on every `.then(...)` / `.and(...)` string. Here are the patterns it recognises — if your assertion doesn't match one of these, it fails as `Unrecognized assertion`.

### HTTP response assertions

| Phrase | Meaning |
|---|---|
| `response status is <N>` | Asserts HTTP status code equals `N`. |
| `response body matches <ModelName>` | Validates the whole body against a named `ModelSchema` registered on the router. |
| `response body is an array` | `Array.isArray(body)`. |
| `response body has length <N>` | `body.length === N` (body must be an array). |
| `response body has <path> "<string>"` | Dotted-path equality, string literal. |
| `response body has <path> <number>` | Dotted-path equality, numeric literal. Integers or decimals, negative allowed. |
| `response body has <path> true` / `... false` | Dotted-path equality, boolean literal. |
| `response body has code "<CODE>"` | Shortcut for `body.code === "<CODE>"`. Equivalent to the generic path-has form but conventional for error responses. |

**Dotted paths** work any depth: `response body has user.profile.name "Alice"` reads `body.user.profile.name`. For array indexing: `response body has items.0.id "..."`.

**String literals MUST use double quotes.** Single quotes do not parse. This is the most common assertion-parser mistake.

**`null` as a literal is parsed but almost never what you want.** The parser accepts `response body has foo null` but the recommended pattern is to let the response schema enforce nullability — if the schema says `.nullable()`, the test runner's response-schema validation catches mismatches before the assertion runs.

### Channel message assertions

[Step 6](06-websockets.md) covers channels in full, but the assertion phrases live in the same parser:

| Phrase | Meaning |
|---|---|
| `<clientName> receives a <messageType> event` | Client received at least one `<messageType>` message. |
| `all clients receive a <messageType> event` | Every connected client received it. |
| `<clientName> does not receive a <messageType> event` | Negative assertion (case-insensitive `NOT`). |
| `<clientName> receives a <messageType> with <field> "<value>"` | Most recent `<messageType>` has `field === value`. |
| `message has <field> "<value>"` | Shortcut for "any client, any message type, most recent". |
| `connection is rejected with code <N>` | `onConnect` called `ctx.reject(N, ...)`. |

`<clientName>` is a named client from the channel test harness. When your scenario only has one client, the conventional name is `client`. You already saw this in the petstore chat-room example.

For the full reference including edge cases and negation rules, see [AI agent guide §5.5 and §5.6](../ai-agent-guide.md#55-http-assertion-phrase-reference).

## 7. Common mistakes

Every one of these will fail the parser and produce a "scenario failed" message rather than a passing test:

- **Single quotes around string values.** `'response body has title 'Dune''` → does not parse. Use `'response body has title "Dune"'`.
- **Unquoted string values.** `'response body has title Dune'` → does not parse. Always quote.
- **Expecting negation in `.then(...)`.** There is no `response body does NOT have title "Dune"` for HTTP assertions. Structure the scenario so the positive assertion is what you want, or use a custom matcher.
- **Referencing an unregistered model.** `response body matches UnknownThing` fails because the parser checks the router's model registry. Add it to the context's `models[]` or the reference endpoint.
- **Forgetting the `return` in `.setup()`.** `.setup(async (services) => { await services.bookRepo.create(...) })` runs but contributes no fixtures. Writing `{bookId}` downstream gives you the literal string `{bookId}`.
- **Mismatching fixture keys.** The fixture you returned is `bookId`, but you wrote `{id}` in the path. Capitalisation and underscores matter.

## 8. A worked example — add a negative-path scenario

Extend `updateBook` in `src/endpoints/books.ts` with a scenario that confirms updates on missing books return 404:

```ts
// Inside updateBook's behaviors array:
scenario('Updating a missing book returns 404')
  .given('no book exists with the requested id')
  .fixtures({ bookId: '00000000-0000-0000-0000-000000000000' })
  .params({ id: '{bookId}' })
  .body({ title: 'This will not happen' })
  .when('I PATCH /books/{bookId}')
  .then('response status is 404')
  .and('response body has code "NOT_FOUND"'),
```

Three things worth pointing out:

1. No `.setup()` — the scenario is about an id that doesn't exist, so there's nothing to seed. A static fixture is enough.
2. The literal UUID is valid enough to pass the `t.string().format('uuid')` param validation. If you used `'bogus'`, you would get a scenario validation error at step 4 of the run flow and never reach the handler.
3. The error assertion uses the `response body has code "..."` shortcut.

Run:

```bash
npx triad test
```

Seven passing scenarios now.

## 9. Filtering and Gherkin export

To run only scenarios that belong to a specific endpoint:

```bash
npx triad test --filter updateBook
```

The `--filter` flag does a substring match on the endpoint's `name`. Useful while iterating on a single rule.

To generate the Gherkin feature files:

```bash
npx triad gherkin
```

This writes `generated/features/library.feature` (one file per bounded context). The content is deterministic — same scenarios in, same file out — so you can check the output in and diff it on every PR. A slice:

```gherkin
Feature: Library

  Scenario: An existing book can be retrieved by id
    Given a book exists
    When I GET /books/{bookId}
    Then response status is 200
    And response body has title "Dune"
```

The `{bookId}` placeholder is preserved in Gherkin output because the narrative text is only substituted for humans reading the generated file, not for the parser. Give these `.feature` files to a product manager or a non-engineer on your team — they are guaranteed to be current because they are generated.

## 10. Debugging a stubborn scenario

When a scenario refuses to pass:

1. **Read the exact error message.** The runner prints the scenario name, the assertion text, and the actual value. Don't skim.
2. **Is the phrase parseable?** If the message says `Unrecognized assertion`, the phrase isn't in the table above. Rewrite it.
3. **Is the fixture returned?** Put a `console.log` inside `.setup()` and confirm the return value has the key you think it does.
4. **Is the endpoint's request schema being violated?** Scenario validation fails before the handler runs. Check that your `.body({...})` matches the model exactly.
5. **Has the response schema drifted?** If the handler returns data that doesn't match the declared 200 schema, the runner fails before any `.then[]` assertion. The fix is usually in the handler or the schema, not the scenario.

The runner is strict, but strictness is the whole point: the scenario is a business rule, and a business rule that silently passes is worse than one that loudly fails.

## Next up

[Step 4 — Persistence](04-persistence.md). Your scenarios all work against an in-memory `Map` right now. You will swap the `BookRepository` for a Drizzle-backed implementation against better-sqlite3 without rewriting a single scenario or handler. Then you will use `triad db generate` to emit the same Drizzle schema from `.storage()` hints on your `Book` model.
