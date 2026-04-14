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

## Phase 9 — WebSocket Channels ✅

**Status:** Shipped. Core `channel()` function and router integration shipped in Phase 9.1. WebSocket adapter, AsyncAPI generator, test runner extensions, and example chat room completed through Phase 9.5. All follow-ups shipped in Phase 9.6.

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

### Phase 9.6 — Channel follow-ups ✅

**Status:** Shipped.

- **`triad validate` channel checks** ✅ — 5 new checks: duplicate channel names, duplicate channel paths, handler completeness (every `clientMessages` key has a handler), assertion message type references (verify `channel_receives`/`channel_not_receives`/`channel_message_has` reference declared `serverMessages`), and bounded-context model leakage for channels.
- **`beforeHandler` for channels** ✅ — `ChannelBeforeHandler` runs before schema validation, can populate `ctx.state` or reject the connection. Works in the test harness and Fastify adapter. Enables auth patterns that were previously impossible (missing header → 401 before schema validation rejects with 4400).
- **Multi-client scenarios (`.andWhen()`)** ✅ — `whenSteps` field on `Behavior`, `AndWhenStage` interface. Channel runner executes steps sequentially. `scenario('...').given('...').when('alice connects').andWhen('bob connects').andWhen('alice sends message').then('bob receives message')`.
- **`channel.withState<T>()`** ✅ — Ergonomic helper that eliminates the phantom witness pattern. `const withState = channel.withState<MyState>(); withState({ ... })` infers all other generics while fixing the state type.

Previously shipped in Phase 10.5:
- **Gherkin output for channels** ✅ — Shipped in Phase 10.
- **Channel `when` fallback preserves rejection** ✅ — Shipped in Phase 10.5.
- **`validateBeforeConnect` option** ✅ — Shipped in Phase 10.5.
- **`response body is empty` assertion** ✅ — Shipped in Phase 10.5.
- **`isUniqueViolation` predicate** ✅ — Shipped in Phase 10.5.

---

## Phase 10.5 — Ergonomic polish ✅

**Status:** Shipped. Five small independent fixes surfaced during cross-example work, bundled as one polish commit:

1. **Channel `when`-parser fallback preserves rejection** — `ensureConnected` now returns the client from `harness.connect()` directly, skipping subsequent sends if the client is `.rejected`. `connection_rejected` assertions work regardless of `when` phrasing.
2. **`validateBeforeConnect` option on channels** — when `false`, handshake validation failures attach to `ctx.validationError` and `onConnect` runs anyway, letting users render custom rejections. Default (`true`) is unchanged.
3. **`response body is empty` assertion phrase** — new `body_is_empty` variant targeting 204/205/304 scenarios paired with `t.empty()`.
4. **`isUniqueViolation` predicate in `@triad/drizzle`** — duck-typed detection of unique-constraint errors from better-sqlite3, pg, and mysql2. Eliminates the `existsByEmail` race window pattern used in multiple examples.
5. **`wrapBeforeHandler` across `@triad/otel`, `@triad/metrics`, `@triad/logging`** — all three observability wrappers now instrument the beforeHandler phase separately from the main handler, so auth failures are traced, timed, and logged correctly. `getLogger()` works inside a beforeHandler.

+37 tests. Zero existing tests broken — all changes additive or behind new flags.

---

## Phase 10 — Tasktracker gap fixes ✅

**Status:** Shipped across four sub-phases driven by ergonomic gaps the tasktracker example surfaced.

- **Phase 10.1** — `null` literal support in the behavior assertion parser
- **Phase 10.2** — `t.empty()` first-class primitive for 204/205/304 responses. OpenAPI omits `content`, adapters omit `Content-Type`, `ctx.respond[204]()` takes zero args
- **Phase 10.3** — `beforeHandler` extension point on `endpoint()`. Singular (not an array), runs before request validation, short-circuit or typed `ctx.state`. Tasktracker refactored to use it; ~35 lines of auth boilerplate deleted
- **Phase 10.4** — `checkOwnership` helper in `@triad/core` with discriminated `not_found | forbidden` result. Shared ownership pattern documented in `docs/ddd-patterns.md §7`

