/**
 * Coverage analysis for `triad validate --coverage`.
 *
 * For each endpoint, reads the schema descriptor and checks which categories
 * of auto-scenarios are already covered by hand-written behaviors. Reports
 * uncovered categories as warnings.
 */

import type { Router, Endpoint, Behavior } from '@triadjs/core';
import {
  describeEndpoint,
  type EndpointDescriptor,
} from '../../../test-runner/src/schema-reader.js';
import {
  generateMissingFieldScenarios,
  generateBoundaryScenarios,
  generateInvalidEnumScenarios,
  type AutoScenario,
} from '../../../test-runner/src/auto-generators.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EndpointCoverageReport {
  name: string;
  method: string;
  path: string;
  hasAutoScenarios: boolean;
  gaps: string[];
}

export interface CoverageReport {
  totalEndpoints: number;
  fullyCovered: number;
  endpoints: EndpointCoverageReport[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeCoverage(router: Router): CoverageReport {
  const reports: EndpointCoverageReport[] = [];

  for (const ep of router.allEndpoints()) {
    reports.push(analyzeEndpoint(ep));
  }

  const fullyCovered = reports.filter((r) => r.gaps.length === 0).length;

  return {
    totalEndpoints: reports.length,
    fullyCovered,
    endpoints: reports,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function analyzeEndpoint(ep: Endpoint): EndpointCoverageReport {
  const hasAuto = ep.behaviors.some(
    (b) => '__auto' in b && (b as Record<string, unknown>)['__auto'] === true,
  );

  if (hasAuto) {
    return {
      name: ep.name,
      method: ep.method,
      path: ep.path,
      hasAutoScenarios: true,
      gaps: [],
    };
  }

  const descriptor = describeEndpoint(ep);
  const gaps: string[] = [];

  // Check missing-field coverage
  const missingScenarios = generateMissingFieldScenarios(descriptor);
  for (const ms of missingScenarios) {
    const fieldName = extractFieldName(ms);
    if (fieldName && !handWrittenCoversMissingField(ep.behaviors, fieldName)) {
      gaps.push(`No scenario tests missing '${fieldName}' field`);
    }
  }

  // Check boundary coverage
  const boundaryScenarios = generateBoundaryScenarios(descriptor);
  if (boundaryScenarios.length > 0) {
    const hasBoundaryTests = ep.behaviors.some(
      (b) =>
        b.scenario.toLowerCase().includes('boundary') ||
        b.scenario.toLowerCase().includes('min') ||
        b.scenario.toLowerCase().includes('max'),
    );
    if (!hasBoundaryTests) {
      for (const bs of boundaryScenarios) {
        gaps.push(bs.name.replace('[auto:boundary] ', 'No scenario tests '));
      }
    }
  }

  // Check enum coverage
  const enumScenarios = generateInvalidEnumScenarios(descriptor);
  for (const es of enumScenarios) {
    const fieldName = extractEnumFieldName(es);
    if (fieldName) {
      const hasEnumTest = ep.behaviors.some(
        (b) =>
          b.scenario.toLowerCase().includes('enum') ||
          b.scenario.toLowerCase().includes(fieldName),
      );
      if (!hasEnumTest) {
        gaps.push(`No scenario tests invalid enum for '${fieldName}'`);
      }
    }
  }

  return {
    name: ep.name,
    method: ep.method,
    path: ep.path,
    hasAutoScenarios: false,
    gaps,
  };
}

function extractFieldName(scenario: AutoScenario): string | undefined {
  const match = scenario.name.match(/when '(\w+)' is missing/);
  return match?.[1];
}

function extractEnumFieldName(scenario: AutoScenario): string | undefined {
  const match = scenario.name.match(/(\w+) rejects invalid/);
  return match?.[1];
}

function handWrittenCoversMissingField(
  behaviors: readonly Behavior[],
  fieldName: string,
): boolean {
  for (const b of behaviors) {
    if ('__auto' in b && (b as Record<string, unknown>)['__auto'] === true) continue;

    const body = b.given.body;
    if (body !== undefined && typeof body === 'object' && body !== null) {
      if (!Object.hasOwn(body as Record<string, unknown>, fieldName)) {
        return true;
      }
    }
  }
  return false;
}
