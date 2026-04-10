/**
 * Structured test results produced by `runBehaviors()`.
 *
 * The runner is pure: it returns plain data. Reporters, CLIs, and test
 * framework adapters transform these results into whatever format they need.
 */

import type { Assertion, Endpoint, Behavior } from '@triad/core';

export type TestStatus = 'passed' | 'failed' | 'errored' | 'skipped';

export interface TestFailure {
  /** The parsed assertion that failed, if the failure was an assertion. */
  assertion?: Assertion;
  /** Human-readable failure message. */
  message: string;
  /** Actual status code returned by the handler, if known. */
  actualStatus?: number;
  /** Actual body returned by the handler, if known. */
  actualBody?: unknown;
  /** Stack trace from thrown errors (for `errored` results). */
  stack?: string;
}

export interface TestResult {
  endpointName: string;
  method: string;
  path: string;
  scenario: string;
  status: TestStatus;
  failure?: TestFailure;
  durationMs: number;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  durationMs: number;
  results: TestResult[];
}

export function summarize(results: TestResult[]): RunSummary {
  const summary: RunSummary = {
    total: results.length,
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
    durationMs: 0,
    results,
  };
  for (const r of results) {
    summary.durationMs += r.durationMs;
    summary[r.status]++;
  }
  return summary;
}

/** Thrown by assertion executors when an assertion does not hold. */
export class AssertionFailure extends Error {
  constructor(
    message: string,
    public readonly assertion?: Assertion,
  ) {
    super(message);
    this.name = 'AssertionFailure';
  }
}

/** Context bundle passed to every assertion and error constructor. */
export interface ScenarioContext {
  endpoint: Endpoint;
  behavior: Behavior;
}
