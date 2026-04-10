/**
 * `triad gherkin` — generate `.feature` files from the project router.
 */

import * as path from 'node:path';
import pc from 'picocolors';
import { generateGherkin, writeGherkinFiles } from '@triad/gherkin';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';

export interface GherkinOptions {
  config?: string;
  router?: string;
  output?: string;
}

const DEFAULT_OUTPUT = './generated/features';

export async function runGherkin(opts: GherkinOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const outputRelative =
    opts.output ?? loaded.config.gherkin?.output ?? DEFAULT_OUTPUT;
  const outputDir = path.resolve(loaded.configDir, outputRelative);

  const files = generateGherkin(router);

  if (files.length === 0) {
    process.stdout.write(
      `${pc.yellow('!')} No features generated — the router has no endpoints with behaviors.\n`,
    );
    return;
  }

  let written: string[];
  try {
    written = writeGherkinFiles(files, outputDir);
  } catch (err) {
    throw new CliError(
      `Failed to write feature files to ${outputDir}: ${err instanceof Error ? err.message : String(err)}`,
      'OUTPUT_WRITE_FAILED',
    );
  }

  const lines: string[] = [];
  lines.push(
    `${pc.green('✓')} Wrote ${pc.bold(String(written.length))} feature file(s) to ${pc.bold(outputDir)}`,
  );
  for (const f of files) {
    const scenarioCount = countScenarios(f.content);
    lines.push(
      `  ${pc.dim('•')} ${f.filename} ${pc.dim(`(${scenarioCount} scenario${scenarioCount === 1 ? '' : 's'})`)}`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function countScenarios(content: string): number {
  return (content.match(/^\s*Scenario:/gm) ?? []).length;
}
