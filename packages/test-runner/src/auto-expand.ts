/**
 * Expand an `AutoScenarioMarker` into concrete `Behavior` objects.
 *
 * Called by the runner at execution time. The marker carries the user's
 * generator options; this module reads the endpoint's schema, calls the
 * generators, and wraps each `AutoScenario` in a `Behavior` that the
 * runner can execute through its normal pipeline.
 */

import type { Endpoint, Behavior, Assertion } from '@triad/core';
import { describeEndpoint } from './schema-reader.js';

/** Matches the shape of AutoScenarioMarker from @triad/core/scenario-auto. */
interface AutoMarkerLike {
  __auto: true;
  options: {
    missingFields: boolean;
    boundaries: boolean;
    invalidEnums: boolean;
    typeConfusion: boolean;
    randomValid: number;
    seed?: number;
  };
}
import {
  generateMissingFieldScenarios,
  generateBoundaryScenarios,
  generateInvalidEnumScenarios,
  generateTypeConfusionScenarios,
  generateRandomValidScenarios,
  type AutoScenario,
} from './auto-generators.js';

export function expandAutoMarker(
  endpoint: Endpoint,
  marker: AutoMarkerLike,
): Behavior[] {
  const descriptor = describeEndpoint(endpoint);
  const opts = marker.options;
  const scenarios: AutoScenario[] = [];

  if (opts.missingFields) {
    scenarios.push(...generateMissingFieldScenarios(descriptor));
  }
  if (opts.boundaries) {
    scenarios.push(...generateBoundaryScenarios(descriptor));
  }
  if (opts.invalidEnums) {
    scenarios.push(...generateInvalidEnumScenarios(descriptor));
  }
  if (opts.typeConfusion) {
    scenarios.push(...generateTypeConfusionScenarios(descriptor));
  }
  if (opts.randomValid > 0 && endpoint.request.body) {
    scenarios.push(
      ...generateRandomValidScenarios(descriptor, endpoint.request.body, {
        count: opts.randomValid,
        seed: opts.seed,
      }),
    );
  }

  return scenarios.map((s) => autoScenarioToBehavior(s, endpoint));
}

/**
 * An `AutoBehavior` is a `Behavior` with an extra `__autoOutcome` field
 * that tells the runner how to evaluate the result.
 */
export interface AutoBehavior extends Behavior {
  __autoOutcome: 'rejected' | 'accepted';
}

export function isAutoBehavior(b: Behavior): b is AutoBehavior {
  return '__autoOutcome' in b;
}

function autoScenarioToBehavior(
  scenario: AutoScenario,
  _endpoint: Endpoint,
): AutoBehavior {
  return {
    __autoOutcome: scenario.expectedOutcome,
    scenario: scenario.name,
    given: {
      description: `auto-generated ${scenario.category} scenario`,
      body: scenario.input,
    },
    when: { description: 'I send the request' },
    then: [],
  };
}
