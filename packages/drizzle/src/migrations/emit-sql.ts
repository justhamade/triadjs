/**
 * SQL migration emitter.
 *
 * Turns a `SchemaDiff` into raw SQL (`up` + `down`) per dialect.
 * Unlike the Drizzle codegen emitter in `../codegen/emit.ts`, this
 * emits actual CREATE TABLE / ALTER TABLE / DROP TABLE statements
 * meant to be executed against a real database with `psql`, `mysql`,
 * `sqlite3`, or whatever migration runner the user prefers.
 *
 * Per-dialect identifier quoting:
 *
 *   - sqlite, postgres: `"double quotes"`
 *   - mysql: `` `backticks` ``
 *
 * Per-dialect type mapping lives in dedicated `sqlType*` helpers. The
 * mapping rules are documented at the top of each helper and mirror
 * the Drizzle codegen emitter where possible; differences
 * (e.g. Postgres emitting `TIMESTAMP(3) WITH TIME ZONE` here vs.
 * `timestamp('col', { mode: 'string' })` in codegen) are deliberate:
 * the SQL emitter has no Drizzle runtime to inject options, so it
 * encodes the same intent directly in the DDL.
 *
 * Down migrations are best-effort:
 *
 *   - Initial migrations (from === null): `down` drops every created table.
 *   - Column added → column dropped in down.
 *   - Column dropped → column re-added in down (type and nullability
 *     from the `from` descriptor).
 *   - Column changed → inverse change.
 *   - Table added → DROP TABLE in down.
 *   - Table dropped → CREATE TABLE in down (reconstructed from the
 *     descriptor we recorded in the diff).
 *
 * Users should review the generated down migration before running it,
 * especially when changes involved data loss (dropped columns do not
 * come back with their data).
 */

import type {
  ColumnDescriptor,
  Dialect,
  TableDescriptor,
} from '../codegen/types.js';
import type { ColumnChange, SchemaDiff, TableChange } from './types.js';

export function emitMigrationSQL(
  diff: SchemaDiff,
  dialect: Dialect,
): { up: string; down: string } {
  const upParts: string[] = [];
  const downParts: string[] = [];

  // --- Up: creates, drops, then per-table alterations -------------------
  for (const table of diff.tablesAdded) {
    upParts.push(emitCreateTable(table, dialect));
    downParts.push(emitDropTable(table.tableName, dialect));
  }

  for (const table of diff.tablesDropped) {
    upParts.push(emitDropTable(table.tableName, dialect));
    // Inverse: recreate the table we dropped.
    downParts.push(emitCreateTable(table, dialect));
  }

  for (const change of diff.tableChanges) {
    const { up, down } = emitTableChange(change, dialect);
    if (up.length > 0) upParts.push(up);
    if (down.length > 0) downParts.push(down);
  }

  return {
    up: upParts.join('\n\n'),
    down: downParts.reverse().join('\n\n'),
  };
}

// ---------------------------------------------------------------------------
// CREATE TABLE
// ---------------------------------------------------------------------------

function emitCreateTable(table: TableDescriptor, dialect: Dialect): string {
  const q = quoteId(dialect);
  const lines = table.columns.map((c) => `  ${emitColumnDefinition(c, dialect)}`);
  return `CREATE TABLE ${q(table.tableName)} (\n${lines.join(',\n')}\n);`;
}

