# Triad Example — Supabase Edge Function

The fourth Triad reference example. This one targets a very specific deployment shape: **a Triad API running as a Supabase Edge Function on Deno**, with Supabase Auth for identity and `@supabase/supabase-js` as the storage layer.

If you have never built a Triad app before, read [`examples/petstore`](../petstore) first — it covers the basics without the Supabase-specific machinery. Then come back here when you want to see how the framework lands on an edge-runtime stack.

## Why this example exists

Supabase + Deno + Edge Functions is one of the most popular "full stack in a weekend" deployment stories in the TypeScript ecosystem. Triad's HTTP layer already runs on Deno via [`@triadjs/hono`](../../packages/hono), so there is no adapter work to do — the gap was a **worked reference** showing the wiring: how Supabase Auth pairs with Triad's `beforeHandler`, how to keep the Supabase client per-request for RLS to work, how to split repositories so tests don't need a real Supabase project, and how to deploy with `supabase functions deploy`.

This example fills that gap. Everything in it — the schemas, the repositories, the endpoints, the behavior tests — looks just like `examples/tasktracker`. The only differences are the persistence layer (Supabase instead of Drizzle/SQLite), the adapter (Hono instead of Express), and an extra deploy target (`supabase/functions/api/index.ts` for Deno).

## What it is

A tiny blog API with three bounded contexts:

| Context | Endpoints | Auth |
|---|---|---|
| **Auth** | `GET /me` | Supabase JWT |
| **Posts** | `POST /posts`, `GET /posts`, `GET /posts/:id`, `PATCH /posts/:id`, `DELETE /posts/:id` | Public read, authed write, ownership-scoped update/delete |
| **Comments** | `POST /posts/:id/comments`, `GET /posts/:id/comments` | Authed write, public read — anyone can comment on any post |

~22 behavior scenarios cover the happy paths and the important failure modes (unauthed, forbidden, not found, pagination edges).

## How it differs from the other examples

| Concern | Petstore | Tasktracker | Bookshelf | **Supabase Edge** |
| --- | --- | --- | --- | --- |
| HTTP adapter | `@triadjs/fastify` | `@triadjs/express` | `@triadjs/fastify` | `@triadjs/hono` |
| Persistence | Drizzle (SQLite) | Drizzle (SQLite) | Drizzle (SQLite) | **Supabase (`@supabase/supabase-js`)** |
| Auth | None | In-process token store | In-process token store | **Supabase Auth JWT** |
| Deploy target | Node | Node | Node | **Supabase Edge Function (Deno)** |
| Test-time persistence | In-memory SQLite | In-memory SQLite | In-memory SQLite | **In-memory repositories (no Supabase)** |

The persistence split is the interesting one. `@supabase/supabase-js` is a network client — you can't hand it an in-memory store the way you can hand Drizzle an in-memory SQLite. So this example splits every repository into two concrete classes behind one interface:

- `MemoryPostRepository` — used by every `triad test` scenario. Plain `Map`, zero network.
- `SupabasePostRepository` — used at deploy time. Wraps `@supabase/supabase-js`.

`createServices({ mode: 'memory' | 'supabase' })` picks the pair. Tests always call memory mode; the Deno entry always calls Supabase mode. Same interface, two implementations. See `src/services.ts` for the wiring.

## File layout

