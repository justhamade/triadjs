/**
 * Book schemas — the Library bounded context.
 *
 * `Book` is the canonical response shape and is the aggregate root of
 * the Library context. Every book belongs to one user (`ownerId`) — the
 * ownership relationship is modeled directly in the aggregate rather
 * than through a side table, because a book without an owner is not a
 * valid domain state.
 *
 * `CreateBook` and `UpdateBook` are derived via `.pick()` (+ `.partial()`
 * for update) so the mutable wire shape has one source of truth. Adding
 * a new mutable field is a one-line change to `Book`. Note that
 * `ownerId` is NOT in either — the owner is resolved from
 * `ctx.state.user`, never trusted from the client.
 *
 * `BookPage` is the keyset pagination envelope for `GET /books`. It
 * wraps the array in an object carrying `nextCursor` so clients get a
 * stable shape even when a page is empty.
 */

import { t } from '@triad/core';

export const Book = t.model('Book', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique book identifier'),
  ownerId: t
    .string()
    .format('uuid')
    .storage({
      columnName: 'owner_id',
      indexed: true,
      references: 'users.id',
    })
    .doc('The user that added this book to their shelf'),
  title: t
    .string()
    .minLength(1)
    .maxLength(200)
    .storage({ indexed: true })
    .doc('Book title')
    .example('The Pragmatic Programmer'),
  author: t
    .string()
    .minLength(1)
    .maxLength(200)
    .storage({ indexed: true })
    .doc('Author name')
    .example('Andy Hunt'),
  isbn: t
    .string()
    .optional()
    .doc('ISBN-10 or ISBN-13, digits and dashes only'),
  publishedYear: t
    .int32()
    .min(1000)
    .max(2100)
    .storage({ columnName: 'published_year' })
    .doc('Year of first publication'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, columnName: 'created_at', indexed: true })
    .doc('When the book was added — also used as the keyset pagination cursor'),
});

/** Input for POST /books — user-supplied fields only. Owner comes from auth. */
export const CreateBook = Book.pick(
  'title',
  'author',
  'isbn',
  'publishedYear',
).named('CreateBook');

/** Input for PATCH /books/:bookId — every mutable field is optional. */
export const UpdateBook = Book.pick('title', 'author', 'isbn')
  .partial()
  .named('UpdateBook');

/**
 * Pagination envelope for `GET /books`. `nextCursor` is `null` on the
 * last page so clients can loop `while (page.nextCursor !== null)`
 * without counting items or reading HTTP headers.
 */
export const BookPage = t.model('BookPage', {
  items: t.array(Book).doc('The books on this page, ordered by createdAt ASC'),
  nextCursor: t
    .string()
    .nullable()
    .doc('Opaque cursor. Pass as ?cursor=<value> to fetch the next page. `null` on the last page.'),
});
