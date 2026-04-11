/**
 * `triad` CLI entry point.
 *
 * Dispatches to subcommands via commander. Top-level options (`--config`,
 * `--router`) are available on every subcommand. Every CliError is caught
 * at the top level and printed without a stack trace; any other error
 * crashes loudly with a full stack for debugging.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import { runDocs } from './commands/docs.js';
import { runGherkin } from './commands/gherkin.js';
import { runTest } from './commands/test.js';
import { runValidate } from './commands/validate.js';
import { runDbGenerate, runDbMigrate } from './commands/db.js';
import { runFrontendGenerate } from './commands/frontend.js';
import { runNew } from './commands/new.js';
import { runMock } from './commands/mock.js';
import { runDocsCheck } from './commands/docs-check.js';
import { CliError } from './errors.js';

const VERSION = '0.1.0';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('triad')
    .description(
      'Triad CLI — generate OpenAPI, Gherkin, and run behavior tests from a single source of truth.',
    )
    .version(VERSION)
    .option('-c, --config <path>', 'path to triad.config.ts')
    .option('-r, --router <path>', 'override the router path');

  program
    .command('docs')
    .description('Generate an OpenAPI 3.1 document from the router')
    .option('-o, --output <path>', 'output file path')
    .option('-f, --format <format>', 'output format: yaml or json')
    .action(async (cmdOpts) => {
      await runDocs({ ...program.opts(), ...cmdOpts });
    });

  program
    .command('gherkin')
    .description('Generate Gherkin .feature files from the router')
    .option('-o, --output <dir>', 'output directory')
    .action(async (cmdOpts) => {
      await runGherkin({ ...program.opts(), ...cmdOpts });
    });

  program
    .command('test')
    .description('Run every behavior in the router as an in-process test')
    .option('--bail', 'stop on first failure')
    .option('--filter <pattern>', 'only run endpoints whose name contains <pattern>')
    .action(async (cmdOpts) => {
      await runTest({ ...program.opts(), ...cmdOpts });
    });

  program
    .command('validate')
    .description('Cross-artifact consistency checks on the router')
    .option('--strict', 'treat warnings as errors')
    .action(async (cmdOpts) => {
      await runValidate({ ...program.opts(), ...cmdOpts });
    });

  // `db` is a subcommand group. Today it only has `generate`; future
  // phases will add `migrate`, `diff`, and `push`.
  const dbCommand = program
    .command('db')
    .description('Database schema utilities (Drizzle codegen, migrations)');

  dbCommand
    .command('generate')
    .description('Generate Drizzle table definitions from the router schemas')
    .option('-o, --output <path>', 'output file path')
    .option(
      '-d, --dialect <dialect>',
      'database dialect: sqlite, postgres, or mysql',
      'sqlite',
    )
    .action(async (cmdOpts) => {
      await runDbGenerate({ ...program.opts(), ...cmdOpts });
    });

  dbCommand
    .command('migrate')
    .description(
      'Diff the router against the last snapshot and write an SQL migration file',
    )
    .option(
      '-d, --dialect <dialect>',
      'database dialect: sqlite, postgres, or mysql',
    )
    .option('--dir <path>', 'migrations directory (default: ./migrations)')
    .option('-n, --name <name>', 'optional name suffix for the migration file')
    .action(async (cmdOpts) => {
      await runDbMigrate({ ...program.opts(), ...cmdOpts });
    });

  // `frontend` — codegen for frontend clients. v1 targets TanStack Query.
  const frontendCommand = program
    .command('frontend')
    .description('Frontend client codegen (typed TanStack Query hooks, ...)');

  // `triad new` — scaffold a project from a built-in example template.
  program
    .command('new')
    .description(
      'Scaffold a new Triad project from a built-in template (fastify-petstore, express-tasktracker, fastify-bookshelf, hono-supabase)',
    )
    .argument('[project-path]', 'where to create the project')
    .option('-t, --template <name>', 'template to use')
    .option('--force', 'overwrite the target directory if it is not empty')
    .action(async (projectPath: string | undefined, cmdOpts) => {
      await runNew({
        ...program.opts(),
        ...cmdOpts,
        ...(projectPath !== undefined && { projectPath }),
      });
    });

  // `triad mock` — zero-dependency fake HTTP server driven by the router.
  program
    .command('mock')
    .description(
      'Start a mock HTTP server that returns schema-valid fake responses from the router',
    )
    .option('-p, --port <n>', 'bind port (default 3333)', (v) => Number(v))
    .option('--latency <ms>', 'artificial latency in ms', (v) => Number(v))
    .option('--error-rate <r>', 'fraction of requests that return 500', (v) =>
      Number(v),
    )
    .option('--seed <n>', 'seed the fake-data RNG for reproducibility', (v) =>
      Number(v),
    )
    .action(async (cmdOpts) => {
      await runMock({ ...program.opts(), ...cmdOpts });
    });

  // `triad docs check` — breaking-change detection against a baseline.
  // Attach as a subcommand of the pre-existing `docs` command without
  // touching its original definition.
  const docsCommand = program.commands.find((c) => c.name() === 'docs');
  if (docsCommand) {
    docsCommand
      .command('check')
      .description(
        'Diff the current OpenAPI against a baseline and classify changes as safe, risky, or breaking',
      )
      .option(
        '--against <ref-or-path>',
        'git ref or file path to compare against (default: main)',
      )
      .option('--allow-breaking', 'exit 0 even if breaking changes are found')
      .action(async (cmdOpts) => {
        await runDocsCheck({ ...program.opts(), ...cmdOpts });
      });
  }

  frontendCommand
    .command('generate')
    .description(
      'Generate typed frontend clients from the router (tanstack-query, channel-client, channel-client-react, channel-client-solid, channel-client-vue, channel-client-svelte)',
    )
    .option(
      '-t, --target <target>',
      'frontend target(s), comma-separated: tanstack-query, channel-client, channel-client-react, channel-client-solid, channel-client-vue, channel-client-svelte',
    )
    .option('-o, --output <path>', 'output directory')
    .option('-b, --base-url <url>', 'base URL embedded in the runtime client')
    .action(async (cmdOpts) => {
      await runFrontendGenerate({ ...program.opts(), ...cmdOpts });
    });

  return program;
}

/** Top-level dispatcher: parse args, run, handle errors. */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(argv as string[]);
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${pc.red('✗')} ${pc.red(err.message)}\n`);
      process.exit(err.exitCode);
    }
    // Unexpected errors: print the full stack so users can file a bug.
    process.stderr.write(
      `${pc.red('✗ Unexpected error:')} ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

// Only execute `main()` when this file is the entry point (i.e. run as `triad`).
// When imported from tests, the program is created via `createProgram()` and
// `main()` is called explicitly with a custom argv.
//
// We compare the resolved real path of `process.argv[1]` to this module's
// URL so the check works whether the binary is invoked directly, via
// `node_modules/.bin/triad` (a symlink), or through `npx`.
function isEntryPoint(): boolean {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryReal = realpathSync(entry);
    const moduleReal = fileURLToPath(import.meta.url);
    return entryReal === moduleReal;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main();
}
