/**
 * `triad fuzz` — schema-derived adversarial fuzzing against the full router.
 *
 * Generates auto scenarios for EVERY endpoint (regardless of whether they
 * have `scenario.auto()` in their behaviors), runs them, and reports results.
 */

import type { Router, Behavior } from '@triad/core';
import { runOneBehavior, collectModels } from '@triad/test-runner';
import type { TestResult } from '@triad/test-runner';
import { expandAutoMarker } from '../../../test-runner/src/auto-expand.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzOptions {
  config?: string;
  router?: string | Router;
  filter?: string;
  runs?: number;
  seed?: number;
  failFast?: boolean;
  categories?: string;
}

export interface FuzzSummary {
  total: number;
  passed: number;
  failed: number;
  results: FuzzResult[];
}

export interface FuzzResult {
  endpointName: string;
  method: string;
  path: string;
  scenario: string;
  status: 'passed' | 'failed' | 'errored';
}

type CategoryName = 'missing' | 'boundary' | 'enum' | 'type' | 'valid';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runFuzz(opts: FuzzOptions): Promise<FuzzSummary> {
  const router = opts.router as Router;
  if (!router) {
    return { total: 0, passed: 0, failed: 0, results: [] };
  }

  const activeCategories = parseCategories(opts.categories);
  const runs = opts.runs ?? 10;
  const seed = opts.seed;
  const filter = opts.filter;

  const models = collectModels(router);
  const results: FuzzResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const ep of router.allEndpoints()) {
    if (filter && !ep.name.includes(filter)) continue;

    const marker = {
      __auto: true as const,
      options: {
        missingFields: activeCategories.has('missing'),
        boundaries: activeCategories.has('boundary'),
        invalidEnums: activeCategories.has('enum'),
        typeConfusion: activeCategories.has('type'),
        randomValid: activeCategories.has('valid') ? runs : 0,
        ...(seed !== undefined ? { seed } : {}),
      },
    };
    const behaviors: Behavior[] = expandAutoMarker(ep, marker);

    for (const behavior of behaviors) {
      const testResult: TestResult = await runOneBehavior(ep, behavior, models);
      const fuzzResult: FuzzResult = {
        endpointName: ep.name,
        method: ep.method,
        path: ep.path,
        scenario: behavior.scenario,
        status: testResult.status === 'passed' ? 'passed' : 'failed',
      };
      results.push(fuzzResult);
      if (testResult.status === 'passed') {
        passed++;
      } else {
        failed++;
      }

      if (opts.failFast && testResult.status !== 'passed') {
        return { total: results.length, passed, failed, results };
      }
    }
  }

  return { total: results.length, passed, failed, results };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_CATEGORIES: CategoryName[] = [
  'missing',
  'boundary',
  'enum',
  'type',
  'valid',
];

function parseCategories(input?: string): Set<CategoryName> {
  if (!input) return new Set(ALL_CATEGORIES);
  const parts = input.split(',').map((s) => s.trim()) as CategoryName[];
  return new Set(parts.filter((c) => ALL_CATEGORIES.includes(c)));
}
