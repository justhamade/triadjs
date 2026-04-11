/**
 * Database client factory.
 *
 * Creates a `better-sqlite3` database (in-memory by default) wrapped in
 * a Drizzle client. In production you point this at a file path via
 * `DATABASE_URL`; in tests we use `:memory:` for per-scenario isolation
 * — a brand-new connection starts with a complete, empty schema in a
 * couple of milliseconds.
 *
 * CREATE TABLE DDL is inlined so in-memory test databases are
 * self-initializing. Must stay in sync with `./schema.ts`. A production
 * deployment would instead commit generated migrations and run them at
 * startup (see `docs/tutorial/07-production.md`).
 *
 * Foreign keys model the ownership graph: a book belongs to one user,
 * a review belongs to one book and one reviewer. ON DELETE CASCADE on
 * both foreign keys in the reviews table keeps the demo honest —
 * deleting a book also removes its reviews without the handler having
 * to orchestrate it.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/** Drizzle database handle augmented with access to the raw sqlite connection. */
export type Db = BetterSQLite3Database<typeof schema> & {
  readonly $raw: Database.Database;
};

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  isbn TEXT,
  published_year INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  rating_score INTEGER NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_created_at ON books(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(book_id);
`;

export function createDatabase(url: string = ':memory:'): Db {
  const sqlite = new Database(url);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema });
  return Object.assign(db, { $raw: sqlite });
}
