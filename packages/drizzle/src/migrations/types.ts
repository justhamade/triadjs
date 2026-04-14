/**
 * Migration codegen types.
 *
 * A `RouterSnapshot` is a plain, JSON-serializable capture of the IR
 * produced by `walkRouter`. It exists so migration codegen can compare
 * two points in time without re-invoking the walker (and so the
 * on-disk `.snapshot.json` format is decoupled from any Drizzle or
 * Triad internals).
 *
 * `SchemaDiff` describes a transition between two snapshots as the
 * minimal set of table and column mutations needed to get from `from`
 * to `to`. The diff is deliberately shallow: renames are NOT detected
 * (a column rename shows up as drop + add), and there is no data
 * migration concept — this is schema only.
 */

import type { ColumnDescriptor, TableDescriptor } from '../codegen/types.js';

/**
 * A point-in-time capture of every table descriptor in a Triad router.
 *
 * `version` pins the snapshot format — bumped if the IR shape changes
 * in an incompatible way so old snapshots can be rejected with a clear
 * error rather than silently producing a bogus diff.
 */
export interface RouterSnapshot {
  readonly version: 1;
  readonly tables: readonly TableDescriptor[];
}

export interface SchemaDiff {
  tablesAdded: TableDescriptor[];
  tablesDropped: TableDescriptor[];
  tableChanges: TableChange[];
}

export interface TableChange {
  table: string;
  columnsAdded: ColumnDescriptor[];
  columnsDropped: ColumnDescriptor[];
  columnsChanged: ColumnChange[];
}

export type ColumnChangeKind =
  | 'type'
  | 'nullable'
  | 'default'
  | 'primaryKey'
  | 'foreignKey';

export interface ColumnChange {
  name: string;
  from: ColumnDescriptor;
  to: ColumnDescriptor;
  kind: ColumnChangeKind[];
}

export interface GenerateMigrationOptions {
  /** The Triad router to snapshot. */
  router: import('@triadjs/core').Router;
  /** Target SQL dialect. */
  dialect: import('../codegen/types.js').Dialect;
  /** Directory containing existing migrations and the `.snapshot.json`. */
  directory: string;
  /** Optional name appended to the timestamped filename. */
  name?: string;
}

export interface MigrationResult {
  /** Path to the written migration file, or null if no changes. */
  path: string | null;
  /** Path to the updated snapshot file, or null if no changes. */
  snapshotPath: string | null;
  /** The computed diff (empty when no changes). */
  diff: SchemaDiff;
}