---

## Phase 11 — Frontend codegen ✅

**Status:** Shipped. `@triad/tanstack-query` walks a Triad router and emits fully-typed TanStack Query hooks, closing the single-source-of-truth loop from backend to frontend.

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

## Phase 12 — Supabase + Deno integration ✅

**Status:** Shipped. `examples/supabase-edge` is a full reference app deployed as a Supabase Edge Function on Deno, with a companion guide at `docs/guides/supabase.md`.

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

## Phase 13 — Client-side channels ✅

**Status:** All sub-phases shipped. `@triad/channel-client` walks `router.allChannels()` and emits typed clients for vanilla TypeScript, React, Solid, Vue, and Svelte. The Fastify channel adapter supports first-message auth for browser clients that can't set custom WebSocket headers. The runtime supports shared connections (multiple subscribers to the same channel share one underlying WebSocket) and offline send queueing (buffered FIFO flush on reconnect).

### Phase 13.0 — Server-side first-message auth

**Prerequisite.** Browsers cannot set custom headers on `new WebSocket()`. The three workarounds are subprotocol, query param, and "first-message auth" (connect, then send `{ type: '__auth', token }` as the first message). The Fastify channel adapter currently only reads auth from handshake headers. Add support for first-message auth so browser clients have a clean path.

Scope:
- New `auth.strategy: 'header' | 'first-message'` option on `channel()`
- Adapter reads the first message before running `onConnect` when `first-message` is selected
- Timeout on unauthenticated connections (reject after N seconds if no auth message)
- Documentation update in `docs/guides/choosing-an-adapter.md` and the AI agent guide

### Phase 13.1 — `@triad/channel-client` — vanilla TypeScript client generator

New package. `triad frontend generate --target channel-client --output ./client` walks every `channel()` in the router and emits one file per channel plus a shared types file:

```ts
import { createBookReviewsClient } from './client/book-reviews.js';

const client = createBookReviewsClient({
  url: 'wss://api.example.com',
  params: { bookId: 'abc' },                  // typed from connection.params
  headers: { authorization: 'Bearer xyz' },   // typed from connection.headers
  auth: 'subprotocol',                        // | 'query' | 'first-message'
  reconnect: { backoff: 'exponential', maxAttempts: 10 },
});

client.on('review', (payload) => { /* typed Review */ });
client.on('error', (payload) => { /* typed ChannelError */ });
client.on('stateChange', (state) => { /* 'connecting' | 'open' | ... */ });

client.send.submitReview({ rating: 5, comment: '!' });  // typed send
await client.close();
```

The generator reuses the `schema-to-ts.ts` emitter from `@triad/tanstack-query` (extract into a shared codegen module or duplicate — decide during implementation). No React dependency; this is pure TypeScript.

Scope:
- Path param interpolation (`/ws/books/:bookId/reviews` → URL construction)
- Typed `.send.<messageType>()` surface derived from `clientMessages`
- Typed event callbacks derived from `serverMessages`
- Reconnect with exponential backoff + jitter (configurable, opt-in)
- Message envelope format locked in and covered by a conformance test against a real Triad + Fastify server
- Integration test: spin up a real server, connect with the generated client, round-trip messages

### Phase 13.2 — React hook emit target

`triad frontend generate --target channel-client-react` emits a React hook per channel:

```tsx
function ReviewFeed({ bookId, token }: Props) {
  const { state, send, lastMessage } = useBookReviewsChannel({
    params: { bookId },
    headers: { authorization: `Bearer ${token}` },
    enabled: !!token,
    onReview: (review) => { /* typed */ },
    onError: (err) => { /* typed */ },
  });

  return (
    <button disabled={state !== 'open'} onClick={() => send.submitReview({ rating: 5, comment: '!' })}>
      Submit
    </button>
  );
}
```

