/**
 * Drizzle storage schema for the tasktracker.
 *
 * As with petstore, this file is the **storage contract** and lives
 * intentionally separate from the Triad API schemas in `src/schemas/`.
 * The mapping between them happens in the repository layer.
 *
 * Notable differences from petstore:
 *   - `users.email` carries a real `UNIQUE` constraint; the repository
 *     relies on it to detect duplicate registrations without a separate
 *     read-before-write.
 *   - `projects.owner_id` establishes the ownership graph that every
 *     authorization check in the Projects and Tasks contexts walks.
 *   - `tasks.created_at` is indexed because pagination uses it as a
 *     keyset cursor — the index makes `ORDER BY created_at ASC LIMIT N`
 *     cheap as tasks accumulate.
 *
 * Tokens are **not** stored here. They live in the in-memory
 * `TokenStore` so the example shows that Triad services can mix
 * persistence strategies freely — see `src/repositories/token.ts` for
 * the rationale.
 */

import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().notNull(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey().notNull(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status', {
    enum: ['todo', 'in_progress', 'done'],
  })
    .notNull()
    .default('todo'),
  createdAt: text('created_at').notNull(),
});
