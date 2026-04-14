/**
 * Execute parsed `Assertion` objects against a handler response.
 *
 * Unrecognized (`custom`) assertions **fail** — this is Triad's stance:
 * if an assertion can't be parsed into a structured check, it provides
 * no machine-verifiable value, which defeats the single-source-of-truth
 * promise. Users who need custom logic should either (a) rewrite the
 * assertion into a supported pattern, or (b) register a matcher on the
 * runner. Silent skipping was rejected because it would let stale or
 * aspirational behaviors drift into the test suite undetected.
 */

import type { Assertion, HandlerResponse } from '@triadjs/core';
import { AssertionFailure } from './results.js';
import type { ModelRegistry } from './models.js';
import { substitute, type Fixtures } from './substitute.js';

/** A user-provided matcher for `{ type: 'custom' }` assertions. */
export type CustomMatcher = (
  response: HandlerResponse,
  assertion: Extract<Assertion, { type: 'custom' }>,
) => void | Promise<void>;

export interface AssertionRunOptions {
  models: ModelRegistry;
  fixtures: Fixtures;
  /** Optional matchers keyed by a substring of the raw assertion text. */
  customMatchers?: Record<string, CustomMatcher>;
}

/**
 * Run every assertion in `behavior.then[]` against the handler response.
 * Throws `AssertionFailure` on the first failure. The runner catches and
 * records the failure per-scenario.
 */
export async function runAssertions(
  response: HandlerResponse,
  assertions: readonly Assertion[],
  options: AssertionRunOptions,
): Promise<void> {
  for (const assertion of assertions) {
    await runSingleAssertion(response, assertion, options);
  }
}

export async function runSingleAssertion(
  response: HandlerResponse,
  assertion: Assertion,
  options: AssertionRunOptions,
): Promise<void> {
  const { models, fixtures, customMatchers } = options;

  switch (assertion.type) {
    case 'status': {
      if (response.status !== assertion.expected) {
        throw new AssertionFailure(
          `Expected response status ${assertion.expected}, got ${response.status}`,
          assertion,
        );
      }
      return;
    }

    case 'body_matches': {
      const model = models.get(assertion.model);
      if (!model) {
        throw new AssertionFailure(
          `Unknown model "${assertion.model}" in assertion "${assertion.raw}". ` +
            `No ModelSchema with that name was found in the router. ` +
            `Register the model by using it in an endpoint's request or response schema.`,
          assertion,
        );
      }
      const result = model.validate(response.body);
      if (!result.success) {
        const first = result.errors[0];
        throw new AssertionFailure(
          `Response body does not match model "${assertion.model}": ${first?.path || '<root>'}: ${first?.message}`,
          assertion,
        );
      }
      return;
    }

    case 'body_has': {
      const expected = substitute(assertion.value, fixtures);
      const actual = getByPath(response.body, assertion.path);
      if (!deepEqual(actual, expected)) {
        throw new AssertionFailure(
          `Expected response body.${assertion.path} to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          assertion,
        );
      }
      return;
    }

    case 'body_has_code': {
      const expected = substituteIfString(assertion.code, fixtures);
      const actual = getByPath(response.body, 'code');
      if (actual !== expected) {
        throw new AssertionFailure(
          `Expected response body.code to equal ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
          assertion,
        );
      }
      return;
    }

    case 'body_is_array': {
      if (!Array.isArray(response.body)) {
        throw new AssertionFailure(
          `Expected response body to be an array, got ${typeOfValue(response.body)}`,
          assertion,
        );
      }
      return;
    }

    case 'body_is_empty': {
      const body = response.body;
      const isEmpty =
        body === undefined ||
        body === null ||
        (typeof body === 'string' && body.length === 0);
      if (!isEmpty) {
        throw new AssertionFailure(
          `Expected response body to be empty (undefined, null, or ""), got ${typeOfValue(body)}`,
          assertion,
        );
      }
      return;
    }

    case 'body_length': {
      if (!Array.isArray(response.body)) {
        throw new AssertionFailure(
          `Expected response body to be an array for length check, got ${typeOfValue(response.body)}`,
          assertion,
        );
      }
      if (response.body.length !== assertion.expected) {
        throw new AssertionFailure(
          `Expected response body to have length ${assertion.expected}, got ${response.body.length}`,
          assertion,
        );
      }
      return;
    }

    case 'custom': {
      // Look for a registered matcher whose key appears in the raw text.
      if (customMatchers) {
        for (const [key, matcher] of Object.entries(customMatchers)) {
          if (assertion.raw.includes(key)) {
            await matcher(response, assertion);
            return;
          }
        }
      }
      throw new AssertionFailure(
        `Unrecognized assertion: "${assertion.raw}". ` +
          `Triad could not parse this into a structured assertion and no custom matcher ` +
          `was registered for it. Either rewrite it using a supported pattern ` +
          `(e.g. "response status is 200", "response body matches Pet", ` +
          `"response body has name \\"Buddy\\"") or register a matcher via ` +
          `runBehaviors(router, { customMatchers: { ... } }).`,
        assertion,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a dotted path like `owner.name` or a single key from a value. */
export function getByPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  const segments = path.split('.');
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function substituteIfString(value: unknown, fixtures: Fixtures): unknown {
  if (typeof value === 'string') return substitute(value, fixtures);
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    ),
  );
}

function typeOfValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
