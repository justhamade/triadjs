# Triad Example — Task Tracker API

The second Triad reference example. If [`examples/petstore`](../petstore) is the "Hello, world" of Triad (one adapter, no auth, simple CRUD), this one is the follow-up showing **what the framework feels like once real production concerns land**: authenticated users, ownership-based authorization, paginated listings, nested resources, `204 No Content` responses, and a second HTTP adapter.

Read petstore first. This README assumes you already know how Triad's schemas, endpoints, behaviors, repositories, and test runner fit together.

## What's different from petstore

| Concern | Petstore | Task Tracker |
| --- | --- | --- |
| HTTP adapter | `@triad/fastify` | `@triad/express` |
| Auth | None | Bearer token with a per-scenario in-memory `TokenStore` |
| Authorization | None | Ownership checks: a user only sees their own projects and tasks |
| Pagination | Offset (`limit`/`offset` array) | Keyset cursor (`{items, nextCursor}` envelope) |
| Nested resources | `/pets/:id/adopt` (one segment deep) | `/projects/:projectId/tasks/:taskId` (two typed params) |
| DELETE with `204` | Not exercised | `DELETE /projects/:id` and `DELETE /projects/:id/tasks/:id` |
| Test data lifecycle | Fresh in-memory DB per scenario | Same — **plus** an in-memory token store that also resets between scenarios |

Everything else — schemas as single source of truth, thin handlers, declarative endpoints, BDD behaviors as tests and docs, Drizzle repositories, value objects, bounded contexts — is identical in shape. That's the point: the adapter and the feature set are orthogonal to the core declarative style.

## Layout

```
examples/tasktracker/
├── triad.config.ts
├── src/
│   ├── schemas/
│   │   ├── user.ts           # User, RegisterInput, LoginInput, AuthResult
│   │   ├── project.ts        # Project, CreateProject
│   │   ├── task.ts           # Task, CreateTask, UpdateTask, TaskPage (pagination envelope)
│   │   └── common.ts         # ApiError, AuthHeaders, NoContent (the 204 workaround)
│   ├── db/
│   │   ├── schema.ts         # Drizzle sqliteTable definitions (users, projects, tasks)
│   │   └── client.ts         # better-sqlite3 + DDL + foreign keys
│   ├── repositories/
│   │   ├── user.ts           # UserRepository (hashes passwords, hides password_hash from rowToApi)
│   │   ├── project.ts        # ProjectRepository (findByIdForOwner — ownership-scoped queries)
│   │   ├── task.ts           # TaskRepository (keyset pagination with limit+1 trick)
│   │   └── token.ts          # TokenStore — in-memory, deliberately ephemeral
│   ├── endpoints/
│   │   ├── auth.ts           # POST /auth/register, POST /auth/login, GET /me
│   │   ├── projects.ts       # CRUD + ownership checks
│   │   └── tasks.ts          # Nested CRUD + pagination
│   ├── auth.ts               # requireAuth helper + hashPassword + parseBearer
│   ├── services.ts           # Service container + ServiceContainer declaration merge
│   ├── test-setup.ts         # Per-scenario DB + TokenStore reset
│   ├── app.ts                # Router with Auth/Projects/Tasks bounded contexts
│   └── server.ts             # Express entry point using @triad/express
└── generated/                # triad docs/gherkin output
```

## Running it

From the monorepo root:

```bash
npm install
```

From `examples/tasktracker/`:

```bash
npm start          # → http://localhost:3100 (Express + in-memory SQLite)
npm test           # → 27 behavior scenarios, in-process, no HTTP server needed
npm run docs       # → generated/openapi.yaml (7 paths, 11 components)
npm run gherkin    # → generated/features/{auth,projects,tasks}.feature
npm run validate   # → cross-artifact consistency check
npm run typecheck  # → strict TS, no `any`, no @ts-ignore
```

## The interesting bits

### Auth without middleware

Triad has no middleware primitive. Every protected handler therefore starts with the same three lines:

