# Working with AI coding assistants

Triad is designed so that an AI agent can understand the whole API by reading one place. This guide is the practical manual for making that promise pay off — how to brief Claude Code, Cursor, Copilot, Aider, and their cousins so they produce idiomatic Triad code on the first try instead of plausible-looking code that fails to parse.

The canonical reference agents should read is [`docs/ai-agent-guide.md`](../ai-agent-guide.md). This guide tells you **how** to feed it to a tool, **when** to invoke it, and **what** to watch for in the output.

---

## 1. What the AI agent guide is

[`docs/ai-agent-guide.md`](../ai-agent-guide.md) is a ~1400-line source-grounded reference covering every public Triad API an agent might touch: the `t` namespace, `endpoint()`, `channel()`, `scenario()`, the assertion phrase table, `ServiceContainer` augmentation, the CLI, the Drizzle bridge, DDD mappings, and a catalogue of common pitfalls. Every section is mirrored against real source files in `packages/core/`, `packages/test-runner/`, and `packages/cli/`.

It exists because a handful of Triad behaviors are too subtle for an agent to get right from examples alone:

- **The behavior assertion parser is heuristic.** A phrase like `'response body has name "Buddy"'` is parsed into a real assertion; `'expect body.name to equal Buddy'` falls through to a custom matcher that silently never runs. The guide documents the phrase table so agents do not guess.
- **`ctx.respond[n]` is typed per endpoint.** Agents used to Express or Nest want to `return res.status(201).json(...)` or cast their way to a response. The guide is emphatic that `ctx.respond[201](body)` is the only correct form and declares 201 at compile time.
- **`beforeHandler` is a first-class extension point, not middleware.** Agents trained on Express want to write `app.use(requireAuth)`. Triad's model is `beforeHandler: requireAuth` on the endpoint, with typed state flowing into `ctx.state`. The guide has a worked example.
- **`.storage()` metadata affects codegen.** Agents that do not know about the Drizzle bridge will omit `primaryKey: true` and quietly break `triad db generate`. The guide has the options table.
- **`checkOwnership` is a utility, not a convention.** The ownership helper returns `{ ok, reason }` and explicitly refuses to pick 403 vs 404 for you. Agents want to collapse the decision; the guide tells them not to.

If you are briefing an agent without pointing it at the guide, you are asking it to reinvent these rules.

---

## 2. When to use the agent guide

**Always** at the start of a new conversation with any agent working inside a Triad project. The first instruction should be "Read `docs/ai-agent-guide.md` before writing any code."

**Always** when asking the agent to generate new endpoints, channels, schemas, or behaviors.

**Always** when asking the agent to refactor existing Triad code that touches `endpoint()`, `scenario()`, or `beforeHandler`.

**Skip** for pure infrastructure changes: Dockerfiles, GitHub Actions, `tsconfig.json`, `package.json` scripts. The guide adds no value to these tasks and eats context budget.

**Skip** for isolated bug fixes in non-Triad code paths (e.g., fixing a typo in a migration script, updating a dependency version).

**Partial** for small edits where one or two sections are relevant: tell the agent which section to read (see §8).

---

## 3. Setup per tool

All of the following share one idea: make `docs/ai-agent-guide.md` part of the agent's standing context so it pulls from the guide when it is uncertain instead of hallucinating.

### Claude Code

Put a `CLAUDE.md` at the root of your Triad project. Claude Code picks it up automatically.

```markdown
# CLAUDE.md

This is a Triad framework project. Before writing any API code, read:
- docs/ai-agent-guide.md — canonical API reference
- docs/ddd-patterns.md — repository, aggregate, and bounded context patterns
- docs/drizzle-integration.md — storage layer conventions
- examples/petstore — reference implementation closest to this project

Project rules:
- Every endpoint must have a behaviors: [] array. Scenarios ARE the tests.
- Never hand-write openapi.yaml. Run `triad docs`.
- Auth goes in beforeHandler, not in the handler body. Read ctx.state.user.
- Never cast ctx.services — augment `ServiceContainer` via `declare module '@triadjs/core'`.
- Never redefine schemas in test files. Import them.
- Use the assertion phrase table in docs/ai-agent-guide.md §5.5.
  Double quotes only. No single quotes in assertion literals.
- Storage hints on Triad models (`.storage({ primaryKey: true })`) drive
  `triad db generate`. Don't remove them unless you know what you're doing.

When unsure about an API name, read docs/ai-agent-guide.md §14 for the
source-file index and follow it to the real source.
```

