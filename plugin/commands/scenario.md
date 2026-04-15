---
description: Add BDD behavior scenarios to an existing TriadJS endpoint or channel. Writes `.given().when().then()` chains using only valid assertion phrases from the parser table.
---

Load the `triad-behaviors` skill — it carries the authoritative assertion phrase table, fixture syntax, and `scenario.auto()` reference. Do NOT invent phrases — unrecognized strings fail as `"Unrecognized assertion"`.

Add behavior scenarios to an existing endpoint or channel based on the user's description ($ARGUMENTS).

## Steps

1. **Locate the target endpoint or channel**. If the user gives a name, grep for `name: 'thatName'`. If they describe the resource, find the matching file in `src/endpoints/` or `src/channels/`.

2. **Understand the business intent first.** A scenario name should describe business intent, not mechanics:
   - Good: `"Duplicate pet names are rejected within the same species"`
   - Bad: `"POST /pets returns 409 when name is taken"`

3. **Write the `.given()` stage** — seed fixtures via `.setup(async services => { return { foo: ... } })` if the scenario depends on existing state, or use `.fixtures({...})` for static values.

4. **Set the request** — `.body(...)`, `.params(...)`, `.query(...)`, `.headers(...)`. Use `{placeholder}` tokens to interpolate fixtures (e.g. `.params({ id: '{petId}' })`).

5. **Write the `.when()` narrative** — a short string describing the action. This flows to Gherkin but doesn't affect test execution.

6. **Write the `.then()` and `.and()` assertions** — **every phrase must match a row in the phrase table** (see `triad-behaviors` skill):
   - `response status is <N>`
   - `response body matches <ModelName>`
   - `response body has <path> "<string>"` — double quotes, never single
   - `response body has <path> <number>`
   - `response body has <path> true` / `false`
   - `response body has length <N>`
   - `response body is an array`
   - `response body is empty` (for 204/`t.empty()` responses)
   - `response body has code "<CODE>"`

7. **For channels**, use channel phrases instead:
   - `<client> receives a <messageType> event`
   - `all clients receive a <messageType> event`
   - `<client> does not receive a <messageType> event`
   - `<client> receives a <messageType> with <field> "<value>"`
   - `connection is rejected with code <N>`

8. **Consider adding `...scenario.auto()`** at the end of the behaviors array if it's not already there — it generates missing-field/boundary/enum/type scenarios from the schema constraints for free.

9. **Run `triad test --filter <name>`** to verify every new scenario parses, seeds correctly, and passes.

## Rules

- Phrases use **double quotes** for string literals. Single quotes fail.
- `null` is NOT a supported assertion value — let the response schema enforce nullability.
- Scenarios must not redefine schemas. They import the real models by reference.
- `.setup()` must `return { key: value }` for fixtures to be available. Side-effect-only setups contribute no fixtures.
- `.then('response status is 201')` is structured; comments and adjectives break the parser.

If a scenario the user wants genuinely can't be expressed with a built-in phrase, they have two options:
1. Register a custom matcher via `createRouter({ matchers: [defineMatcher({...})] })` — see the matcher primitive in `@triadjs/core`.
2. Drop to plain `vitest` for that one test. Triad's behaviors are a first-class layer; nothing stops you from adding a parallel `*.test.ts` file for edge cases.

After adding the scenarios, print a short summary of what was added and run `triad test --filter <endpointName>` to verify.
