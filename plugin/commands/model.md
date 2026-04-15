---
description: Add a new TriadJS `t.model` (or `t.value`) to an existing project, along with derived request DTOs (`CreateX`, `UpdateX`) and the models[] entry in the bounded context.
---

Load the `triad-schema` skill for authoritative rules on `t.model` vs `t.value`, derivation operators, and `.storage()` hints.

Add a new model or value object to the project based on the user's description ($ARGUMENTS).

## Steps

1. **Decide model vs value object.** Entities with identity → `t.model`. Comparable-by-value shapes (Email, Money, DateRange) → `t.value`. If unsure, default to `t.model`.

2. **Place the file** in `src/schemas/<resource>.ts`. If a schemas directory doesn't exist, create it.

3. **Include derivations** when appropriate:
   - `CreateX = X.pick(...).named('CreateX')` — omit identity/audit fields, keep user-supplied fields
   - `UpdateX = X.pick(...).partial().named('UpdateX')` — make every updatable field optional

4. **Identity field** should have **both** `.identity()` and `.storage({ primaryKey: true })` if the model will become a DB table:
   ```ts
   id: t.string().format('uuid').identity().storage({ primaryKey: true })
   ```

5. **Add `.storage()` hints** to persistent fields per the `triad-drizzle` skill: `indexed`, `unique`, `references`, `defaultNow`, `defaultRandom`, `columnName`.

6. **Update the bounded context's `models[]`** in `src/app.ts` so `triad validate` recognizes the model as part of the context's ubiquitous language.

7. **Run `triad validate`** to confirm the new model doesn't break any consistency checks.

8. If the project uses persistence (`src/db/schema.generated.ts` exists), run `triad db generate` to regenerate the Drizzle schema.

## Rules

- Always `.named('NewName')` when deriving. Unnamed derivations collide with the parent in OpenAPI.
- Never define a model inside a test file — tests import the real model.
- Value objects (`t.value`) cannot be used with `body matches` assertions — only models can.
- Use `t.datetime()` rather than `t.string().format('date-time')`.
- Use `t.empty()` only for response slots (204/205/304), never for fields.

After adding the model, print the diff summary and suggest a follow-up: "Add an endpoint that uses `<Model>` via `/triadjs:endpoint`."