Built on `useSyncExternalStore` for clean React 18+ integration. Auto-disconnects on unmount. Depends on Phase 13.1.

### Phase 13.3 — Additional framework variants

`@triad/channel-client-solid`, `@triad/channel-client-vue`, `@triad/channel-client-svelte`. Each one is ~200 lines wrapping the vanilla client from 13.1 in the framework's primitive (signal / ref / store).

### Phase 13.4 — Shared connections and offline queueing (v-later)

- Multiple calls to `useBookReviewsChannel({ params: { bookId: 'abc' } })` share one underlying WebSocket, keyed by `(channelName, params)`. Same pattern React Query uses for query deduplication.
- Buffer sends while disconnected; flush on reconnect. Configurable max-queue-size with drop-oldest semantics.
- Both are v-later because they add real complexity and most apps can ship without them.

---

## Phase 14 — Observability ✅

**Status:** Phases 14.1, 14.2, and 14.3 shipped. `@triad/otel` provides the OpenTelemetry tracing wrapper. `@triad/metrics` adds a zero-dependency Prometheus collector with automatic histograms per declared endpoint and cardinality protection. `@triad/logging` ships structured logging with AsyncLocalStorage-backed `getLogger()` and adapters for pino, winston, and a built-in JSON console logger. All three packages follow the same opt-in router-wrapper pattern and work uniformly across every HTTP adapter without adapter modifications. `docs/guides/observability.md` is the consolidated cookbook. Phase 14.4 (integration cookbook) lives inside that guide.

### Phase 14.1 — `@triad/otel` — OpenTelemetry integration

New package. Automatic OpenTelemetry spans per endpoint and per channel message, tagged with structured metadata the router already has:

- `triad.endpoint.name`, `triad.endpoint.method`, `triad.endpoint.path`
- `triad.context` (bounded context name)
- `triad.user.id` from `ctx.state.user.id` when available
- `triad.status_code` for the resolved response
- Spans around `ctx.services.*` method calls (automatic instrumentation via a Proxy on the services container)

Unique angle: because Triad knows the declared response statuses, error rates can be tagged correctly by category (expected 4xx vs unexpected 5xx). Generic HTTP instrumentation can't do this without guesswork.

### Phase 14.2 — `@triad/metrics` — Prometheus endpoint

Emit a `/metrics` endpoint returning p50/p95/p99 latency per declared endpoint plus request counts bucketed by declared response status. The Triad router already knows every declared status, so the histogram buckets are fully automatic.

Ships with opt-in middleware for each adapter (fastify, express, hono) that hooks the request lifecycle and feeds the histogram.

### Phase 14.3 — Structured logging helpers

A small wrapper that auto-decorates every log line with `{ endpoint, requestId, userId, context }` derived from the current request. Works with pino, winston, or bring-your-own. Probably ships inside the adapter packages rather than as a standalone package.

### Phase 14.4 — Integration cookbook

`docs/guides/observability.md` covering Sentry, Honeycomb, Datadog, Grafana. Docs only, no packages. Each integration is ~30 lines of wiring.

---

## Phase 15 — AWS Lambda adapter ✅

**Status:** Shipped. `@triad/lambda` runs a Triad router as an AWS Lambda handler — supports API Gateway v1 (REST), v2 (HTTP), Function URLs, and ALB events, all detected automatically from the event shape. Zero runtime dependencies beyond `@triad/core`, ~10.5 KB bundle, estimated ~180-250 ms cold start on ARM64 + 512 MB. Error envelope is byte-identical to the other adapters. `docs/guides/deploying-to-aws.md` is the full deployment cookbook covering Lambda, Fargate, App Runner, Beanstalk, and EC2 with SAM + CDK snippets.