function emitColumnDefinition(
  column: ColumnDescriptor,
  dialect: Dialect,
): string {
  const q = quoteId(dialect);
  const parts: string[] = [q(column.columnName), sqlType(column, dialect)];

  if (column.notNull) parts.push('NOT NULL');
  if (column.primaryKey) parts.push('PRIMARY KEY');
  if (column.unique && !column.primaryKey) parts.push('UNIQUE');

  if (column.default) {
    const lit = defaultLiteral(column, dialect);
    if (lit !== undefined) parts.push(`DEFAULT ${lit}`);
  }

  if (column.references) {
    const [refTable, refCol] = column.references.split('.');
    if (refTable && refCol) {
      parts.push(`REFERENCES ${q(refTable)}(${q(refCol)})`);
    }
  }

  // SQLite-specific: enum check constraint (no native ENUM type).
  if (dialect === 'sqlite' && column.logicalType === 'enum' && column.enumValues) {
    const values = column.enumValues.map((v) => `'${v}'`).join(', ');
    parts.push(`CHECK (${q(column.columnName)} IN (${values}))`);
  }
  // Postgres enum: also a CHECK constraint (portable, no CREATE TYPE).
  if (
    dialect === 'postgres' &&
    column.logicalType === 'enum' &&
    column.enumValues
  ) {
    const values = column.enumValues.map((v) => `'${v}'`).join(', ');
    parts.push(`CHECK (${q(column.columnName)} IN (${values}))`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// DROP TABLE
// ---------------------------------------------------------------------------

function emitDropTable(tableName: string, dialect: Dialect): string {
  return `DROP TABLE IF EXISTS ${quoteId(dialect)(tableName)};`;
}

// ---------------------------------------------------------------------------
// Table change (ADD / DROP / MODIFY COLUMN)
// ---------------------------------------------------------------------------

function emitTableChange(
  change: TableChange,
  dialect: Dialect,
): { up: string; down: string } {
  const q = quoteId(dialect);
  const upLines: string[] = [];
  const downLines: string[] = [];

  for (const col of change.columnsAdded) {
    upLines.push(
      `ALTER TABLE ${q(change.table)} ADD COLUMN ${emitColumnDefinition(col, dialect)};`,
    );
    downLines.push(
      `ALTER TABLE ${q(change.table)} DROP COLUMN ${q(col.columnName)};`,
    );
  }

  for (const col of change.columnsDropped) {
    if (dialect === 'sqlite') {
      upLines.push(
        `-- NOTE: SQLite DROP COLUMN requires SQLite 3.35.0+. If you target` +
          ` older versions, use the create-copy-rename-drop pattern.`,
      );
    }
    upLines.push(
      `ALTER TABLE ${q(change.table)} DROP COLUMN ${q(col.columnName)};`,
    );
    downLines.push(
      `ALTER TABLE ${q(change.table)} ADD COLUMN ${emitColumnDefinition(col, dialect)};`,
    );
  }

  for (const cc of change.columnsChanged) {
    const { up, down } = emitColumnChange(change.table, cc, dialect);
    if (up) upLines.push(up);
    if (down) downLines.push(down);
  }

  return {
    up: upLines.join('\n'),
    down: downLines.reverse().join('\n'),
  };
}

function emitColumnChange(
  tableName: string,
  change: ColumnChange,
  dialect: Dialect,
): { up: string; down: string } {
  const q = quoteId(dialect);

  if (dialect === 'sqlite') {
    // SQLite supports no in-place column alteration. Emit a guidance
    // comment and skip the DDL; the user must handle it manually.
    const upComment =
      `-- SQLite does not support ALTER COLUMN. Manual migration via ` +
      `create-copy-rename-drop required for column "${change.name}" in ` +
      `table "${tableName}". ` +
      `See https://www.sqlite.org/lang_altertable.html#otheralter`;
    return { up: upComment, down: upComment };
  }

  if (dialect === 'postgres') {
    const ups: string[] = [];
    const downs: string[] = [];
    if (change.kind.includes('type')) {
      ups.push(
        `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} TYPE ${sqlType(change.to, dialect)};`,
      );
      downs.push(
        `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} TYPE ${sqlType(change.from, dialect)};`,
      );
    }
    if (change.kind.includes('nullable')) {
      if (change.to.notNull) {
        ups.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} SET NOT NULL;`,
        );
        downs.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} DROP NOT NULL;`,
        );
      } else {
        ups.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} DROP NOT NULL;`,
        );
        downs.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} SET NOT NULL;`,
        );
      }
    }
    if (change.kind.includes('default')) {
      const toLit = change.to.default
        ? defaultLiteral(change.to, dialect)
        : undefined;
      const fromLit = change.from.default
        ? defaultLiteral(change.from, dialect)
        : undefined;
      if (toLit !== undefined) {
        ups.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} SET DEFAULT ${toLit};`,
        );
      } else {
        ups.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} DROP DEFAULT;`,
        );
      }
      if (fromLit !== undefined) {
        downs.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} SET DEFAULT ${fromLit};`,
        );
      } else {
        downs.push(
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(change.name)} DROP DEFAULT;`,
        );
      }
    }
    return { up: ups.join('\n'), down: downs.reverse().join('\n') };
  }

  // mysql — single MODIFY COLUMN statement does type + nullability + default.
  const up = `ALTER TABLE ${q(tableName)} MODIFY COLUMN ${emitColumnDefinition(change.to, dialect)};`;
  const down = `ALTER TABLE ${q(tableName)} MODIFY COLUMN ${emitColumnDefinition(change.from, dialect)};`;
  return { up, down };
}

// ---------------------------------------------------------------------------
// Type mapping per dialect
// ---------------------------------------------------------------------------

function sqlType(descriptor: ColumnDescriptor, dialect: Dialect): string {
  switch (dialect) {
    case 'sqlite':
      return sqlTypeSqlite(descriptor);
    case 'postgres':
      return sqlTypePostgres(descriptor);
    case 'mysql':
      return sqlTypeMysql(descriptor);
  }
}

