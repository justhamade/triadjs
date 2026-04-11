/**
 * Router definition — the entry point the `triad.config.ts` file and
 * `src/server.ts` consume.
 *
 * Endpoints and channels are grouped into three DDD bounded contexts:
 *
 *   - **Accounts** — user registration, login, `/me`
 *   - **Library** — book CRUD, scoped to the authenticated user
 *   - **Reviews** — HTTP review endpoint + real-time `bookReviews`
 *     channel
 *
 * Each context declares its own ubiquitous language via `models[]`,
 * which `triad validate` uses to detect cross-context leakage. The
 * Reviews context lists `Book` in its model list because the review
 * endpoint and channel both walk through a `Book` ownership check.
 */

import { createRouter } from '@triad/core';

import { getMe, login, register } from './endpoints/accounts.js';
import {
  createBook,
  deleteBook,
  getBook,
  listBooks,
  updateBook,
} from './endpoints/books.js';
import { createReview } from './endpoints/reviews.js';
import { bookReviews } from './channels/book-reviews.js';

import {
  AuthResult,
  LoginInput,
  RegisterInput,
  User,
} from './schemas/user.js';
import { Book, BookPage, CreateBook, UpdateBook } from './schemas/book.js';
import {
  ChannelError,
  CreateReview,
  Review,
  SubmitReviewPayload,
} from './schemas/review.js';
import { ApiError } from './schemas/common.js';

const router = createRouter({
  title: 'Bookshelf API',
  version: '1.0.0',
  description:
    'Triad reference example — the tutorial app. Fastify + auth + ownership + pagination + WebSocket channels in one place.',
  servers: [{ url: 'http://localhost:3200', description: 'Local development' }],
});

router.context(
  'Accounts',
  {
    description: 'User registration, login, and identity introspection.',
    models: [User, RegisterInput, LoginInput, AuthResult, ApiError],
  },
  (ctx) => {
    ctx.add(register, login, getMe);
  },
);

router.context(
  'Library',
  {
    description: 'The authenticated user\'s personal book collection.',
    // Library handlers reference `User` via `ctx.state.user` and
    // `loadOwnedBook`, so User must be listed here for `triad validate`
    // to accept the cross-context reference.
    models: [Book, BookPage, CreateBook, UpdateBook, User, ApiError],
  },
  (ctx) => {
    ctx.add(createBook, listBooks, getBook, updateBook, deleteBook);
  },
);

router.context(
  'Reviews',
  {
    description: 'Book reviews over HTTP and real-time channels.',
    // Review endpoints and channels walk through Book (ownership) and
    // User (reviewer identity), so both are listed here.
    models: [
      Review,
      CreateReview,
      SubmitReviewPayload,
      ChannelError,
      Book,
      User,
      ApiError,
    ],
  },
  (ctx) => {
    ctx.add(createReview, bookReviews);
  },
);

export default router;
