/**
 * Drizzle-backed `ReviewRepository`.
 *
 * Reviews cross two aggregates in a minimal way: every row references
 * a `book_id` and a `reviewer_id`. The repository surface is
 * deliberately tiny — `create` and `listForBook`. Everything else
 * (ownership checks, rating validation, broadcast fanout) happens
 * outside this layer.
 *
 * The `Rating` value object is stored as a single `rating_score`
 * integer column and reconstituted in `rowToApi`. Value-object
 * unpacking is a classic repository responsibility.
 */

import { asc, eq } from 'drizzle-orm';
import type { Infer } from '@triadjs/core';
import type { InferRow, InferInsert } from '@triadjs/drizzle';

import type { Db } from '../db/client.js';
import { reviews } from '../db/schema.js';
import type { Review as ReviewSchema } from '../schemas/review.js';

type Review = Infer<typeof ReviewSchema>;
type ReviewRow = InferRow<typeof reviews>;
type ReviewInsert = InferInsert<typeof reviews>;

export interface CreateReviewInput {
  bookId: string;
  reviewerId: string;
  reviewerName: string;
  rating: { score: number };
  comment: string;
}

export class ReviewRepository {
  constructor(private readonly db: Db) {}

  private rowToApi(row: ReviewRow): Review {
    return {
      id: row.id,
      bookId: row.bookId,
      reviewerId: row.reviewerId,
      reviewerName: row.reviewerName,
      rating: { score: row.ratingScore },
      comment: row.comment,
      createdAt: row.createdAt,
    };
  }

  async create(input: CreateReviewInput): Promise<Review> {
    const row: ReviewInsert = {
      id: crypto.randomUUID(),
      bookId: input.bookId,
      reviewerId: input.reviewerId,
      reviewerName: input.reviewerName,
      ratingScore: input.rating.score,
      comment: input.comment,
      createdAt: new Date().toISOString(),
    };
    this.db.insert(reviews).values(row).run();
    return this.rowToApi(row as ReviewRow);
  }

  async listForBook(bookId: string): Promise<Review[]> {
    const rows = this.db
      .select()
      .from(reviews)
      .where(eq(reviews.bookId, bookId))
      .orderBy(asc(reviews.createdAt))
      .all();
    return rows.map((r) => this.rowToApi(r));
  }

  async clear(): Promise<void> {
    this.db.delete(reviews).run();
  }
}
