/**
 * `triad frontend generate` — emit typed frontend clients from the
 * project's Triad router.
 *
 * Supports two targets today:
 *
 *   - `tanstack-query`  — typed React Query hooks from HTTP endpoints
 *   - `channel-client`  — typed vanilla TypeScript WebSocket clients
 *                         from `channel()` declarations
 *
 * Multiple targets may be passed as a comma-separated list:
 * `triad frontend generate --target tanstack-query,channel-client`
 *
 * Thin wrapper: load config → load router → call the selected
 * generator(s) → write files → print summary.
 */

import * as path from 'node:path';
import pc from 'picocolors';
import { generate, writeFiles } from '@triad/tanstack-query';
import {
  generateChannelClient,
  writeFiles as writeChannelFiles,
} from '@triad/channel-client';
import { loadConfig } from '../load-config.js';
import { loadRouter } from '../load-router.js';
import { CliError } from '../errors.js';

export type FrontendTarget =
  | 'tanstack-query'
  | 'channel-client'
  | 'channel-client-react';

export interface FrontendGenerateOptions {
  config?: string;
  router?: string;
  target?: FrontendTarget | FrontendTarget[] | string;
  output?: string;
  baseUrl?: string;
  emitRuntime?: boolean;
}

const DEFAULT_OUTPUT = './src/generated/api';
const SUPPORTED_TARGETS: ReadonlySet<FrontendTarget> = new Set<FrontendTarget>([
  'tanstack-query',
  'channel-client',
  'channel-client-react',
]);

function normalizeTargets(
  raw: FrontendGenerateOptions['target'],
  fallback: FrontendTarget,
): FrontendTarget[] {
  if (raw === undefined) return [fallback];
  if (Array.isArray(raw)) return dedupe(raw.map(validateTarget));
  const parts = String(raw)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return [fallback];
  return dedupe(parts.map(validateTarget));
}

function validateTarget(value: string): FrontendTarget {
  if (!SUPPORTED_TARGETS.has(value as FrontendTarget)) {
    throw new CliError(
      `Frontend target "${value}" is not supported. Available: ${[...SUPPORTED_TARGETS].join(', ')}.`,
      'VALIDATION_FAILED',
    );
  }
  return value as FrontendTarget;
}

function dedupe(values: FrontendTarget[]): FrontendTarget[] {
  return Array.from(new Set(values));
}

export async function runFrontendGenerate(
  opts: FrontendGenerateOptions,
): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const frontendConfig = loaded.config.frontend ?? {};
  const fallbackTarget: FrontendTarget =
    (frontendConfig.target as FrontendTarget | undefined) ?? 'tanstack-query';
  const targets = normalizeTargets(opts.target, fallbackTarget);

  const outputRelative = opts.output ?? frontendConfig.output ?? DEFAULT_OUTPUT;
  const outputPath = path.resolve(loaded.configDir, outputRelative);
  const baseUrl = opts.baseUrl ?? frontendConfig.baseUrl ?? '/api';
  const emitRuntime = opts.emitRuntime ?? frontendConfig.emitRuntime ?? true;

  for (const target of targets) {
    if (target === 'tanstack-query') {
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
      continue;
    }

    if (target === 'channel-client' || target === 'channel-client-react') {
      // `channel-client-react` is a superset of `channel-client`: it
      // emits both the vanilla client files and the React hook
      // wrappers. If both targets were passed explicitly, the
      // dedupe above collapses them into a single React run; if
      // only `channel-client` was passed (the plain one we already
      // handled in an earlier loop iteration) we'd otherwise emit
      // twice, so we skip the plain run when `channel-client-react`
      // is also in the list.
      if (target === 'channel-client' && targets.includes('channel-client-react')) {
        continue;
      }
      const channelOutput = path.join(outputPath, 'channels');
      const isReact = target === 'channel-client-react';
      const files = generateChannelClient(router, {
        outputDir: channelOutput,
        baseUrl,
        emitRuntime,
        target,
      });
      if (files.length === 0) {
        process.stdout.write(
          `${pc.yellow('!')} Channel client target skipped: router has no channels.\n`,
        );
        continue;
      }
      try {
        writeChannelFiles(files, channelOutput);
      } catch (err) {
        throw new CliError(
          `Failed to write channel-client files to ${channelOutput}: ${err instanceof Error ? err.message : String(err)}`,
          'OUTPUT_WRITE_FAILED',
        );
      }
      const label = isReact
        ? 'Channel client (React) written to'
        : 'Channel client written to';
      process.stdout.write(
        `${pc.green('✓')} ${label} ${pc.bold(channelOutput)}\n` +
          `  ${pc.dim(`${files.length} file(s) · baseUrl=${baseUrl}`)}\n`,
      );
    }
  }
}
