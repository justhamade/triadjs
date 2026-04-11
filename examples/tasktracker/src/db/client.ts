/**
 * Database client factory.
 *
 * Identical in shape to `examples/petstore/src/db/client.ts` — the
 * tasktracker is deliberately built on the same persistence pattern so
 * readers can diff the two examples side-by-side and see which changes
 * come from the new features (auth, ownership, pagination) and which
 * are just different table shapes.
 *
 * A fresh in-memory SQLite database is created per test scenario; in
 * production the caller passes a file URL via `DATABASE_URL`. The DDL
 * is inlined so a brand-new connection is fully schema-complete before
 * the first query — no migration step, no external files to chase.
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
 * initializing. Must stay in sync with `./schema.ts`.
 *
 * Foreign keys model the ownership graph: a project belongs to one user,
 * a task belongs to one project, and a token belongs to one user. The
 * ON DELETE CASCADE on `tasks.project_id` keeps the example honest —
 * deleting a project also removes its tasks in a single SQL statement
 * without the handler having to orchestrate it.
 */
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
`;

export function createDatabase(url: string = ':memory:'): Db {
  const sqlite = new Database(url);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(INIT_SQL);
  const db = drizzle(sqlite, { schema });
  return Object.assign(db, { $raw: sqlite });
}