### `@triad/lambda`

New package. Takes a Triad router and emits an AWS Lambda handler that accepts API Gateway v1/v2 events and ALB target events, normalizes them into the internal context shape, and runs the same validation/handler/respond pipeline as the other adapters.

Scope:
- API Gateway v1 (REST) and v2 (HTTP) event support
- ALB target event support
- Lambda Function URL support (same as API Gateway v2)
- Cold-start benchmarking — Triad's in-process runner is fast, but validate it
- Sample SAM template / CDK construct in the README
- No channel support (Lambda is request/response only)

Deployment targets this unlocks:
- Lambda + API Gateway (classic serverless)
- Lambda + CloudFront (edge-ish, globally distributed)
- Lambda behind ALB (VPC-attached compute)
- Lambda via SST, Serverless Framework, AWS CDK, SAM

Reference implementation mirrors `@triad/express` and `@triad/hono`. ~300 lines. Adapter error envelope stays byte-identical.

### Deployment cookbook

`docs/guides/deploying-to-aws.md`:
- Lambda (via `@triad/lambda`)
- ECS Fargate (container, any HTTP adapter)
- App Runner (container, any HTTP adapter)
- Elastic Beanstalk (container, any HTTP adapter)
- EC2 (any HTTP adapter)
- Terraform / CDK / SAM snippets for each

---

## Phase 16 — File uploads ✅

**Status:** Shipped. `t.file()` is a first-class schema primitive with `.maxSize()`, `.minSize()`, `.mimeTypes()` constraints. All three HTTP adapters auto-detect file fields and route the request through multipart parsing: Fastify uses `@fastify/multipart`, Express uses `multer`, Hono uses the built-in `c.req.parseBody({ all: true })`. The OpenAPI generator emits `multipart/form-data` content type with `format: binary` for file fields. Error envelopes for file-related failures (too large, wrong mime type, missing required file, expected multipart) are byte-identical across all three adapters.

### `t.file()` primitive

New schema primitive that validates file metadata and typed access in handlers:

```ts
const UploadAvatar = t.model('UploadAvatar', {
  file: t.file().maxSize(5 * 1024 * 1024).mimeTypes('image/png', 'image/jpeg'),
});

const uploadAvatar = endpoint({
  method: 'POST',
  path: '/users/:id/avatar',
  request: { body: UploadAvatar },  // multipart/form-data automatically
  // handler sees ctx.body.file as a typed { name, mimeType, size, stream(): ReadableStream, arrayBuffer(): Promise<ArrayBuffer> }
});
```

### Adapter wiring

Each HTTP adapter (fastify, express, hono) gains multipart parsing:
- Fastify: `@fastify/multipart`
- Express: `multer` or `express-fileupload`
- Hono: built-in `c.req.parseBody()`

Triad detects multipart from the body schema containing any `t.file()` field and routes the request through the multipart parser before building `ctx.body`.

### OpenAPI

`t.file()` emits as `{ type: 'string', format: 'binary' }` inside a `multipart/form-data` request body. Handles the Swagger UI "try it out" file picker correctly.

### Limits

Ship sensible defaults (10MB max file, 10 files max) and let users override per endpoint. Guard against zip bombs, memory DoS, etc.

---

## Phase 17 — Developer tooling sprint ✅

**Status:** Shipped. Three new CLI commands in `@triad/cli`:
- `triad new <project> --template <name>` scaffolds from one of four templates (fastify-petstore, express-tasktracker, fastify-bookshelf, hono-supabase), rewrites the copied `package.json`, and initializes git.
- `triad mock` starts a zero-dependency HTTP server (using only `node:http`) that returns schema-generated fake data for every router endpoint. Honors `.example()`/`.default()` metadata first, then deterministic LCG generation. `--latency`, `--error-rate`, and `--seed` flags for chaos testing and reproducibility.
- `triad docs check --against <ref|file>` diffs OpenAPI against a baseline, classifies changes as safe / risky / breaking, exits non-zero on breakages. Triad-unique capability — the router as a typed source means API drift is detectable from the source code alone.



