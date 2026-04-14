/**
 * Access-control helper for the Library and Reviews contexts.
 *
 * Composes Triad's generic `checkOwnership` helper from `@triadjs/core`
 * with Bookshelf's `BookRepository` shape to produce a context-specific
 * `loadOwnedBook` wrapper every book-scoped endpoint can reuse. Keeping
 * the fetch-then-check pattern in one place guarantees the 404 vs 403
 * branching is identical across the four GET/PATCH/DELETE/POST review
 * endpoints that need it.
 *
 * `checkOwnership` itself does not fetch — that's the repository's
 * job. The wrapper here is the thin composition that binds the two.
 *
 * On the 404 vs 403 split: we intentionally surface "not found" when
 * the book id is globally unknown and "forbidden" when it exists but
 * belongs to another user. Collapsing both into 404 is safer from an
 * enumeration standpoint, and `docs/ddd-patterns.md` discusses when
 * that trade-off is worth it.
 */

import type { Infer } from '@triadjs/core';
import { checkOwnership } from '@triadjs/core';
import type { Book } from './schemas/book.js';
import type { BookshelfServices } from './services.js';

type BookValue = Infer<typeof Book>;
type ErrorBody = { code: string; message: string };

export type LoadedBook =
  | { ok: true; book: BookValue }
  | { ok: false; status: 404 | 403; error: ErrorBody };

export async function loadOwnedBook(
  services: Pick<BookshelfServices, 'bookRepo'>,
  bookId: string,
  userId: string,
): Promise<LoadedBook> {
  const book = await services.bookRepo.findById(bookId);
  const result = checkOwnership(book, userId, (b) => b.ownerId);
  if (result.ok) {
    return { ok: true, book: result.entity };
  }
  if (result.reason === 'not_found') {
    return {
      ok: false,
      status: 404,
      error: { code: 'NOT_FOUND', message: `No book with id ${bookId}.` },
    };
  }
  return {
    ok: false,
    status: 403,
    error: { code: 'FORBIDDEN', message: 'You do not own this book.' },
  };
}