### Cursor

Put the same content in `.cursorrules` at the project root. Cursor reads it on every request.

### GitHub Copilot

Copilot has no persistent instruction file and relies heavily on open tabs. Keep `docs/ai-agent-guide.md` open in a background tab when writing Triad code. For more structured briefing, use Copilot Chat with a prompt like:

```
Before suggesting code in this project, read docs/ai-agent-guide.md
(I have it open in a tab). The project follows Triad conventions strictly.
```

### Aider

Pass the guide on the command line or in config:

```bash
aider --read docs/ai-agent-guide.md src/endpoints/books.ts
```

Or in `.aider.conf.yml`:

```yaml
read:
  - docs/ai-agent-guide.md
  - docs/ddd-patterns.md
```

Aider's `--read` includes the file as read-only context — it will not try to edit the guide, just consult it.

### Generic pattern

For any tool that accepts either a system prompt or a file-reference context, the instruction is the same:

1. Tell it the project is a Triad framework project.
2. Point it at `docs/ai-agent-guide.md` before any code generation.
3. List the project-specific invariants (auth, DB, test conventions).
4. Tell it to read the real source (under `packages/core/src/`) when the guide is ambiguous.

---

## 4. The prompt stack

Every task an agent handles in a Triad project should see three layers of context, in this order:

```
┌──────────────────────────────────────────────┐
│ Layer 1 — Project file (CLAUDE.md / cursor)  │  standing instructions
├──────────────────────────────────────────────┤
│ Layer 2 — Task description                   │  what you want right now
├──────────────────────────────────────────────┤
│ Layer 3 — docs/ai-agent-guide.md             │  source of truth on ambiguity
└──────────────────────────────────────────────┘
```

**Layer 1** sets defaults that apply to every interaction in the project. This is where you encode team conventions: "we use the tasktracker's auth pattern," "every endpoint is protected by default," "we prefer snake_case database columns." Agents do not re-derive these from the codebase — they read the file.

**Layer 2** is the single-task prompt you type at the start of a conversation. This layer modifies Layer 1 for the current session: "for this endpoint, allow anonymous access." Layer 2 always wins where it contradicts Layer 1.

**Layer 3** is the API reference the agent consults when it is not sure how to spell something. You never re-type the contents of Layer 3 in a prompt — you just make sure the agent knows it exists and is load-bearing.

The most common failure mode is skipping Layer 3 and watching the agent invent APIs that look right but are not in the source. The second most common is skipping Layer 1 and having to repeat project conventions every time.

---

## 5. Workflow recipes

Six ready-to-paste prompts for the most common Triad tasks. Each one is designed to be dropped into Claude Code, Cursor, or any agent that can read files — paste, edit the project-specific details, send.

### Recipe 1: Add a new endpoint

**When to use it**: any time you need a new HTTP endpoint in an existing bounded context.

**Prompt**:

```
I want to add a POST /books/:bookId/reviews endpoint to the Library
bounded context. Requirements:

- Protected by requireAuth (see src/auth.ts).
- Creates a Review with rating (1-5) and comment (minLength 10).
- Only the owner of the book can create reviews. Use checkOwnership
  from @triadjs/core; on failure return 403 for forbidden, 404 for
  not-found. Distinguish them — do not collapse.
- Returns: 201 with the created Review, 400 validation, 401 missing
  token, 403 not owner, 404 book not found.
- Include 3 behavior scenarios: happy path, forbidden, not found.
  Use only the assertion phrases in docs/ai-agent-guide.md §5.5.
  Double quotes only.

Read docs/ai-agent-guide.md first, paying attention to §3 (endpoints),
§5 (behaviors), §6 (beforeHandler), and §12 (common pitfalls). Do not
invent identifiers — every public name must come from @triadjs/core or
existing code in this repository.

Write the endpoint as one file under src/endpoints/reviews.ts and
register it in src/app.ts. Do not touch anything else.
```

