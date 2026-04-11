/**
 * `triad frontend generate` — emit a typed TanStack Query client from
 * the project's Triad router.
 *
 * Thin wrapper around `@triad/tanstack-query`: load config → load
 * router → call `generate()` → write files → print summary.
 */

import * as path from 'node:path';
import pc from 'picocolors';
import { generate, writeFiles } from '@triad/tanstack-query';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';

export type FrontendTarget = 'tanstack-query';

export interface FrontendGenerateOptions {
  config?: string;
  router?: string;
  target?: FrontendTarget;
  output?: string;
  baseUrl?: string;
  emitRuntime?: boolean;
}

const DEFAULT_OUTPUT = './src/generated/api';
const SUPPORTED_TARGETS: ReadonlySet<FrontendTarget> = new Set<FrontendTarget>([
  'tanstack-query',
]);

export async function runFrontendGenerate(
  opts: FrontendGenerateOptions,
): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const frontendConfig = loaded.config.frontend ?? {};
  const target: FrontendTarget = opts.target ?? frontendConfig.target ?? 'tanstack-query';

  if (!SUPPORTED_TARGETS.has(target)) {
    throw new CliError(
      `Frontend target "${target}" is not supported. Available: ${[...SUPPORTED_TARGETS].join(', ')}.`,
      'VALIDATION_FAILED',
    );
  }

  const outputRelative = opts.output ?? frontendConfig.output ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(loaded.configDir, outputRelative);
  const baseUrl = opts.baseUrl ?? frontendConfig.baseUrl ?? '/api';
  const emitRuntime = opts.emitRuntime ?? frontendConfig.emitRuntime ?? true;

  const files = generate(router, {
    outputDir: outputPath,
    baseUrl,
    emitRuntime,
  });

  try {
    writeFiles(files, outputPath);
  } catch (err) {
    throw new CliError(
      `Failed to write frontend files to ${outputPath}: ${err instanceof Error ? err.message : String(err)}`,
      'OUTPUT_WRITE_FAILED',
    );
  }

  process.stdout.write(
    `${pc.green('✓')} TanStack Query client written to ${pc.bold(outputPath)}\n` +
      `  ${pc.dim(`${files.length} file(s) · baseUrl=${baseUrl}`)}\n`,
  );
}
