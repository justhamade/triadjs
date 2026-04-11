# Triad Roadmap

Triad is built in phases. Each phase has a single commit boundary. Phases land in order — do not skip ahead.

## Phase 1 — Schema DSL ✅

**Status:** Shipped (`8439b6d`).

`@triad/core/schema` — immutable schema builders, runtime validation, OpenAPI 3.1 emission.

- Primitives: string (typed `.format()`), int32/int64/float32/float64, boolean, datetime, enum, literal, unknown
- Collections: array, record, tuple, union
- DDD: `ModelSchema` with pick/omit/partial/required/extend/merge/named/identity; `ValueSchema` for value objects
- `t` namespace with const-generic factories
- Type-level `t.infer<typeof X>` via namespace merge
- 112 tests passing

## Phase 2 — Endpoint, Behavior, Router ✅

**Status:** Shipped.

`@triad/core` additions:

- `behavior.ts` — `scenario(description).given(...).when(...).then(...).and(...)` builder
- `context.ts` — `HandlerContext<TParams, TQuery, TBody, THeaders, TResponses>` + `ctx.respond` type-safe response map
- `endpoint.ts` — declarative `endpoint()` function with full generic inference
- `router.ts` — `createRouter()` with `add()` and `context()` for DDD bounded contexts

## Phase 3 — OpenAPI Generator ✅

**Status:** Shipped.

`@triad/openapi` package.

- Router → full OpenAPI 3.1 document
- Named models → `components/schemas` with `$ref`
- YAML / JSON serializers
- Bounded contexts → top-level tags with descriptions; endpoints in a context are auto-tagged
- Express-style `:id` path params converted to OpenAPI `{id}`

## Phase 4 — Gherkin Generator ✅

**Status:** Shipped.

`@triad/gherkin` package.

- Behaviors → Gherkin `.feature` text
- Feature grouping: bounded context (first) → first tag → `Other`
- Body rendered as aligned Gherkin data tables
- Deterministic ordering: contexts in declaration order, tags alphabetical, `Other` last
- `writeGherkinFiles()` helper for writing to disk

## Phase 5 — Behavior Test Runner ✅

**Status:** Shipped.

`@triad/test-runner` package.

- `runBehaviors(router, options)` — in-process runner, no HTTP server
- Per-scenario isolation via `servicesFactory` + `teardown`
- Placeholder substitution (`{petId}`) across body/params/query/headers + assertion values
- Structured assertion executors for every parsed type; **custom assertions fail** unless a matcher is registered
- Response safety net: validates handler output against the declared schema and fails on undeclared status codes
- `registerBehaviors(router, { describe, it })` — test-framework-agnostic adapter for Vitest/Jest
- `defineConfig()` for `triad.config.ts` (picked up by Phase 6 CLI)

## Phase 6.5 — HTTP adapter (Fastify) ✅

**Status:** Shipped.

`@triad/fastify` — mount a Triad `Router` onto a Fastify app.

- `triadPlugin` Fastify plugin registers one Fastify route per Triad endpoint
- Automatic scalar coercion for query/params/headers (`'42'` → `42`, `'true'` → `true`) before validation
- Full request-part validation (params, query, body, headers) with structured `400` errors
- Async `ctx.respond` dispatches to `reply.code(...).send(...)` with outgoing schema validation preserved
- Static services object or per-request services factory for scoped DBs / auth
- Works with Fastify's native `register(plugin, { prefix })` for mount prefixing
- `Router.isRouter()` brand check means routers from jiti-loaded modules still work

### Additional adapters

- **`@triad/express`** ✅ — Shipped. Full HTTP parity with Fastify, byte-for-byte identical error envelopes. No channel support in v1.
- **`@triad/hono`** ✅ — Shipped. Runs on Node (via `@hono/node-server`), Cloudflare Workers, Bun, Deno, and Fastly. No channel support in v1.
- **Koa / NestJS / `node:http`** — Not planned as first-party packages. The router is data (`router.allEndpoints()`) and each adapter is ~300 lines; rolling your own is viable. See the three existing adapters as reference implementations.

## Phase 6 — CLI ✅

**Status:** Shipped.

`@triad/cli` — the `triad` command.