/**
 * SQLite mapping notes:
 *
 *   - All string-ish logical types (string, uuid, datetime, enum, json)
 *     become TEXT. SQLite uses storage classes, not strict types, so
 *     there's no upside to using a non-TEXT type for these.
 *   - boolean → INTEGER (SQLite convention: 0/1).
 *   - float/double → REAL.
 *   - integer/bigint → INTEGER. SQLite's INTEGER is variable-width up
 *     to 8 bytes, so there's no distinct BIGINT.
 */
function sqlTypeSqlite(c: ColumnDescriptor): string {
  switch (c.logicalType) {
    case 'string':
    case 'uuid':
    case 'datetime':
    case 'enum':
    case 'json':
      return 'TEXT';
    case 'integer':
    case 'bigint':
    case 'boolean':
      return 'INTEGER';
    case 'float':
    case 'double':
      return 'REAL';
  }
}

/**
 * Postgres mapping notes:
 *
 *   - string → VARCHAR(n) when `.maxLength(n)` is set, otherwise TEXT.
 *     TEXT is unbounded and still indexable in Postgres, so it's a
 *     safe default.
 *   - uuid → UUID (native).
 *   - datetime → TIMESTAMP(3) WITH TIME ZONE. Matches Triad's ISO-8601
 *     datetime shape with millisecond precision.
 *   - enum → TEXT with a CHECK constraint. We do NOT emit CREATE TYPE
 *     because that requires managing a separate DB object whose
 *     lifecycle isn't captured in the IR; CHECK keeps migrations
 *     portable.
 *   - json → JSONB. Faster to query than JSON and the 9.4+ baseline.
 *   - bigint → BIGINT (native).
 */
function sqlTypePostgres(c: ColumnDescriptor): string {
  switch (c.logicalType) {
    case 'string':
      return c.maxLength !== undefined ? `VARCHAR(${c.maxLength})` : 'TEXT';
    case 'uuid':
      return 'UUID';
    case 'datetime':
      return 'TIMESTAMP(3) WITH TIME ZONE';
    case 'enum':
      return 'TEXT';
    case 'json':
      return 'JSONB';
    case 'integer':
      return 'INTEGER';
    case 'bigint':
      return 'BIGINT';
    case 'float':
      return 'REAL';
    case 'double':
      return 'DOUBLE PRECISION';
    case 'boolean':
      return 'BOOLEAN';
  }
}

/**
 * MySQL mapping notes:
 *
 *   - string → VARCHAR(n). Defaults to 255 when `.maxLength(n)` is not
 *     set. TEXT is avoided because it can't be part of a primary key
 *     without a prefix length.
 *   - uuid → VARCHAR(36). No native UUID type; 36 is the canonical
 *     hyphenated form.
 *   - datetime → DATETIME(3). DATETIME stores wall-clock, timezone-
 *     agnostic values; fsp: 3 matches ISO-8601 millisecond precision.
 *   - enum → ENUM(...). MySQL's native ENUM.
 *   - json → JSON (MySQL 5.7+).
 *   - boolean → BOOLEAN (alias for TINYINT(1)).
 */
function sqlTypeMysql(c: ColumnDescriptor): string {
  switch (c.logicalType) {
    case 'string':
      return `VARCHAR(${c.maxLength ?? 255})`;
    case 'uuid':
      return 'VARCHAR(36)';
    case 'datetime':
      return 'DATETIME(3)';
    case 'enum': {
      const values = (c.enumValues ?? []).map((v) => `'${v}'`).join(', ');
      return `ENUM(${values})`;
    }
    case 'json':
      return 'JSON';
    case 'integer':
      return 'INT';
    case 'bigint':
      return 'BIGINT';
    case 'float':
      return 'FLOAT';
    case 'double':
      return 'DOUBLE';
    case 'boolean':
      return 'BOOLEAN';
  }
}

// ---------------------------------------------------------------------------
// Default literal emission
// ---------------------------------------------------------------------------

function defaultLiteral(
  column: ColumnDescriptor,
  dialect: Dialect,
): string | undefined {
  const d = column.default;
  if (!d) return undefined;
  if (d.kind === 'now' || d.kind === 'random') {
    // These are Drizzle runtime defaults, not DB-level. Skip them in
    // DDL — the application layer supplies the value at insert time.
    return undefined;
  }
  const v = d.value;
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') {
    // SQLite has no boolean type — use the integer equivalent. Postgres
    // and MySQL both accept TRUE/FALSE.
    if (dialect === 'sqlite') return v ? '1' : '0';
    return v ? 'TRUE' : 'FALSE';
  }
  if (typeof v === 'string') {
    // Single-quote-escape by doubling.
    return `'${v.replace(/'/g, "''")}'`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Identifier quoting
// ---------------------------------------------------------------------------

function quoteId(dialect: Dialect): (id: string) => string {
  if (dialect === 'mysql') return (id) => `\`${id}\``;
  return (id) => `"${id}"`;
}