**What good output looks like**:

- Exactly one endpoint export with `beforeHandler: requireAuth`.
- `ctx.state.user.id` used directly (no `.ok` check, no casts).
- Three `scenario(...)` entries using phrases from the table.
- `ctx.respond[201](review)`, `ctx.respond[403](apiError)`, `ctx.respond[404](apiError)`.
- No schema redefinitions — `Review` imported from `src/schemas/`.

**Red flags**:

- A custom assertion phrase like `"body.review.rating should be 5"`. The parser cannot handle this.
- `(ctx.services as any).reviewRepo`. Missing `ServiceContainer` augmentation.
- `request.headers: { authorization: t.string() }`. Auth lives in `beforeHandler`, not in the request shape.
- `return { status: 201, body: review }`. Should be `ctx.respond[201](review)`.
- A `test-fixtures.ts` file that duplicates the `Review` schema.

### Recipe 2: Add a bounded context

**When to use it**: introducing a new DDD aggregate and its endpoints as a distinct context.

**Prompt**:

```
Add a new "Ratings" bounded context to this project. It should contain:

- One aggregate: Rating (id, bookId, userId, stars, createdAt).
- One repository: RatingRepository under src/repositories/.
- One endpoint: POST /ratings under src/endpoints/ratings.ts.
- Registration in src/app.ts via router.context('Ratings', { ... }, ...).

Follow the DDD patterns in docs/ddd-patterns.md. Register the context
with a models[] list containing only the Ratings context's own models
plus ApiError. Do not touch the Library context.

Read docs/ai-agent-guide.md §2 (schemas), §3.4 (bounded contexts),
§6 (services), and §10 (Drizzle bridge) before writing code.

If the project uses @triadjs/drizzle (check package.json), add
.storage({ primaryKey: true }) on the id field and .storage({ indexed: true })
on bookId. Otherwise skip the .storage() calls.

Augment ServiceContainer in src/services.ts for the new repository.
```

**Red flags**: the agent registers the new context's models under an existing context, or skips `router.context()` and flattens endpoints into the root.

### Recipe 3: Convert REST to a channel

**When to use it**: you want a real-time version of an existing HTTP endpoint without removing the HTTP path.

**Prompt**:

```
The POST /books/:bookId/reviews endpoint is currently HTTP-only. I want
a parallel WebSocket channel at /ws/books/:bookId/reviews that broadcasts
new reviews in real time to clients subscribed to that room.

Keep the existing HTTP endpoint unchanged. Add the channel next to it in
the same bounded context.

Requirements:
- The channel accepts a clientMessage `newReview` with the same payload
  as the HTTP body.
- On message, persist via the same repository and broadcast a serverMessage
  `review` to every client in the room (including the sender).
- onConnect validates that the book exists; reject with 404 otherwise.
- Typed ctx.state via the phantom witness pattern.

Read docs/ai-agent-guide.md §4 (channels) and docs/phase-9-websockets.md
for the design rationale. The Fastify adapter is the only one that
supports channels — verify that this project uses @triadjs/fastify before
starting. If it uses @triadjs/express or @triadjs/hono, stop and tell me.

Do not touch the HTTP endpoint. Do not change tests on the HTTP endpoint.
```

**Red flags**: the agent tries to use `ctx.broadcast` to send to a specific client (should be `ctx.send`), or forgets the phantom witness and ends up with `ctx.state: Record<string, any>`.

### Recipe 4: Refactor to `beforeHandler`

**When to use it**: you have older code with inline auth at the top of each handler.

**Prompt**:

```
src/endpoints/library.ts has three endpoints that begin with:

  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth.response;
  const user = auth.value.user;

Refactor them to use Triad's beforeHandler pattern:
- Move requireAuth onto each endpoint as `beforeHandler: requireAuth`.
- Remove the three-line preamble from each handler.
- Read ctx.state.user in the handler body.
- Remove the `authorization: t.string()` entry from request.headers if
  it is there (it should be — it is the old workaround).

Do not change any behavior. The scenarios should continue to pass.

Read docs/ai-agent-guide.md §3.5 (the bearer auth subsection) and §12
(pitfall #6) before starting.

After refactoring, run `triad test` mentally through the scenarios in
the file and tell me which ones would still pass.
```

**Red flags**: the agent leaves the `authorization` header in `request.headers`, or keeps the three-line preamble as a fallback.

### Recipe 5: Add cursor pagination

**When to use it**: a `GET /things` endpoint returns everything and you want keyset pagination.

**Prompt**:

```
GET /books currently returns every book. Replace it with cursor-based
keyset pagination:

- Query: limit (int32, 1..100, default 20), cursor (string, optional).
- Response shape: { items: Book[], nextCursor: string | null }.
  Define BookPage via Pet-style .named() derivation if useful, or as
  a new model — your call.
- Cursor format: base64url of the last item's createdAt.
- Sort: createdAt ascending.

Look at examples/tasktracker/src/endpoints/tasks.ts for the reference
implementation of this exact pattern. Match its structure — cursor
encoding, the nextCursor computation, and the behavior scenarios
(especially the "subsequent page picks up where the cursor left off"
scenario in docs/ai-agent-guide.md §5.7).

Read docs/ai-agent-guide.md §3.5 (common patterns) and §5 (behaviors)
first. Write at least three scenarios: first page full, last page with
null cursor, and the subsequent-page continuation using a computed cursor.
```

**Red flags**: offset-based pagination instead of keyset; writing a helper that URL-encodes the raw `createdAt` string instead of base64url; using `'...' === null` in a scenario (the parser does not support `null`).

### Recipe 6: Write behavior scenarios for existing code

**When to use it**: you inherited an endpoint file with an empty or thin `behaviors: []`.

**Prompt**:

```
src/endpoints/reviews.ts has an empty behaviors: [] array. Write five
scenarios covering:

1. Happy path — create a review with valid input.
2. Validation failure — comment shorter than minLength.
3. Auth failure — missing bearer token.
4. Ownership failure — user is not the book owner (should return 403
   per this codebase's convention; check src/access.ts).
5. Book not found — 404.

Use only the assertion phrases in docs/ai-agent-guide.md §5.5. Double
quotes only. No null assertions (docs explain the workaround).

For each scenario that needs data, use .setup() to seed the database
through the real repositories in ctx.services. Return a fixtures
object with {token, bookId} and reference them via {placeholder}
substitution. See §5.3 for fixture semantics and §5.7 for a full
worked example.

Do not invent custom matchers. If an assertion cannot be expressed
with the phrase table, tell me which assertion and why.
```

**Red flags**: a scenario that expects `ctx.body` to contain something without first calling `.body({...})`; an assertion using `'...'` single quotes; a scenario that re-declares `Review` instead of importing it.

### Recipe 7: Add a new feature to the framework (contributor workflow)

**When to use it**: you are contributing to Triad itself and want to add a new dialect, a new primitive, or a new assertion phrase.

**Prompt**:

```
I want to add MySQL dialect support to the Drizzle bridge. The SQLite
and Postgres dialects are already implemented.

Read:
- packages/drizzle/src/codegen/emit.ts — dialect profiles
- packages/drizzle/src/codegen/types.ts — the dialect interface
- packages/drizzle/__tests__/ — existing tests

Mirror the Postgres profile onto MySQL. Add:
- A mysql profile in emit.ts matching the shape of sqlite/postgres.
- Type mappings per docs/ai-agent-guide.md §10.3.
- A test file under __tests__/ that mirrors the existing postgres test
  name-for-name.
- A new case in the CLI's dialect flag validation (packages/cli/src/commands/db.ts).

Do not change the sqlite or postgres emitters.
```

