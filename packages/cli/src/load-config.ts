/**
 * Locate and load `triad.config.ts` (or `.js` / `.mjs`).
 *
 * Uses `jiti` to import TypeScript config files at runtime without a
 * pre-build step. Searches upward from the current working directory
 * until a config file is found, or uses an explicit `--config` path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import type { TriadConfig } from '@triadjs/test-runner';
import { CliError } from './errors.js';

const CONFIG_CANDIDATES = [
  'triad.config.ts',
  'triad.config.mts',
  'triad.config.js',
  'triad.config.mjs',
];

export interface LoadedConfig {
  config: TriadConfig;
  /** Absolute path to the config file. */
  configPath: string;
  /** Absolute path to the directory containing the config file. */
  configDir: string;
}

/**
 * Load a Triad config file. If `explicitPath` is provided it is used
 * directly; otherwise the function walks up from `cwd` looking for a
 * `triad.config.*` file.
 */
export async function loadConfig(
  explicitPath?: string,
  cwd: string = process.cwd(),
): Promise<LoadedConfig> {
  const configPath = explicitPath
    ? path.resolve(cwd, explicitPath)
    : findConfig(cwd);

  if (!configPath) {
    throw new CliError(
      `No triad.config.ts found. Create one in your project root, or pass --config <path>.`,
      'CONFIG_NOT_FOUND',
    );
  }

  if (!fs.existsSync(configPath)) {
    throw new CliError(
      `Config file not found: ${configPath}`,
      'CONFIG_NOT_FOUND',
    );
  }

  let loaded: unknown;
  try {
    const jiti = createJiti(configPath, { interopDefault: true });
    loaded = await jiti.import(configPath, { default: true });
  } catch (err) {
    throw new CliError(
      `Failed to load config at ${configPath}: ${errMessage(err)}`,
      'CONFIG_INVALID',
    );
  }

  if (!loaded || typeof loaded !== 'object') {
    throw new CliError(
      `Config at ${configPath} must default-export a TriadConfig object (got ${typeof loaded}).`,
      'CONFIG_INVALID',
    );
  }

  return {
    config: loaded as TriadConfig,
    configPath,
    configDir: path.dirname(configPath),
  };
}

/** Walk up from `startDir` looking for a `triad.config.*` file. */
function findConfig(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    for (const name of CONFIG_CANDIDATES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