- `triad docs` — generate OpenAPI (YAML/JSON)
- `triad gherkin` — export `.feature` files
- `triad test` — run all behaviors as in-process tests with pretty terminal reporter
- `triad validate` — cross-artifact consistency checks (duplicate names/paths, unknown model refs, bounded-context leakage)
- `triad.config.ts` loaded via jiti (no pre-build step for users)
- `Router.isRouter()` brand for cross-module-graph identity checks
- Kind-based schema walkers so the validator works with jiti-loaded routers

## Phase 7 — Example App ✅

**Status:** Shipped.

`examples/petstore` — full working petstore using Triad.

- 7 endpoints across `Pets` and `Adoption` bounded contexts
- 14 behaviors covering happy paths, edge cases, and cross-aggregate operations
- `Money` value object composed into `Pet`
- In-memory repositories (Drizzle integration is Phase 8)
- Fastify server entry with graceful shutdown
- All four CLI commands work against it (`validate`, `docs`, `gherkin`, `test`)
- End-to-end regression test in `@triad/cli` verifies the whole pipeline on every `npm test` run

### Runner bug caught during Phase 7

The test runner was not validating request parts (params/query/body/headers) through the endpoint's declared schemas. This meant scenarios that omitted `.query()` would see `ctx.query.limit` as `undefined` even when the schema declared `.default(20)` — defaults were never applied. Fixed: runner now validates each request part through its schema, applying defaults and rejecting scenarios with malformed params. Matches the Fastify adapter's behavior.

### Validate noise caught during Phase 7

`triad validate` was flagging synthetic request-part wrappers (`getPetParams`, `listPetsQuery`, etc.) as bounded-context leakage candidates. These are ephemeral URL/transport shapes the endpoint builder creates from inline `request.params`/`request.query` objects, not domain models. Fixed: `collectEndpointModelNames` in validate now only walks `request.body` and `responses[*].schema` — the places where domain models actually appear.

## Phase 8 — Drizzle Storage Bridge ✅

**Status:** Shipped.

`@triad/drizzle` — type helpers and runtime utilities for pairing Triad schemas with Drizzle tables.

- `.storage()` metadata on every `SchemaNode` — `primaryKey`, `unique`, `indexed`, `defaultNow`, `defaultRandom`, `references`, `columnName`, `custom`
- Type helpers `InferRow<table>` / `InferInsert<table>` that extract Drizzle row types without importing Drizzle directly in every file
- `validateAgainst(model, row)` / `validateAgainstSafe(model, row)` — run a DB row through a Triad model at the repository boundary to catch DB ↔ API drift
- `findPrimaryKey(model)` — locate the field marked with `.storage({ primaryKey: true })`
- **Example petstore migrated to real Drizzle + `better-sqlite3`** with the full repository pattern (`rowToApi`/`apiToRow`), per-scenario in-memory DB isolation, `Money` value object split across two integer columns, JSON-text tags, and foreign keys
- All 14 behavior scenarios pass against real SQLite, not an in-memory Map

See [`docs/drizzle-integration.md`](docs/drizzle-integration.md) and the working example in [`examples/petstore`](examples/petstore).

## Phase 8.5 — `triad db generate` ✅

**Status:** Shipped.

- New codegen module in `@triad/drizzle`: `walkRouter` → `TableDescriptor[]`, `emitSqlite` → TypeScript source, `generateDrizzleSchema` as the high-level entry.
- Walker identifies table models by looking for fields with `.storage({ primaryKey: true })`. Derived models (`CreatePet`, `UpdatePet`), input DTOs, and error shapes are automatically excluded.
- Value objects (`Money`) are flattened into prefixed columns (`adoptionFee` + `amount`/`currency` → `adoption_fee_amount`, `adoption_fee_currency`).
- Column types mapped via the schema `kind` discriminator: string→text, int32/int64→integer, float32/float64→real, boolean→integer(boolean), datetime→text, enum→text with enum values, arrays/records/tuples/unions→text (JSON-serialized).
- Storage hints flow through: `defaultNow` → `$defaultFn(() => new Date().toISOString())`, `defaultRandom` → `$defaultFn(() => crypto.randomUUID())`, `references: 'pets.id'` → `.references(() => pets.id)`, `unique`, `columnName` overrides, literal `.default()` values preserved.
- Nested `ModelSchema` fields throw a helpful `CodegenError` pointing at the fix (use a string field with `.storage({ references })`).
- snake_case conversion for column names by default; overridable via `.storage({ columnName })` or the `columnNames` option.
- Table name default: `ModelName.toLowerCase() + 's'`; overridable via the `tableNames` option.
- CLI: `triad db generate [--output <path>] [--dialect sqlite]` loads the config, walks the router, writes a fully-formatted file with a "do not edit by hand" header.
- Example petstore's Adopter and Adoption schemas now carry full `.storage()` hints. Running `triad db generate` against the example produces a working `schema.generated.ts` that type-checks and could replace the hand-written `schema.ts`.