**Status:** Not started. Three small CLI additions that together dramatically improve the day-to-day experience. Small individually, high cumulative value.

### Phase 17.1 — `triad new` scaffolding

```bash
npx triad new my-api --template fastify-drizzle
npx triad new my-api --template hono-supabase
npx triad new my-api --template lambda
```

Instantiates a fresh project from one of the `examples/` directories with the current package versions. Prompts for project name, adapter choice, ORM choice. Outputs a ready-to-run repo with a `README.md`, `package.json`, and a working hello-world endpoint. ~200 lines plus the template copying logic. Low complexity, huge onboarding impact.

### Phase 17.2 — `triad mock` — mock server from router

```bash
triad mock --port 3000
```

Starts an HTTP server that returns schema-generated fake data for every endpoint in the router. Uses a faker library seeded from each response schema. Critical for frontend teams developing against an unfinished backend — they get a fully-typed mock API the moment the backend team declares an endpoint, before any handler is written.

Scope:
- Faker-style synthesis for every `SchemaNode` kind
- Honors response schema constraints (string format, number ranges, enum values)
- Configurable latency simulation (`--latency 200` adds 200ms artificial delay)
- Configurable error injection (`--error-rate 0.05` returns random 5xx on 5% of requests)
- Deterministic seed mode for reproducible tests (`--seed 42`)

### Phase 17.3 — `triad docs check` — breaking-change detection

```bash
triad docs check --against main
```

Regenerates the OpenAPI from the current branch, fetches the baseline from a git ref, and classifies changes:

- **Safe**: new endpoint, new optional field, new response status, new enum value at the end
- **Risky**: removed optional field, enum value reordered, response schema widened
- **Breaking**: removed endpoint, required field added, response schema narrowed, status removed

Exits non-zero on breaking changes unless `--allow-breaking` is passed. In CI, this catches API contract regressions in PRs automatically. This is a Triad-unique capability because the router is a typed source — nothing else in the ecosystem does this as cleanly.

---

## Phase 18 — Auth cookbook ✅

**Status:** Shipped. `@triad/jwt` wraps `jose` (peer dep, not runtime) with a typed `requireJWT` BeforeHandler factory. Supports JWKS via `jwksUri` or shared secret via `secret`, checks issuer/audience/algorithms/clock-skew, projects verified claims into a user-defined `TUser` via `extractUser`. `docs/guides/auth.md` is the consolidated 881-line cookbook covering Auth0, Clerk, WorkOS, Firebase, Supabase (pointer), NextAuth, session cookies, API keys, multi-tenancy, and RBAC patterns.



**Status:** Not started. `beforeHandler` is the mechanism; users need concrete integrations for the common identity providers.

### Phase 18.1 — `@triad/jwt`

Tiny package wrapping `jose` or `jsonwebtoken` with a `requireJWT` BeforeHandler factory:

```ts
import { requireJWT } from '@triad/jwt';

const auth = requireJWT({
  issuer: 'https://my-auth.example.com',
  audience: 'my-api',
  jwksUri: 'https://my-auth.example.com/.well-known/jwks.json',
});

const createBook = endpoint({
  beforeHandler: auth,
  handler: async (ctx) => {
    ctx.state.user; // typed, JWT claims
  },
});
```

Scope:
- Verify, sign, key rotation via JWKS
- Claim extraction with configurable user shape
- HS256, RS256, ES256 support
- Clock skew tolerance
- Works with any JWT issuer (Auth0, Clerk, Supabase Auth, Firebase Auth, self-signed)

### Phase 18.2 — Auth integration cookbook

`docs/guides/auth.md` — the consolidated auth playbook:

