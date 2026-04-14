# @triadjs/solid-query

Generate fully-typed [Solid Query](https://tanstack.com/query/latest/docs/framework/solid/overview)
hooks from a Triad router. A single source of truth — changing a schema
on the server produces compile errors in the exact call sites on the
frontend.

## Install

```bash
npm install --save-dev @triadjs/solid-query
```

`@tanstack/solid-query` is a peer concern: the generated code imports
from it, so your frontend app must have it installed:

```bash
npm install @tanstack/solid-query
```

## Usage

```bash
triad frontend generate --target solid-query --output ./src/generated/api
```

Or via `triad.config.ts`:

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  frontend: {
    target: 'solid-query',
    output: './src/generated/api',
  },
});
```

## Output layout

```
src/generated/api/
  index.ts         — barrel re-exporting everything
  types.ts         — every named interface used by any hook
  query-keys.ts    — per-resource key factories
  client.ts        — runtime fetch client + HttpError
  <context>.ts     — one file per bounded context with its hooks
```

## Example generated hook

```ts
// Generated: library.ts
import { createQuery, createMutation, useQueryClient,
         type SolidQueryOptions, type SolidMutationOptions } from '@tanstack/solid-query';
import { client, type HttpError } from './client.js';
import type { Book, BookPage, CreateBook, ListBooksQuery, GetBookParams } from './types.js';
import { bookKeys } from './query-keys.js';

export function useListBooks(
  query: () => ListBooksQuery,
  options?: Omit<SolidQueryOptions<BookPage, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return createQuery(() => ({
    queryKey: bookKeys.list(query()),
    queryFn: () => client.get<BookPage>(`/books`, { query: query() }),
    ...(options ?? {}),
  }));
}

export function useBook(
  params: () => GetBookParams,
  options?: Omit<SolidQueryOptions<Book, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return createQuery(() => ({
    queryKey: bookKeys.detail(params().bookId),
    queryFn: () => client.get<Book>(`/books/${params().bookId}`),
    ...(options ?? {}),
  }));
}

export function useCreateBook(
  options?: Omit<SolidMutationOptions<Book, HttpError, { body: CreateBook }>, 'mutationFn'>,
) {
  const qc = useQueryClient();
  return createMutation(() => ({
    mutationFn: (vars: { body: CreateBook }) => client.post<Book>(`/books`, { body: vars.body }),
    onSuccess: (data: Book, variables: { body: CreateBook }, context: unknown) => {
      qc.invalidateQueries({ queryKey: bookKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...(options ?? {}),
  }));
}
```

## Reactive idioms

Solid Query resolves query options on every render via a thunk. The
generator preserves reactivity end-to-end by:

- Wrapping `createQuery` / `createMutation` options in `() => ({ ... })`.
- Passing `params` and `query` as accessor functions (`() => T`) so
  changes to a parent signal cause re-fetches without re-creating the
  hook.
- Deriving query keys inside the thunk so invalidation and refetch
  react to signal changes naturally.

## Invalidation

The generator mirrors `@triadjs/tanstack-query`'s invalidation heuristic:

- `POST /books` invalidates `bookKeys.lists()`.
- `PATCH /books/:bookId` / `PUT` invalidate `bookKeys.detail(id)` and `bookKeys.lists()`.
- `DELETE /books/:bookId` invalidates both as well.
- Endpoints whose paths don't map to a CRUD resource (e.g. `/auth/login`)
  use a flat key `['auth', 'login']` and no automatic invalidation.

You can override `onSuccess` via the `options` argument — it runs
**after** the built-in invalidations.

## Reuse

This package reuses the schema emitter, resource derivation, query-key
factory, and fetch client template from `@triadjs/tanstack-query`. Only
the hook emitter is unique to Solid Query.
