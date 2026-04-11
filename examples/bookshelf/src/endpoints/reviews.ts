/**
 * Review HTTP endpoint — the companion to the `bookReviews` channel.
 *
 * Product decision: **only the book's owner can post a review.** Some
 * bookshelf apps let anyone review any book; here we treat reviews as
 * notes the owner leaves about their own reading so the Library +
 * Reviews contexts demonstrate nested ownership cleanly. Switching to
 * "anyone can review any book" is a one-branch change in the handler
 * — drop the `loadOwnedBook` gate and replace it with a plain
 * `findById` + 404. The channel's broadcast semantics do not change.
 *
 * This endpoint is the HTTP counterpart to the channel's `submitReview`
 * client message. The two paths intentionally do NOT share a cross-
 * process event bus here — production deployments would wire one in so
 * an HTTP POST also fans out to connected WebSocket subscribers, but
 * adding the bus would obscure the separate roles of the two transports
 * in a reference example. The tutorial step 6 spells out the shared-
 * bus and domain-service alternatives.
 */

import { endpoint, scenario, t } from '@triad/core';
import { CreateReview, Review } from '../schemas/review.js';
import { ApiError } from '../schemas/common.js';
import { requireAuth } from '../auth.js';
import { loadOwnedBook } from '../access.js';

export const createReview = endpoint({
  name: 'createReview',
  method: 'POST',
  path: '/books/:bookId/reviews',
  summary: 'Post a review for a book you own',
  tags: ['Reviews'],
  beforeHandler: requireAuth,
  request: {
    params: { bookId: t.string().format('uuid') },
    body: CreateReview,
  },
  responses: {
    201: { schema: Review, description: 'Review created' },
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
    const review = await ctx.services.reviewRepo.create({
      bookId: loaded.book.id,
      reviewerId: ctx.state.user.id,
      reviewerName: ctx.state.user.name,
      rating: ctx.body.rating,
      comment: ctx.body.comment,
    });
    return ctx.respond[201](review);
  },
  behaviors: [
    scenario('Owners can review their own book')
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
      .body({ rating: { score: 5 }, comment: 'A masterpiece.' })
      .when('I POST /books/{bookId}/reviews')
      .then('response status is 201')
      .and('response body matches Review')
      .and('response body has comment "A masterpiece."'),

    scenario("Reviewing another user's book returns 403")
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
      .body({ rating: { score: 1 }, comment: 'Sneaky review.' })
      .when('I POST /books/{bookId}/reviews')
      .then('response status is 403')
      .and('response body has code "FORBIDDEN"'),
  ],
});
