# Triad on Supabase

A working reference for building Triad APIs on top of [Supabase](https://supabase.com) — Supabase Auth for identity, Postgres + RLS for storage, and Supabase Edge Functions (Deno) for deployment. The companion example lives in [`examples/supabase-edge`](../../examples/supabase-edge). Read this guide to understand the *why* behind each file there.

This guide is long on purpose. The Supabase and Triad stories overlap but aren't identical — they both push for typed-end-to-end, both want you to define your contract once, and both try to stay small — but they make different trade-offs at the boundaries. The goal here is to show how they compose without pretending the seams don't exist.

If you are brand new to Triad, read the [tutorial](../tutorial/) first. If you are brand new to Supabase, skim their [Edge Functions intro](https://supabase.com/docs/guides/functions) before coming back.

## 1. Why Supabase + Triad

Supabase and Triad solve different problems:

- **Supabase** solves "I need a Postgres database, auth, storage, and realtime with zero infrastructure work." It gives you a managed Postgres instance, a signed-JWT auth server, a S3-compatible file store, a Postgres-replication realtime bus, and — crucially for this guide — a Deno-based Edge Functions runtime for any API logic you can't express as a database view.

- **Triad** solves "I want a single source of truth for my API contract, shared between runtime validation, types, docs, tests, and client codegen." It does NOT give you a database, auth, or storage. It assumes you have those.

Put together, the two are complementary. Supabase's auto-generated REST API (PostgREST) is excellent for simple CRUD pass-through, but it reaches its limits when you have:

- Domain logic that doesn't fit in a view or a stored procedure.
- Validation rules more nuanced than "reject if column is null."
- Long-form behavior tests you want to run in CI without standing up Postgres.
- Typed request/response contracts documented as OpenAPI for client codegen.
- More than one "bounded context" inside one Postgres schema (orders vs inventory vs billing) and you want them to look like separate API surfaces.

Triad is the layer that lives above Supabase's generated API for those cases.

### When NOT to use Triad with Supabase

If your API is literally "select rows from a table and return them," you should use PostgREST and stop reading here. You won't enjoy the extra ceremony of declarative endpoints and behavior tests — the value proposition of Triad only kicks in when you have domain logic worth testing.

If your domain logic is trivial but your validation rules are complex, consider just tightening your Postgres CHECK constraints and letting PostgREST surface the errors. That's less code than writing a Triad endpoint.

Reach for Triad when you have one or more of:

- Cross-table writes that need to be atomic and validated together.
- Authorization rules that are easier to express in TypeScript than in RLS policies.
- A UI team asking for OpenAPI + client codegen.
- A test suite that needs to run without hitting the network.

## 2. Architecture

The stack looks like this:

```
┌──────────────┐                          ┌───────────────────┐
│  Client      │───── HTTPS + JWT ───────▶│ Supabase Edge Fn  │
│ (web / iOS / │                          │  (Deno runtime)   │
│  Android)    │                          │  ┌─────────────┐  │
└──────────────┘                          │  │ @triadjs/hono │  │
       │                                  │  │ ├─ router   │  │
       │                                  │  │ ├─ handlers │  │
       │                                  │  │ └─ repos    │  │
       │                                  │  └──────┬──────┘  │
       │                                  └─────────┼─────────┘
       │                                            │
       │                                            ▼
       │                                 ┌──────────────────┐
       │                                 │  Postgres        │
       └────── Supabase Auth ──JWT──────▶│  + auth.users    │
                                         │  + RLS policies  │
                                         └──────────────────┘
```

The request lifecycle:

1. Client obtains a JWT from Supabase Auth (sign-up / sign-in flows; not our API's problem).
2. Client calls `https://<project>.supabase.co/functions/v1/api/posts` with `Authorization: Bearer <jwt>`.
3. The Edge Function (Deno runtime) starts, imports your router, and constructs a per-request Supabase client forwarding the caller's JWT.
4. Triad's `requireAuth` beforeHandler asks `SupabaseAuthVerifier.verify(token)` which calls `supabase.auth.getUser(token)`. Supabase's auth server validates the JWT, confirms the user isn't deleted/banned, and returns the canonical user record. That becomes `ctx.state.user`.
5. The endpoint handler runs. Every `supabase.from('posts').select()` call inside it executes under Postgres Row-Level Security using the caller's JWT as the role context.
6. The handler returns a `HandlerResponse`, Triad validates it against the declared schema, and Hono writes the HTTP response.

Four layers of validation happen in a single round-trip:

- **JWT signature** — Supabase Auth verifies the token.
- **Application-level authorization** — `loadOwnedPost` checks the authenticated user is the author before an update.
- **Row-Level Security** — Postgres rejects the write if the RLS policy disagrees.
- **Response schema** — Triad refuses to emit a body that doesn't match the declared response schema.

Layers 2 and 3 are redundant *on purpose*. See §5.

## 3. Service injection — Supabase client as a dependency

The single biggest departure from the tasktracker example is that the Supabase client is built **per request**, not once at startup. The reason is §5's defense-in-depth story: a per-request client can forward the caller's `Authorization` header so every Postgres query runs under their JWT, and that's what makes RLS useful.

Triad already has the plumbing for per-request services. `@triadjs/hono`'s `createTriadApp` accepts either a static services object or a factory that receives the Fetch `Request`:

```ts
createTriadApp(router, {
  services: (req) => ({
    petRepo: petRepoFor(req.headers.get('x-tenant')),
  }),
});
```

In this example we use the factory form from the Deno entry:

```ts
// supabase/functions/api/index.ts
Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
  const services = await createServices({ mode: 'supabase', supabase });
  const app = createTriadApp(router, { services });
  return app.fetch(req);
});
```

Four things worth calling out:

1. **The client is constructed after we know the request.** That's how the `Authorization` header makes it into the client. A module-level `const supabase = createClient(...)` would be shared across all requests and RLS would run as an anonymous role.
2. **`createServices` is awaited** in Supabase mode because it dynamically imports the Supabase-backed repositories. See §6 for why.
3. **The `app` is also constructed per-request.** That looks wasteful — allocating a Hono app for every call — but Edge Functions are request-scoped by design; there is no long-lived process to amortize the allocation against. Benchmark it if you're worried; in practice the allocations are negligible compared to the network round-trip for `auth.getUser`.
4. **`createClient` uses the anon key, not the service role key.** This is critical. Using the service role key would bypass RLS entirely and would mean a single bug in the application layer is enough for a full data leak. Use the anon key and let RLS do its job.

## 4. Authentication — Supabase Auth + `requireAuth`

Supabase Auth owns the sign-up / sign-in / password-reset flows. Your API never sees a password; it only sees JWTs. That means the only auth code you write in Triad is a `beforeHandler` that turns a JWT into `ctx.state.user`.

The hook lives in [`src/supabase-auth.ts`](../../examples/supabase-edge/src/supabase-auth.ts). Its job is unchanged from the pattern in `examples/tasktracker`:

```ts
export const requireAuth: BeforeHandler<AuthState, With401<any>> = async (ctx) => {
  const token = parseBearer(ctx.rawHeaders['authorization']);
  if (!token) return { ok: false, response: ctx.respond[401](/* ... */) };
  const user = await ctx.services.authVerifier.verify(token);
  if (!user) return { ok: false, response: ctx.respond[401](/* ... */) };
  return { ok: true, state: { user } };
};
```

The interesting piece is `ctx.services.authVerifier`. It's a one-method interface:

```ts
export interface AuthVerifier {
  verify(token: string): Promise<User | null>;
}
```

with two concrete implementations:

- **`MemoryAuthVerifier`** — used by tests. Holds a `Map<token, User>` and has a `register(user)` method for scenario setup. Zero network, zero Supabase dependency.
- **`SupabaseAuthVerifier`** — used at deploy time. Delegates to `supabase.auth.getUser(token)` and maps the result into Triad's `User` schema.

This separation is what makes the tests runnable without a real Supabase project. `requireAuth` doesn't know (or care) which verifier is wired up — it just calls `.verify()`.

### The mapping: Supabase's `User` → Triad's `User`

Supabase hands you a rich `User` object with a dozen fields (id, email, phone, user_metadata, app_metadata, role, factors, created_at, confirmed_at, ...). Your Triad `User` schema should be the minimal subset your API cares about. In the example it's three fields:

```ts
export const User = t.model('User', {
  id: t.string().format('uuid'),
  email: t.string().format('email'),
  name: t.string().minLength(1).maxLength(100),
});
```

The mapping code in `SupabaseAuthVerifier`:

```ts
const { id, email, user_metadata } = data.user;
if (!email) return null;
const metadataName = typeof user_metadata?.name === 'string' ? user_metadata.name : null;
const name = metadataName ?? email.split('@')[0]!;
return { id, email, name };
```

Three things to notice:

1. **We reject users with no email.** Supabase supports phone-only and OAuth-only flows that can produce a user without an email. Our domain model (posts by an author) treats email as identity, so we fail closed.
2. **`name` falls back to the local-part of the email** when the client didn't set `user_metadata.name`. That's an opinion; your app might prefer to require a display name at sign-up and reject users who don't have one.
3. **The Triad schema is the ubiquitous language.** `user_metadata` is a Supabase concept; nothing above this mapping knows the phrase exists. If you ever migrate off Supabase, only this file and `src/services.ts` need to move.

### The caching gotcha

`supabase.auth.getUser(token)` is a **network round-trip** to Supabase's auth server. It does NOT validate the JWT locally, because local validation can't check for revoked tokens or deleted users.

That's safer, but it means every authenticated request pays for an extra HTTP call. For a low-traffic API this is fine. For anything busy, cache the verification result for some bounded window — 30 seconds is the classic compromise — and accept that a revoked token remains valid for that window:

```ts
export class CachedAuthVerifier implements AuthVerifier {
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();
  private readonly ttlMs: number;
  constructor(private readonly inner: AuthVerifier, ttlSeconds = 30) {
    this.ttlMs = ttlSeconds * 1000;
  }
  async verify(token: string): Promise<User | null> {
    const now = Date.now();
    const hit = this.cache.get(token);
    if (hit && hit.expiresAt > now) return hit.user;
    const user = await this.inner.verify(token);
    if (user) this.cache.set(token, { user, expiresAt: now + this.ttlMs });
    return user;
  }
}
```

Per-request caching at the Edge doesn't help — the function is cold between invocations. A shared in-memory cache only helps if Supabase's Edge runtime reuses workers, which it does but not predictably. For anything serious, push the cache out of process (Redis, Upstash) and key on a hash of the token.

## 5. Authorization — RLS as defense in depth

This is the most important section in the guide. Get this right and your Supabase + Triad stack is robust; get it wrong and you have a data-leak shaped hole.

**Rule: authorize twice. Once in the application layer, once in the database layer.**

### The application layer: `loadOwnedPost`

Inside Triad, authorization looks exactly like the tasktracker example:

```ts
// src/access.ts
export async function loadOwnedPost(
  services: Pick<SupabaseEdgeServices, 'postRepo'>,
  postId: string,
  userId: string,
): Promise<LoadedPost> {
  const post = await services.postRepo.findById(postId);
  const result = checkOwnership(post, userId, (p) => p.authorId);
  if (result.ok) return { ok: true, post: result.entity };
  if (result.reason === 'not_found') return { ok: false, status: 404, error: {...} };
  return { ok: false, status: 403, error: {...} };
}
```

This gives you:

- **Readable 404 vs 403 branching** that the client can interpret.
- **Explicit `code` fields** in error responses.
- **A testable decision** you can cover with behavior scenarios.

Application-layer checks are *necessary* — RLS alone produces ugly error messages — but they are *not sufficient*. A bug in the `loadOwnedPost` call (forgot to use it, wrong user id, wrong path param) would bypass the check completely.

### The database layer: Row-Level Security

Postgres RLS is a second enforcement point that runs after the application check, as part of the query itself. If the RLS policy disagrees with the application check, the database wins — the query simply returns zero rows or raises a permission error.

For the example's `posts` table, enable RLS and write three policies:

```sql
create table posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  body text not null check (length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index on posts (created_at desc);

alter table posts enable row level security;

-- Anyone (even anonymous) can read any post. If your app needs
-- private posts, change this to `(author_id = auth.uid())` or add
-- a `visibility` column and key off it.
create policy "Anyone can read posts"
  on posts for select
  using (true);

-- Only authenticated users can insert, and they must set themselves
-- as the author. The `with check` clause prevents spoofing.
create policy "Authenticated users can insert their own posts"
  on posts for insert
  to authenticated
  with check (author_id = auth.uid());

-- Only the author can update their post.
create policy "Authors can update their own posts"
  on posts for update
  to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

-- Only the author can delete their post.
create policy "Authors can delete their own posts"
  on posts for delete
  to authenticated
  using (author_id = auth.uid());
```

And for `comments`:

```sql
create table comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index on comments (post_id, created_at);

alter table comments enable row level security;

create policy "Anyone can read comments"
  on comments for select
  using (true);

create policy "Authenticated users can comment"
  on comments for insert
  to authenticated
  with check (author_id = auth.uid());
```

Notice there is **no update or delete policy on comments** — the example doesn't expose those endpoints, so we don't grant them. RLS is default-deny, so no policy means no access, which is exactly what we want.

### Why `auth.uid()` works

`auth.uid()` is a Postgres function Supabase ships that returns the `sub` claim from the current JWT, or `null` if no JWT is attached. For it to return a value, the Postgres session needs to be running under the caller's JWT — which is why we built the Supabase client per-request with the caller's Authorization header in §3. Miss that step and `auth.uid()` returns `null` and every insert fails with "new row violates row-level security policy for table posts" — a confusing error because the policy says `author_id = auth.uid()` and the `null` compared to a UUID is what actually fails.

### The four-layer picture

For a `PATCH /posts/:postId` request with a valid token:

1. **`requireAuth` beforeHandler** — rejects missing/invalid JWTs with 401.
2. **`loadOwnedPost`** — rejects cross-author updates with 403, rejects missing posts with 404.
3. **RLS `Authors can update their own posts`** — rejects the update at the Postgres layer if the first two somehow missed something.
4. **Triad response-schema validation** — rejects malformed handler responses with 500 instead of leaking the shape to the client.

Layers 1, 2, and 4 are in your code. Layer 3 is in your database. All four need to agree. If they disagree, the more restrictive one wins, which is the right default.

### When to skip RLS

The service role key bypasses RLS entirely. Use it *only* for:

- Internal admin endpoints that run server-to-server with no user context.
- Cron jobs and background workers where there is no caller JWT.
- Schema migrations and seed scripts.

Never forward the service role key to a per-request handler. If you find yourself needing it inside a Triad endpoint, step back — usually the right answer is a separate "admin" Edge Function with its own auth story (a shared secret header, for instance) that uses the service role key only when the shared secret matches.

## 6. Repositories — the Supabase client in a repository

The example uses Triad's repository pattern just like the Drizzle-backed examples. The twist is the dual implementation:

```ts
// src/repositories/post.ts
export interface PostRepository {
  create(input: CreatePostInput): Promise<Post>;
  findById(id: string): Promise<Post | null>;
  list(options: ListPostsOptions): Promise<ListPostsResult>;
  update(id: string, patch: UpdatePostInput): Promise<Post | null>;
  delete(id: string): Promise<boolean>;
}

export class MemoryPostRepository implements PostRepository { /* ... */ }
```

And in a sibling file:

```ts
// src/repositories/post-supabase.ts
export class SupabasePostRepository implements PostRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreatePostInput): Promise<Post> {
    const { data, error } = await this.supabase
      .from('posts')
      .insert({ author_id: input.authorId, title: input.title, body: input.body })
      .select()
      .single();
    if (error) throw new Error(`posts.insert failed: ${error.message}`);
    return this.rowToApi(data as PostRow);
  }

  async findById(id: string): Promise<Post | null> {
    const { data, error } = await this.supabase
      .from('posts')
      .select()
      .eq('id', id)
      .single();
    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`posts.findById failed: ${error.message}`);
    return this.rowToApi(data as PostRow);
  }

  // ... list / update / delete

  private rowToApi(row: PostRow): Post {
    return {
      id: row.id,
      authorId: row.author_id,   // snake_case → camelCase at the boundary
      title: row.title,
      body: row.body,
      createdAt: row.created_at,
    };
  }
}
```

Four things to learn from this pattern:

### `rowToApi` / `apiToRow` at the boundary

Supabase speaks Postgres conventions (snake_case); Triad speaks JavaScript conventions (camelCase). Translate at the repository edge so nothing above knows about the mismatch. Your handlers should never see `author_id` and your schemas should never see `created_at`.

The translation is boring and duplicated across repositories. That's fine. A generic `snakeToCamel(row)` utility is tempting but adds runtime cost for zero correctness win; an explicit mapper is 4 lines of obvious code.

### Error handling

Supabase's JS client returns `{ data, error }` tuples. Most places in your repo want to convert errors into thrown exceptions so the Hono adapter can surface them as 500s. One exception: the "no rows returned" signal from `.single()`.

```ts
const { data, error } = await this.supabase.from('posts').select().eq('id', id).single();
if (error && error.code === 'PGRST116') return null;
if (error) throw new Error(error.message);
return this.rowToApi(data);
```

`PGRST116` is the PostgREST code for "JSON object requested, multiple (or no) rows returned." When called against `.single()` it means "no rows matched" — a legitimate "not found" signal, not a bug. Translate it to `null` and let the handler decide whether that's a 404 or an empty response.

### Dynamic import for Supabase repositories

`src/services.ts` imports memory repositories statically and Supabase repositories dynamically:

```ts
export function createServices(options: CreateServicesOptions) {
  if (options.mode === 'memory') {
    return {
      postRepo: new MemoryPostRepository(),
      // ...
    };
  }
  return buildSupabaseServices(options.supabase);
}

async function buildSupabaseServices(supabase: SupabaseClient) {
  const [{ SupabasePostRepository }, /* ... */] = await Promise.all([
    import('./repositories/post-supabase.js'),
    // ...
  ]);
  return {
    postRepo: new SupabasePostRepository(supabase),
    // ...
  };
}
```

Why bother? Because the Triad test runner loads `services.ts` as part of loading `test-setup.ts`, and a static `import { SupabasePostRepository } from './repositories/post-supabase.js'` would drag `@supabase/supabase-js` into every test run. For a small example the cost is invisible; for a large application the startup difference is measurable. The dynamic import keeps memory-mode callers — which is every test — from ever touching the Supabase client library at import time.

This is a minor optimization. If you don't care, drop the dynamic import and make `createServices` synchronous again. Nothing about the interface design requires it.

### Generated Supabase types

Supabase can generate TypeScript types from your Postgres schema:

```bash
supabase gen types typescript --project-id <ref> > src/generated/supabase.ts
```

Should you use those inside your repository? Yes — typed row interfaces catch snake_case typos at compile time and survive schema drift. But they should **stop at the repository boundary**. Don't leak the generated `Database['public']['Tables']['posts']['Row']` type into handlers or endpoint schemas. The Triad `Post` model is the wire contract; the generated type is an implementation detail.

A typical wiring:

```ts
import type { Database } from '../generated/supabase.js';
type PostRow = Database['public']['Tables']['posts']['Row'];

export class SupabasePostRepository implements PostRepository {
  private rowToApi(row: PostRow): Post { /* ... */ }
}
```

## 7. Realtime — Supabase Realtime as your channel backend

Triad's channel model (see [`docs/phase-9-websockets.md`](../phase-9-websockets.md)) is currently only implemented by `@triadjs/fastify`. Hono's WebSocket helpers are runtime-specific (`hono/bun`, `hono/cloudflare-workers`, `hono/deno`), and unifying them into a single adapter is a non-goal for v1.

For Supabase users this is fine, because **you probably want Supabase Realtime anyway**. Supabase Realtime is a WebSocket fan-out layer driven by Postgres logical replication. When you insert a row, Supabase Realtime fires to every connected client subscribed to that table, with no application code in the middle.

A typical pattern: Triad endpoint validates + writes + returns, Supabase Realtime handles the fan-out to other connected clients.

```ts
// Server: Triad endpoint just writes to Postgres
export const createPost = endpoint({
  method: 'POST',
  path: '/posts',
  beforeHandler: requireAuth,
  handler: async (ctx) => {
    const post = await ctx.services.postRepo.create({
      authorId: ctx.state.user.id,
      title: ctx.body.title,
      body: ctx.body.body,
    });
    // That's it. Supabase Realtime sees the INSERT via logical
    // replication and fans out to subscribed clients.
    return ctx.respond[201](post);
  },
});
```

```ts
// Client: subscribe to post inserts
const channel = supabase
  .channel('posts')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'posts' },
    (payload) => {
      const parsed = Post.validate(payload.new);
      if (parsed.success) {
        renderNewPost(parsed.data);
      }
    },
  )
  .subscribe();
```

Two things to note:

1. **The client re-validates the payload.** Supabase Realtime hands you the raw row — snake_case, no mapping. Treat it as untrusted and validate it against the Triad schema before using it, same as any other network input. (You can share the Triad schemas between client and server by publishing them as a package, exactly like `@triadjs/tanstack-query` does.)
2. **Triad channels are NOT involved.** Your client talks to Supabase Realtime directly. Triad's role is defining the shape that gets validated on both ends. Don't try to proxy Realtime through a Triad channel — the value is in cutting out the middleman.

When you NEED a Triad channel (rich server-side validation, typed broadcast, client-side `@triadjs/tanstack-query` integration), deploy to a Node host with `@triadjs/fastify` instead. Trying to run Fastify on Deno Edge is not the right call.

## 8. Storage — Supabase Storage from a Triad handler

Supabase Storage is an S3-compatible file store exposed through the same `@supabase/supabase-js` client. You can use it from a Triad handler without ceremony:

```ts
export const uploadAvatar = endpoint({
  method: 'POST',
  path: '/me/avatar',
  beforeHandler: requireAuth,
  request: {
    body: t.model('UploadAvatar', {
      filename: t.string().minLength(1).maxLength(200),
      contentType: t.string(),
      dataBase64: t.string().doc('Base64-encoded file bytes'),
    }),
  },
  responses: {
    201: {
      schema: t.model('AvatarUploaded', { url: t.string().format('uri') }),
      description: 'Avatar uploaded',
    },
    401: { schema: ApiError, description: 'Unauthenticated' },
  },
  handler: async (ctx) => {
    const bytes = Uint8Array.from(atob(ctx.body.dataBase64), (c) => c.charCodeAt(0));
    const path = `${ctx.state.user.id}/${ctx.body.filename}`;
    const { error } = await ctx.services.supabase.storage
      .from('avatars')
      .upload(path, bytes, { contentType: ctx.body.contentType, upsert: true });
    if (error) throw new Error(error.message);
    const { data } = ctx.services.supabase.storage.from('avatars').getPublicUrl(path);
    return ctx.respond[201]({ url: data.publicUrl });
  },
});
```

Two notes:

1. **Base64 is a convenience, not a recommendation.** For real uploads, prefer Supabase's signed-URL flow: your API generates a short-lived upload URL, the client PUTs the file directly to Storage, and then the client tells your API to record the reference. That keeps the large file bytes off your Edge Function's request path.
2. **Storage has its own RLS-like policies.** Enable them on the bucket so clients can't read each other's avatars. Same defense-in-depth story as §5.

## 9. Cron + background jobs

Supabase supports scheduled invocations via `pg_cron`. You give it a cron expression and a SQL statement, and it runs on a schedule inside your Postgres database. Combined with `pg_net`, that SQL can `POST` to an Edge Function — which is how you get "call my Triad endpoint every hour" for free.

Pattern: expose a cron endpoint on your Triad router, protect it with a shared-secret header (NOT Supabase Auth — there is no user JWT for a cron job), and invoke it from `pg_cron`:

```ts
const CRON_SECRET = Deno.env.get('CRON_SHARED_SECRET')!;

export const cleanupOldPosts = endpoint({
  method: 'POST',
  path: '/cron/cleanup-old-posts',
  request: {
    headers: t.model('CronHeaders', {
      'x-cron-secret': t.string().doc('Shared secret from pg_cron'),
    }),
  },
  responses: {
    200: { schema: t.model('CleanupResult', { deleted: t.int32() }), description: 'OK' },
    401: { schema: ApiError, description: 'Bad secret' },
  },
  handler: async (ctx) => {
    if (ctx.headers['x-cron-secret'] !== CRON_SECRET) {
      return ctx.respond[401]({ code: 'UNAUTHORIZED', message: 'Bad secret' });
    }
    const deleted = await ctx.services.postRepo.deleteOlderThan(/* 90 days */);
    return ctx.respond[200]({ deleted });
  },
});
```

And the `pg_cron` entry:

```sql
select cron.schedule(
  'cleanup-old-posts',
  '0 3 * * *',                      -- 03:00 UTC daily
  $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/api/cron/cleanup-old-posts',
    headers := jsonb_build_object('x-cron-secret', '<secret>', 'content-type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
```

The shared-secret check is the whole authentication story for cron. Don't try to synthesize a JWT for `pg_cron`; just let the secret be the proof.

## 10. Deploying to Supabase Edge Functions

Prerequisites:

- Supabase CLI installed (`brew install supabase/tap/supabase`).
- A Supabase project you can deploy to.
- Tables and RLS policies from §5 applied.

From the example directory:

```bash
cd examples/supabase-edge
supabase link --project-ref <your-ref>
supabase functions deploy api
```

The CLI packages up `supabase/functions/api/` (including any other files it references via relative paths), uploads them, and spins up the function. Environment variables go through `supabase secrets`:

```bash
supabase secrets set SUPABASE_URL=https://<your-ref>.supabase.co
supabase secrets set SUPABASE_ANON_KEY=<anon-key>
```

Invoke it:

```bash
curl -H "Authorization: Bearer <jwt>" \
  https://<your-ref>.supabase.co/functions/v1/api/me
```

Check logs:

```bash
supabase functions logs api
```

### The `deno.json` import map

Deno resolves bare specifiers via an import map. Ours (`supabase/functions/api/deno.json`):

```json
{
  "imports": {
    "@triadjs/core": "npm:@triadjs/core@*",
    "@triadjs/hono": "npm:@triadjs/hono@*",
    "hono": "npm:hono@^4",
    "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2"
  }
}
```

Two things:

1. **`npm:` specifiers** let Deno pull packages from the npm registry. Pin to whatever is in your `package.json` — `@*` is fine for examples but risky for production. A concrete `@0.1.0` is better.
2. **`https://esm.sh/...`** is a CDN that re-exports npm packages as ES modules, and it's what most "Deno-native" Supabase examples use. It works identically to `npm:` for supabase-js; pick whichever style your team prefers.

### Cold starts

Edge Functions have cold-start time. Triad's in-process router is fast (~few ms), but the real costs are:

- Loading the Hono + Triad bundle.
- Loading `@supabase/supabase-js`.
- The first `auth.getUser` call — network round-trip.

The total is typically under 500ms; for most APIs that's fine. If you need lower tail latency, look at Supabase's "Deno Deploy" integration or fall back to a traditional Node host with `@triadjs/hono` or `@triadjs/fastify`.

### The Node dev server vs the Deno deploy target

This example ships two entry points:

- `src/server.ts` — Node, uses `@hono/node-server`, in-memory services. For `npm run dev` on your laptop.
- `supabase/functions/api/index.ts` — Deno, uses `Deno.serve`, real Supabase services. For `supabase functions deploy`.

They share `src/app.ts` (the router) and `src/services.ts` (the factory). Nothing about the endpoints or schemas differs between the two — the adapter + services are the only runtime-aware layers. That's the "adapter at the edge" payoff you get from Triad's design.

## 11. Testing strategy

Tests run against `MemoryPostRepository`, `MemoryCommentRepository`, and `MemoryAuthVerifier`. The rationale has three parts:

1. **CI independence.** Builds that depend on network access to a third-party API fail for reasons unrelated to your code. Kill that class of flakes by never making the call.
2. **Speed.** Triad's in-process test runner executes 20+ scenarios in under a second. Adding a ~100ms network call per scenario would blow the budget by 20×.
3. **Contract-driven design.** Your repositories implement `PostRepository` etc. If the interface is right, the two implementations are small enough to verify manually.

The manual verification procedure:

```bash
# 1. Deploy to a throwaway staging project
supabase functions deploy api --project-ref <staging>

# 2. Create a test user through the Supabase dashboard or API
supabase auth admin create-user --email test@example.com --password ...

# 3. Get a JWT via supabase-js (or the dashboard's "Impersonate")
# 4. Run curl against every endpoint, comparing responses to the
#    assertions your behavior scenarios check.
curl -H "Authorization: Bearer <jwt>" https://<staging>.supabase.co/functions/v1/api/posts
# ... etc
```

If you want automated integration tests against a real Postgres, use `supabase start` (requires Docker). It spins up a local Supabase stack — Postgres, Auth, Storage, Realtime — in containers. Point a second `test-setup.ts` at `http://localhost:54321` and run a separate `integration.test.ts` suite that never runs in the default `npm test` path. That's out of scope for the example but straightforward if you need it.

## 12. Migrating a non-Triad Supabase app

Say you have a Supabase project with ad-hoc Edge Function handlers written in raw Deno, and you want to adopt Triad without a rewrite. The step-by-step:

### Step 1: Wrap existing handlers

Pick one handler. Wrap it in an `endpoint()` declaration. Don't change the logic — just move it inside:

```ts
// Before: supabase/functions/posts/index.ts
Deno.serve(async (req) => {
  const body = await req.json();
  // ... validate manually, query Postgres, return Response
});

// After: src/endpoints/posts.ts
export const createPost = endpoint({
  method: 'POST',
  path: '/posts',
  request: { body: CreatePost },  // auto-validated
  responses: { 201: { schema: Post, description: '...' } },
  handler: async (ctx) => {
    // Same logic, now with typed ctx.body and ctx.respond
  },
});
```

You've gained: request validation, typed body, declared responses, and a place to attach behavior scenarios. You've lost: nothing.

### Step 2: Extract schemas

Pull your request/response shapes into `t.model(...)` declarations. This is the "single source of truth" step — the schemas become the thing that drives runtime validation, TypeScript types, OpenAPI docs, and (later) client codegen.

### Step 3: Add behavior scenarios

For each endpoint, add a handful of `scenario(...)` declarations. Start with the happy path and the most dangerous failure mode. You don't need to be exhaustive — even two scenarios per endpoint is a step up from zero.

### Step 4: Wire up `requireAuth`

Replace your ad-hoc JWT verification (if any) with the `requireAuth` beforeHandler and an `AuthVerifier` service. Now auth is declarative, testable, and impossible to forget.

### Step 5: Switch the deploy target

Replace `Deno.serve(...)` with `createTriadApp(router, ...)`. The URL stays the same; the function handle is now a typed router instead of a hand-rolled switch statement.

At each step the app still runs end-to-end. You can ship every step independently.

## 13. What NOT to do

A checklist of mistakes that will bite you:

- **Don't use the service role key in a user-facing endpoint.** It bypasses RLS. Use the anon key and forward the caller's JWT.
- **Don't create a module-level `supabase = createClient(...)`.** It won't have the caller's JWT and RLS will run as anonymous. Construct it per-request.
- **Don't skip RLS and rely only on application checks.** One bug in the application layer = full data leak. Belt and braces.
- **Don't try to run `@triadjs/fastify` in an Edge Function.** Fastify needs `http.Server` which Deno Edge doesn't provide. Use `@triadjs/hono`.
- **Don't put the Deno entry file inside `src/`.** tsc will try to compile it and fail on `https://` imports, `.ts` extensions, and the `Deno` global. Keep it under `supabase/functions/api/` and exclude the subtree in `tsconfig.json`.
- **Don't `npm install @triadjs/core` from inside the Deno function.** Use `npm:@triadjs/core@*` specifiers in the import map. The file will still work on Node if you import it from `src/` (via the `.ts` relative path) but the Edge runtime needs the Deno-native form.
- **Don't rely on `user_metadata` for anything security-relevant.** Users can supply arbitrary metadata during sign-up in many Supabase configurations. Treat it as untrusted display data.
- **Don't forget the `with check` clause on INSERT/UPDATE RLS policies.** `using` gates reads and filters updates; `with check` gates the NEW row. Omit `with check` and a user can update their own row to set `author_id = some-other-user`, which is bad.

## 14. FAQ

**Does this work with non-Supabase Deno Deploy?**

Yes. Drop the Supabase client, replace it with whatever auth and storage you use, and keep the `@triadjs/hono` + `Deno.serve` structure. The adapter is the portable layer.

**Can I use Prisma with Supabase?**

Yes, via the Postgres connection string. Prisma works fine as a library; use it in a long-running Node host or a Deno Deploy target. Edge Functions are trickier because Prisma's query engine is a native binary that doesn't run on every edge runtime. See [`docs/guides/choosing-an-orm.md`](./choosing-an-orm.md) for details.

**Why Hono and not Fastify?**

Fastify requires Node's `http` module. Hono is built on the Web Fetch API and runs unchanged on Deno, Bun, Cloudflare Workers, and Node (via `@hono/node-server`). For edge runtimes, Hono is the only choice among Triad's first-party adapters.

**What about Supabase's generated TypeScript types?**

Run `supabase gen types typescript --project-id <ref> > src/generated/supabase.ts` and import `Database['public']['Tables']['posts']['Row']` inside your repositories. Stop at the repository boundary — your Triad schemas remain the wire contract. Handlers should never see generated types directly.

**How do I handle migrations?**

Supabase CLI ships a migration system (`supabase migration new`). Run `supabase db push` to apply them to your linked project. Keep migrations in `supabase/migrations/`; they are orthogonal to Triad.

**Can I use both PostgREST and Triad on the same project?**

Yes, and you probably should. Let PostgREST handle the boring CRUD tables; use Triad for the endpoints that have real domain logic. They share the same Postgres, the same Supabase Auth, and the same RLS policies. Your client code picks the URL: `https://<ref>.supabase.co/rest/v1/...` for PostgREST, `https://<ref>.supabase.co/functions/v1/api/...` for your Triad function.

**How do I write integration tests against a real Supabase instance?**

Run `supabase start` (Docker required). It spins up the whole Supabase stack locally at `http://localhost:54321`. Write a separate `test-setup-integration.ts` that calls `createServices({ mode: 'supabase', supabase })` pointed at the local instance and runs a subset of scenarios. Keep it out of the default `npm test` path so it only runs when you ask for it.

**Is there a channels story for Edge runtimes?**

Not through Triad in v1. Use Supabase Realtime from the client directly (see §7) and share your Triad schemas between client and server for end-to-end validation. Full Triad channel support on Edge runtimes is tracked on the roadmap.

---

## See also

- **[`examples/supabase-edge`](../../examples/supabase-edge)** — the full working example this guide documents.
- **[`docs/guides/choosing-an-adapter.md`](./choosing-an-adapter.md)** — when to pick Hono vs Fastify vs Express.
- **[`docs/guides/choosing-an-orm.md`](./choosing-an-orm.md)** — the BYO-ORM patterns that underpin this guide's repository split.
- **[`docs/ai-agent-guide.md`](../ai-agent-guide.md)** — the canonical Triad API reference.
- **[`docs/ddd-patterns.md`](../ddd-patterns.md)** — §7 covers ownership patterns in depth.
- **[Supabase docs](https://supabase.com/docs)** — for everything about the Supabase side of the stack.
