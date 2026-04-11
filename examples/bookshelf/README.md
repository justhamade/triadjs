# Bookshelf — the tutorial example

Bookshelf is the third Triad reference app and the working companion
to the step-by-step tutorial under [`docs/tutorial/`](../../docs/tutorial/).
It is a personal book-collection API with user accounts, ownership
checks, keyset pagination, nested review resources, and a real-time
`bookReviews` WebSocket channel — every major Triad feature in one
small codebase.

## How it compares to the other examples

| Example | Adapter | Auth | Pagination | Channels | Nested resources |
|---|---|---|---|---|---|
| `petstore` | Fastify | — | offset | chat room | — |
| `tasktracker` | Express | bearer | keyset | — | tasks under projects |
| **`bookshelf`** | Fastify | bearer | keyset | `bookReviews` | reviews under books |

Bookshelf is the "all features at once" reference. If you need to see
a pattern from one of the other examples in combination with the rest,
this is the place to look.

## Layout

```
src/
  schemas/       User, Book, Review, ApiError — the single source of truth
  db/            Drizzle + better-sqlite3 schema and client factory
  repositories/  UserRepository, BookRepository, ReviewRepository, TokenStore
  endpoints/     accounts.ts, books.ts, reviews.ts
  channels/      book-reviews.ts (WebSocket)
  auth.ts        requireAuth beforeHandler + parseBearer helper
  access.ts      loadOwnedBook — composes checkOwnership with BookRepository
  services.ts    Service container + ServiceContainer module augmentation
  app.ts         Router with Accounts, Library, Reviews bounded contexts
  server.ts      Fastify entry point
  test-setup.ts  Per-scenario fresh in-memory SQLite + token wipe
```

## Running it

From this directory:

```bash
npm start          # boot the Fastify server on :3200
npm run dev        # same, with tsx watch mode
npm test           # run all 21 behavior scenarios via `triad test`
npm run docs       # emit generated/openapi.yaml + generated/asyncapi.yaml
npm run gherkin    # emit generated/features/*.feature
npm run validate   # cross-artifact checks via `triad validate`
npm run typecheck  # tsc --noEmit
```

Every script delegates to the Triad CLI — there is no custom tooling.
The scenarios ARE the tests; you will not find a `.test.ts` file in
this project.

## Behavior scenario count

| Context | Scenarios |
|---|---|
| Accounts | 7 |
| Library | 10 |
| Reviews | 4 (2 HTTP + 2 channel) |
| **Total** | **21** |

## Walkthrough

For the step-by-step narrative — including the "why" behind every
layer — read [`docs/tutorial/`](../../docs/tutorial/) in order. The
tutorial builds this exact app over seven short steps, and the final
state matches what you see in `src/`.
