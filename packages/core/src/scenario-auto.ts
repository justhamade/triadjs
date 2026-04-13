/**
 * Auto-generated scenario markers.
 *
 * `auto()` returns an array of marker objects that the test runner expands
 * at execution time into concrete scenarios derived from the endpoint's
 * schema constraints. The markers are `Behavior`-shaped so they can be
 * spread directly into an endpoint's `behaviors` array.
 */

import type { Behavior, GivenData, WhenData, Assertion } from './behavior.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ScenarioAutoOptions {
  /** Generate missing-field scenarios. Default true. */
  missingFields?: boolean;
  /** Generate boundary-value scenarios. Default true. */
  boundaries?: boolean;
  /** Generate invalid-enum scenarios. Default true. */
  invalidEnums?: boolean;
  /** Generate type-confusion scenarios. Default true. */
  typeConfusion?: boolean;
  /** Generate random valid inputs. Default 10. Set 0 to skip. */
  randomValid?: number;
  /** Seed for random generation. Default: no seed (non-deterministic). */
  seed?: number;
}

// ---------------------------------------------------------------------------
// Marker type
// ---------------------------------------------------------------------------

export interface AutoScenarioMarker extends Behavior {
  __auto: true;
  options: Required<Omit<ScenarioAutoOptions, 'seed'>> & { seed?: number };
}

function isAutoScenarioMarker(b: Behavior): b is AutoScenarioMarker {
  return '__auto' in b && (b as AutoScenarioMarker).__auto === true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns an array containing a single auto-scenario marker. Spread it
 * into an endpoint's `behaviors` array:
 *
 * ```ts
 * behaviors: [
 *   scenario('creates a pet').given(...).when(...).then(...),
 *   ...auto(),
 * ]
 * ```
 *
 * The marker carries options but no test logic — the test runner resolves
 * it at execution time by reading the endpoint's schema and calling the
 * appropriate generators.
 */
export function auto(options: ScenarioAutoOptions = {}): Behavior[] {
  const resolved: AutoScenarioMarker['options'] = {
    missingFields: options.missingFields ?? true,
    boundaries: options.boundaries ?? true,
    invalidEnums: options.invalidEnums ?? true,
    typeConfusion: options.typeConfusion ?? true,
    randomValid: options.randomValid ?? 10,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  };

  const marker: AutoScenarioMarker = {
    __auto: true,
    options: resolved,
    scenario: '__auto_marker__',
    given: { description: '__auto__' } satisfies GivenData,
    when: { description: '__auto__' } satisfies WhenData,
    then: [{ type: 'custom', raw: '__auto__' }] satisfies Assertion[],
  };

  return [marker as Behavior];
}

export { isAutoScenarioMarker };
