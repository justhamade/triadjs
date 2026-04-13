import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, scenario, t } from '@triad/core';
import { auto } from '../../core/src/scenario-auto.js';
import { analyzeCoverage } from '../src/commands/validate-coverage.js';
import type { CoverageReport } from '../src/commands/validate-coverage.js';

// ---------------------------------------------------------------------------
// Fixture schemas
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

function makeRouter(...endpoints: ReturnType<typeof endpoint>[]) {
  const router = createRouter({ title: 'API', version: '1.0.0' });
  router.add(...endpoints);
  return router;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeCoverage', () => {
  it('endpoint with scenario.auto() reports no coverage gaps', () => {
    const ep = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'Create pet',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '00000000-0000-4000-8000-000000000000',
        ...ctx.body,
      }),
      behaviors: [...auto()],
    });
    const router = makeRouter(ep);
    const report = analyzeCoverage(router);
    const epReport = report.endpoints.find((e) => e.name === 'createPet')!;
    expect(epReport.hasAutoScenarios).toBe(true);
    expect(epReport.gaps).toHaveLength(0);
  });

  it('endpoint missing boundary coverage produces a warning', () => {
    const ep = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'Create pet',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '00000000-0000-4000-8000-000000000000',
        ...ctx.body,
      }),
      behaviors: [
        scenario('creates a pet')
          .given('valid data')
          .body({ name: 'Buddy', species: 'dog', age: 5 })
          .when('I create')
          .then('response status is 201'),
      ],
    });
    const router = makeRouter(ep);
    const report = analyzeCoverage(router);
    const epReport = report.endpoints.find((e) => e.name === 'createPet')!;
    expect(epReport.gaps.length).toBeGreaterThan(0);
  });

  it('endpoint with full manual coverage reports no gaps for covered categories', () => {
    const ep = endpoint({
      name: 'createPet',
      method: 'POST',
      path: '/pets',
      summary: 'Create pet',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '00000000-0000-4000-8000-000000000000',
        ...ctx.body,
      }),
      behaviors: [
        scenario('missing name is rejected')
          .given('missing name')
          .body({ species: 'dog', age: 5 })
          .when('I create')
          .then('response status is 400'),
        scenario('missing species is rejected')
          .given('missing species')
          .body({ name: 'Buddy', age: 5 })
          .when('I create')
          .then('response status is 400'),
        scenario('missing age is rejected')
          .given('missing age')
          .body({ name: 'Buddy', species: 'dog' })
          .when('I create')
          .then('response status is 400'),
      ],
    });
    const router = makeRouter(ep);
    const report = analyzeCoverage(router);
    const epReport = report.endpoints.find((e) => e.name === 'createPet')!;
    const missingGaps = epReport.gaps.filter((g) => g.includes('missing'));
    expect(missingGaps).toHaveLength(0);
  });

  it('--coverage summary counts fully covered endpoints', () => {
    const ep1 = endpoint({
      name: 'covered',
      method: 'POST',
      path: '/covered',
      summary: 'Covered',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '00000000-0000-4000-8000-000000000000',
        ...ctx.body,
      }),
      behaviors: [...auto()],
    });
    const ep2 = endpoint({
      name: 'uncovered',
      method: 'POST',
      path: '/uncovered',
      summary: 'Uncovered',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
        400: { schema: ApiError, description: 'Bad' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '00000000-0000-4000-8000-000000000000',
        ...ctx.body,
      }),
      behaviors: [],
    });
    const router = makeRouter(ep1, ep2);
    const report = analyzeCoverage(router);
    expect(report.fullyCovered).toBe(1);
    expect(report.totalEndpoints).toBe(2);
  });

  it('bodyless endpoint with no constraints reports no gaps', () => {
    const ep = endpoint({
      name: 'listItems',
      method: 'GET',
      path: '/items',
      summary: 'List',
      responses: {
        200: { schema: t.model('Items', { items: t.array(t.string()) }), description: 'OK' },
      },
      handler: async (ctx) => ctx.respond[200]({ items: [] }),
      behaviors: [],
    });
    const router = makeRouter(ep);
    const report = analyzeCoverage(router);
    const epReport = report.endpoints.find((e) => e.name === 'listItems')!;
    expect(epReport.gaps).toHaveLength(0);
  });
});
