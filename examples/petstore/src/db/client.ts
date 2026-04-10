/**
 * Database client factory.
 *
 * Creates a `better-sqlite3` database (in-memory by default) wrapped in a
 * Drizzle client. In production you would point this at a file path via
 * `DATABASE_URL`; in tests we use `:memory:` for per-scenario isolation.
 *
 * Schema creation: rather than pulling in a drizzle-kit migration step
 * for this example, we run the `CREATE TABLE` statements inline. For a
 * real app you'd commit generated migrations and run `migrate()` at
 * startup — see `docs/drizzle-integration.md`.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/** Drizzle database handle augmented with access to the raw sqlite connection. */
export type Db = BetterSQLite3Database<typeof schema> & {
  readonly $raw: Database.Database;
};

/**
 * CREATE TABLE DDL inlined so in-memory test databases are self-
 * initializing. Must stay in sync with `./schema.ts`. A future phase
 * will use `.storage()` metadata on Triad schemas to generate both
 * this DDL and the Drizzle schema from a single source.
 */
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL,
  age INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  tags TEXT,
  adoption_fee_amount INTEGER NOT NULL,
  adoption_fee_currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adopters (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adoptions (
  id TEXT PRIMARY KEY NOT NULL,
  pet_id TEXT NOT NULL REFERENCES pets(id),
  adopter_id TEXT NOT NULL REFERENCES adopters(id),
  status TEXT NOT NULL,
  fee_amount INTEGER NOT NULL,
  fee_currency TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pets_species ON pets(species);
CREATE INDEX IF NOT EXISTS idx_pets_status ON pets(status);
CREATE INDEX IF NOT EXISTS idx_adoptions_pet_id ON adoptions(pet_id);
`;

export function createDatabase(url: string = ':memory:'): Db {
  const sqlite = new Database(url);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema });
  // Attach the raw connection so `server.ts` and `test-setup.ts` can
  // close it on shutdown without importing better-sqlite3 directly.
  return Object.assign(db, { $raw: sqlite });
}
