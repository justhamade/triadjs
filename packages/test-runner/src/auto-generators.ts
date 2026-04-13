/**
 * Schema-derived adversarial test generators.
 *
 * Five generators produce `AutoScenario[]` from an `EndpointDescriptor`:
 *   1. Missing field — one per required field, with that field removed.
 *   2. Boundary — +-1 at each numeric min/max and string minLength/maxLength.
 *   3. Invalid enum — one per enum field with an out-of-range value.
 *   4. Type confusion — one per field with the wrong JS type.
 *   5. Random valid — N random inputs via fast-check (optional).
 */

import type { SchemaNode } from '@triad/core';
import type { EndpointDescriptor, FieldDescriptor } from './schema-reader.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AutoCategory = 'missing' | 'boundary' | 'enum' | 'type' | 'valid' | 'invalid';

export interface AutoScenario {
  name: string;
  category: AutoCategory;
  input: Record<string, unknown>;
  expectedOutcome: 'rejected' | 'accepted';
}

// ---------------------------------------------------------------------------
// Baseline builder
// ---------------------------------------------------------------------------

export function buildBaseline(fields: FieldDescriptor[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.required) continue;
    obj[field.name] = minimalValidValue(field);
  }
  return obj;
}

function minimalValidValue(field: FieldDescriptor): unknown {
  switch (field.kind) {
    case 'string': {
      if (field.constraints.format === 'uuid')
        return '00000000-0000-4000-8000-000000000000';
      if (field.constraints.format === 'email') return 'test@example.com';
      if (field.constraints.format === 'uri' || field.constraints.format === 'url')
        return 'https://example.com';
      if (field.constraints.format === 'date') return '2024-01-01';
      if (field.constraints.format === 'date-time')
        return '2024-01-01T00:00:00.000Z';
      if (field.constraints.format === 'ipv4') return '127.0.0.1';
      if (field.constraints.format === 'ipv6') return '::1';
      if (field.constraints.format === 'hostname') return 'example.com';
      if (field.constraints.minLength)
        return 'a'.repeat(field.constraints.minLength);
      return 'test';
    }
    case 'int32':
    case 'int64':
      return field.constraints.min ?? 0;
    case 'float32':
    case 'float64':
      return field.constraints.min ?? 0.0;
    case 'boolean':
      return true;
    case 'enum':
      return field.constraints.enumValues?.[0] ?? 'unknown';
    case 'datetime':
      return '2024-01-01T00:00:00.000Z';
    case 'array':
      return [];
    case 'model':
      return field.children ? buildBaseline(field.children) : {};
    case 'literal':
      return field.constraints.literalValue ?? null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 1. Missing-field generator
// ---------------------------------------------------------------------------

export function generateMissingFieldScenarios(
  descriptor: EndpointDescriptor,
): AutoScenario[] {
  const fields = descriptor.body;
  if (!fields) return [];

  const baseline = buildBaseline(fields);
  const scenarios: AutoScenario[] = [];

  for (const field of fields) {
    if (!field.required) continue;
    const input = { ...baseline };
    delete input[field.name];
    scenarios.push({
      name: `[auto:missing] rejects when '${field.name}' is missing`,
      category: 'missing',
      input,
      expectedOutcome: 'rejected',
    });
  }

  return scenarios;
}

// ---------------------------------------------------------------------------
// 2. Boundary generator
// ---------------------------------------------------------------------------

export function generateBoundaryScenarios(
  descriptor: EndpointDescriptor,
): AutoScenario[] {
  const fields = descriptor.body;
  if (!fields) return [];

  const baseline = buildBaseline(fields);
  const scenarios: AutoScenario[] = [];

  for (const field of fields) {
    if (!field.required) continue;

    // Numeric boundaries
    if (
      (field.kind === 'int32' ||
        field.kind === 'int64' ||
        field.kind === 'float32' ||
        field.kind === 'float64') &&
      (field.constraints.min !== undefined || field.constraints.max !== undefined)
    ) {
      if (field.constraints.min !== undefined) {
        const belowMin =
          field.kind === 'int32' || field.kind === 'int64'
            ? field.constraints.min - 1
            : field.constraints.min - 0.001;
        scenarios.push({
          name: `[auto:boundary] ${field.name} below min(${field.constraints.min}) at ${belowMin}`,
          category: 'boundary',
          input: { ...baseline, [field.name]: belowMin },
          expectedOutcome: 'rejected',
        });
      }
      if (field.constraints.max !== undefined) {
        const aboveMax =
          field.kind === 'int32' || field.kind === 'int64'
            ? field.constraints.max + 1
            : field.constraints.max + 0.001;
        scenarios.push({
          name: `[auto:boundary] ${field.name} above max(${field.constraints.max}) at ${aboveMax}`,
          category: 'boundary',
          input: { ...baseline, [field.name]: aboveMax },
          expectedOutcome: 'rejected',
        });
      }
    }

    // String length boundaries
    if (field.kind === 'string') {
      if (field.constraints.minLength !== undefined && field.constraints.minLength > 0) {
        const tooShort = 'a'.repeat(field.constraints.minLength - 1);
        scenarios.push({
          name: `[auto:boundary] ${field.name} below minLength(${field.constraints.minLength}) at ${field.constraints.minLength - 1}`,
          category: 'boundary',
          input: { ...baseline, [field.name]: tooShort },
          expectedOutcome: 'rejected',
        });
      }
      if (field.constraints.maxLength !== undefined) {
        const tooLong = 'a'.repeat(field.constraints.maxLength + 1);
        scenarios.push({
          name: `[auto:boundary] ${field.name} above maxLength(${field.constraints.maxLength}) at ${field.constraints.maxLength + 1}`,
          category: 'boundary',
          input: { ...baseline, [field.name]: tooLong },
          expectedOutcome: 'rejected',
        });
      }
    }

    // Array item count boundaries
    if (field.kind === 'array') {
      if (field.constraints.minItems !== undefined && field.constraints.minItems > 0) {
        scenarios.push({
          name: `[auto:boundary] ${field.name} below minItems(${field.constraints.minItems})`,
          category: 'boundary',
          input: { ...baseline, [field.name]: [] },
          expectedOutcome: 'rejected',
        });
      }
      if (field.constraints.maxItems !== undefined) {
        const tooMany = new Array(field.constraints.maxItems + 1).fill(null);
        scenarios.push({
          name: `[auto:boundary] ${field.name} above maxItems(${field.constraints.maxItems})`,
          category: 'boundary',
          input: { ...baseline, [field.name]: tooMany },
          expectedOutcome: 'rejected',
        });
      }
    }
  }

  return scenarios;
}

// ---------------------------------------------------------------------------
// 3. Invalid enum generator
// ---------------------------------------------------------------------------

export function generateInvalidEnumScenarios(
  descriptor: EndpointDescriptor,
): AutoScenario[] {
  const fields = descriptor.body;
  if (!fields) return [];

  const baseline = buildBaseline(fields);
  const scenarios: AutoScenario[] = [];

  for (const field of fields) {
    if (field.kind !== 'enum') continue;
    if (!field.constraints.enumValues) continue;

    const invalidValue = '__invalid_enum_value__';
    scenarios.push({
      name: `[auto:enum] ${field.name} rejects invalid value '${invalidValue}'`,
      category: 'enum',
      input: { ...baseline, [field.name]: invalidValue },
      expectedOutcome: 'rejected',
    });
  }

  return scenarios;
}

// ---------------------------------------------------------------------------
// 4. Type-confusion generator
// ---------------------------------------------------------------------------

export function generateTypeConfusionScenarios(
  descriptor: EndpointDescriptor,
): AutoScenario[] {
  const fields = descriptor.body;
  if (!fields) return [];

  const baseline = buildBaseline(fields);
  const scenarios: AutoScenario[] = [];

  for (const field of fields) {
    if (!field.required) continue;

    const wrongValue = wrongTypeValue(field.kind);
    if (wrongValue === undefined) continue;

    scenarios.push({
      name: `[auto:type] ${field.name} (${field.kind}) receives ${typeof wrongValue}`,
      category: 'type',
      input: { ...baseline, [field.name]: wrongValue },
      expectedOutcome: 'rejected',
    });
  }

  return scenarios;
}

function wrongTypeValue(kind: string): unknown {
  switch (kind) {
    case 'string':
    case 'enum':
    case 'datetime':
      return 12345;
    case 'int32':
    case 'int64':
    case 'float32':
    case 'float64':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return 'not-an-array';
    case 'model':
      return 'not-an-object';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// 5. Random valid generator (optional fast-check)
// ---------------------------------------------------------------------------

export function generateRandomValidScenarios(
  descriptor: EndpointDescriptor,
  bodySchema: SchemaNode,
  options: { count?: number; seed?: number } = {},
): AutoScenario[] {
  const count = options.count ?? 10;
  if (count <= 0) return [];

  const fields = descriptor.body;
  if (!fields) return [];

  let fc: typeof import('fast-check') | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fc = require('fast-check') as typeof import('fast-check');
  } catch {
    // fast-check not installed — skip random generation
    return [];
  }

  return generateWithFastCheck(fc, fields, bodySchema, count, options.seed);
}

function generateWithFastCheck(
  fc: typeof import('fast-check'),
  fields: FieldDescriptor[],
  bodySchema: SchemaNode,
  count: number,
  seed?: number,
): AutoScenario[] {
  const arb = buildArbitrary(fc, fields);
  const params: { seed?: number; numRuns: number } = { numRuns: count };
  if (seed !== undefined) params.seed = seed;

  const samples = fc.sample(arb, params);
  return samples.map((input, i) => ({
    name: `[auto:valid] random #${i + 1}`,
    category: 'valid' as const,
    input: input as Record<string, unknown>,
    expectedOutcome: 'accepted' as const,
  }));
}

function buildArbitrary(
  fc: typeof import('fast-check'),
  fields: FieldDescriptor[],
): ReturnType<typeof fc.record> {
  const shape: Record<string, ReturnType<typeof fc.string>> = {};

  for (const field of fields) {
    if (!field.required) continue;
    shape[field.name] = fieldArbitrary(fc, field);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fc.record(shape as any);
}

function fieldArbitrary(
  fc: typeof import('fast-check'),
  field: FieldDescriptor,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  switch (field.kind) {
    case 'string': {
      const min = field.constraints.minLength ?? 0;
      const max = field.constraints.maxLength ?? Math.max(min + 10, 20);
      if (field.constraints.format === 'uuid') return fc.uuid();
      if (field.constraints.format === 'email') return fc.emailAddress();
      return fc.string({ minLength: min, maxLength: max });
    }
    case 'int32': {
      const min = field.constraints.min ?? -2_147_483_648;
      const max = field.constraints.max ?? 2_147_483_647;
      return fc.integer({ min, max });
    }
    case 'int64': {
      const min = field.constraints.min ?? Number.MIN_SAFE_INTEGER;
      const max = field.constraints.max ?? Number.MAX_SAFE_INTEGER;
      return fc.integer({ min, max });
    }
    case 'float32':
    case 'float64': {
      const min = field.constraints.min ?? -1e6;
      const max = field.constraints.max ?? 1e6;
      return fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
    }
    case 'boolean':
      return fc.boolean();
    case 'enum':
      return fc.constantFrom(...(field.constraints.enumValues ?? []));
    case 'datetime':
      return fc.date().map((d: Date) => d.toISOString());
    case 'array': {
      const minItems = field.constraints.minItems ?? 0;
      const maxItems = field.constraints.maxItems ?? 5;
      if (field.children?.[0]) {
        return fc.array(fieldArbitrary(fc, field.children[0]), {
          minLength: minItems,
          maxLength: maxItems,
        });
      }
      return fc.array(fc.string(), {
        minLength: minItems,
        maxLength: maxItems,
      });
    }
    case 'model': {
      if (field.children) return buildArbitrary(fc, field.children);
      return fc.constant({});
    }
    default:
      return fc.constant(null);
  }
}
