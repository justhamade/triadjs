---
name: triad-endpoint
description: Use when declaring TriadJS HTTP endpoints with `endpoint()`, wiring `request`/`responses`/`handler`/`beforeHandler`, building a router with `createRouter` and `router.context()` bounded contexts, designing auth via `beforeHandler`, or debugging `ctx.respond`/`ctx.state`/`ctx.services`.
---

# Endpoints and routers

## `endpoint()` signature

```ts
import { endpoint, scenario, t } from '@triadjs/core';

export const createPet = endpoint({
  name: 'createPet',            // operationId in OpenAPI — must be unique
  method: 'POST',               // 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: '/pets',                // Express-style (/pets/:id)
  summary: 'Create a new pet',  // one-line human summary
  description: 'Longer prose.', // optional, flows into OpenAPI
  tags: ['Pets'],               // used to group operations in OpenAPI
  request: {
    body: CreatePet,
    params: { id: t.string() },
    query: { limit: t.int32().default(20) },
    // headers: { xRequestId: t.string().optional() },
  },
  beforeHandler: requireAuth,   // optional — see §Auth below
  responses: {
    201: { schema: Pet,      description: 'Created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    409: { schema: ApiError, description: 'Duplicate' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo.create({
      ownerId: ctx.state.user.id,  // typed state from beforeHandler
      ...ctx.body,
    });
    return ctx.respond[201](pet);
  },
  behaviors: [ /* scenarios — see triad-behaviors skill */ ],
});
```

Return value is a normalized `Endpoint` — pass it to `router.add(...)`.

## `HandlerContext` — what `ctx` contains

Everything on `ctx` is inferred from the `request` and `responses` declarations:

| Field | Type |
|---|---|
| `ctx.params` | Inferred from `request.params` (or `{}`) |
| `ctx.query` | Inferred from `request.query` |
| `ctx.body` | Inferred from `request.body` (or `undefined`) |
| `ctx.headers` | Inferred from `request.headers` |
| `ctx.services` | `ServiceContainer` (module-augment it — see `triad-services` skill) |
| `ctx.state` | `Readonly<TBeforeState>` — state produced by the endpoint's `beforeHandler`. `{}` when no hook is declared |
| `ctx.respond` | `{ [status]: (data) => HandlerResponse }` — only declared statuses are present |

`ctx.respond[201](body)` validates `body` against the schema declared for status 201 and wraps it as `{ status: 201, body }`. Calling `ctx.respond[500](...)` when 500 is not declared is a **compile error**.

## `request.params`, `request.query`, `request.headers` — two forms

```ts
// Inline shape (wrapped in an anonymous model named `${endpointName}Params`)
request: {
  params: { id: t.string().format('uuid') },
  query:  { limit: t.int32().default(20), cursor: t.string().optional() },
}

// Named ModelSchema (reusable, emitted as a component)
const AuthHeaders = t.model('AuthHeaders', { authorization: t.string() });
request: { headers: AuthHeaders }
```

Use inline for one-off shapes; use a named `ModelSchema` when the shape is reusable or should appear as an OpenAPI component.

## Auth — `beforeHandler`

Triad ships **one** extension point on `endpoint()`: `beforeHandler`. It is the declarative hook for authentication, tenant resolution, feature flags, and any cross-cutting concern that inspects the raw request before schema validation runs.

**Key properties:**

- **Singular, not an array.** One endpoint, one hook. Compose multiple concerns with plain function calls inside your own hook. There is no `beforeHandler: [a, b]` form and no router-level hook.
- **Runs BEFORE request schema validation.** Auth can reject missing/malformed headers as 401 without the validator 400-ing first. You do NOT need to declare the `authorization` header in `request.headers`.
- **Returns `{ ok: true, state }` or `{ ok: false, response }`.** On success, `state` is threaded into `ctx.state` (readonly) on the main handler, with its type inferred from the return. On short-circuit, the main handler is NEVER called.
- **Type-safe short-circuits.** `ctx.respond[...]` inside `beforeHandler` is keyed on the same `responses` config, so a 401 short-circuit only compiles when 401 is declared.

```ts
// src/auth.ts — a reusable hook
import type { BeforeHandler } from '@triadjs/core';
import type { ApiError } from './schemas/common.js';

export type AuthState = { user: User };

export const requireAuth: BeforeHandler<
  AuthState,
  { 401: { schema: typeof ApiError; description: string } }
> = async (ctx) => {
  const token = parseBearer(ctx.rawHeaders['authorization']);
  if (!token) {
    return { ok: false, response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'Missing bearer token' }) };
  }
  const user = await ctx.services.userRepo.findByToken(token);
  if (!user) {
    return { ok: false, response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'Invalid token' }) };
  }
  return { ok: true, state: { user } };
};
```

Use in an endpoint:

