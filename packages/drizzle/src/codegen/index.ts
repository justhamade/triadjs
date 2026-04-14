/**
 * Codegen entry point. Walks a router and renders Drizzle table
 * definitions as TypeScript source.
 *
 * The pipeline is two-stage:
 *
 *   1. `walkRouter(router, options)` → `TableDescriptor[]`
 *   2. `emitForDialect(dialect, tables, options)` → TypeScript source
 *
 * They're exposed separately so tools can consume the intermediate
 * representation (e.g. a migration generator comparing two descriptor
 * sets to produce ALTER statements).
 */

import type { Router } from '@triadjs/core';
import { walkRouter, CodegenError } from './walker.js';
import {
  emitSqlite,
  emitPostgres,
  emitMysql,
  emitForDialect,
  type EmitOptions,
} from './emit.js';
import type { GenerateOptions, GeneratedFile } from './types.js';

const SUPPORTED_DIALECTS = new Set(['sqlite', 'postgres', 'mysql']);

/**
 * Generate a complete Drizzle schema file from a Triad router.
 *
 * Throws `CodegenError` if the router contains schema constructs that
 * cannot be auto-translated (e.g. a field that references a nested
 * `ModelSchema` directly — see the error message for the recommended
 * fix) or if no table models are present.
 */
export function generateDrizzleSchema(
  router: Router,
  options: GenerateOptions & EmitOptions = {},
): GeneratedFile {
  const dialect = options.dialect ?? 'sqlite';
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new CodegenError(
      `Dialect "${dialect}" is not supported. Available dialects: ` +
        `${[...SUPPORTED_DIALECTS].join(', ')}.`,
    );
  }

  const tables = walkRouter(router, options);

  if (tables.length === 0) {
    throw new CodegenError(
      `No table models were found in the router. To have a model included ` +
        `in the generated schema, mark at least one of its fields with ` +
        `.storage({ primaryKey: true }).`,
    );
  }

  const source = emitForDialect(dialect, tables, options);
  return { source, tables };
}

export {
  walkRouter,
  emitSqlite,
  emitPostgres,
  emitMysql,
  emitForDialect,
  CodegenError,
};
export type { GenerateOptions, GeneratedFile, EmitOptions };
export type {
  ColumnDescriptor,
  ColumnDefault,
  LogicalColumnType,
  TableDescriptor,
  Dialect,
} from './types.js';