```ts
const auth = await requireAuth(ctx);
if (!auth.ok) return ctx.respond[401](auth.error);
const user = auth.user;
```

`requireAuth` is a plain async helper in [`src/auth.ts`](./src/auth.ts) that returns a discriminated union — `{ ok: true, user }` on success or `{ ok: false, error }` on any failure mode (missing header, bad token, deleted user). The explicit early-return is more verbose than a Fastify `preHandler` would be, but it keeps auth visible at every call site and requires zero framework support. **Whether that tradeoff is worth it depends on your team** — the final-report section below treats this as a real gap worth discussing.

### Ownership checks

`loadOwnedProject(services, projectId, userId)` returns either the project or a structured `{ status: 404 | 403, error }` tuple so handlers can route the outcome to the right `ctx.respond[...]` slot. We intentionally distinguish "404 — project doesn't exist" from "403 — exists but not yours"; returning 404 for both is safer against enumeration but less honest. Pick the rule that matches your threat model.

The helper is duplicated between `endpoints/projects.ts` and `endpoints/tasks.ts` on purpose — cross-file imports for a 15-line function obscure the flow more than a small amount of duplication does.

### Pagination

`GET /projects/:projectId/tasks` returns a `TaskPage = { items, nextCursor }` envelope, not a bare array. The cursor is a base64url-encoded copy of the last item's `createdAt`. It's a classic keyset cursor:

- Opaque to clients (they can't synthesise one).
- Insensitive to inserts between pages — `ORDER BY createdAt ASC WHERE createdAt > cursor`.
- Cheap: one indexed query, `limit + 1` rows to detect whether a next page exists without a separate `COUNT(*)`.

The encoding lives in the handler; the repository takes raw timestamps. That keeps storage and wire-format concerns separate.

### 204 No Content

Triad doesn't ship a dedicated "empty body" response helper. We work around it with `NoContent = t.unknown().optional()` in `src/schemas/common.ts` and `return ctx.respond[204](undefined)`. It works — the test runner and schema validator both accept `undefined` against an optional unknown — but it's a workaround, not an idiom. Flagged in the friction report.

### Express adapter

`src/server.ts` mounts the router with `createTriadRouter(router, { services })` from `@triad/express`. Two quirks vs the Fastify adapter:

1. **You must register `express.json()` before the Triad router.** Fastify parses JSON internally; Express does not.
2. **Port defaults to 3100** (petstore uses 3000) so both servers can run in parallel during development.

Everything else — per-request services, per-route validation, the 400 envelope for `RequestValidationError`, the 500 envelope for `ValidationException` — is behaviourally identical to `@triad/fastify`.

## Things to try

1. **Swap the adapter.** Delete the Express imports in `server.ts`, `import { triadPlugin } from '@triad/fastify'`, and run it on Fastify. No endpoint file changes. That's the adapter-at-the-edge payoff.
2. **Add a bounded context.** A `Teams` context with members and per-team projects would stress-test nested ownership: a task's owner is now "anyone on the team that owns the project".
3. **Break ownership.** Change `loadOwnedProject` to skip the `ownerId !== userId` check. Run `npm test` — the "another user's project" scenarios go red immediately.
4. **Swap SHA-256 for bcrypt.** `hashPassword` / `verifyPassword` in `src/auth.ts` are the only files that change.
5. **Make `requireAuth` reusable.** Could it be factored into a higher-order endpoint wrapper? A Symbol on `ctx.services` populated by the adapter? A dedicated `authContext()` helper in core? The best answer shapes the future Triad auth story.

## What's NOT here

- **JWTs / signed tokens.** Real apps should use signed, expiring tokens. The UUID-in-a-map approach keeps the example dep-light and unambiguously ephemeral.
- **Password security.** SHA-256 with a static salt is a teaching placeholder — use bcrypt or argon2 in production.
- **Rate limiting, CSRF, CORS, HTTPS.** Express can do all of these with off-the-shelf middleware; none of them interact with the Triad layer.
- **Concurrency control on task updates.** No `If-Match` header or version column. Last-write-wins.
