# @triad/svelte-query

Generate fully-typed [Svelte Query](https://tanstack.com/query/latest/docs/framework/svelte/overview)
store factories from a Triad router. One source of truth — changing a
schema on the server produces compile errors in the exact call sites on
the frontend.

## Install

```bash
npm install --save-dev @triad/svelte-query
```

`@tanstack/svelte-query` is a peer concern:

```bash
npm install @tanstack/svelte-query
```

## Usage

```bash
triad frontend generate --target svelte-query --output ./src/generated/api
```

Or via `triad.config.ts`:

```ts
import { defineConfig } from '@triad/test-runner';

export default defineConfig({
  frontend: {
    target: 'svelte-query',
    output: './src/generated/api',
  },
});
```

## Output layout

```
src/generated/api/
  index.ts         — barrel re-exporting everything
  types.ts         — every named interface used by any store
  query-keys.ts    — per-resource key factories
  client.ts        — runtime fetch client + HttpError
  <context>.ts     — one file per bounded context with its store factories
```

## Naming convention

Svelte Query exposes `createQuery` / `createMutation` primitives. The
generator follows that convention:

- GET endpoints → `createXxxQuery` (e.g. `createListBooksQuery`, `createBookQuery`)
- Mutations → `createXxxMutation` (e.g. `createCreateBookMutation`)
- GET-by-id endpoints named `getX` drop the `get` prefix.

## Example generated factory

```ts
// Generated: library.ts
import { createQuery, createMutation, useQueryClient,
         type CreateQueryOptions, type CreateMutationOptions } from '@tanstack/svelte-query';
import { client, type HttpError } from './client.js';
import type { Book, BookPage, CreateBook, ListBooksQuery, GetBookParams } from './types.js';
import { bookKeys } from './query-keys.js';

export function createListBooksQuery(
  query: ListBooksQuery,
  options?: Omit<CreateQueryOptions<BookPage, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return createQuery({
    queryKey: bookKeys.list(query),
    queryFn: () => client.get<BookPage>(`/books`, { query }),
    ...(options ?? {}),
  });
}

export function createBookQuery(
  params: GetBookParams,
  options?: Omit<CreateQueryOptions<Book, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return createQuery({
    queryKey: bookKeys.detail(params.bookId),
    queryFn: () => client.get<Book>(`/books/${params.bookId}`),
    ...(options ?? {}),
  });
}

export function createCreateBookMutation(
  options?: Omit<CreateMutationOptions<Book, HttpError, { body: CreateBook }>, 'mutationFn'>,
) {
  const qc = useQueryClient();
  return createMutation({
    mutationFn: (vars: { body: CreateBook }) => client.post<Book>(`/books`, { body: vars.body }),
    onSuccess: (data: Book, variables: { body: CreateBook }, context: unknown) => {
      qc.invalidateQueries({ queryKey: bookKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...(options ?? {}),
  });
}
```

## Svelte idioms

Svelte Query stores take plain (non-reactive) args — when arguments
change, call the factory again inside a `$:` reactive block or
`derived` store. The generator does NOT wrap options in thunks; each
call produces a fresh store subscription.

## Invalidation

- `POST` invalidates `xxxKeys.lists()`.
- `PATCH` / `PUT` / `DELETE` on a detail path invalidate both
  `xxxKeys.detail(id)` and `xxxKeys.lists()`.
- Flat-key endpoints (e.g. `/auth/login`) do not auto-invalidate.

## Reuse

This package reuses the schema emitter, resource derivation, query-key
factory, and fetch client template from `@triad/tanstack-query`. Only
the store-factory emitter is unique to Svelte Query.
