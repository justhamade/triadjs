# Authentication cookbook

> A consolidated guide to plugging authentication systems into Triad
> endpoints. Triad does not ship "an auth system" — it ships the
> plumbing so any auth system plugs in cleanly.

**Related reading**

- [`@triadjs/jwt`](../../packages/jwt/README.md) — the JWT verification package this cookbook leans on.
- [`@triadjs/core` — `BeforeHandler`](../../packages/core/src/before-handler.ts) — the underlying extension point.
- [`@triadjs/core` — `checkOwnership`](../../packages/core/src/ownership.ts) — the pairing helper for authorization.
- [Supabase guide](./supabase.md) — end-to-end Supabase walkthrough; the section here is deliberately short.

---

## Table of contents

1. [Overview — Triad's auth philosophy](#1-overview--triads-auth-philosophy)
2. [`@triadjs/jwt` deep dive](#2-triadjwt-deep-dive)
3. [Auth0](#3-auth0)
4. [Clerk](#4-clerk)
5. [WorkOS](#5-workos)
6. [Firebase Auth](#6-firebase-auth)
7. [Supabase Auth](#7-supabase-auth)
8. [NextAuth.js / Auth.js](#8-nextauthjs--authjs)
9. [Session cookies for SSR apps](#9-session-cookies-for-ssr-apps)
10. [API keys for server-to-server](#10-api-keys-for-server-to-server)
11. [Multi-tenancy](#11-multi-tenancy)
12. [RBAC and permissions](#12-rbac-and-permissions)
13. [What NOT to build](#13-what-not-to-build)
14. [FAQ](#14-faq)

---

## 1. Overview — Triad's auth philosophy

Triad takes the position that authentication is an _application concern_,
not a framework concern. The framework's job is to give you a single
well-typed extension point and stay out of the way. That extension point
is `beforeHandler`.

Every protected endpoint declares its own `beforeHandler`. The hook
runs before the request schema validates, reads raw headers / cookies /
query, and either:

- returns `{ ok: true, state: {...} }` — the typed state is threaded
  into `ctx.state` for the main handler, OR
- returns `{ ok: false, response: ctx.respond[401](...) }` — the main
  handler never runs, the response is dispatched directly, and the
  response body is still validated against the declared schema for
  that status so a buggy `beforeHandler` cannot leak malformed data.

There is no middleware chain. Composition happens in plain functions:
one `beforeHandler` calls another, inspects its result, and either
short-circuits or augments its state. This is boring on purpose — you
never walk a middleware stack to find where auth lives.

### The three layers

Authentication answers three separable questions:

| Layer              | Question                                       | Triad primitive                         |
| ------------------ | ---------------------------------------------- | --------------------------------------- |
| **Authentication** | Who are you? Prove it.                         | `requireJWT`, `requireSession`, `requireApiKey` |
| **Authorization**  | What are you allowed to do with _this_ thing?  | `checkOwnership`, custom role checks    |
| **Session**        | How long are you still you?                    | Your session store / JWT expiry         |

Bundle these and you get "a login system". Keep them separate and you
get a set of small, testable, composable pieces.

### Decision matrix

| You have…                               | Use…                   | Why                                                    |
| --------------------------------------- | ---------------------- | ------------------------------------------------------ |
| SPA or mobile client hitting a JSON API | JWT (`@triadjs/jwt`)     | Stateless, cacheable, plays well with CDNs and edges.  |
| Server-rendered app (Next / Remix)      | Session cookies        | HttpOnly cookies + CSRF tokens. No token in JS.        |
| Service-to-service calls                | API keys               | Long-lived, stored hashed, scoped per integration.     |
| Third-party identity (Auth0 / Clerk)    | JWT + JWKS             | Let the provider rotate keys; you just verify.         |
| Mixed (SSR + internal API)              | Session + internal JWT | Session at the edge, short-lived JWT for service hops. |

Pick one answer per boundary. Do not run JWT on top of session cookies
on top of API keys "for defence in depth" — you get three bug classes
for the price of one.

---

## 2. `@triadjs/jwt` deep dive

`@triadjs/jwt` is a single factory: `requireJWT`. It returns a
`BeforeHandler` that reads `Authorization: Bearer <token>`, verifies
the token with the configured key material, and attaches a typed
user object to `ctx.state.user`.

### Minimal example

```ts
import { requireJWT } from '@triadjs/jwt';

export const requireAuth = requireJWT({
  jwksUri: 'https://issuer.example.com/.well-known/jwks.json',
  issuer: 'https://issuer.example.com',
  audience: 'my-api',
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string,
  }),
});
```

Use it at an endpoint site:

```ts
endpoint({
  method: 'GET',
  path: '/me',
  beforeHandler: requireAuth,
  responses: {
    200: { schema: User, description: 'The current user' },
    401: { schema: ApiError, description: 'Not authenticated' },
  },
  handler: async (ctx) => ctx.respond[200](ctx.state.user),
});
```

### JWKS vs static secrets

- **Production**: JWKS (`jwksUri`). The provider rotates keys without
  your code ever changing. `@triadjs/jwt` caches the JWKS set on first
  use and re-fetches only when a new `kid` appears.
- **Development / internal tools**: a shared `secret` with HS256 is
  acceptable if you control both issuer and verifier. Never use a
  shared secret across a trust boundary.

### `extractUser` patterns

```ts
// Lift a handful of claims to a flat user type.
extractUser: (claims) => ({
  id: claims.sub!,
  email: claims.email as string,
  roles: (claims['https://my-app.com/roles'] as string[]) ?? [],
}),

// Reject structurally-valid tokens that miss domain invariants.
extractUser: (claims) => {
  const tenantId = claims['tenant_id'];
  if (typeof tenantId !== 'string') {
    throw new Error('token missing tenant_id');
  }
  return { id: claims.sub!, tenantId };
},

// Keep the whole payload for handlers that need it.
extractUser: (claims) => claims,
```

### `onVerified` for audit logging and revocation

```ts
requireJWT({
  jwksUri: '...',
  extractUser: (claims) => ({ id: claims.sub! }),
  onVerified: async (claims, user) => {
    if (await revocationList.has(claims.jti!)) {
      throw new Error('revoked');
    }
    metrics.increment('auth.verified', { sub: user.id });
  },
});
```

Throwing from `onVerified` maps to a 401. This is the right layer for
"the signature verified but business rules reject this specific
token": revocation lists, tenant suspensions, emergency kill switches.

### Common pitfalls

1. **Forgetting to validate `audience`.** Tokens without an `aud`
   check can be replayed against other services that trust the same
   issuer. Always set `audience`.
2. **Allowing both HS and RS algorithms.** The classic "alg: none"
   and algorithm-confusion attacks depend on a verifier that accepts
   either family. Pin to one.
3. **High clock tolerance.** A token that is 10 minutes expired is
   expired. Five seconds covers NTP drift; anything more invites
   abuse.
4. **Trusting claims before verifying.** Never read `claims.sub`
   before `jwtVerify` has returned successfully. `@triadjs/jwt` enforces
   this at the API, but hand-rolled verifiers get it wrong all the
   time.
5. **Logging the raw token.** Tokens are bearer credentials. Log
   `jti` or a hash, never the token.

See [`packages/jwt/README.md`](../../packages/jwt/README.md) for the
full option reference.

---

## 3. Auth0

Auth0 issues RS256 JWTs and publishes a JWKS URI at
`https://YOUR_TENANT.auth0.com/.well-known/jwks.json`. You configure
`requireJWT` with the tenant's issuer and the API identifier you
registered in the Auth0 dashboard.

### Configuration

```ts
import { requireJWT } from '@triadjs/jwt';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN!;    // my-tenant.auth0.com
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE!; // https://api.my-app.com

export const requireAuth = requireJWT({
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
  issuer: `https://${AUTH0_DOMAIN}/`,   // note trailing slash
  audience: AUTH0_AUDIENCE,
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string | undefined,
    // Auth0 custom claims must be fully-qualified URIs by convention.
    roles: (claims['https://my-app.com/roles'] as string[] | undefined) ?? [],
    tenantId: claims['https://my-app.com/tenant_id'] as string | undefined,
  }),
});
```

Two easy-to-miss Auth0 gotchas:

1. **Issuer has a trailing slash.** Auth0 embeds
   `https://tenant.auth0.com/` (with the slash) as `iss`. Copy the
   string verbatim from a sample token, don't retype it.
2. **Custom claims need namespacing.** Auth0's rules engine rejects
   top-level custom claims. Use a URI prefix
   (`https://my-app.com/roles`) per Auth0's published conventions.

### Extracting roles

Store roles in an Auth0 Rule / Action:

```js
// Auth0 Action
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim(
    'https://my-app.com/roles',
    event.authorization?.roles ?? [],
  );
  api.accessToken.setCustomClaim(
    'https://my-app.com/roles',
    event.authorization?.roles ?? [],
  );
};
```

Then read from `claims['https://my-app.com/roles']` in `extractUser`.

### Multi-tenant Auth0 setup

Auth0 Organizations encode the tenant in the `org_id` claim. Lift it
in `extractUser` and gate per-tenant resources in a second
`beforeHandler`:

```ts
extractUser: (claims) => ({
  id: claims.sub as string,
  orgId: claims.org_id as string | undefined,
}),
```

Handlers then build per-tenant services from `ctx.state.user.orgId`
(see [§11 Multi-tenancy](#11-multi-tenancy)).

### Talking to the Auth0 Management API

You almost never need to. The JWT itself carries enough state for
auth decisions. Call the Management API only for true user-metadata
reads that don't belong in a token (billing status, last login, etc.)
and cache aggressively — the Management API has a low rate limit.

---

## 4. Clerk

Clerk is another third-party identity provider that issues verifiable
JWTs. The configuration shape is near-identical to Auth0; the
differences are the JWKS URL format and the session token shape.

### Configuration

```ts
const CLERK_ISSUER = 'https://YOUR_INSTANCE.clerk.accounts.dev';

export const requireAuth = requireJWT({
  jwksUri: `${CLERK_ISSUER}/.well-known/jwks.json`,
  issuer: CLERK_ISSUER,
  audience: process.env.CLERK_AUDIENCE, // optional, only if you set it
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    sessionId: claims.sid as string,
    orgId: claims.org_id as string | undefined,
    orgRole: claims.org_role as string | undefined,
  }),
});
```

### Session tokens vs JWT templates

Clerk issues two kinds of tokens:

- **Session tokens** (default from `getToken()`): short-lived, carry
  a minimal claim set (`sub`, `sid`, `exp`).
- **JWT templates**: you define the payload shape in the Clerk
  dashboard. Use these when you need custom claims or a specific
  audience.

Prefer JWT templates for API work — they give you deterministic
claim shapes and a stable `aud` to validate against.

### Revocation

Clerk sessions can be revoked from the dashboard or the API. To
respect revocation in near real-time, plug a cache into `onVerified`:

```ts
onVerified: async (claims) => {
  const sid = claims.sid as string;
  if (await revokedSessions.has(sid)) {
    throw new Error('session revoked');
  }
},
```

---

## 5. WorkOS

WorkOS AuthKit issues JWTs with a familiar shape. The main quirks
are the issuer URL format and the claim names for organization
data.

```ts
const WORKOS_ISSUER = 'https://api.workos.com/user_management';

export const requireAuth = requireJWT({
  jwksUri: `${WORKOS_ISSUER}/YOUR_CLIENT_ID/jwks`,
  issuer: WORKOS_ISSUER,
  audience: process.env.WORKOS_CLIENT_ID,
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string,
    organizationId: claims.org_id as string | undefined,
    role: claims.role as string | undefined,
  }),
});
```

WorkOS puts organization membership in `org_id` and the role in
`role`. For SSO-only deployments, the `sub` claim is the canonical
user id — you don't need a separate user table keyed on email.

---

## 6. Firebase Auth

Firebase issues JWTs signed with rotating Google-managed keys. The
JWKS endpoint is a Google-hosted URL and the issuer encodes your
Firebase project id.

```ts
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID!;

export const requireAuth = requireJWT({
  jwksUri:
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  issuer: `https://securetoken.google.com/${PROJECT_ID}`,
  audience: PROJECT_ID,
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string | undefined,
    emailVerified: claims.email_verified === true,
    // Firebase nests provider info here.
    provider: (claims.firebase as { sign_in_provider?: string } | undefined)
      ?.sign_in_provider,
  }),
});
```

Two Firebase-specific notes:

1. **`audience` equals the project id.** No `https://` prefix — just
   the raw project string.
2. **`email_verified` is a claim, not a side effect.** Enforce it in
   `extractUser` if your app requires verified emails:

   ```ts
   extractUser: (claims) => {
     if (claims.email_verified !== true) {
       throw new Error('email not verified');
     }
     return { id: claims.sub as string, email: claims.email as string };
   },
   ```

---

## 7. Supabase Auth

Supabase issues JWTs signed with the project's JWT secret (HS256 on
legacy projects) or via JWKS on newer projects.

```ts
const SUPABASE_ISSUER = 'https://YOUR_PROJECT.supabase.co/auth/v1';

export const requireAuth = requireJWT({
  jwksUri: `https://YOUR_PROJECT.supabase.co/auth/v1/.well-known/jwks.json`,
  issuer: SUPABASE_ISSUER,
  audience: 'authenticated',
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string | undefined,
    role: claims.role as string | undefined, // 'authenticated' | 'anon'
  }),
});
```

For an end-to-end walkthrough — including the Edge Functions adapter,
database-backed user lookups, and the AuthVerifier abstraction — see
[`docs/guides/supabase.md`](./supabase.md).

---

## 8. NextAuth.js / Auth.js

NextAuth is different from the providers above: in `jwt` session mode,
NextAuth signs its own tokens with a shared secret and stores them in
an HttpOnly cookie. If you have a separate Triad API service behind
the same NextAuth issuer, you share the secret and verify with HS256.

```ts
export const requireAuth = requireJWT({
  secret: process.env.NEXTAUTH_SECRET!,
  algorithms: ['HS256'],
  // NextAuth doesn't set issuer/audience by default — validate claim
  // presence in extractUser instead.
  extractUser: (claims) => {
    // NextAuth nests the user under `session.user` in some setups.
    // In others, the fields are at the top level. Check both.
    const sub = claims.sub as string | undefined;
    if (!sub) throw new Error('missing sub');
    return {
      id: sub,
      email: claims.email as string | undefined,
      name: claims.name as string | undefined,
    };
  },
});
```

Reading the token from a cookie instead of the `Authorization` header
requires a small wrapper — `requireJWT` only reads `Authorization`
today. Wrap it:

```ts
const requireAuthFromCookie: BeforeHandler<{ user: User }, With401> =
  async (ctx) => {
    const token = ctx.rawCookies['next-auth.session-token'];
    if (!token) {
      return { ok: false, response: ctx.respond[401](unauthError) };
    }
    // Synthesize an Authorization header for the inner hook.
    const inner = requireJWT({ /* …as above… */ });
    return inner({
      ...ctx,
      rawHeaders: { ...ctx.rawHeaders, authorization: `Bearer ${token}` },
    });
  };
```

This works but has a whiff — session cookies really want session
semantics, not JWT semantics. Consider [§9](#9-session-cookies-for-ssr-apps)
instead if your deployment is SSR-first.

---

## 9. Session cookies for SSR apps

JWT is the right answer for stateless APIs. Session cookies are the
right answer for server-rendered apps where the backend can keep
server-side state.

### Shape

1. The login handler creates a session record server-side and sets a
   signed `Set-Cookie: session=<opaque-id>; HttpOnly; Secure; SameSite=Lax`.
2. Every protected endpoint's `beforeHandler` reads the cookie,
   looks the id up in a `SessionStore`, and attaches the user.
3. Mutating requests additionally require a CSRF token header that
   matches a value stored in the session.

### A `SessionStore` interface

```ts
export interface SessionStore {
  create(userId: string): Promise<{ id: string; csrf: string }>;
  lookup(id: string): Promise<{ userId: string; csrf: string } | null>;
  destroy(id: string): Promise<void>;
}
```

Back it with Redis, Postgres, or in-memory for tests. The
`tasktracker` example's `TokenStore` is the same shape.

### The `requireSession` beforeHandler

```ts
import type { BeforeHandler } from '@triadjs/core';

export const requireSession: BeforeHandler<{ user: User }, With401> =
  async (ctx) => {
    const sessionId = ctx.rawCookies['session'];
    if (!sessionId) {
      return { ok: false, response: ctx.respond[401](unauthError) };
    }
    const session = await ctx.services.sessionStore.lookup(sessionId);
    if (!session) {
      return { ok: false, response: ctx.respond[401](unauthError) };
    }
    // CSRF for mutating verbs. Safe reads bypass.
    const method = ctx.rawHeaders['x-method'] ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      const submitted = ctx.rawHeaders['x-csrf-token'];
      if (submitted !== session.csrf) {
        return { ok: false, response: ctx.respond[401](csrfError) };
      }
    }
    const user = await ctx.services.userRepo.findById(session.userId);
    if (!user) {
      return { ok: false, response: ctx.respond[401](unauthError) };
    }
    return { ok: true, state: { user } };
  };
```

Key points:

- **Cookies are read from `ctx.rawCookies`**, not from `ctx.rawHeaders['cookie']`.
  The adapter has already parsed them.
- **CSRF is required on mutating requests.** SameSite=Lax defends
  against most cross-site POSTs, but a CSRF token closes the last
  gap (and protects Internet Explorer users if you still have any).
- **Session destroy on logout.** Logout endpoints call
  `sessionStore.destroy` before clearing the cookie.

### Rotating session ids

On privilege change (login, password change, role change), destroy
the old session and create a new one. This closes the session-fixation
attack.

---

## 10. API keys for server-to-server

Machine clients — cron jobs, integrations, data pipelines — have
different requirements than human users:

- Credentials are long-lived (months, not minutes).
- There is no "interactive login flow".
- Keys must be scoped to a subset of operations ("read-only",
  "webhook-only", …).
- Keys must be revocable without deploying code.

### Storage

**Never store API keys in plaintext.** Hash them on creation with a
slow hash (argon2, bcrypt, or scrypt — not SHA-256 alone) and
compare hashes on each request. Show the plaintext key to the user
exactly once, at creation time.

### A `requireApiKey` beforeHandler

```ts
export const requireApiKey: BeforeHandler<
  { apiKey: ApiKeyRecord },
  With401
> = async (ctx) => {
  const headerValue = ctx.rawHeaders['x-api-key'];
  if (typeof headerValue !== 'string') {
    return { ok: false, response: ctx.respond[401](unauthError) };
  }
  const record = await ctx.services.apiKeyRepo.findByHash(
    await hashApiKey(headerValue),
  );
  if (!record || record.revokedAt !== null) {
    return { ok: false, response: ctx.respond[401](unauthError) };
  }
  await ctx.services.apiKeyRepo.touchLastUsed(record.id);
  return { ok: true, state: { apiKey: record } };
};
```

### Scoped keys

Each key carries a set of allowed operations. Check the operation in
a second `beforeHandler`:

```ts
const requireScope = (scope: string): BeforeHandler<{}, With401> =>
  async (ctx) => {
    const key = ctx.state.apiKey; // from requireApiKey
    if (!key.scopes.includes(scope)) {
      return { ok: false, response: ctx.respond[401](forbiddenError) };
    }
    return { ok: true, state: {} };
  };
```

Compose them in the endpoint's `beforeHandler`:

```ts
beforeHandler: async (ctx) => {
  const a = await requireApiKey(ctx);
  if (!a.ok) return a;
  const ctxWithKey = { ...ctx, state: a.state };
  const b = await requireScope('webhooks:write')(ctxWithKey as never);
  if (!b.ok) return b;
  return { ok: true, state: a.state };
},
```

### Rotation

Let users create a new key, grace-period the old one for a week,
then revoke. Expose `revokedAt` rather than hard-deleting — you want
audit history.

---

## 11. Multi-tenancy

Multi-tenant APIs have a per-request _tenant scope_ that gates which
data a user can see. Triad handles this cleanly because
`beforeHandler` can construct per-request services.

### Where does the tenant come from?

Three common sources, in order of preference:

1. **A JWT claim** (`tenant_id`, `org_id`). Cryptographically bound
   to the authenticated user — the best option if your issuer can
   embed it.
2. **A subdomain** (`acme.api.example.com`). Good UX, easy caching.
3. **A request header** (`X-Tenant-Id`). Simplest, but the server
   must verify the user is allowed to use that tenant.

### Wiring it up

Combine `requireJWT` with a tenant extractor:

```ts
const requireAuth = requireJWT({
  jwksUri: '...',
  extractUser: (claims) => ({
    id: claims.sub as string,
    tenantId: claims['tenant_id'] as string,
  }),
});

const requireTenantScope: BeforeHandler<
  { user: User; tenantServices: TenantServices },
  With401
> = async (ctx) => {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth;
  const tenantServices = ctx.services.tenantFactory.forTenant(
    auth.state.user.tenantId,
  );
  return {
    ok: true,
    state: { user: auth.state.user, tenantServices },
  };
};
```

The tenant factory closes over the tenant id and returns
repositories that only see that tenant's rows. Your handlers then
use `ctx.state.tenantServices.petRepo.list()` without ever passing
the tenant id explicitly — the bug class "forgot to filter by
tenant" becomes a type error.

### Pairing with ownership checks

Even inside a tenant, a user can only modify their own resources:

```ts
handler: async (ctx) => {
  const pet = await ctx.state.tenantServices.petRepo.findById(ctx.params.id);
  const owned = checkOwnership(pet, ctx.state.user.id);
  if (!owned.ok) return ctx.respond[404](notFoundError);
  // ... safe to mutate pet
},
```

`checkOwnership` is the tiny helper in `@triadjs/core` that returns a
typed "yes this is yours" result so the handler's remaining logic
can stay on the happy path.

---

## 12. RBAC and permissions

Role-based and attribute-based access control both compose with
`beforeHandler`.

### Simple roles

```ts
const requireRole = (role: string): BeforeHandler<{}, With401> =>
  async (ctx) => {
    const user = (ctx as unknown as { state?: { user?: { roles: string[] } } })
      .state?.user;
    if (!user || !user.roles.includes(role)) {
      return { ok: false, response: ctx.respond[401](forbiddenError) };
    }
    return { ok: true, state: {} };
  };

const requireAdmin: BeforeHandler<{ user: User }, With401> = async (ctx) => {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth;
  if (!auth.state.user.roles.includes('admin')) {
    return { ok: false, response: ctx.respond[401](forbiddenError) };
  }
  return { ok: true, state: auth.state };
};
```

Write the composition out longhand. A `composeBeforeHandlers` helper
is tempting and I encourage you to resist — the plain-function
version is easier to read and easier to modify for one-off cases
like "admins from org X only".

### Permission sets

For finer-grained access, store a _permission set_ on the user and
check it per-operation:

```ts
const requirePermission = (perm: Permission) => async (ctx) => {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth;
  if (!auth.state.user.permissions.has(perm)) {
    return { ok: false, response: ctx.respond[401](forbiddenError) };
  }
  return { ok: true, state: auth.state };
};
```

### ABAC / policy engines

For rule systems complex enough to warrant a DSL, plug in a policy
engine (Casbin, Oso, OpenFGA, Cedar) inside `onVerified` or in a
dedicated `beforeHandler`:

```ts
const requirePolicy = (action: string, resource: string) => async (ctx) => {
  const auth = await requireAuth(ctx);
  if (!auth.ok) return auth;
  const allowed = await ctx.services.policyEngine.check({
    subject: auth.state.user.id,
    action,
    resource,
  });
  if (!allowed) {
    return { ok: false, response: ctx.respond[401](forbiddenError) };
  }
  return { ok: true, state: auth.state };
};
```

---

## 13. What NOT to build

A short list of footguns that have sunk real services. Avoid them.

- **Don't roll your own JWT verification.** `jose` is audited, fast,
  and free. Hand-rolled base64 + HMAC code gets alg-confusion bugs
  and nothing else.
- **Don't put tokens in URLs.** Query parameters and fragments leak
  into logs, referrers, and screenshots. Use headers or cookies.
- **Don't skip `audience` validation.** See §2 pitfalls.
- **Don't use HS256 across trust boundaries.** HS256 requires sharing
  a secret with every verifier. Leaked at one = compromised at all.
- **Don't store passwords reversibly.** Even "encrypted" with a key
  on the same disk is reversibly-stored. Use argon2 / bcrypt /
  scrypt hashed with a per-password salt.
- **Don't trust claims before verification.** Always `jwtVerify`
  first, then read claims from the verified payload.
- **Don't log raw tokens, cookies, or passwords.** Log the `jti`,
  the session id, or a hash.
- **Don't use `SameSite=None` without a very good reason.** `Lax` is
  the right default; `Strict` when you can tolerate it.
- **Don't expire sessions "never".** 30 days is generous. Idle
  expiration catches abandoned logins; absolute expiration caps
  blast radius.

---

## 14. FAQ

### Should I use JWT or sessions?

- **SSR apps** (Next, Remix, SvelteKit server routes): sessions.
  HttpOnly cookies + CSRF tokens. The browser never sees the token
  in JS.
- **SPA / mobile / service-to-service**: JWT. Stateless, cacheable,
  and the client already needs to pass tokens across a wire.
- **Both**: session at the edge (what the browser holds), short-lived
  JWT for internal hops between services. The user's browser never
  sees the JWT.

### How do I revoke a JWT before expiry?

Three options, in order of operational cost:

1. **Short expiry + refresh tokens.** 5-15 minute access tokens,
   1-30 day refresh tokens. On logout, revoke the refresh token and
   the user is out within one access-token lifetime. This is the
   recommended default.
2. **Revocation list in `onVerified`.** Maintain a Redis set of
   revoked `jti` values and check it on every request. Low latency,
   but now your "stateless" auth has state.
3. **Rotate the signing key.** Nuclear option — invalidates every
   token. Used rarely (suspected key compromise).

### Can I combine JWT with ownership checks?

Yes. `requireJWT` attaches the user to `ctx.state.user`, then the
handler uses `checkOwnership(resource, ctx.state.user.id)` on the
resource it just fetched. The two checks are independent: auth says
"you are Alice", ownership says "this post is Alice's".

### What about OAuth flows?

Triad doesn't handle the authorization code / device / PKCE dance.
That's what your identity provider (Auth0, Clerk, WorkOS, …) is
for. You receive the verified token they issued, call `requireJWT`,
and stop.

### Can I use `requireJWT` with HTTP/2 push, WebSockets, or SSE?

- **WebSockets**: pass the token as a subprotocol or on the first
  message. `@triadjs/core`'s `channel` API has its own `beforeHandler`
  slot on connect.
- **SSE**: EventSource doesn't support custom headers. Use a query
  param that proxies a short-lived token (note the URL-leak warning
  above), or tunnel SSE over `fetch` with a reader.
- **HTTP/2 push**: pass-through, same as normal requests.

### Why is there no `afterHandler`?

Out of scope for Triad v1. Response shaping belongs in the schema
validation pipeline. If you find yourself wanting one, the question
to ask first is: "could I have done this in the handler itself?"
Usually yes.

### How do I test a protected endpoint?

`@triadjs/test-runner` builds a fake `BeforeHandlerContext` and runs
the hook in isolation. For JWT: mint a test token with a test
secret, pass it in the `Authorization` header of the test request,
and assert against the response. `@triadjs/jwt`'s own test suite is a
small worked example — see
`packages/jwt/__tests__/require-jwt.test.ts`.
