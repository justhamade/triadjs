/**
 * `bookReviews` channel — real-time review broadcasts for a single book.
 *
 * Everything about this channel mirrors the HTTP `createReview`
 * endpoint except for the transport and the broadcast. A client
 * subscribes to `/ws/books/:bookId/reviews`, authenticates on the
 * handshake, and then either posts reviews via `submitReview` or just
 * listens for broadcasts. Every subscriber to the same `bookId` shares
 * a broadcast group — the Fastify adapter and the test harness both
 * key groups on the resolved path params.
 *
 * ## Why auth lives in `onConnect`
 *
 * Channels do NOT share Triad's HTTP `beforeHandler` pipeline in v1.
 * WebSocket handshakes have different failure semantics — rejecting a
 * connection means calling `ctx.reject(code, message)` so the adapter
 * emits a close frame, rather than responding with a typed status
 * body. Wiring a single `requireAuth` across both transports was
 * explicitly rejected during the Phase 10 design because it would
 * hide that difference. The code here is the same five-line flow
 * (parse header → lookup token → load user → reject or seed state)
 * that `requireAuth` implements for HTTP.
 *
 * ## Why we broadcast to self
 *
 * `ctx.broadcast.review(...)` includes the sender. A review-posting
 * client gets one authoritative "review persisted" event instead of
 * having to optimistically render and reconcile. If you'd rather
 * leave the sender to render locally, swap to `ctx.broadcastOthers`.
 */

import { channel, scenario, t } from '@triadjs/core';
import {
  ChannelError,
  Review,
  SubmitReviewPayload,
} from '../schemas/review.js';
import { parseBearer } from '../auth.js';

interface BookReviewsState {
  userId: string;
  userName: string;
  bookId: string;
}

export const bookReviews = channel({
  name: 'bookReviews',
  path: '/ws/books/:bookId/reviews',
  summary: 'Real-time review notifications for a book',
  description:
    'Clients connect to a specific book and receive a broadcast whenever any connected client posts a new review. Authentication is by bearer token passed as the `authorization` header on the upgrade request.',
  tags: ['Reviews'],

  // Phantom witness for typed ctx.state — the value is ignored at
  // runtime, only its type matters. Without it, ctx.state would be
  // Record<string, any>.
  state: {} as BookReviewsState,

  connection: {
    params: {
      bookId: t.string().format('uuid').doc('Book to subscribe to'),
    },
    headers: {
      authorization: t
        .string()
        .doc('Bearer token header: "Bearer <token>"'),
    },
  },

  clientMessages: {
    submitReview: {
      schema: SubmitReviewPayload,
      description: 'Post a new review for this book',
    },
  },

  serverMessages: {
    review: {
      schema: Review,
      description: 'A new review was posted to this book',
    },
    error: {
      schema: ChannelError,
      description: 'An error occurred handling a client message',
    },
  },

  onConnect: async (ctx) => {
    const token = parseBearer(ctx.headers.authorization);
    if (!token) {
      return ctx.reject(401, 'Missing or malformed Authorization header.');
    }
    const userId = ctx.services.tokenStore.lookup(token);
    if (!userId) {
      return ctx.reject(401, 'Token is invalid or has been revoked.');
    }
    const user = await ctx.services.userRepo.findById(userId);
    if (!user) {
      return ctx.reject(401, 'Token refers to a user that no longer exists.');
    }
    const book = await ctx.services.bookRepo.findById(ctx.params.bookId);
    if (!book) {
      return ctx.reject(404, 'Book not found.');
    }
    // Mirror the HTTP createReview ownership rule — only the book's
    // owner can post reviews. Read-only subscribers would need a
    // different rule; we don't model that split in the tutorial.
    if (book.ownerId !== user.id) {
      return ctx.reject(403, 'You do not own this book.');
    }

    ctx.state.userId = user.id;
    ctx.state.userName = user.name;
    ctx.state.bookId = ctx.params.bookId;
  },

  handlers: {
    submitReview: async (ctx, data) => {
      const review = await ctx.services.reviewRepo.create({
        bookId: ctx.state.bookId,
        reviewerId: ctx.state.userId,
        reviewerName: ctx.state.userName,
        rating: data.rating,
        comment: data.comment,
      });
      ctx.broadcast.review(review);
    },
  },

  behaviors: [
    scenario('Submitting a review broadcasts it back to the sender')
      .given('alice is subscribed to her own book')
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
      .params({ bookId: '{bookId}' })
      .headers({ authorization: 'Bearer {token}' })
      .body({ rating: { score: 5 }, comment: 'A masterpiece.' })
      .when('client sends submitReview')
      .then('client receives a review event')
      .and('client receives a review with comment "A masterpiece."'),

    scenario('Connections with an unknown token are rejected')
      .given('an invalid bearer token')
      .setup(async (services) => {
        // We still need a book id that passes handshake param
        // validation, so seed a user + book owned by them and point
        // the scenario at that book. The token is bogus on purpose.
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
        return { bookId: book.id };
      })
      .params({ bookId: '{bookId}' })
      .headers({ authorization: 'Bearer not-a-real-token' })
      .when('client connects')
      .then('connection is rejected with code 401'),
  ],
});
