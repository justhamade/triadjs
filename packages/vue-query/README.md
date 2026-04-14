# @triadjs/vue-query

Generate fully-typed [Vue Query](https://tanstack.com/query/latest/docs/framework/vue/overview)
composables from a Triad router. One source of truth — changing a
schema on the server produces compile errors in the exact call sites on
the frontend.

## Install

```bash
npm install --save-dev @triadjs/vue-query
```

`@tanstack/vue-query` and `vue` are peer concerns:

```bash
npm install @tanstack/vue-query vue
```

## Usage

```bash
triad frontend generate --target vue-query --output ./src/generated/api
```

Or via `triad.config.ts`:

```ts
import { defineConfig } from '@triadjs/test-runner';

export default defineConfig({
  frontend: {
    target: 'vue-query',
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
  <context>.ts     — one file per bounded context with its composables
```

## Example generated composable

```ts
// Generated: library.ts
import { useQuery, useMutation, useQueryClient,
         type UseQueryOptions, type UseMutationOptions } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { client, type HttpError } from './client.js';
import type { Book, BookPage, CreateBook, ListBooksQuery, GetBookParams } from './types.js';
import { bookKeys } from './query-keys.js';

export function useListBooks(
  query: MaybeRefOrGetter<ListBooksQuery>,
  options?: Omit<UseQueryOptions<BookPage, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: computed(() => bookKeys.list(toValue(query))),
    queryFn: () => client.get<BookPage>(`/books`, { query: toValue(query) }),
    ...(options ?? {}),
  });
}

export function useBook(
  params: MaybeRefOrGetter<GetBookParams>,
  options?: Omit<UseQueryOptions<Book, HttpError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: computed(() => bookKeys.detail(toValue(params).bookId)),
    queryFn: () => client.get<Book>(`/books/${toValue(params).bookId}`),
    ...(options ?? {}),
  });
}

export function useCreateBook(
  options?: Omit<UseMutationOptions<Book, HttpError, { body: CreateBook }>, 'mutationFn'>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { body: CreateBook }) => client.post<Book>(`/books`, { body: vars.body }),
    onSuccess: (data: Book, variables: { body: CreateBook }, context: unknown) => {
      qc.invalidateQueries({ queryKey: bookKeys.lists() });
      options?.onSuccess?.(data, variables, context);
    },
    ...(options ?? {}),
  });
}
```

## Reactive idioms

- Query composables take `MaybeRefOrGetter<T>` inputs — plain values,
  refs, computed refs, and getters all work.
- Inputs are unwrapped with `toValue` at fetch time.
- Query keys are wrapped in `computed(...)` so reactive changes
  trigger refetches.

## Invalidation

- `POST /books` invalidates `bookKeys.lists()`.
- `PATCH` / `PUT` / `DELETE` on `/books/:bookId` invalidate
  `bookKeys.detail(id)` and `bookKeys.lists()`.
- Flat-key endpoints (e.g. `/auth/login`) do not auto-invalidate.

## Reuse

This package reuses the schema emitter, resource derivation, query-key
factory, and fetch client template from `@triadjs/tanstack-query`. Only
the composable emitter is unique to Vue Query.
