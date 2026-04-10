/**
 * @triad/drizzle — bridge helpers for pairing Triad schemas with Drizzle
 * tables.
 *
 * # The pattern
 *
 * Triad deliberately keeps the API contract (`t.model()`) separate from
 * the storage contract (`pgTable()` / `sqliteTable()`). They describe
 * different things:
 *
 *   - The Triad schema is what clients see over the wire — field names,
 *     validation, documentation, examples, OpenAPI components.
 *   - The Drizzle schema is what lives in the database — column names
 *     (often snake_case), foreign keys, soft-delete columns, indexes,
 *     internal fields the API never exposes.
 *
 * The **repository** is the translation layer between them. A typical
 * repository method looks like this:
 *
 * ```ts
 * async findById(id: string): Promise<Pet | null> {
 *   const row = await this.db
 *     .select()
 *     .from(pets)
 *     .where(eq(pets.id, id))
 *     .get();
 *   return row ? this.rowToApi(row) : null;
 * }
 * ```
 *
 * This package provides:
 *
 * 1. **Type helpers** that let you name the row and insert types inferred
 *    from your Drizzle tables without pulling Drizzle's full generics
 *    soup into every file.
 * 2. **`validateAgainst`** — a runtime helper that parses a row (already
 *    mapped to the API shape) through the Triad model. Use it at the
 *    repository boundary to catch drift between your DB schema and your
 *    API schema early.
 *
 * It does **not** try to generate Drizzle tables from Triad schemas
 * automatically. That would hide the deliberate column-level choices
 * (snake_case names, cents-based Money storage, JSON-as-text for arrays)
 * that make a real database schema work. The `.storage()` metadata on
 * Triad schemas is a future-facing hint for codegen tooling.
 */

import type { SchemaNode, Infer, ValidationError } from '@triad/core';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/**
 * Extract the row type from a Drizzle table definition without importing
 * Drizzle directly. Use alongside Triad's `Infer` to make the two worlds'
 * types visible side by side:
 *
 * ```ts
 * import { pets } from './db/schema.js';
 * import { Pet } from './schemas/pet.js';
 *
 * type PetRow = InferRow<typeof pets>;       // DB row
 * type PetModel = Infer<typeof Pet>;         // API shape
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferRow<T extends { $inferSelect: any }> = T['$inferSelect'];

/** Extract the insert type from a Drizzle table definition. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferInsert<T extends { $inferInsert: any }> = T['$inferInsert'];

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

/**
 * Parse a (already shape-mapped) row through a Triad model.
 *
 * Use this at the boundary of repository methods so anything coming out
 * of the database is verified against the API contract before reaching
 * handlers. If the DB ever drifts away from the Triad schema (a migration
 * adds a field, a constraint slips, old data doesn't match the current
 * enum) this call surfaces the mismatch immediately instead of silently
 * sending malformed data to clients.
 *
 * Throws `ValidationException` on failure — the repository's caller
 * (usually the endpoint handler) should not catch it; let it bubble up
 * so the adapter maps it to a 500 and logs the drift.
 */
export function validateAgainst<T extends SchemaNode>(
  model: T,
  row: unknown,
): Infer<T> {
  return model.parse(row) as Infer<T>;
}

/**
 * Same as `validateAgainst` but returns a `Result` instead of throwing.
 * Useful for repositories that want to handle drift gracefully (e.g.
 * fall back to a default value or filter out bad rows from a list).
 */
export function validateAgainstSafe<T extends SchemaNode>(
  model: T,
  row: unknown,
):
  | { success: true; data: Infer<T> }
  | { success: false; errors: ValidationError[] } {
  const result = model.validate(row);
  if (result.success) {
    return { success: true, data: result.data as Infer<T> };
  }
  return { success: false, errors: result.errors };
}

// ---------------------------------------------------------------------------
// Storage-metadata access
// ---------------------------------------------------------------------------

/**
 * Walk a model's shape and return the field name marked with
 * `.storage({ primaryKey: true })`. Complements Triad's `.identity()`
 * marker — `identity` is the *domain* identity, `primaryKey` is the
 * *storage* identity. They are usually but not always the same column.
 *
 * Returns `undefined` if no field is marked. Only the first match is
 * returned — composite keys are not exposed here.
 */
export function findPrimaryKey<T extends SchemaNode>(
  model: T,
): string | undefined {
  // We reach into the schema via structural access rather than the class
  // hierarchy so this works across duplicate module graphs (same reason
  // the test-runner and CLI use `kind`-based walks).
  const shape = (model as unknown as { shape?: Record<string, SchemaNode> })
    .shape;
  if (!shape) return undefined;
  for (const [key, field] of Object.entries(shape)) {
    if (field.metadata.storage?.primaryKey) return key;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Codegen — generate Drizzle table definitions from a Triad router
// ---------------------------------------------------------------------------

export {
  generateDrizzleSchema,
  walkRouter,
  emitSqlite,
  emitPostgres,
  emitForDialect,
  CodegenError,
} from './codegen/index.js';

export type {
  GenerateOptions,
  GeneratedFile,
  EmitOptions,
  TableDescriptor,
  ColumnDescriptor,
  ColumnDefault,
  LogicalColumnType,
  Dialect,
} from './codegen/index.js';
