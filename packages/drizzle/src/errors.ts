/**
 * Database error introspection helpers.
 *
 * Repositories that use `INSERT ... UNIQUE` constraints typically face a
 * choice: pre-check with a `SELECT` to return a clean 409 Conflict, or
 * catch the driver's raw constraint error and map it post-hoc. The
 * pre-check approach races under concurrent inserts; the catch approach
 * races nothing. This module provides the predicate needed to implement
 * the catch approach portably.
 *
 * Supported drivers (duck-typed, no driver dependencies):
 *
 *   - better-sqlite3: `code === 'SQLITE_CONSTRAINT_UNIQUE'`, message
 *     typically includes `"UNIQUE constraint failed: table.column"`.
 *   - node-postgres (`pg`): `code === '23505'` (SQLSTATE unique
 *     violation), `table` / `column` / `constraint` fields may be
 *     present, `detail` often contains `Key (column)=(value)` text.
 *   - mysql2: `code === 'ER_DUP_ENTRY'`, message typically
 *     `"Duplicate entry 'value' for key 'table.constraint'"`.
 *
 * The parser is best-effort — if the driver's error is recognized as a
 * unique violation but we can't extract a table/column, an empty
 * descriptor `{}` is returned. Callers that only care about the
 * yes/no outcome can treat any truthy return as a conflict.
 */

/**
 * Structured descriptor for a detected unique violation. Every field is
 * optional because parsing the table/column/constraint is best-effort
 * across drivers.
 */
export type DbError = {
  table?: string;
  column?: string;
  constraint?: string;
};

// ---------------------------------------------------------------------------
// Duck-typing helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function readString(
  rec: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!rec) return undefined;
  const v = rec[key];
  return typeof v === 'string' ? v : undefined;
}

// ---------------------------------------------------------------------------
// Per-driver parsers
// ---------------------------------------------------------------------------

function parseSqliteMessage(message: string): DbError {
  // Example: "UNIQUE constraint failed: users.email"
  const match = message.match(
    /UNIQUE constraint failed:\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/,
  );
  if (!match) return {};
  return { table: match[1]!, column: match[2]! };
}

function parseMysqlMessage(message: string): DbError {
  // Example: "Duplicate entry 'alice@example.com' for key 'users.email_unique'"
  const keyMatch = message.match(/for key '([^']+)'/);
  if (!keyMatch) return {};
  const rawKey = keyMatch[1]!;
  // mysql8 emits `table.constraint`; older mysql emits just `constraint`.
  const parts = rawKey.split('.');
  if (parts.length === 2) {
    return { table: parts[0]!, constraint: parts[1]! };
  }
  return { constraint: rawKey };
}

function parsePgDetail(detail: string): DbError {
  // Example: "Key (email)=(alice@example.com) already exists."
  const match = detail.match(/Key \(([^)]+)\)=/);
  if (!match) return {};
  return { column: match[1]! };
}

// ---------------------------------------------------------------------------
// Public predicate
// ---------------------------------------------------------------------------

/**
 * Detect whether an error thrown from Drizzle / better-sqlite3 / pg /
 * mysql2 is a unique-constraint violation. Returns a structured
 * descriptor (possibly empty) when it is, or `null` otherwise.
 *
 * Usage:
 *
 * ```ts
 * try {
 *   return await this.db.insert(users).values(input).returning().get();
 * } catch (err) {
 *   const conflict = isUniqueViolation(err);
 *   if (conflict) {
 *     throw new DuplicateEmailError(input.email, conflict);
 *   }
 *   throw err;
 * }
 * ```
 */
export function isUniqueViolation(err: unknown): DbError | null {
  const rec = asRecord(err);
  if (!rec) return null;

  const code = readString(rec, 'code');
  const message = readString(rec, 'message') ?? '';

  // better-sqlite3
  if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return parseSqliteMessage(message);
  }

  // pg (node-postgres)
  if (code === '23505') {
    const descriptor: DbError = {};
    const table = readString(rec, 'table');
    const column = readString(rec, 'column');
    const constraint = readString(rec, 'constraint');
    if (table) descriptor.table = table;
    if (column) descriptor.column = column;
    if (constraint) descriptor.constraint = constraint;
    const detail = readString(rec, 'detail');
    if (!descriptor.column && detail) {
      const fromDetail = parsePgDetail(detail);
      if (fromDetail.column) descriptor.column = fromDetail.column;
    }
    return descriptor;
  }

  // mysql2
  if (code === 'ER_DUP_ENTRY') {
    return parseMysqlMessage(message);
  }

  // Some SQLite distributions (including the WASM build that Supabase
  // Edge uses) emit the more generic code. Check the message as a
  // secondary signal — a unique-constraint message is unambiguous.
  if (
    code === 'SQLITE_CONSTRAINT' &&
    /UNIQUE constraint failed/.test(message)
  ) {
    return parseSqliteMessage(message);
  }

  return null;
}
