/**
 * `triad test` — run every behavior in the router as an in-process test.
 *
 * Runs both HTTP endpoint behaviors (via `runBehaviors`) and WebSocket
 * channel behaviors (via `runChannelBehaviors`). Results from both are
 * merged into a single summary so users get one pass/fail count
 * regardless of which protocol their routes use.
 *
 * Exits with code 1 if any scenario fails or errors.
 */

import type {
  RunOptions,
  RunChannelOptions,
  RunSummary,
  TestResult,
} from '@triad/test-runner';
import type { ServiceContainer } from '@triad/core';
import { runBehaviors, runChannelBehaviors } from '@triad/test-runner';
import { loadConfig } from '../load-config.js';
import { loadRouter, loadTestSetup } from '../load-router.js';
import { reportSummary } from '../reporter.js';
import { CliError } from '../errors.js';

export interface TestOptions {
  config?: string;
  router?: string;
  bail?: boolean;
  filter?: string;
}

export async function runTest(opts: TestOptions): Promise<void> {
  const loaded = await loadConfig(opts.config);
  const router = await loadRouter(loaded, { router: opts.router });

  const servicesFactory = await loadTestSetup(loaded);
  const teardownKey = loaded.config.test?.teardown;

  const runOptions: RunOptions = {};
  if (servicesFactory !== undefined) {
    runOptions.servicesFactory =
      servicesFactory as RunOptions['servicesFactory'];
  }

  // Call `services[teardownKey]()` after each scenario if a teardown method
  // name was configured. The method is looked up on the live services object
  // so cleanup hooks see the state the scenario left behind.
  if (teardownKey) {
    runOptions.teardown = async (services: ServiceContainer) => {
      const maybeFn = (services as Record<string, unknown>)[teardownKey];
      if (typeof maybeFn === 'function') {
        await (maybeFn as () => unknown | Promise<unknown>).call(services);
      }
    };
  }

  const bail = opts.bail ?? loaded.config.test?.bail;
  if (bail !== undefined) runOptions.bail = bail;

  if (opts.filter) {
    const needle = opts.filter;
    runOptions.filter = (endpoint) => endpoint.name.includes(needle);
  }

  // The channel runner takes its own filter signature (Channel → bool)
  // so we clone the options without the HTTP-specific filter and
  // rebuild it against the channel's `name` field.
  const { filter: _httpFilter, ...baseOptions } = runOptions;
  const channelOptions: RunChannelOptions = { ...baseOptions };
  if (opts.filter) {
    const needle = opts.filter;
    channelOptions.filter = (channel) => channel.name.includes(needle);
  }

  // Run HTTP endpoint behaviors first.
  const httpSummary: RunSummary = await runBehaviors(router, runOptions);

  // Then run channel behaviors — same services factory, same teardown,
  // parallel filter. The channel runner is a no-op when the router has
  // no channels.
  const channelSummary: RunSummary = await runChannelBehaviors(
    router,
    channelOptions,
  );

  const merged: RunSummary = mergeSummaries(httpSummary, channelSummary);
  reportSummary(merged);

  if (merged.failed > 0 || merged.errored > 0) {
    throw new CliError(
      `${merged.failed + merged.errored} scenario(s) did not pass.`,
      'TESTS_FAILED',
    );
  }
}

function mergeSummaries(a: RunSummary, b: RunSummary): RunSummary {
  const results: TestResult[] = [...a.results, ...b.results];
  return {
    total: a.total + b.total,
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    errored: a.errored + b.errored,
    skipped: a.skipped + b.skipped,
    durationMs: a.durationMs + b.durationMs,
    results,
  };
}
