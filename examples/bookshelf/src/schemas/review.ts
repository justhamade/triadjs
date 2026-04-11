/**
 * Review schemas — the Reviews bounded context.
 *
 * Reviews are the first bounded context in any of the Triad reference
 * examples that mixes an HTTP endpoint with a WebSocket channel against
 * the same aggregate. `Review` is the persisted shape; `CreateReview`
 * is the HTTP body; `SubmitReviewPayload` is the wire payload a client
 * sends over the `bookReviews` channel.
 *
 * Keeping `CreateReview` and `SubmitReviewPayload` separate — even
 * though they happen to have identical fields today — is a conscious
 * choice. An HTTP POST may add idempotency headers, rate-limit hints,
 * or a `draft: true` flag later; a WebSocket push may add a client-
 * generated correlation id. Forcing them to share a shape couples two
 * transports that want to evolve independently.
 */

import { t } from '@triad/core';

/**
 * Rating is a value object — identity-less, immutable, compared by
 * value. Modeling it as `t.value` produces an inline OpenAPI schema
 * (no `$ref`) which matches how value objects describe attributes
 * rather than resources. Using a value object here (instead of a bare
 * int) lets us document the 1–5 range once and reuse it anywhere a
 * rating appears.
 */
export const Rating = t.value('Rating', {
  score: t.int32().min(1).max(5).doc('Rating score on a 1–5 scale'),
});

export const Review = t.model('Review', {
  id: t
    .string()
    .format('uuid')
    .identity()
    .storage({ primaryKey: true })
    .doc('Unique review identifier'),
  bookId: t
    .string()
    .format('uuid')
    .storage({
      columnName: 'book_id',
      indexed: true,
      references: 'books.id',
    })
    .doc('The book being reviewed'),
  reviewerId: t
    .string()
    .format('uuid')
    .storage({
      columnName: 'reviewer_id',
      references: 'users.id',
    })
    .doc('The user that wrote the review'),
  reviewerName: t
    .string()
    .minLength(1)
    .maxLength(100)
    .storage({ columnName: 'reviewer_name' })
    .doc('Display name captured at review time'),
  rating: Rating,
  comment: t.string().minLength(1).maxLength(2000).doc('Review text'),
  createdAt: t
    .datetime()
    .storage({ defaultNow: true, columnName: 'created_at' })
    .doc('When the review was written'),
});

/** HTTP body for `POST /books/:bookId/reviews`. */
export const CreateReview = t.model('CreateReview', {
  rating: Rating,
  comment: t
    .string()
    .minLength(1)
    .maxLength(2000)
    .doc('What the reviewer thought')
    .example('A masterpiece.'),
});

/** WebSocket payload for the `submitReview` client message. */
export const SubmitReviewPayload = t.model('SubmitReviewPayload', {
  rating: Rating,
  comment: t.string().minLength(1).maxLength(2000).doc('What the reviewer thought'),
});

/** Server-side channel error envelope — distinct from `ApiError` for docs clarity. */
export const ChannelError = t.model('ChannelError', {
  code: t.string().doc('Machine-readable error code'),
  message: t.string().doc('Human-readable error message'),
});
