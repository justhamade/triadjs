---
description: Add a new HTTP endpoint to an existing TriadJS router — request/response schemas, handler, auth via `beforeHandler` if needed, and behavior scenarios.
---

Load the `triad-endpoint` skill for the `endpoint()` signature and patterns. Load `triad-behaviors` for the assertion phrase table. If the endpoint needs auth, load `triad-schema` for the `ApiError` pattern.

Add a new endpoint to the project based on the user's description ($ARGUMENTS).

## Steps

1. **Identify the target file.** Either `src/endpoints/<resource>.ts` (add a new `export const`) or create a new file if the resource is new.

2. **Define the `endpoint()` config**:
   - `name` — unique across the whole router (used as `operationId`)
   - `method` — one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`
   - `path` — Express-style (`/pets/:id`)
   - `summary` — one-line human description
   - `tags` — `['<BoundedContext>']`
   - `request` — `body`, `params`, `query`, `headers` as appropriate
   - `responses` — every status the handler can return, each with `{ schema, description }`
   - `handler` — thin; parse `ctx.body/params/query`, call a repository on `ctx.services`, return `ctx.respond[status](body)`
   - `behaviors` — at least one happy-path scenario and `...scenario.auto()`

3. **Request schemas** — use inline shapes (`params: { id: t.string() }`) for one-off shapes, or named `ModelSchema`s when they should appear as OpenAPI components.

4. **Response schemas** — reuse the existing `Pet`/`ApiError`/etc. Derive with `.pick(...)`/`.partial()` if needed. Every 4xx response uses the project-wide `ApiError` model.

5. **204 No Content** — use `t.empty()`, never `t.unknown().optional()`. Call `ctx.respond[204]()` with zero args.

6. **If auth is needed** — use `beforeHandler: requireAuth`. Do NOT declare `authorization` in `request.headers` — the beforeHandler reads `ctx.rawHeaders` before validation. Make sure `401: { schema: ApiError, description: '...' }` is in `responses`.

7. **Add at least one behavior** that covers the happy path, plus `...scenario.auto()` for boundary/missing/enum/type coverage for free. Every assertion string must come from the `triad-behaviors` phrase table. Strings use **double** quotes. `null` is not supported — let the response schema enforce nullability.

8. **Register the endpoint** in `src/app.ts`:
   ```ts
   router.context('Pets', { ... }, (ctx) => ctx.add(createPet, getPet, listPets, /* newly added */ yourEndpoint));
   ```

9. **Verify**:
   - `triad validate --strict` — catches duplicate names, missing responses, out-of-context models
   - `triad test --filter yourEndpoint` — runs just the new endpoint's behaviors

## Rules

- Every branch of the handler `return ctx.respond[status](body)`. Falling off the end returns `undefined` and the test runner treats it as a schema failure.
- Never cast `ctx.body`, `ctx.params`, `ctx.query`, or `ctx.services`. If you need a cast, the schema is wrong — fix the schema.
- Never parse the `authorization` header in the handler. Use `beforeHandler`.
- Handlers are thin. Business logic lives in repositories/services, not in endpoint files.
- `ctx.respond[201]` (no call) is a type — `ctx.respond[201](body)` is the correct form.

After adding the endpoint, run `triad test --filter <name>` and report results. If any scenario fails, fix the schema or assertion phrasing before continuing.