```ts
export const createProject = endpoint({
  // ...
  beforeHandler: requireAuth,
  responses: {
    201: { schema: Project, description: 'Created' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const project = await ctx.services.projectRepo.create({
      ownerId: ctx.state.user.id,  // typed; no unpack needed
      name: ctx.body.name,
    });
    return ctx.respond[201](project);
  },
});
```

**Composing hooks:** write a thin wrapper that calls multiple functions inside one `beforeHandler`:

```ts
const protectedEndpoint = <P, Q, B, H, R, S>(cfg: EndpointConfig<P, Q, B, H, R, S>) =>
  endpoint({ ...cfg, beforeHandler: requireAuth });
```

## The router

```ts
import { createRouter } from '@triadjs/core';

const router = createRouter({
  title: 'Petstore API',
  version: '1.0.0',
  description: 'Pets and adoptions',
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
});

// Flat registration
router.add(createPet, getPet, listPets);

// Or group by DDD bounded context
router.context(
  'Pets',
  {
    description: 'Pet catalog and CRUD',
    models: [Pet, CreatePet, UpdatePet, ApiError],
  },
  (ctx) => {
    ctx.add(createPet, getPet, listPets, updatePet);
  },
);

export default router;
```

**Bounded contexts do three things:**
1. Group endpoints in Gherkin output (one `.feature` file per context).
2. Declare the context's ubiquitous language via `models[]`. `triad validate` warns if an endpoint inside the context uses a model that isn't on the list.
3. Can hold both HTTP endpoints and WebSocket channels — `ctx.add(createPet, chatRoom)` works.

> **Always default-export the router.** The CLI loads it via `import(...)`.

## Common patterns

### CRUD

```ts
export const createPet = endpoint({ name: 'createPet', method: 'POST',   path: '/pets',      /* ... */ });
export const getPet    = endpoint({ name: 'getPet',    method: 'GET',    path: '/pets/:id',  /* ... */ });
export const listPets  = endpoint({ name: 'listPets',  method: 'GET',    path: '/pets',      /* ... */ });
export const updatePet = endpoint({ name: 'updatePet', method: 'PATCH',  path: '/pets/:id',  /* ... */ });
export const deletePet = endpoint({ name: 'deletePet', method: 'DELETE', path: '/pets/:id',  /* ... */ });
```

### Paginated list with filters

```ts
request: {
  query: {
    species: t.enum('dog', 'cat', 'bird', 'fish').optional().doc('Filter by species'),
    limit:   t.int32().min(1).max(100).default(20).doc('Page size'),
    offset:  t.int32().min(0).default(0).doc('Page offset'),
  },
},
handler: async (ctx) => {
  const pets = await ctx.services.petRepo.list({
    limit: ctx.query.limit,
    offset: ctx.query.offset,
    ...(ctx.query.species !== undefined && { species: ctx.query.species }),
  });
  return ctx.respond[200](pets);
},
```

### File upload (multipart)

```ts
const AvatarUpload = t.model('AvatarUpload', {
  name: t.string().minLength(1),
  avatar: t.file().maxSize(5 * 1024 * 1024).mimeTypes('image/png', 'image/jpeg'),
});

export const uploadAvatar = endpoint({
  name: 'uploadAvatar',
  method: 'POST',
  path: '/avatars',
  summary: 'Upload a user avatar',
  request: { body: AvatarUpload },
  responses: {
    201: { schema: t.model('AvatarOk', { url: t.string() }), description: 'Uploaded' },
    400: { schema: ApiError, description: 'Validation error' },
  },
  handler: async (ctx) => {
    const file = ctx.body.avatar;
    const url = await ctx.services.storage.put(file.buffer, { filename: file.name, contentType: file.mimeType });
    return ctx.respond[201]({ url });
  },
});
```

### 204 No Content

```ts
responses: { 204: { schema: t.empty(), description: 'Deleted' } },
handler: async (ctx) => {
  await ctx.services.petRepo.delete(ctx.params.id);
  return ctx.respond[204](); // zero-arg — passing a body is a compile error
}
```

### Error envelope — standardize on one `ApiError` model

```ts
export const ApiError = t.model('ApiError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable message'),
  details: t.record(t.string(), t.unknown()).optional(),
});
```

Return it via `ctx.respond[4xx](apiError)` across every endpoint — one consistent envelope makes clients' lives dramatically easier.

## Checklist before committing an endpoint

1. `name` is unique across the router (operationId collisions are silent bugs in OpenAPI).
2. Path parameters appear in both `path` and `request.params`.
3. Every response status your handler can return is declared in `responses` — `ctx.respond[<undeclared>]` is a compile error, but uncaught throws aren't.
4. At least one behavior is attached. Consider adding `...scenario.auto()` for schema boundary coverage.
5. If auth is needed, use `beforeHandler: requireAuth` — don't parse headers in the main handler.
6. `handler` is thin: parse `ctx.body`/`ctx.params`, call a repository/service, map to `ctx.respond`. No business logic inline.