## Phase 8.6 — Postgres dialect ✅

**Status:** Shipped.

- Refactored the codegen IR from SQLite-flavored column types (`'text' | 'integer' | 'real' | 'blob'`) to a **dialect-neutral `LogicalColumnType`** (`'string' | 'uuid' | 'datetime' | 'integer' | 'bigint' | 'float' | 'double' | 'boolean' | 'enum' | 'json'`). Walker picks a logical type per field via `kind` + `numberType` + `format('uuid')` signals. Emitters map logical types to dialect-specific helpers.
- **`emitPostgres`** uses `drizzle-orm/pg-core` with native Postgres types:
  - `t.string().format('uuid')` → `uuid('col')`
  - `t.datetime()` → `timestamp('col', { mode: 'string' })` (string mode matches Triad's `datetime` output type)
  - `t.int64()` → `bigint('col', { mode: 'number' })` (JS numbers, not bigints)
  - `t.float64()` → `doublePrecision('col')`
  - `t.float32()` → `real('col')`
  - `t.boolean()` → `boolean('col')` (native, no mode: 'boolean' hack)
  - `t.array(...)`, `t.record(...)`, `t.tuple(...)`, `t.union(...)`, `t.unknown()` → `jsonb('col')`
  - Enums stay as `text('col', { enum: [...] })` (native `pgEnum` deferred)
  - Foreign keys on uuid columns type-check cleanly: `petId: uuid('pet_id').references(() => pets.id).notNull()`
- CLI `triad db generate --dialect postgres` wired through; `sqlite` remains the default.
- Both dialects share the column call chain, defaults, literal escaping, header, and table structure via a `DialectProfile` pattern. Adding MySQL would mean writing ~15 lines of column-helper mapping.
- 10 new Postgres tests + 1 CLI regression test against the example petstore.

### Deferred (backlog)

These items have clear designs but are not urgent. Any one of them is a good contribution for a new maintainer.

- **MySQL dialect** — add a `MYSQL` DialectProfile to `packages/drizzle/src/codegen/emit.ts`. ~15 lines of column-helper mapping plus import-module override. Biggest decisions: `bigint` mode, how to represent `datetime` (MySQL has both `datetime` and `timestamp` with different behaviors), and whether to lean on native MySQL enum types.
- **Postgres native `pgEnum`** — currently enum columns use `text` + `{ enum: [...] }` for type-level enforcement. Promoting to real `pgEnum` types requires (1) naming them — `pets_species_enum`, or a shared name when values match — (2) deduplicating shared enum definitions across tables, and (3) emitting `pgEnum` declarations above the tables (two-pass emission). Worth doing, non-trivial.
- **CREATE INDEX statements** — `.storage({ indexed: true })` is captured but unused by either emitter. Drizzle takes indexes as a second argument to `sqliteTable` / `pgTable`; follow-up work.
- **Composite primary keys** — `walkRouter` picks up the first primary-key field. Composite keys need a separate representation on `TableDescriptor` and a different emission path.
- **Migration generation** — diff two `TableDescriptor[]` snapshots and emit ALTER statements. The IR is fully dialect-neutral, so a migration tool can walk both sides once and produce dialect-specific SQL.

## Phase 9 — WebSocket Channels 🚧

**Status:** In progress. Core `channel()` function and router integration shipped in Phase 9.1. WebSocket adapter, AsyncAPI generator, test runner extensions, and example chat room are queued as sub-phases.

See [`docs/phase-9-websockets.md`](docs/phase-9-websockets.md) for the full design.

### Phase 9.1 — `channel()` core ✅

**Status:** Shipped.

- `@triad/core/channel-context.ts` — `ChannelConnectContext`, `ChannelMessageContext`, `BroadcastMap`, `SendMap`, `DefaultChannelState`, `ChannelReject`. Type-safe `ctx.broadcast.*` / `ctx.send.*` derived from the `serverMessages` declaration, mirroring the `ctx.respond[status]` pattern used by HTTP endpoints.
- `@triad/core/channel.ts` — `channel()` declarative function. Normalizes inline `connection.params/query/headers` into anonymous `ModelSchema`s the same way `endpoint()` does. Carries a `kind: 'channel'` discriminant and a `Symbol.for('@triad/core/Channel')` brand for cross-module-graph identity checks. Exposes `isChannel(value)` as the canonical identity check.
- **Phantom state witness pattern** — `ChannelConfig<TState, ...>` uses a phantom `state?: TState` field rather than requiring `channel<ChatState>({...})`. This sidesteps TypeScript's partial-inference limitation: providing `<MyState>` explicitly would block inference of `TParams`, `TQuery`, and other generics, forcing users to annotate everything manually. Inferring `TState` from a witness value (`state: {} as ChatState`) keeps every generic inferrable at the same time.
- Router extended — `router.add()` dispatches on `isChannel()` to route items into `rootEndpoints` or `rootChannels`. New methods: `allChannels()`, `findChannel(name)`, `rootChannels`. `contextOf()` now accepts `Endpoint | Channel`. `BoundedContext` gained a `channels: Channel[]` field so a single context can own both HTTP endpoints and WebSocket channels.
- 18 new channel tests + 7 new router tests covering construction, brand checks, structural discrimination, handler type inference (params, data, broadcast, broadcastOthers, send), typed state via the phantom witness, router integration across root and contexts.

### Phase 9.2 — Fastify WebSocket adapter ✅

**Status:** Shipped.

`@triad/fastify` extended with `createChannelHandler` + `ChannelHub`. The existing `triadPlugin` now lazily imports `@fastify/websocket` only when the router declares channels, so HTTP-only routers keep working with no new required peer dependency. Handshake validation reuses the existing `coerceByShape` + `RequestValidationError` pipeline. Broadcast scoping is by resolved path parameters (same-room clients share a group). Outgoing messages validate via `.parse()` so the "no undeclared payload can leak" guarantee extends across the WebSocket boundary. 13 new integration tests with a real Fastify server + `ws` client.

### Phase 9.3 — AsyncAPI 3.0 generator ✅

**Status:** Shipped.

New package `@triad/asyncapi` — the real-time counterpart to `@triad/openapi`. Walks a router's channels and emits a complete AsyncAPI 3.0 document with channels, operations (keyed by `<channelName>.<client|server>.<messageType>` to disambiguate same-named messages across directions), components/schemas (shared with the OpenAPI generator so models appear identically in both docs), WebSocket bindings for header/query declarations, and bounded-context tagging. Channel-local message maps suffix the server entry with `_server` when there's a client/server naming collision. 32 tests.

### Phase 9.4 — Test runner channel support ✅

**Status:** Shipped.

`@triad/core/behavior.ts` extended with four new `Assertion` variants (`channel_receives`, `channel_not_receives`, `connection_rejected`, `channel_message_has`) and matching natural-language parser patterns. `@triad/test-runner` now has `ChannelTestClient`, `ChannelHarness` (in-memory multi-client simulator that mirrors Phase 9.2's `ChannelHub` semantics), and `runChannelBehaviors` / `runOneChannelBehavior`. A heuristic `when` interpreter recognizes "`<name>` connects", "`<name>` sends `<type>`", "`<name>` disconnects", and falls back to sending the first declared clientMessage with `given.body`. 23 new tests.

### Phase 9.5 — Example chat room + CLI integration ✅

**Status:** Shipped.

`examples/petstore` gained a real `chatRoom` channel. New files: `src/schemas/chat.ts`, `src/channels/chat-room.ts`, `src/repositories/message.ts`. The example's router registers the channel inside a new `Chat` bounded context.

`@triad/cli`:
- **`runTest`** now runs both `runBehaviors` (HTTP) and `runChannelBehaviors` (WebSocket) and merges their summaries. The example's `triad test` reports 16 scenarios (14 HTTP + 2 channel).
- **`runDocs`** detects `router.allChannels().length > 0` and emits `asyncapi.yaml` as a sibling of `openapi.yaml` with the same format. Users get both protocol docs from one command.

End-to-end verified with a live two-client WebSocket smoke test:
- Alice and Bob connect → Alice sees Bob's `presence` (joined) event (broadcast-before-registration semantic)
- Alice sends a `sendMessage` → both clients receive the `message` broadcast
- Full pipeline: `t.model()` → `channel()` → router → `triadPlugin` → `@fastify/websocket` → `ws` clients

459 tests across 8 packages passing.

### Deferred (Phase 9 follow-ups backlog)

- **Gherkin output for channels** ✅ — Shipped in Phase 10.
- **`triad validate` channel checks** — cross-reference `clientMessages` handlers, check that `channel_receives` / `channel_message_has` assertions reference declared server message types, warn on bounded-context leakage for channels.
- **Multi-client scenarios in a single behavior** — the test runner's heuristic `when` parser can already recognize named clients ("`alice sends typing`"), but the fluent BDD builder doesn't have a way to express "first alice connects, then bob connects, then alice sends..." as a single scenario. A future API extension could add chained `.andThen()` steps.
- **Typed state without the phantom witness** — the `state: {} as ChatRoomState` pattern works but is a little awkward. A TypeScript improvement to partial generic inference (or a future Triad helper like `channel.withState<T>()`) could clean this up.
- **`beforeHandler` for channels** — channels in v1 do auth inside `onConnect`. Lifting the `beforeHandler` extension point to channels would let the same `requireAuth` helper work for both HTTP and WebSocket.

---

## Phase 10 — Tasktracker gap fixes ✅

**Status:** Shipped across four sub-phases driven by ergonomic gaps the tasktracker example surfaced.

- **Phase 10.1** — `null` literal support in the behavior assertion parser
- **Phase 10.2** — `t.empty()` first-class primitive for 204/205/304 responses. OpenAPI omits `content`, adapters omit `Content-Type`, `ctx.respond[204]()` takes zero args
- **Phase 10.3** — `beforeHandler` extension point on `endpoint()`. Singular (not an array), runs before request validation, short-circuit or typed `ctx.state`. Tasktracker refactored to use it; ~35 lines of auth boilerplate deleted
- **Phase 10.4** — `checkOwnership` helper in `@triad/core` with discriminated `not_found | forbidden` result. Shared ownership pattern documented in `docs/ddd-patterns.md §7`

---

## Phase 11 — Frontend codegen (planned)

**Status:** Not started. High priority because the "one source of truth" story is incomplete until the frontend can consume Triad schemas as cleanly as the backend produces them.

The goal is to close the loop: a Triad router on the backend should generate ready-to-use TypeScript code on the frontend with zero manual API client work. Every schema, endpoint, and response type flows through — change a field on the server, the frontend compile errors point exactly where.

### `@triad/tanstack-query` — React Query / TanStack Query codegen

Generate fully-typed TanStack Query hooks from a Triad router. For each endpoint:

```ts
// Generated from POST /books
export function useCreateBook(
  options?: UseMutationOptions<Book, ApiError, CreateBook>
): UseMutationResult<Book, ApiError, CreateBook>;

// Generated from GET /books
export function useListBooks(
  params: ListBooksParams,
  options?: UseQueryOptions<BookPage, ApiError>
): UseQueryResult<BookPage, ApiError>;

// Generated from GET /books/:bookId
export function useBook(
  bookId: string,
  options?: UseQueryOptions<Book, ApiError>
): UseQueryResult<Book, ApiError>;
```

Scope for v1:
- `triad frontend generate --target tanstack-query --output ./client` command
- Walks `router.allEndpoints()` and emits one hook file per endpoint
- Types derived from existing Triad schemas (no Zod duplication; reuse the `Infer<>` output)
- Sensible query key strategy (`['books', bookId]` for GET `/books/:bookId`, `['books', 'list', params]` for list)
- Automatic invalidation helpers (deleting a book invalidates the list query)
- Works with any HTTP client; ships with a tiny default `fetch`-based one but accepts a custom client via options
- Strict TypeScript — hooks are fully typed from the Triad schema

Scope for later:
- Vanilla TanStack Query (not React-specific)
- Solid Query / Vue Query / Svelte Query variants
- Suspense-mode hooks
- Prefetch helpers for SSR / Next.js
- Mutation optimistic update helpers

Reference implementation: likely a new package `@triad/tanstack-query` with a generator module plus a small runtime, mirroring the `@triad/drizzle` bridge pattern.

### Future frontend targets

- **`@triad/trpc`-ish vanilla client** — just typed fetch wrappers, no framework dependency
- **`@triad/openapi-ts`** — integration with `openapi-ts` for users who want a classical OpenAPI client instead of Triad-native
- **GraphQL schema generator** — optional; lets Triad APIs double as GraphQL backends via schema stitching

---

## Phase 12 — Supabase + Deno integration (planned)

**Status:** Not started. Supabase is the most popular "Firebase-alternative" stack among indie and small-team TypeScript developers, and its Edge Functions run on Deno. Triad should have first-class docs and an example for this combination.

Goals:

1. **Example: `examples/supabase-edge`** — a Triad API deployed as a Supabase Edge Function running on Deno Deploy. Uses the existing `@triad/hono` adapter (Hono runs on Deno natively) plus Supabase's Deno runtime.
2. **Docs: `docs/guides/supabase.md`** — how to wire Triad into a Supabase project:
   - Service injection receives the Supabase client (`createClient(supabaseUrl, supabaseKey)`) instead of a Drizzle connection
   - Repositories use `supabase.from('books').select(...)` instead of `db.select().from(books)`
   - Auth integrates with Supabase Auth — `requireAuth` beforeHandler validates the JWT in `Authorization: Bearer <supabase_jwt>` via `supabase.auth.getUser(token)`
   - Row-Level Security (RLS) policies layered under Triad's application-level checks (belt and braces)
   - Realtime: `supabase.channel('books').on(...)` as the broadcast layer for a Triad channel
3. **Cookbook entries** for common Supabase patterns:
   - Using Supabase Storage from a Triad handler
   - Triggering database functions / RPC from endpoints
   - Scheduling with Supabase Cron + Triad endpoints

Non-goals:
- **No `@triad/supabase` package** — Supabase isn't an ORM, and the existing repository pattern already accommodates it. Ship docs + an example, not a new package.
- **No automatic RLS policy generation from Triad schemas** — interesting idea for a later phase, but out of scope for v1.

Why Deno specifically: Supabase Edge Functions run on Deno, and the `@triad/hono` adapter already supports Deno. Triad's ESM-only output and lack of Node built-ins (except where adapters pull them in) means core + hono work on Deno unchanged. The example validates that claim.

---

## Documentation

Start at [`docs/README.md`](docs/README.md) — the index that organizes everything below by what you're trying to do.

**Learn by building**
- [`docs/tutorial/`](docs/tutorial/) — Progressive 7-step tutorial building the Bookshelf app from hello-world to production-ready

**Pick your stack**
- [`docs/guides/choosing-an-adapter.md`](docs/guides/choosing-an-adapter.md) — Fastify vs Express vs Hono
- [`docs/guides/choosing-an-orm.md`](docs/guides/choosing-an-orm.md) — Drizzle (default), Prisma, Kysely, or raw SQL

**Work with AI**
- [`docs/guides/working-with-ai.md`](docs/guides/working-with-ai.md) — Prompt library + how to use the AI Agent Guide
- [`docs/ai-agent-guide.md`](docs/ai-agent-guide.md) — Canonical source-grounded reference for Claude Code, Cursor, Copilot, Aider

**Reference**
- [`docs/schema-dsl.md`](docs/schema-dsl.md) — Schema DSL primitive reference
- [`docs/ddd-patterns.md`](docs/ddd-patterns.md) — DDD integration (repositories, aggregates, domain services, factories, sagas, ownership)
- [`docs/drizzle-integration.md`](docs/drizzle-integration.md) — Drizzle bridge details
- [`docs/phase-9-websockets.md`](docs/phase-9-websockets.md) — WebSocket channel design spec
