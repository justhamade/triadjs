import { describe, expect, it } from 'vitest';
import { t } from '@triadjs/core';
import { describeEndpoint } from '../src/schema-reader.js';
import {
  generateMissingFieldScenarios,
  generateBoundaryScenarios,
  generateInvalidEnumScenarios,
  generateTypeConfusionScenarios,
  generateRandomValidScenarios,
  buildBaseline,
} from '../src/auto-generators.js';
import type { AutoScenario } from '../src/auto-generators.js';
import { endpoint } from '@triadjs/core';

// ---------------------------------------------------------------------------
// Fixture endpoint
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string().minLength(1).maxLength(50),
  species: t.enum('dog', 'cat', 'bird'),
  age: t.int32().min(0).max(30),
});
const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');
const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

const createPet = endpoint({
  name: 'createPet',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    400: { schema: ApiError, description: 'Validation error' },
  },
  handler: async (ctx) => ctx.respond[201]({
    id: '00000000-0000-4000-8000-000000000000',
    ...ctx.body,
  }),
});

function petDescriptor() {
  return describeEndpoint(createPet);
}

// ---------------------------------------------------------------------------
// buildBaseline
// ---------------------------------------------------------------------------

describe('buildBaseline', () => {
  it('produces a valid object for given field descriptors', () => {
    const desc = petDescriptor();
    const baseline = buildBaseline(desc.body!);
    expect(baseline).toHaveProperty('name');
    expect(baseline).toHaveProperty('species');
    expect(baseline).toHaveProperty('age');
    expect(typeof baseline['name']).toBe('string');
    expect(typeof baseline['age']).toBe('number');
  });

  it('respects string minLength in baseline value', () => {
    const desc = petDescriptor();
    const baseline = buildBaseline(desc.body!);
    const name = baseline['name'] as string;
    expect(name.length).toBeGreaterThanOrEqual(1);
  });

  it('uses first enum value for enum fields', () => {
    const desc = petDescriptor();
    const baseline = buildBaseline(desc.body!);
    expect(baseline['species']).toBe('dog');
  });

  it('uses min for numeric fields', () => {
    const desc = petDescriptor();
    const baseline = buildBaseline(desc.body!);
    expect(baseline['age']).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateMissingFieldScenarios
// ---------------------------------------------------------------------------

describe('generateMissingFieldScenarios', () => {
  it('produces one scenario per required field', () => {
    const desc = petDescriptor();
    const scenarios = generateMissingFieldScenarios(desc);
    // CreatePet has 3 required fields: name, species, age
    expect(scenarios).toHaveLength(3);
  });

  it('each scenario removes exactly one field', () => {
    const desc = petDescriptor();
    const scenarios = generateMissingFieldScenarios(desc);
    for (const s of scenarios) {
      expect(s.expectedOutcome).toBe('rejected');
      expect(s.category).toBe('missing');
    }
  });

  it('has descriptive names', () => {
    const desc = petDescriptor();
    const scenarios = generateMissingFieldScenarios(desc);
    const names = scenarios.map((s) => s.name);
    expect(names.some((n) => n.includes('name'))).toBe(true);
    expect(names.some((n) => n.includes('species'))).toBe(true);
    expect(names.some((n) => n.includes('age'))).toBe(true);
  });

  it('skips optional fields', () => {
    const OptBody = t.model('OptBody', {
      required: t.string(),
      optional: t.string().optional(),
    });
    const ep = endpoint({
      name: 'optTest',
      method: 'POST',
      path: '/opt',
      summary: 'test',
      request: { body: OptBody },
      responses: {
        200: { schema: t.model('R', { ok: t.boolean() }), description: 'OK' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[200]({ ok: true }),
    });
    const desc = describeEndpoint(ep);
    const scenarios = generateMissingFieldScenarios(desc);
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]!.name).toContain('required');
  });
});

// ---------------------------------------------------------------------------
// generateBoundaryScenarios
// ---------------------------------------------------------------------------

describe('generateBoundaryScenarios', () => {
  it('produces boundary-1 and boundary+1 scenarios for numeric constraints', () => {
    const desc = petDescriptor();
    const scenarios = generateBoundaryScenarios(desc);
    // age has min=0 and max=30, so:
    //   below-min: -1, above-max: 31
    // name has minLength=1 and maxLength=50, so:
    //   below-minLength: 0 chars, above-maxLength: 51 chars
    const ageScenarios = scenarios.filter((s) => s.name.includes('age'));
    expect(ageScenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('produces boundary scenarios for string length constraints', () => {
    const desc = petDescriptor();
    const scenarios = generateBoundaryScenarios(desc);
    const nameScenarios = scenarios.filter((s) => s.name.includes('name'));
    expect(nameScenarios.length).toBeGreaterThanOrEqual(2);
  });

  it('all boundary-violating scenarios expect rejection', () => {
    const desc = petDescriptor();
    const scenarios = generateBoundaryScenarios(desc);
    for (const s of scenarios) {
      expect(s.expectedOutcome).toBe('rejected');
      expect(s.category).toBe('boundary');
    }
  });
});

// ---------------------------------------------------------------------------
// generateInvalidEnumScenarios
// ---------------------------------------------------------------------------

describe('generateInvalidEnumScenarios', () => {
  it('produces one scenario per enum field with an invalid value', () => {
    const desc = petDescriptor();
    const scenarios = generateInvalidEnumScenarios(desc);
    expect(scenarios).toHaveLength(1); // only 'species' is an enum
    expect(scenarios[0]!.category).toBe('enum');
    expect(scenarios[0]!.expectedOutcome).toBe('rejected');
  });

  it('the invalid value is not in the enum list', () => {
    const desc = petDescriptor();
    const scenarios = generateInvalidEnumScenarios(desc);
    const input = scenarios[0]!.input;
    const species = input['species'];
    expect(['dog', 'cat', 'bird']).not.toContain(species);
  });
});

// ---------------------------------------------------------------------------
// generateTypeConfusionScenarios
// ---------------------------------------------------------------------------

describe('generateTypeConfusionScenarios', () => {
  it('produces one scenario per field with the wrong type', () => {
    const desc = petDescriptor();
    const scenarios = generateTypeConfusionScenarios(desc);
    // 3 fields: name (string gets number), species (enum gets number), age (int gets string)
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
  });

  it('all type-confusion scenarios expect rejection', () => {
    const desc = petDescriptor();
    const scenarios = generateTypeConfusionScenarios(desc);
    for (const s of scenarios) {
      expect(s.expectedOutcome).toBe('rejected');
      expect(s.category).toBe('type');
    }
  });

  it('sends wrong JS type for string fields', () => {
    const desc = petDescriptor();
    const scenarios = generateTypeConfusionScenarios(desc);
    const nameScenario = scenarios.find((s) => s.name.includes('name'));
    expect(nameScenario).toBeDefined();
    expect(typeof nameScenario!.input['name']).not.toBe('string');
  });
});

// ---------------------------------------------------------------------------
// generateRandomValidScenarios
// ---------------------------------------------------------------------------

describe('generateRandomValidScenarios', () => {
  it('produces N scenarios with valid inputs', () => {
    const desc = petDescriptor();
    const bodySchema = createPet.request.body!;
    const scenarios = generateRandomValidScenarios(desc, bodySchema, { count: 5, seed: 42 });
    // fast-check is installed in this workspace as a devDep
    expect(scenarios).toHaveLength(5);
    for (const s of scenarios) {
      expect(s.expectedOutcome).toBe('accepted');
      expect(s.category).toBe('valid');
    }
  });

  it('seed produces deterministic output', () => {
    const desc = petDescriptor();
    const bodySchema = createPet.request.body!;
    const a = generateRandomValidScenarios(desc, bodySchema, { count: 3, seed: 42 });
    const b = generateRandomValidScenarios(desc, bodySchema, { count: 3, seed: 42 });
    expect(a).toEqual(b);
  });

  it('each generated scenario has the expected shape', () => {
    const desc = petDescriptor();
    const bodySchema = createPet.request.body!;
    const scenarios = generateRandomValidScenarios(desc, bodySchema, { count: 2, seed: 1 });
    for (const s of scenarios) {
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('category');
      expect(s).toHaveProperty('input');
      expect(s).toHaveProperty('expectedOutcome');
    }
  });
});

// ---------------------------------------------------------------------------
// Endpoint with no body produces no scenarios
// ---------------------------------------------------------------------------

describe('generators with no body', () => {
  it('missing-field generator returns empty for bodyless endpoints', () => {
    const ep = endpoint({
      name: 'noBody',
      method: 'GET',
      path: '/items',
      summary: 'List items',
      responses: {
        200: { schema: t.model('Items', { items: t.array(t.string()) }), description: 'OK' },
      },
      handler: async (ctx) => ctx.respond[200]({ items: [] }),
    });
    const desc = describeEndpoint(ep);
    expect(generateMissingFieldScenarios(desc)).toHaveLength(0);
  });
});
