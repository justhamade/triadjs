/**
 * Drizzle storage schema for the petstore.
 *
 * This is the **storage contract** — column names, types, and constraints
 * as they live in the database. It is intentionally separate from the
 * Triad API schemas in `src/schemas/`, which describe what crosses the
 * wire. The differences are where you see the trade-offs of good DB
 * design:
 *
 *   - snake_case column names (`adoption_fee_amount`) vs camelCase API
 *     fields (`adoptionFee.amount`)
 *   - `Money` (a value object in the API) split across two columns in
 *     the DB: `adoption_fee_amount` (integer cents, no float rounding)
 *     and `adoption_fee_currency`
 *   - `tags` (a `string[]` in the API) stored as JSON text because
 *     SQLite has no array column type
 *   - foreign keys on relationships the API doesn't otherwise model
 *
 * The mapping between the two lives in the repository layer
 * (`src/repositories/*`).
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pets = sqliteTable('pets', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  species: text('species', {
    enum: ['dog', 'cat', 'bird', 'fish'],
  }).notNull(),
  age: integer('age').notNull(),
  status: text('status', {
    enum: ['available', 'adopted', 'pending'],
  })
    .notNull()
    .default('available'),
  // Array-of-strings stored as JSON text. SQLite has no array type.
  tags: text('tags'),
  // Money value object → split into two columns (integer cents + code).
  adoptionFeeAmount: integer('adoption_fee_amount').notNull(),
  adoptionFeeCurrency: text('adoption_fee_currency', {
    enum: ['USD', 'CAD', 'EUR'],
  }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const adopters = sqliteTable('adopters', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
});

export const adoptions = sqliteTable('adoptions', {
  id: text('id').primaryKey().notNull(),
  petId: text('pet_id')
    .notNull()
    .references(() => pets.id),
  adopterId: text('adopter_id')
    .notNull()
    .references(() => adopters.id),
  status: text('status', {
    enum: ['requested', 'completed', 'cancelled'],
  }).notNull(),
  feeAmount: integer('fee_amount').notNull(),
  feeCurrency: text('fee_currency', {
    enum: ['USD', 'CAD', 'EUR'],
  }).notNull(),
  requestedAt: text('requested_at').notNull(),
  completedAt: text('completed_at'),
});