---

## 6. Common agent mistakes and how to catch them

Grounded in real failure modes observed while building this project.

### 6.1 Inventing assertion phrases

**What happens**: the agent writes `.then('expect body.name to equal "Buddy"')`. The parser does not recognize it, falls through to `{ type: 'custom' }`, and the assertion fails at runtime as "Unrecognized assertion."

**Why**: agents extrapolate from natural-language testing frameworks (Chai, Jest matchers, RSpec) and do not realize Triad's parser is a fixed phrase table.

**How to catch**: run `triad test`. Unrecognized assertions fail loudly. Also: grep for any `.then('expect` or `.then('body.` — these are agent tells.

### 6.2 Hand-writing OpenAPI

**What happens**: the agent generates `docs/openapi.yaml` or `generated/openapi.yaml` by hand instead of running `triad docs`.

**Why**: agents without the guide do not know Triad has a generator; they assume OpenAPI is a hand-maintained artifact.

**How to catch**: add a CI step that runs `triad docs` and fails on `git diff --exit-code`. If the agent edited the file, CI catches it.

### 6.3 Casting `ctx.services`

**What happens**: the agent does `(ctx.services as any).myThing` or `ctx.services as MyServices` inside a handler.

**Why**: the agent skipped or did not understand the `declare module '@triadjs/core'` augmentation step. Without it, `ctx.services` is `{}` and casting is the only way to compile.

**How to catch**: a grep or lint rule for `ctx\.services as` and `(ctx\.services as any)`. Either is a code-review rejection.

### 6.4 Declaring `authorization` on `request.headers`

**What happens**: the agent writes `request: { headers: { authorization: t.string() } }` to pass auth through. This is the obsolete pre-`beforeHandler` workaround.

**Why**: training data predates the `beforeHandler` API, or the agent saw an old example.

**How to catch**: grep for `authorization:.*t\.string` inside endpoint files. Legitimate uses are rare enough that every match should be reviewed.

### 6.5 Using `t.unknown().optional()` for 204 responses

**What happens**: the agent writes `204: { schema: t.unknown().optional(), description: 'Deleted' }` and calls `ctx.respond[204](undefined)`. Both work, but both are wrong — this is the obsolete pre-Phase-10.2 workaround.

**Why**: agents trained on older Triad docs or older examples will reach for the workaround. They may also carry over patterns from frameworks where "no body" requires an optional placeholder type.

**How to catch**: grep for `t\.unknown\(\)\.optional\(\)` and for `respond\[\d+\]\(undefined\)`. The correct form is `schema: t.empty()` with `ctx.respond[204]()` taking zero arguments. `t.empty()` narrows the respond type (passing a body is a compile error), tells the OpenAPI generator to omit `content` entirely, and tells every adapter to skip the `Content-Type` header.

### 6.6 Duplicating schemas in test fixture files

**What happens**: the agent creates `src/__fixtures__/book.ts` with a second `t.model('Book', {...})` so tests can use a "simpler" shape.

**Why**: habit from frameworks where test fixtures are separate from production models. In Triad, tests import the real schema — scenarios are black-box consumers of the router.

**How to catch**: grep for `t.model(` occurrences. The count should equal the number of schema files, not more.

### 6.7 Business logic in handlers

**What happens**: the agent puts pagination math, ownership checks, notification sending, or derived-field calculation inside the endpoint handler instead of a repository or domain service.

**Why**: agents used to thin frameworks like Express put everything in the route handler by default.

**How to catch**: code review. If a handler is more than ~15 lines, it is probably doing too much. The rule is: parse `ctx.*`, call services, map result to `ctx.respond[n]`. Nothing else.

### 6.8 Forgetting `.storage(...)` on the primary key

**What happens**: `triad db generate` skips the model and the Drizzle schema has no table for it.

