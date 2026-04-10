/**
 * Vitest / Jest adapter for the behavior runner.
 *
 * Rather than depending on a specific test framework, the adapter accepts
 * `describe` and `it` functions from the caller. This keeps `@triad/test-
 * runner` free of any test-framework dependency — users bring their own.
 *
 * Usage:
 *
 * ```ts
 * import { describe, it } from 'vitest';
 * import { registerBehaviors } from '@triad/test-runner';
 * import router from '../src/app';
 * import { createTestServices } from './test-setup';
 *
 * registerBehaviors(router, {
 *   describe,
 *   it,
 *   servicesFactory: createTestServices,
 *   teardown: (services) => services.cleanup(),
 * });
 * ```
 *
 * Each endpoint becomes a `describe` block; each behavior becomes an `it`.
 * Test framework reporters show scenario names, which makes failures read
 * like business rules: "Pets can be created with valid data — FAILED".
 */

import type { Router } from '@triad/core';
import { runOneBehavior, type RunOptions } from './runner.js';
import { collectModels } from './models.js';

export type DescribeFn = (name: string, fn: () => void) => void;
export type ItFn = (name: string, fn: () => void | Promise<void>) => void;

export interface RegisterOptions extends RunOptions {
  describe: DescribeFn;
  it: ItFn;
}

/**
 * Register every behavior in the router as a test case in the host
 * framework. Call this from a test file that's picked up by vitest/jest.
 */
export function registerBehaviors(
  router: Router,
  options: RegisterOptions,
): void {
  const { describe, it, ...runOptions } = options;
  const models = collectModels(router);

  for (const endpoint of router.allEndpoints()) {
    if (runOptions.filter && !runOptions.filter(endpoint)) continue;
    if (endpoint.behaviors.length === 0) continue;

    describe(`${endpoint.method} ${endpoint.path} — ${endpoint.name}`, () => {
      for (const behavior of endpoint.behaviors) {
        it(behavior.scenario, async () => {
          const result = await runOneBehavior(endpoint, behavior, models, runOptions);
          if (result.status !== 'passed') {
            const failure = result.failure;
            const lines = [
              `${result.status.toUpperCase()}: ${behavior.scenario}`,
              failure?.message ?? '(no failure message)',
            ];
            if (failure?.actualStatus !== undefined) {
              lines.push(`Actual status: ${failure.actualStatus}`);
            }
            if (failure?.actualBody !== undefined) {
              lines.push(`Actual body: ${JSON.stringify(failure.actualBody)}`);
            }
            throw new Error(lines.join('\n'));
          }
        });
      }
    });
  }
}
