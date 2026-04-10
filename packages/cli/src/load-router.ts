/**
 * Load the user's router module by path.
 *
 * The module must default-export a `Router` instance. Relative paths are
 * resolved against the config file's directory so a typical layout like
 * `router: './src/app.ts'` in `./triad.config.ts` just works.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import { Router } from '@triad/core';
import { CliError } from './errors.js';
import type { LoadedConfig } from './load-config.js';

export async function loadRouter(
  loaded: LoadedConfig,
  override?: { router?: string },
): Promise<Router> {
  const routerPath = override?.router ?? loaded.config.router;
  if (!routerPath) {
    throw new CliError(
      `No router path specified. Set \`router\` in triad.config.ts or pass --router <path>.`,
      'NO_ROUTER',
    );
  }

  const absPath = path.resolve(loaded.configDir, routerPath);
  if (!fs.existsSync(absPath)) {
    throw new CliError(`Router file not found: ${absPath}`, 'ROUTER_NOT_FOUND');
  }

  let loadedRouter: unknown;
  try {
    const jiti = createJiti(absPath, { interopDefault: true });
    loadedRouter = await jiti.import(absPath, { default: true });
  } catch (err) {
    throw new CliError(
      `Failed to load router at ${absPath}: ${errMessage(err)}`,
      'INVALID_ROUTER',
    );
  }

  if (!Router.isRouter(loadedRouter)) {
    throw new CliError(
      `The module at ${absPath} must default-export a Router instance ` +
        `(got ${describe(loadedRouter)}). Did you forget \`export default router\`?`,
      'INVALID_ROUTER',
    );
  }

  return loadedRouter;
}

/**
 * Load the test setup module. The module must default-export a
 * `servicesFactory` function matching `RunOptions.servicesFactory`.
 */
export async function loadTestSetup(
  loaded: LoadedConfig,
): Promise<((() => unknown) | (() => Promise<unknown>)) | undefined> {
  const setupPath = loaded.config.test?.setup;
  if (!setupPath) return undefined;

  const absPath = path.resolve(loaded.configDir, setupPath);
  if (!fs.existsSync(absPath)) {
    throw new CliError(
      `Test setup file not found: ${absPath}`,
      'SETUP_NOT_FOUND',
    );
  }

  let loadedSetup: unknown;
  try {
    const jiti = createJiti(absPath, { interopDefault: true });
    loadedSetup = await jiti.import(absPath, { default: true });
  } catch (err) {
    throw new CliError(
      `Failed to load test setup at ${absPath}: ${errMessage(err)}`,
      'SETUP_INVALID',
    );
  }

  if (typeof loadedSetup !== 'function') {
    throw new CliError(
      `The test setup module at ${absPath} must default-export a function ` +
        `(got ${describe(loadedSetup)}).`,
      'SETUP_INVALID',
    );
  }

  return loadedSetup as () => unknown;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