**Why**: the agent does not know the bridge needs `primaryKey: true` to treat a model as a table.

**How to catch**: `triad db generate` output does not include the expected table. Also: `triad validate` could flag models with an `.identity()` field but no `.storage({ primaryKey: true })` if you want a CI check.

### 6.9 Returning `undefined` from a branch

**What happens**: a handler has an `if` branch that does not `return ctx.respond[...](...)`. The handler falls off the end, returns `undefined`, and the response-schema validator 500s.

**Why**: not a Triad-specific mistake, just classic missing-return.

**How to catch**: TypeScript's `noImplicitReturns` plus strict mode catch many of these at compile time. The rest show up as 500s in `triad test`.

### 6.10 Mixing HTTP and channel assertion phrases

**What happens**: a channel scenario uses `.then('response status is 200')`. Channels have no response — they have a stream of messages. The assertion is "unrecognized" for channel scenarios.

**Why**: the agent pattern-matches on "scenario" and defaults to HTTP phrasing.

**How to catch**: review any `behaviors: [...]` inside a `channel(...)` block. Every `then` must come from the channel phrase table in [`docs/ai-agent-guide.md` §5.6](../ai-agent-guide.md#56-channel-assertion-phrases).

---

## 7. When NOT to use an agent

Some decisions are not ready for automation, no matter how carefully you brief the agent.

- **Domain modeling**. The agent will pick plausible-shaped aggregates (`User`, `Post`, `Comment`) that do not match your business. Bounded contexts, aggregate roots, and the name of every entity are product decisions. Do them yourself; use the agent to implement them.
- **Product choices**. 404 vs 403 on ownership failure, enum values, the contents of an error envelope, which fields are optional, what the success status code is. These feel like mechanical choices but they are product decisions with consequences.
- **Team conventions not in code**. Internal deploy pipelines, secret rotation, which branches are protected, why you use SQLite in CI but Postgres in prod. If it is not written down somewhere the agent can read, it will be guessed.
- **Refactors spanning more than ~5 files** unless you have tight tests covering every call site. Multi-file refactors are the scenario where AI agents look most productive and cause the most damage; the surface area is too large to eyeball the diff.
- **Ambiguous failures**. "The tests are flaky" or "something is wrong with the Docker build" are debugging tasks where the agent has no more information than you. Dig in yourself and bring the agent in once you have a reproducible error.

---

## 8. Feeding the agent guide to smaller-context models

`docs/ai-agent-guide.md` is ~1400 lines (~35KB). Current frontier models (Claude, GPT-4-class, Gemini Pro) handle the whole file with room to spare. If you are using a smaller model or a constrained context window, point the agent at the specific sections you need:

```
For this task, read only these sections of docs/ai-agent-guide.md:
- §3 (Endpoints) — the endpoint() signature and HandlerContext.
- §5 (Behaviors) — the assertion phrase table.
- §12 (Common pitfalls) — mistakes specific to this framework.

Skip everything else. The task is to add one endpoint, not a full app.
```

Section numbers are stable — they come from the guide's table of contents. The full list is in [`docs/ai-agent-guide.md`](../ai-agent-guide.md) at the top of the file.

When the task is "write a channel," swap §3 for §4. When the task is "add a repository," swap §3 for §6 and §10. When the task is "fix a bug in an existing handler," often §5 and §12 are enough.

---

## 9. Contributing back

The agent guide is intentionally a living document. Every time you find a new failure mode — a phrasing the parser silently ignores, an API name the agent consistently invents, a `.storage()` option the agent fails to apply — add an entry.

- New pitfall → [`docs/ai-agent-guide.md` §12](../ai-agent-guide.md#12-common-pitfalls).
- New recipe or catchable mistake → this file's §5 and §6.
- New subtle API rule → the relevant section of the agent guide, with a link to the source file under `packages/`.

The goal is that after a year of collective use, any agent that reads `docs/ai-agent-guide.md` produces idiomatic Triad code without ever guessing. Your contributions are how we get there.
