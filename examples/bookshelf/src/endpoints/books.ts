/**
 * Book CRUD endpoints for the Library context.
 *
 * Every endpoint is protected via `beforeHandler: requireAuth`. Books
 * are scoped to the authenticated user — listing returns only the
 * caller's own books, and the single-book operations route through
 * `loadOwnedBook` (in `../access.ts`) so the 404 vs 403 distinction is
 * consistent across all four routes.
 *
 * `listBooks` demonstrates keyset pagination. The cursor is a
 * base64url-encoded copy of the last item's `createdAt` — opaque to
 * clients so they can't synthesize arbitrary cursors, keyset rather
 * than offset so concurrent inserts don't duplicate or skip rows, and
 * encoded in the handler (not the repository) so the repository
 * surface stays cursor-format-agnostic.
 *
 * `deleteBook` returns 204 with a zero-argument `ctx.respond[204]()`
 * and declares the response as `t.empty()` — the first-class primitive
 * for bodyless responses.
 */

import { endpoint, scenario, t } from '@triadjs/core';
import { Book, BookPage, CreateBook, UpdateBook } from '../schemas/book.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';
import { loadOwnedBook } from '../access.js';

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

function encodeCursor(createdAt: string): string {
  return Buffer.from(createdAt, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return /^\d{4}-\d{2}-\d{2}T/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /books
// ---------------------------------------------------------------------------

export const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Add a book to the authenticated user\'s shelf',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: { body: CreateBook },
  responses: {
    201: { schema: Book, description: 'Book added to the shelf' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const book = await ctx.services.bookRepo.create({
      ownerId: ctx.state.user.id,
      title: ctx.body.title,
      author: ctx.body.author,
      publishedYear: ctx.body.publishedYear,
      ...(ctx.body.isbn !== undefined && { isbn: ctx.body.isbn }),
    });
    return ctx.respond[201](book);
  },
  behaviors: [
    scenario('An authenticated user can add a book')
      .given('a logged-in user')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const token = services.tokenStore.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .body({
        title: 'The Pragmatic Programmer',
        author: 'Andy Hunt',
        publishedYear: 1999,
      })
      .when('I POST /books')
      .then('response status is 201')
      .and('response body matches Book')
      .and('response body has title "The Pragmatic Programmer"'),

    scenario('Adding a book without credentials returns 401')
      .given('no credentials are provided')
      .body({ title: 'Ghost', author: 'Nobody', publishedYear: 2020 })
      .when('I POST /books')
      .then('response status is 401')
      .and('response body has code "UNAUTHENTICATED"'),
  ],
});

// ---------------------------------------------------------------------------
// GET /books — paginated list scoped to the current user
// ---------------------------------------------------------------------------

export const listBooks = endpoint({
  name: 'listBooks',
  method: 'GET',
  path: '/books',
  summary: 'List the authenticated user\'s books with keyset pagination',
  description:
    'Books are returned in `createdAt` ASC order. Use `nextCursor` to fetch the next page; `null` indicates the last page.',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: {
    query: {
      limit: t.int32().min(1).max(100).default(20).doc('Page size (1–100)'),
      cursor: t
        .string()
        .optional()
        .doc('Opaque pagination cursor from a previous page'),
    },
  },
  responses: {
    200: { schema: BookPage, description: 'One page of books' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
  },
  handler: async (ctx) => {
    const cursorCreatedAt =
      ctx.query.cursor !== undefined ? decodeCursor(ctx.query.cursor) : null;

    const result = await ctx.services.bookRepo.listForOwner({
      ownerId: ctx.state.user.id,
      limit: ctx.query.limit,
      ...(cursorCreatedAt !== null && { cursorCreatedAt }),
    });

    return ctx.respond[200]({
      items: result.items,
      nextCursor:
        result.nextCursorRaw !== null ? encodeCursor(result.nextCursorRaw) : null,
    });
  },
  behaviors: [
    scenario('Listing is scoped to the logged-in user')
      .given('alice and bob each own their own books')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const bob = await services.userRepo.create({
          email: 'bob@example.com',
          password: 'pw1234',
          name: 'Bob',
        });
        await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Foundation',
          author: 'Isaac Asimov',
          publishedYear: 1951,
        });
        await services.bookRepo.create({
          ownerId: bob.id,
          title: 'Neuromancer',
          author: 'William Gibson',
          publishedYear: 1984,
        });
        const token = services.tokenStore.issue(alice.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .query({ limit: 50 })
      .when('I GET /books')
      .then('response status is 200')
      .and('response body matches BookPage')
      .and('response body has items.length 2'),

    scenario('The first page returns a cursor when more books exist')
      .given('12 books owned by the user and a page size of 5')
      .setup(async (services) => {
        const user = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        for (let i = 1; i <= 12; i++) {
          await services.bookRepo.create({
            ownerId: user.id,
            title: `Book ${i}`,
            author: `Author ${i}`,
            publishedYear: 2000 + i,
          });
          // Nudge the clock so createdAt is strictly monotonic — the
          // keyset cursor is a timestamp comparison.
          await new Promise((r) => setTimeout(r, 2));
        }
        const token = services.tokenStore.issue(user.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .query({ limit: 5 })
      .when('I GET /books?limit=5')
      .then('response status is 200')
      .and('response body matches BookPage')
      .and('response body has items.length 5'),
  ],
});

// ---------------------------------------------------------------------------
// GET /books/:bookId
// ---------------------------------------------------------------------------

export const getBook = endpoint({
  name: 'getBook',
  method: 'GET',
  path: '/books/:bookId',
  summary: 'Fetch a single book by id',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: {
    params: { bookId: t.string().format('uuid').doc('The book id') },
  },
  responses: {
    200: { schema: Book, description: 'Book found' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Book belongs to another user' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedBook(
      ctx.services,
      ctx.params.bookId,
      ctx.state.user.id,
    );
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    return ctx.respond[200](loaded.book);
  },
  behaviors: [
    scenario('Owners can read their own book')
      .given('alice owns a book and is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const token = services.tokenStore.issue(alice.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ bookId: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 200')
      .and('response body matches Book')
      .and('response body has title "Dune"'),

    scenario("Reading another user's book returns 403")
      .given('alice owns a book and bob is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const bob = await services.userRepo.create({
          email: 'bob@example.com',
          password: 'pw1234',
          name: 'Bob',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const bobToken = services.tokenStore.issue(bob.id);
        return { bobToken, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {bobToken}' })
      .params({ bookId: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),

    scenario('An unknown book id returns 404')
      .given('a logged-in user and an id that does not exist')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const token = services.tokenStore.issue(alice.id);
        return { token };
      })
      .headers({ authorization: 'Bearer {token}' })
      .fixtures({ bookId: '00000000-0000-0000-0000-000000000000' })
      .params({ bookId: '{bookId}' })
      .when('I GET /books/{bookId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

// ---------------------------------------------------------------------------
// PATCH /books/:bookId
// ---------------------------------------------------------------------------

export const updateBook = endpoint({
  name: 'updateBook',
  method: 'PATCH',
  path: '/books/:bookId',
  summary: 'Update mutable fields on a book you own',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: {
    params: { bookId: t.string().format('uuid') },
    body: UpdateBook,
  },
  responses: {
    200: { schema: Book, description: 'Book updated' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Book belongs to another user' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedBook(
      ctx.services,
      ctx.params.bookId,
      ctx.state.user.id,
    );
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    const updated = await ctx.services.bookRepo.update(
      loaded.book.id,
      ctx.body,
    );
    if (!updated) {
      // Would only happen if the row vanished between the ownership
      // check and the update — practically impossible in an in-process
      // test, but guarded for safety.
      return ctx.respond[404]({
        code: 'NOT_FOUND',
        message: `No book with id ${ctx.params.bookId}.`,
      });
    }
    return ctx.respond[200](updated);
  },
  behaviors: [
    scenario('Owners can edit their book')
      .given('alice owns a book and is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'The Hobbit',
          author: 'J.R.R. Tolkien',
          publishedYear: 1937,
        });
        const token = services.tokenStore.issue(alice.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ bookId: '{bookId}' })
      .body({ title: 'The Hobbit (Illustrated)' })
      .when('I PATCH /books/{bookId}')
      .then('response status is 200')
      .and('response body has title "The Hobbit (Illustrated)"'),
  ],
});

// ---------------------------------------------------------------------------
// DELETE /books/:bookId
// ---------------------------------------------------------------------------

export const deleteBook = endpoint({
  name: 'deleteBook',
  method: 'DELETE',
  path: '/books/:bookId',
  summary: 'Remove a book from your shelf',
  tags: ['Library'],
  beforeHandler: requireAuth,
  request: {
    params: { bookId: t.string().format('uuid') },
  },
  responses: {
    204: { schema: t.empty(), description: 'Book deleted (no body)' },
    401: { schema: ApiError, description: 'Missing or invalid token' },
    403: { schema: ApiError, description: 'Book belongs to another user' },
    404: { schema: ApiError, description: 'Book not found' },
  },
  handler: async (ctx) => {
    const loaded = await loadOwnedBook(
      ctx.services,
      ctx.params.bookId,
      ctx.state.user.id,
    );
    if (!loaded.ok) {
      if (loaded.status === 403) return ctx.respond[403](loaded.error);
      return ctx.respond[404](loaded.error);
    }
    await ctx.services.bookRepo.delete(loaded.book.id);
    return ctx.respond[204]();
  },
  behaviors: [
    scenario('Owners can delete their own book')
      .given('alice owns a book and is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Ephemeral',
          author: 'Nobody',
          publishedYear: 2020,
        });
        const token = services.tokenStore.issue(alice.id);
        return { token, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {token}' })
      .params({ bookId: '{bookId}' })
      .when('I DELETE /books/{bookId}')
      .then('response status is 204'),

    scenario("Deleting another user's book returns 403")
      .given('alice owns a book and bob is logged in')
      .setup(async (services) => {
        const alice = await services.userRepo.create({
          email: 'alice@example.com',
          password: 'pw1234',
          name: 'Alice',
        });
        const bob = await services.userRepo.create({
          email: 'bob@example.com',
          password: 'pw1234',
          name: 'Bob',
        });
        const book = await services.bookRepo.create({
          ownerId: alice.id,
          title: 'Dune',
          author: 'Frank Herbert',
          publishedYear: 1965,
        });
        const bobToken = services.tokenStore.issue(bob.id);
        return { bobToken, bookId: book.id };
      })
      .headers({ authorization: 'Bearer {bobToken}' })
      .params({ bookId: '{bookId}' })
      .when('I DELETE /books/{bookId}')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});
