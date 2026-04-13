/**
 * `triad fuzz` CLI wrapper — loads the router from config and delegates to
 * the fuzz runner.
 */

import pc from 'picocolors';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';
import { runFuzz, type FuzzSummary } from './fuzz.js';

export interface FuzzCliOptions {
  config?: string;
  router?: string;
  filter?: string;
  runs?: number;
  seed?: number;
  failFast?: boolean;
  categories?: string;
}

export async function runFuzzCommand(opts: FuzzCliOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const summary: FuzzSummary = await runFuzz({
    router,
    filter: opts.filter,
    runs: opts.runs,
    seed: opts.seed,
    failFast: opts.failFast,
    categories: opts.categories,
  });

  reportFuzz(summary);

  if (summary.failed > 0) {
    throw new CliError(
      `Fuzz failed: ${summary.failed} scenario(s) did not pass.`,
      'FUZZ_FAILED',
    );
  }
}

function reportFuzz(summary: FuzzSummary): void {
  if (summary.total === 0) {
    process.stdout.write('No endpoints to fuzz.\n');
    return;
  }

  let currentEndpoint = '';
  for (const r of summary.results) {
    const header = `${r.method} ${r.path} — ${r.endpointName}`;
    if (header !== currentEndpoint) {
      currentEndpoint = header;
      process.stdout.write(`\n${header}\n`);
    }
    const icon = r.status === 'passed' ? pc.green('✓') : pc.red('✗');
    process.stdout.write(`  ${icon} ${r.scenario}\n`);
  }

  process.stdout.write(
    `\nFuzz complete: ${summary.total} scenarios — ${summary.passed} passed, ${summary.failed} failed\n`,
  );
}
