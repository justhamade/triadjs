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
  | 'channel-client-react'
  | 'channel-client-solid'
  | 'channel-client-vue'
  | 'channel-client-svelte';

const CHANNEL_CLIENT_TARGETS: ReadonlySet<FrontendTarget> = new Set<FrontendTarget>([
  'channel-client',
  'channel-client-react',
  'channel-client-solid',
  'channel-client-vue',
  'channel-client-svelte',
]);

function isChannelClientTarget(target: FrontendTarget): boolean {
  return CHANNEL_CLIENT_TARGETS.has(target);
}

function isChannelFrameworkTarget(target: FrontendTarget): boolean {
  return target !== 'channel-client' && isChannelClientTarget(target);
}

function channelTargetLabel(target: FrontendTarget): string {
  switch (target) {
    case 'channel-client':
      return 'Channel client written to';
    case 'channel-client-react':
      return 'Channel client (React) written to';
    case 'channel-client-solid':
      return 'Channel client (Solid) written to';
    case 'channel-client-vue':
      return 'Channel client (Vue) written to';
    case 'channel-client-svelte':
      return 'Channel client (Svelte) written to';
    default:
      return 'Channel client written to';
  }
}

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
  'channel-client-solid',
  'channel-client-vue',
  'channel-client-svelte',
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

    if (isChannelClientTarget(target)) {
      // Every framework-flavored channel target is a SUPERSET of
      // `channel-client`: it emits the vanilla files plus framework
      // hook files. If the plain `channel-client` target is combined
      // with any framework target, we skip its plain run — otherwise
      // the vanilla files would be written twice to the same dir.
      if (
        target === 'channel-client' &&
        targets.some((t) => isChannelFrameworkTarget(t))
      ) {
        continue;
      }
      const channelOutput = path.join(outputPath, 'channels');
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
      process.stdout.write(
        `${pc.green('✓')} ${channelTargetLabel(target)} ${pc.bold(channelOutput)}\n` +
          `  ${pc.dim(`${files.length} file(s) · baseUrl=${baseUrl}`)}\n`,
      );
    }
  }
}
