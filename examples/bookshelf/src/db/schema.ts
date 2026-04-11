/**
 * Drizzle storage schema for Bookshelf.
 *
 * As in the other reference examples, this file is the **storage
 * contract** — the column names, types, and constraints as they live
 * in the database — and is intentionally separate from the Triad API
 * schemas in `src/schemas/`, which describe what crosses the wire.
 * The mapping between the two happens in the repository layer.
 *
 * Hand-written rather than codegen-emitted because writing the schema
 * once by hand is the shortest path through the tutorial step that
 * introduces persistence. A future pass can switch this to the output
 * of `triad db generate --dialect sqlite` without touching the
 * repositories or handlers.
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const books = sqliteTable('books', {
  id: text('id').primaryKey().notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  author: text('author').notNull(),
  isbn: text('isbn'),
  publishedYear: integer('published_year').notNull(),
  createdAt: text('created_at').notNull(),
});

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey().notNull(),
  bookId: text('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  reviewerId: text('reviewer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reviewerName: text('reviewer_name').notNull(),
  // Rating.score — a single integer column. Value object "unpacking"
  // happens in the repository's rowToApi / apiToRow mappers.
  ratingScore: integer('rating_score').notNull(),
  comment: text('comment').notNull(),
  createdAt: text('created_at').notNull(),
});
