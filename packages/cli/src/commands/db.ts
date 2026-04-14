/**
 * `triad db generate` — emit Drizzle table definitions from the project
 * router by reading `.storage()` hints on each schema.
 *
 * The codegen lives in `@triadjs/drizzle/codegen` so it can also be used
 * programmatically (e.g. by a migration diff tool). This command is a
 * thin wrapper: load config → load router → call `generateDrizzleSchema`
 * → write file → print summary.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import pc from 'picocolors';
import {
  generateDrizzleSchema,
  generateMigration,
  CodegenError,
} from '@triadjs/drizzle';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';

export type DbDialect = 'sqlite' | 'postgres' | 'mysql';

export interface DbGenerateOptions {
  config?: string;
  router?: string;
  output?: string;
  dialect?: DbDialect;
}

const DEFAULT_OUTPUT = './src/db/schema.generated.ts';
const SUPPORTED_DIALECTS: ReadonlySet<DbDialect> = new Set<DbDialect>([
  'sqlite',
  'postgres',
  'mysql',
]);

export async function runDbGenerate(opts: DbGenerateOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });
  const dialect: DbDialect = opts.dialect ?? 'sqlite';

  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new CliError(
      `Dialect "${dialect}" is not yet supported. Available dialects: ${[...SUPPORTED_DIALECTS].join(', ')}.`,
      'VALIDATION_FAILED',
    );
  }

  const outputRelative = opts.output ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(loaded.configDir, outputRelative);

  let result;
  try {
    result = generateDrizzleSchema(router, {
      dialect,
      sourceDescription: path.relative(loaded.configDir, loaded.configPath),
    });
  } catch (err) {
    if (err instanceof CodegenError) {
      throw new CliError(err.message, 'VALIDATION_FAILED');
    }
    throw err;
  }

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.source, 'utf8');
  } catch (err) {
    throw new CliError(
      `Failed to write ${outputPath}: ${err instanceof Error ? err.message : String(err)}`,
      'OUTPUT_WRITE_FAILED',
    );
  }

  const tableSummary = result.tables
    .map((t) => `    ${pc.dim('•')} ${t.identifier} ${pc.dim(`(${t.columns.length} columns)`)}`)
    .join('\n');

  process.stdout.write(
    `${pc.green('✓')} Drizzle ${dialect} schema written to ${pc.bold(outputPath)}\n` +
      `  ${pc.dim(`${result.tables.length} table(s):`)}\n` +
      `${tableSummary}\n`,
  );
}

// ---------------------------------------------------------------------------
// triad db migrate
// ---------------------------------------------------------------------------

export interface DbMigrateOptions {
  config?: string;
  router?: string;
  dialect?: DbDialect;
  dir?: string;
  name?: string;
}

const DEFAULT_MIGRATIONS_DIR = './migrations';

/**
 * `triad db migrate` — diff the current router against the last
 * snapshot in the migrations directory and write an SQL migration
 * file capturing the changes. Codegen only: the file is not
 * executed. See `generateMigration` in `@triadjs/drizzle` for the
 * underlying pipeline.
 */
export async function runDbMigrate(opts: DbMigrateOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const configuredDb = (loaded.config as { db?: { dialect?: DbDialect; migrations?: string } }).db;
  const dialect: DbDialect = opts.dialect ?? configuredDb?.dialect ?? 'sqlite';

  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new CliError(
      `Dialect "${dialect}" is not yet supported. Available dialects: ${[...SUPPORTED_DIALECTS].join(', ')}.`,
      'VALIDATION_FAILED',
    );
  }

  const dirRelative =
    opts.dir ?? configuredDb?.migrations ?? DEFAULT_MIGRATIONS_DIR;
  const directory = path.resolve(loaded.configDir, dirRelative);

  let result;
  try {
    result = generateMigration({
      router,
      dialect,
      directory,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });
  } catch (err) {
    if (err instanceof CodegenError) {
      throw new CliError(err.message, 'VALIDATION_FAILED');
    }
    throw err;
  }

  if (result.path === null) {
    process.stdout.write(
      `${pc.dim('•')} No schema changes — nothing to generate.\n`,
    );
    return;
  }

  const addedCount = result.diff.tablesAdded.length;
  const droppedCount = result.diff.tablesDropped.length;
  const changedTables = result.diff.tableChanges.length;

  const summaryLines: string[] = [];
  if (addedCount > 0) {
    summaryLines.push(
      `    ${pc.dim('•')} ${addedCount} table(s) added: ${result.diff.tablesAdded
        .map((t) => t.tableName)
        .join(', ')}`,
    );
  }
  if (droppedCount > 0) {
    summaryLines.push(
      `    ${pc.dim('•')} ${droppedCount} table(s) dropped: ${result.diff.tablesDropped
        .map((t) => t.tableName)
        .join(', ')}`,
    );
  }
  for (const change of result.diff.tableChanges) {
    const bits: string[] = [];
    if (change.columnsAdded.length > 0) {
      bits.push(`+${change.columnsAdded.length} col`);
    }
    if (change.columnsDropped.length > 0) {
      bits.push(`-${change.columnsDropped.length} col`);
    }
    if (change.columnsChanged.length > 0) {
      bits.push(`~${change.columnsChanged.length} col`);
    }
    summaryLines.push(
      `    ${pc.dim('•')} ${change.table}: ${bits.join(', ')}`,
    );
  }

  process.stdout.write(
    `${pc.green('✓')} Migration written to ${pc.bold(result.path)}\n` +
      `  ${pc.dim(`${dialect} · ${addedCount} added · ${droppedCount} dropped · ${changedTables} altered`)}\n` +
      (summaryLines.length > 0 ? `${summaryLines.join('\n')}\n` : ''),
  );
}
