/**
 * `triad db generate` — emit Drizzle table definitions from the project
 * router by reading `.storage()` hints on each schema.
 *
 * The codegen lives in `@triad/drizzle/codegen` so it can also be used
 * programmatically (e.g. by a migration diff tool). This command is a
 * thin wrapper: load config → load router → call `generateDrizzleSchema`
 * → write file → print summary.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import pc from 'picocolors';
import { generateDrizzleSchema, CodegenError } from '@triad/drizzle';
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
]);

export async function runDbGenerate(opts: DbGenerateOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });
  const dialect: DbDialect = opts.dialect ?? 'sqlite';

  if (!SUPPORTED_DIALECTS.has(dialect)) {
    throw new CliError(
      `Dialect "${dialect}" is not yet supported. Available dialects: ${[...SUPPORTED_DIALECTS].join(', ')}. MySQL is queued as a follow-up.`,
      'VALIDATION_FAILED',
    );
  }

  const outputRelative = opts.output ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(loaded.configDir, outputRelative);

  let result;
  try {
    result = generateDrizzleSchema(router, {
      dialect: dialect as 'sqlite' | 'postgres',
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
