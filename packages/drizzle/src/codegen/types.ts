/**
 * Intermediate representation for Drizzle codegen.
 *
 * The walker produces `TableDescriptor[]` from a Triad router by reading
 * `.storage()` hints and field schemas. Each column carries a
 * **logical type** that's deliberately dialect-neutral — the emitter
 * decides how to translate `'uuid'` to a SQLite `text` column or a
 * Postgres `uuid` column. Keeping the walker oblivious to the target
 * dialect is what lets a single walk feed multiple dialect emitters.
 */

/**
 * Dialect-neutral logical column types.
 *
 * One of these is chosen per field by looking at the Triad schema's
 * `kind`, the numeric `numberType` (for int vs float distinctions), and
 * string `format` (for `uuid` recognition). The emitter then maps each
 * logical type to its dialect-specific Drizzle helper — `'uuid'` becomes
 * `text()` in SQLite and `uuid()` in Postgres.
 */
export type LogicalColumnType =
  | 'string' //     Any plain string
  | 'uuid' //       t.string().format('uuid') — becomes a real `uuid` column in PG
  | 'datetime' //   t.datetime() — ISO 8601 string in both dialects
  | 'integer' //    int32
  | 'bigint' //     int64
  | 'float' //      float32
  | 'double' //     float64
  | 'boolean' //    t.boolean()
  | 'enum' //       t.enum(...) — enumValues list carries the allowed set
  | 'json'; //      arrays, records, tuples, unions, unknown — serialized

export interface ColumnDescriptor {
  /** Triad field name (preserved as-is for the TS identifier). */
  fieldName: string;
  /** SQL column name (usually snake_case of fieldName). */
  columnName: string;
  /** Dialect-neutral logical type. */
  logicalType: LogicalColumnType;
  /** Enum values, when `logicalType === 'enum'`. */
  enumValues?: readonly string[];
  /**
   * Explicit `.maxLength(n)` set on a string schema. Dialects that
   * require a size hint (e.g. MySQL's `varchar`) use this to avoid
   * hard-coding a default length when the author was specific.
   */
  maxLength?: number;
  /** True when the column is a primary key. */
  primaryKey: boolean;
  /** True when the column is NOT NULL. */
  notNull: boolean;
  /** True when the column has a unique constraint. */
  unique: boolean;
  /** Foreign key reference in the form `'tableName.columnName'`. */
  references?: string;
  /** Default clause. */
  default?: ColumnDefault;
  /** A comment emitted above the column declaration. */
  comment?: string;
}

export type ColumnDefault =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'now' }
  | { kind: 'random' };

export interface TableDescriptor {
  /** TypeScript identifier for the exported const (e.g. `pets`). */
  identifier: string;
  /** SQL table name (e.g. `pets`). */
  tableName: string;
  /** Source Triad model name, for comments and error messages. */
  modelName: string;
  /** Columns in declaration order. */
  columns: ColumnDescriptor[];
}

export type Dialect = 'sqlite' | 'postgres' | 'mysql';

export interface GenerateOptions {
  /** Database dialect. Defaults to `'sqlite'`. */
  dialect?: Dialect;
  /**
   * Override the auto-derived table name for a given model. Keys are
   * model names, values are table names. Without an entry, the default
   * is `toLowerCase(modelName) + 's'` (e.g. `Pet` → `pets`).
   */
  tableNames?: Record<string, string>;
  /**
   * Override the auto-derived column name for a given
   * `ModelName.fieldName`. The `.storage({ columnName })` hint on the
   * field takes precedence over this option.
   */
  columnNames?: Record<string, string>;
}

export interface GeneratedFile {
  /** The rendered TypeScript source. */
  source: string;
  /** The table descriptors that produced it, for inspection by tooling. */
  tables: TableDescriptor[];
}
