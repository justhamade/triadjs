/**
 * Service container wiring — one definition, reused by the production
 * entry point (`server.ts`) and the per-scenario test setup
 * (`test-setup.ts`).
 *
 * Heterogeneous by design: user/book/review repositories are Drizzle-
 * backed (shared SQLite handle) while `tokenStore` is an in-memory
 * `TokenStore`. Handlers don't care which storage strategy each
 * service uses — `ctx.services.tokenStore.issue(...)` and
 * `ctx.services.bookRepo.findById(...)` have the same ergonomics.
 *
 * Declaration-merging `ServiceContainer` gives every handler static
 * typing for `ctx.services.*` without manual imports in each endpoint
 * file — the "one tax, paid once" that makes the rest of the codebase
 * feel weightless.
 */

import { createDatabase, type Db } from './db/client.js';
import { BookRepository } from './repositories/book.js';
import { ReviewRepository } from './repositories/review.js';
import { TokenStore } from './repositories/token.js';
import { UserRepository } from './repositories/user.js';

export interface BookshelfServices {
  db: Db;
  userRepo: UserRepository;
  bookRepo: BookRepository;
  reviewRepo: ReviewRepository;
  tokenStore: TokenStore;
}

declare module '@triadjs/core' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ServiceContainer extends BookshelfServices {}
}

export interface CreateServicesOptions {
  /** Provide an existing Drizzle client. Defaults to a fresh in-memory DB. */
  db?: Db;
}

export function createServices(
  options: CreateServicesOptions = {},
): BookshelfServices {
  const db = options.db ?? createDatabase();
  return {
    db,
    userRepo: new UserRepository(db),
    bookRepo: new BookRepository(db),
    reviewRepo: new ReviewRepository(db),
    tokenStore: new TokenStore(),
  };
}