- `@triad/jwt` basic usage
- Auth0 integration (JWT + JWKS)
- Clerk integration
- WorkOS integration
- Supabase Auth (already covered in the Supabase guide; cross-link)
- NextAuth.js session validation from a Triad backend
- Session cookie pattern (for browser apps that don't want bearer tokens)
- API key pattern (for server-to-server)
- Multi-tenancy via tenant-id header
- RBAC / permissions patterns layered on `beforeHandler`

Docs only, no additional packages. Each integration is 30-50 lines of wiring.

---

## Phase 19 — Additional frontend targets ✅

**Status:** Shipped. Four new codegen packages extending Phase 11's TanStack Query work to the rest of the frontend ecosystem: `@triad/solid-query`, `@triad/vue-query`, `@triad/svelte-query`, `@triad/forms`. Each walks `router.allEndpoints()` and emits framework-idiomatic bindings — Solid's accessor thunks, Vue's `MaybeRefOrGetter` + `toValue`, Svelte's `createXxxQuery` store factories. `@triad/forms` is structurally different: it emits a compact JSON descriptor per request body plus a ~140-line self-contained runtime validator, with optional resolver wrappers for `react-hook-form` and `@tanstack/form`. All four packages pass strict-mode `tsc --noEmit` against framework stubs in their bookshelf integration tests. +59 tests across the four. CLI targets `solid-query`, `vue-query`, `svelte-query`, `forms` are registered in `triad frontend generate --target`.



**Status:** Not started. Extends Phase 11 beyond React.

### Phase 19.1 — `@triad/solid-query`

Solid Query variant of Phase 11. Shares the schema-to-ts emitter. Emits `createQuery` / `createMutation` calls matching Solid Query's API. ~400 lines.

### Phase 19.2 — `@triad/vue-query`

Same story for Vue Query. ~400 lines.

### Phase 19.3 — `@triad/svelte-query`

Same story for Svelte Query. ~400 lines.

### Phase 19.4 — `@triad/forms` — form resolvers

Generate `react-hook-form` or `@tanstack/form` resolvers from Triad request body schemas. The schemas already have min/max/pattern/required/enum — this is a direct text emit. Ships one package with multiple emit targets behind flags.

### Phase 19.5 — Plain typed fetch client

For users who don't want a query library at all — just typed fetch wrappers with no runtime dependency beyond `fetch`. `triad frontend generate --target typed-fetch`.

---

## Phase 20 — Security helpers ✅

**Status:** Shipped. `@triad/security-headers` ships per-adapter middleware for Fastify, Express, and Hono backed by a shared `computeHeaders()` function that produces the standard security header set (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP/COEP/CORP) with sensible opinionated defaults. CSP nonce support via a per-request factory — static configs cache the frozen header map at plugin-load time, nonce configs generate a fresh 16-byte base64 nonce per request and inject it into `script-src`/`style-src`. `docs/guides/security.md` (578 lines, 12 sections) is the consolidated security cookbook covering threat modeling, rate limiting, CORS, CSRF, input sanitization, secrets management, dependency security, observability-as-security, OWASP Top 10 coverage audit, and a pre-production checklist.

---

## Phase 23 — End-to-end integration tests ✅

**Status:** Shipped. Each of the four reference examples (petstore, tasktracker, bookshelf, supabase-edge) gained an `e2e/` test suite that starts the example's server in-process on an ephemeral port, makes real HTTP (`fetch`) and real WebSocket (`ws`) calls, and asserts on wire responses. Complements the existing in-process `triad test` suites rather than replacing them. +74 tests across 17 files. Each example exports a `createApp()` factory from `src/server.ts` so tests can start a server without binding to a fixed port, with an entry-guard that preserves the existing `npm start` path.

---

## Phase 24 — Behavior coverage audit ✅

**Status:** Shipped. 148 new tests across 9 packages filling in error-branch gaps that existing happy-path tests didn't cover. Zero source modifications, zero bugs discovered — every branch behaved as the source intended, which is a strong signal that the error paths are genuinely defensive. Focused on `@triad/core` schema/router, `@triad/openapi`, `@triad/asyncapi`, `@triad/drizzle`, `@triad/cli`, and adapter coerce logic. Deliberately avoided padding (variant tests that only change one value), testing JavaScript (assertions on Triad codes, not JS semantics), and testing private APIs.

---

## Phase 25 — Property-based fuzzing ✅

**Status:** Shipped. 72 property tests across 7 files using `fast-check` to encode universal invariants about the schema DSL, endpoint composition, router construction, OpenAPI generation, and Drizzle codegen. Discovered one real bug: `ModelSchema._validate` read fields via plain member access, which resolved `Object.prototype.valueOf` when a field was named `valueOf` (and similar for `toString`, `constructor`, `hasOwnProperty`). Bug fixed in the same wave via `Object.hasOwn(input, fieldName)` guard. 390 core tests now green, zero skipped.

---

## Phase 27 — Adapter parity + HandlerResponse.headers ✅

**Status:** Shipped. All four HTTP adapters (Fastify, Express, Hono, Lambda) now produce byte-identical error envelopes for every failure mode. Three divergences fixed:

1. **JSON parse errors** — Fastify and Express previously leaked framework-native parse error formats. Now all four wrap malformed JSON into `{ code: "VALIDATION_ERROR", errors: [{ code: "invalid_json", ... }] }`.
2. **Handler throws** — All four previously re-threw unexpected errors to framework defaults (Fastify's error handler, Express's `next(err)`, Hono's `onError`). Now all four catch unexpected throws and return `{ code: "INTERNAL_ERROR", message: "The server produced an unexpected error." }` with status 500.
3. **Wrong content-type** — All four now check that the request's `Content-Type` is `application/json` (or `+json` variant) before parsing body, returning `{ code: "VALIDATION_ERROR", errors: [{ code: "invalid_content_type", ... }] }` on mismatch.

**`HandlerResponse.headers`** — Added optional `headers?: Record<string, string>` to the core `HandlerResponse` type plus `ResponseOptions` for `ctx.respond[status](data, { headers })`. All four adapters apply response headers to the outgoing HTTP response. This unblocks future work to make security headers a router wrapper instead of per-adapter middleware.

+32 adapter tests.

---

## Under consideration (not committed)

Items that have been mentioned or requested but are NOT on the committed roadmap. Each is listed with the reason it's deprioritized. These may or may not ever ship — listing them here so the decision is explicit rather than forgotten.

- **~~GraphQL bridge (`@triad/graphql`)~~** — Out of scope. Dropped from the roadmap.
- **~~Playwright-based frontend codegen verification (Phase 23.2)~~** — Out of scope. Dropped from the roadmap.
- **VS Code extension** — Hover docs for assertion phrases, autocomplete for schema fields, inline OpenAPI preview. Valuable but a huge maintenance burden for uncertain payoff. Wait for concrete user demand.
- **IntelliJ plugin** — Same reasoning as VS Code.
- **Browser playground / REPL** — Run Triad in a browser sandbox for marketing. Cool but not engineering-critical.
- **Prisma first-party bridge** — `docs/guides/choosing-an-orm.md` already covers the integration pattern. A first-party package would duplicate what Prisma already provides for type safety.
- **MongoDB / Mongoose first-party support** — Repositories are user code; the BYO-ORM guide covers the pattern. No first-party investment.
- **Queue integrations (BullMQ, Inngest, pg-boss, Trigger.dev)** — All are external concerns. Cookbook entries possible, packages unlikely.
- **Redis caching helpers** — Adapter plugins handle this fine; no Triad-specific angle.
- **Built-in i18n / localization** — Out of scope; users layer this in at the handler level.
- **Multi-tenancy primitives** — Covered by the `ctx.state` + per-request services pattern. No framework-level concept.

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