```
examples/supabase-edge/
├── triad.config.ts                 # Triad test/docs/gherkin config
├── tsconfig.json                   # Excludes `supabase/**` — that's Deno's turf
├── package.json
├── src/
│   ├── app.ts                      # Router + bounded contexts (runtime-agnostic)
│   ├── server.ts                   # Node dev server via @hono/node-server
│   ├── services.ts                 # Services container + mode: memory | supabase
│   ├── test-setup.ts               # Per-scenario memory services
│   ├── supabase-auth.ts            # requireAuth beforeHandler
│   ├── access.ts                   # loadOwnedPost ownership helper
│   ├── auth-verifier.ts            # AuthVerifier interface + MemoryAuthVerifier
│   ├── auth-verifier-supabase.ts   # SupabaseAuthVerifier (Deno-only import path)
│   ├── schemas/
│   │   ├── common.ts               # ApiError
│   │   ├── user.ts                 # User (derived from Supabase JWT)
│   │   ├── post.ts                 # Post + CreatePost/UpdatePost/PostPage
│   │   └── comment.ts              # Comment + CreateComment
│   ├── repositories/
│   │   ├── post.ts                 # PostRepository interface + MemoryPostRepository
│   │   ├── post-supabase.ts        # SupabasePostRepository (Deno-only import path)
│   │   ├── comment.ts              # CommentRepository interface + memory
│   │   └── comment-supabase.ts     # SupabaseCommentRepository
│   └── endpoints/
│       ├── auth.ts                 # GET /me
│       ├── posts.ts                # CRUD + keyset pagination
│       └── comments.ts             # Nested CRUD
└── supabase/
    └── functions/
        └── api/
            ├── index.ts            # Deno entry (excluded from tsc — see below)
            └── deno.json           # Import map
```

## Running it locally (Node)

From the monorepo root:

```bash
npm install
```

From `examples/supabase-edge/`:

```bash
npm run dev      # → http://localhost:3300 (Hono + in-memory repos + seeded dev token)
npm test         # → ~22 behavior scenarios, in-process, no Supabase needed
npm run docs     # → generated/openapi.yaml
npm run gherkin  # → generated/features/{auth,posts,comments}.feature
npm run validate # → cross-artifact consistency check
npm run typecheck
```

`npm run dev` prints a pre-seeded memory token. Use it to curl endpoints:

```bash
curl -H "Authorization: Bearer test-<uuid>" http://localhost:3300/me
```

## Deploying to Supabase Edge Functions

1. Install the Supabase CLI (`brew install supabase/tap/supabase` or see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli)).
2. Link a Supabase project: `supabase link --project-ref <your-ref>`.
3. Create the Postgres tables (and RLS policies) — see the SQL in `docs/guides/supabase.md` §5.
4. Deploy the function:

   ```bash
   supabase functions deploy api --project-ref <your-ref>
   ```

5. Test it:

   ```bash
   # Get a JWT by signing up a user through supabase-js or the Supabase dashboard.
   curl -H "Authorization: Bearer <jwt>" \
     https://<your-ref>.supabase.co/functions/v1/api/me
   ```

Required environment variables (set via `supabase secrets set KEY=VALUE`):

- `SUPABASE_URL` — your project's `https://<ref>.supabase.co` URL.
- `SUPABASE_ANON_KEY` — the project's anon/public key.

Check logs:

```bash
supabase functions logs api --project-ref <your-ref>
```

## Testing strategy

Tests run against `MemoryPostRepository` and `MemoryAuthVerifier`, not a real Supabase project. The rationale:

- **CI can't reach Supabase** reliably, and making builds depend on network calls to a third-party API is a bad trade-off.
- **Network tests are slow.** The whole point of Triad's in-process test runner is that you can iterate on 20+ scenarios in under a second.
- **The repository interface IS the contract.** Both concrete implementations conform to `PostRepository` / `CommentRepository` / `AuthVerifier`. If the interfaces are right, the Supabase implementations are small enough to verify manually.

The manual verification procedure:

1. `supabase functions deploy api` to a throwaway staging project.
2. Sign up a test user via `supabase auth signup` or `supabase-js`.
3. Run a handful of `curl` calls against the deployed function — create a post, list posts, try to update someone else's post, etc. — and confirm the responses match what the tests assert against the memory backend.

If your team needs automated Supabase integration tests, run `supabase start` locally (requires Docker) and point a second `test-setup.ts` at the local stack. That's out of scope for this example but straightforward to add.

## What's NOT here

- **Real Supabase integration tests.** Covered above — `triad test` runs memory-only.
- **Realtime subscriptions.** Supabase Realtime is the right answer for fan-out; `@triadjs/hono` doesn't ship a channels adapter. See `docs/guides/supabase.md` §7.
- **Password flows.** Supabase Auth owns sign-up and sign-in. Our API only sees validated JWTs.
- **A caching layer on `SupabaseAuthVerifier.verify`.** Every authenticated request currently does a `auth.getUser` round-trip to Supabase. Real deployments should cache for ~30s. Discussed in `docs/guides/supabase.md` §4.

## See also

- **[`docs/guides/supabase.md`](../../docs/guides/supabase.md)** — the full walkthrough: architecture, RLS policies, repository pattern, realtime, deploying, migration from an ad-hoc Supabase app. Read this if you are planning to build a real Triad + Supabase project.
- **[`docs/guides/choosing-an-adapter.md`](../../docs/guides/choosing-an-adapter.md)** — context for why `@triadjs/hono` is the right choice for this runtime target.
- **[`examples/tasktracker`](../tasktracker)** — the closest structural match: same ownership-based auth pattern, same bounded-context layout, different persistence and adapter.
