# @triad/tanstack-query

Generate fully-typed [TanStack Query](https://tanstack.com/query) hooks
from a Triad router. Closes the single-source-of-truth loop: a change
to a Triad schema produces compile errors in the exact call sites on
the frontend.

## Install

```bash
npm install --save-dev @triad/tanstack-query
```

`@tanstack/react-query` is a peer concern: the generated code imports
from it, so your frontend app must have it installed:

```bash
npm install @tanstack/react-query
```

## Usage

```bash
triad frontend generate --target tanstack-query --output ./src/generated/api
```

Or via `triad.config.ts`:

```ts
import { defineConfig } from '@triad/test-runner';

export default defineConfig({
  router: './src/app.ts',
  frontend: {
    target: 'tanstack-query',
    output: './src/generated/api',
    baseUrl: '/api',
  },
});
```

## Output layout

```
./src/generated/api/
  index.ts        // barrel re-exporting everything
  types.ts        // interface for every named model + per-endpoint Params/Query/Headers
  query-keys.ts   // per-resource key factories (bookKeys, reviewKeys, ...)
  client.ts       // runtime fetch client + HttpError (safe to edit / replace)
  <context>.ts    // one file per bounded context, with its hooks
```

## Generated hook shape

For `GET /books/:bookId` (named `getBook` in the router):

```ts
export function useBook(
  params: GetBookParams,
  options?: Omit<UseQueryOptions<Book, HttpError>, 'queryKey' | 'queryFn'>,
): UseQueryResult<Book, HttpError> {
  return useQuery({
    queryKey: bookKeys.detail(params.bookId),
    queryFn: () => client.get<Book>(`/books/${params.bookId}`),
    ...options,
  });
}
```

For `POST /books`:

```ts
export function useCreateBook(
  options?: Omit<UseMutationOptions<Book, HttpError, { body: CreateBook }>, 'mutationFn'>,
): UseMutationResult<Book, HttpError, { body: CreateBook }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars) => client.post<Book>(`/books`, { body: vars.body }),
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: bookKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...options,
  });
}
```

## Query key strategy

The default strategy infers a "resource" from the last non-parameter
segment of each endpoint path:

- `/books` → `bookKeys.all = ['books']`
- `/books/:bookId` → `bookKeys.detail(id)`
- `/projects/:projectId/tasks` → `taskKeys` (nested resource)
- `/auth/login` → flat key `loginKey = ['auth', 'login']`

Singularisation is a small built-in heuristic (`books` → `Book`,
`stories` → `Story`, `classes` → `class`). If the heuristic picks the
wrong resource for your routes, file an issue with the path shape —
the custom strategy escape hatch is on the roadmap.

## Invalidation defaults

| Method | Invalidates |
| ------ | ----------- |
| `POST /resource` | `resourceKeys.lists()` |
| `PATCH/PUT /resource/:id` | `resourceKeys.detail(id)` + `resourceKeys.lists()` |
| `DELETE /resource/:id` | `resourceKeys.detail(id)` + `resourceKeys.lists()` |

Each hook forwards the user's own `onSuccess` after running the
built-in invalidations, so you can layer custom cache updates on top.

## Swapping the runtime client

`client.ts` is a small, self-contained fetch wrapper. It's generated
with the comment "safe to edit or replace" at the top. To add auth
headers, request signing, or a custom retry policy, either:

1. Replace `client.ts` with your own implementation (just preserve the
   method signatures), or
2. Keep your own client file and re-export its `client` from
   `client.ts` — the hooks only depend on the shape.

## Non-goals for v1

- No Suspense mode (`useSuspenseQuery`)
- No SSR prefetch helpers
- No Solid/Vue variants
- No mutation-level optimistic updates (bring your own `onMutate`)

## Related

- Phase 11 of the Triad ROADMAP
- `@triad/openapi` — generates OpenAPI documents from the same router
- `@triad/drizzle` — generates Drizzle schemas from the same router
