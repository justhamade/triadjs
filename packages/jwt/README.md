# @triad/jwt

JWT verification for [Triad](https://github.com/ruvnet/triad) endpoints.
A tiny `BeforeHandler` factory that wraps [`jose`](https://github.com/panva/jose)
so any endpoint becomes auth-protected with a handful of lines and zero
middleware magic.

## Install

```bash
npm install @triad/jwt jose
```

`jose` is a **peer dependency**. `@triad/jwt` does not bundle it,
does not pin its version, and loads it lazily via dynamic import —
you bring your own version (5.x or 6.x today).

## Quick start — HS256 with a shared secret

```ts
import { endpoint, t } from '@triad/core';
import { requireJWT } from '@triad/jwt';

const User = t.model('User', {
  id: t.string(),
  email: t.string({ format: 'email' }),
});

const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

const requireAuth = requireJWT({
  secret: process.env.JWT_SECRET!,
  algorithms: ['HS256'],
  issuer: 'my-api',
  audience: 'my-api-users',
  extractUser: (claims) => ({
    id: claims.sub as string,
    email: claims.email as string,
  }),
});

export const getMe = endpoint({
  method: 'GET',
  path: '/me',
  beforeHandler: requireAuth,
  responses: {
    200: { schema: User, description: 'Current user' },
    401: { schema: ApiError, description: 'Not authenticated' },
  },
  handler: async (ctx) => ctx.respond[200](ctx.state.user),
});
```

`ctx.state.user` is fully typed — the generic `TUser` is inferred from
`extractUser`'s return type without any annotations on the handler.

## Quick start — JWKS with RS256 (production shape)

```ts
const requireAuth = requireJWT({
  jwksUri: 'https://my-auth.example.com/.well-known/jwks.json',
  issuer: 'https://my-auth.example.com',
  audience: 'my-api',
  algorithms: ['RS256'],
  extractUser: (claims) => ({
    id: claims.sub!,
    roles: (claims['https://my-app.com/roles'] as string[]) ?? [],
  }),
});
```

`requireJWT` caches the JWKS set on first use and reuses it across
requests — one HTTP fetch per key rotation, not one per request.

## Provider recipes

For full walkthroughs covering Auth0, Clerk, WorkOS, Firebase, Supabase,
NextAuth, API keys, session cookies, RBAC and multi-tenancy, see
[docs/guides/auth.md](../../docs/guides/auth.md).

## Options

| Field            | Type                                   | Default                            | Notes                                                                |
| ---------------- | -------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `jwksUri`        | `string`                               | —                                  | Required unless `secret` is set. Mutually exclusive with `secret`.   |
| `secret`         | `string \| Uint8Array`                 | —                                  | Required unless `jwksUri` is set. UTF-8 encoded internally.          |
| `issuer`         | `string \| string[]`                   | —                                  | Expected `iss`. Mismatch → 401.                                      |
| `audience`       | `string \| string[]`                   | —                                  | Expected `aud`. **Do not skip.**                                     |
| `algorithms`     | `string[]`                             | `['RS256', 'ES256', 'HS256']` (jose default) | Restrict to what your issuer uses.                                   |
| `clockTolerance` | `number` (seconds)                     | `5`                                | Tolerance for `exp`/`nbf`.                                           |
| `extractUser`    | `(claims) => TUser`                    | —                                  | Required. Maps verified claims onto your domain user type.           |
| `onVerified`     | `(claims, user) => void \| Promise`    | —                                  | Post-verification hook for audit logging or revocation checks.       |

## `extractUser` — why you define the user shape

Triad does not ship an opinion about what a user is. Your JWT may carry
`sub`, `email`, and roles under `https://my-app.com/roles`; another app
may embed a tenant id, a plan tier, or a feature flag list. `extractUser`
is the single seam where you translate issuer-specific claims into your
application's domain `User` type.

Throwing from `extractUser` produces a typed 401. Use this to enforce
"the token verified, but it doesn't describe a user we'll accept" —
for example, when `sub` is missing or a required custom claim is absent.

## `onVerified` — audit logging and revocation

```ts
const requireAuth = requireJWT({
  jwksUri: '...',
  extractUser: (claims) => ({ id: claims.sub! }),
  onVerified: async (claims, user) => {
    if (await revocationCache.has(claims.jti!)) {
      throw new Error('token revoked');
    }
    auditLog.push({ at: Date.now(), userId: user.id, jti: claims.jti });
  },
});
```

Throwing from `onVerified` maps to a 401 — the request is rejected
before the main handler runs.

## Typed `ctx.state.user`

```ts
interface Me { id: string; tenantId: string; roles: string[]; }

const requireAuth = requireJWT({
  jwksUri: '...',
  extractUser: (claims): Me => ({
    id: claims.sub!,
    tenantId: claims['tenant_id'] as string,
    roles: claims['roles'] as string[],
  }),
});

// In the handler:
ctx.state.user.tenantId  // ✓ typed as string
ctx.state.user.whatever  // ✗ compile error
```

The generic `TUser` flows through `BeforeHandler<{ user: TUser }, ...>`
into `HandlerContext.state`, so no cast or annotation is needed at
the handler site.

## Security notes

- **Never log raw tokens.** Log the `jti` or a hash if you need
  correlation.
- **Prefer JWKS over shared secrets in production.** JWKS gives you
  key rotation for free; a leaked static HS256 secret forces a manual
  rotation across every verifier.
- **Always validate `audience`.** Missing audience validation lets a
  token minted for service A be replayed at service B — a classic
  CVE pattern.
- **Keep `clockTolerance` small.** Five seconds is plenty. Pushing
  past 60 should require a comment explaining why.
- **Do not mix HS256 with RS256 in the allowed algorithms list.**
  The "algorithm confusion" class of attacks relies on a verifier
  that accepts either.
- **Rotate secrets on a schedule.** Even if nothing has leaked.

## v1 non-goals

- **No session-based auth.** For SSR apps with server-side sessions,
  see the cookies pattern in [docs/guides/auth.md](../../docs/guides/auth.md#session-cookies-for-ssr-apps).
- **No token revocation list.** Use `onVerified` plus your own
  cache / database if you need short-notice revocation.
- **No automatic refresh.** Clients handle refresh on 401 — that's
  the right layering for an API package.
- **No OAuth dance.** Triad verifies already-issued tokens. The
  authorization code flow, device flow, and PKCE are handled by
  your identity provider (Auth0, Clerk, …) or a dedicated library.

## See also

- [docs/guides/auth.md](../../docs/guides/auth.md) — the full auth
  cookbook with provider recipes and pattern discussion.
- [`@triad/core`](../core) — `BeforeHandler`, `HandlerContext`,
  `checkOwnership`.
- [`jose`](https://github.com/panva/jose) — the underlying
  verification library.
