/**
 * Migration file writer.
 *
 * Ties snapshot + diff + emitter together and persists the results to
 * disk. The flow:
 *
 *   1. Load `<directory>/.snapshot.json` if it exists.
 *   2. Snapshot the current router.
 *   3. Diff them.
 *   4. If there are no changes, return `{ path: null, snapshotPath: null }`.
 *   5. Otherwise write `<directory>/<timestamp>[_name].sql` and
 *      overwrite `<directory>/.snapshot.json` with the new snapshot.
 *
 * `generateMigration` is codegen only — it does NOT run the SQL. Users
 * apply migrations with their preferred tool (psql, mysql, sqlite3,
 * drizzle-kit push, Flyway, etc.).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { diffSnapshots } from './diff.js';
import { emitMigrationSQL } from './emit-sql.js';
import {
  parseSnapshot,
  serializeSnapshot,
  snapshotIR,
} from './snapshot.js';
import type {
  GenerateMigrationOptions,
  MigrationResult,
  RouterSnapshot,
  SchemaDiff,
} from './types.js';

const SNAPSHOT_FILENAME = '.snapshot.json';

export function generateMigration(
  options: GenerateMigrationOptions,
): MigrationResult {
  const { router, dialect, directory, name } = options;

  fs.mkdirSync(directory, { recursive: true });

  const snapshotPath = path.join(directory, SNAPSHOT_FILENAME);
  const previous = readPreviousSnapshot(snapshotPath);
  const next = snapshotIR(router);
  const diff = diffSnapshots(previous, next);

  if (isEmptyDiff(diff)) {
    return { path: null, snapshotPath: null, diff };
  }

  const { up, down } = emitMigrationSQL(diff, dialect);
  const filename = buildFilename(name);
  const filepath = path.join(directory, filename);
  const body = buildMigrationFile({ name, dialect, up, down });

  fs.writeFileSync(filepath, body, 'utf8');
  fs.writeFileSync(snapshotPath, serializeSnapshot(next), 'utf8');

  return { path: filepath, snapshotPath, diff };
}

function readPreviousSnapshot(filepath: string): RouterSnapshot | null {
  if (!fs.existsSync(filepath)) return null;
  const text = fs.readFileSync(filepath, 'utf8');
  return parseSnapshot(text);
}

function isEmptyDiff(diff: SchemaDiff): boolean {
  return (
    diff.tablesAdded.length === 0 &&
    diff.tablesDropped.length === 0 &&
    diff.tableChanges.length === 0
  );
}

/**
 * Build the `YYYYMMDDHHMMSS[_name].sql` filename. Uses UTC so the same
 * router in different time zones produces the same ordering.
 */
function buildFilename(name: string | undefined): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const suffix = name ? `_${name}` : '';
  return `${stamp}${suffix}.sql`;
}

interface MigrationFileParts {
  name: string | undefined;
  dialect: string;
  up: string;
  down: string;
}

function buildMigrationFile(parts: MigrationFileParts): string {
  const header =
    `-- Triad migration${parts.name ? `: ${parts.name}` : ''}\n` +
    `-- Generated: ${new Date().toISOString()}\n` +
    `-- Dialect: ${parts.dialect}\n` +
    `-- This file is safe to edit. Review before running.\n` +
    `--\n` +
    `-- NOTES:\n` +
    `--   * Column renames are NOT detected: a rename appears as DROP + ADD.\n` +
    `--   * No data migrations are generated — only schema changes.\n` +
    `--   * No rollback tracking: manage migration state yourself.\n` +
    `--   * Down migrations are best-effort. Review before running.\n` +
    `--   * No transactional wrapping. Add BEGIN;/COMMIT; if your dialect supports it.\n`;
  return (
    `${header}\n` +
    `-- UP ---------------------------------------------------------------\n` +
    `${parts.up}\n\n` +
    `-- DOWN -------------------------------------------------------------\n` +
    `${parts.down}\n`
  );
}
