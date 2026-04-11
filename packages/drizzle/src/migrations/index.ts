/**
 * Public entry point for migration codegen.
 *
 * Re-exports the snapshot, diff, SQL emitter, and file writer. Consumers
 * typically only call `generateMigration`; the lower-level primitives
 * are available for tools that want to build their own pipeline (for
 * example, a dry-run command that prints the SQL without writing it).
 */

export { snapshotIR, serializeSnapshot, parseSnapshot } from './snapshot.js';
export { diffSnapshots } from './diff.js';
export { emitMigrationSQL } from './emit-sql.js';
export { generateMigration } from './generate.js';
export type {
  SchemaDiff,
  TableChange,
  ColumnChange,
  ColumnChangeKind,
  GenerateMigrationOptions,
  MigrationResult,
  RouterSnapshot,
} from './types.js';
