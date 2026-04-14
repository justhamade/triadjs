import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import { runFuzz } from '../src/commands/fuzz.js';
import type { FuzzSummary } from '../src/commands/fuzz.js';

// ---------------------------------------------------------------------------
// Fixture router
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

let petIdCounter = 0;

function makeRouter() {
  petIdCounter = 0;
  const createPet = endpoint({
    name: 'createPet',
    method: 'POST',
    path: '/pets',
    summary: 'Create a pet',
    request: { body: CreatePet },
    responses: {
      201: { schema: Pet, description: 'Created' },
      400: { schema: ApiError, description: 'Bad' },
    },
    handler: async (ctx) =>
      ctx.respond[201]({
        id: `00000000-0000-4000-8000-00000000000${++petIdCounter}`,
        ...ctx.body,
      }),
  });

  const listPets = endpoint({
    name: 'listPets',
    method: 'GET',
    path: '/pets',
    summary: 'List',
    responses: {
      200: {
        schema: t.model('PetList', { items: t.array(Pet) }),
        description: 'OK',
      },
    },
    handler: async (ctx) => ctx.respond[200]({ items: [] }),
  });

  const router = createRouter({ title: 'PetAPI', version: '1.0.0' });
  router.add(createPet, listPets);
  return router;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runFuzz', () => {
  it('fuzzes all endpoints and returns a summary', async () => {
    const router = makeRouter();
    const summary = await runFuzz({ router });
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.passed + summary.failed).toBe(summary.total);
  });

  it('filters by endpoint name', async () => {
    const router = makeRouter();
    const summary = await runFuzz({ router, filter: 'createPet' });
    for (const r of summary.results) {
      expect(r.endpointName).toBe('createPet');
    }
  });

  it('failFast stops on first failure', async () => {
    // This test verifies failFast doesn't crash — in a passing router
    // all scenarios pass, so failFast has no effect, but the option is accepted.
    const router = makeRouter();
    const summary = await runFuzz({ router, failFast: true });
    expect(summary.total).toBeGreaterThan(0);
  });

  it('seed produces deterministic output', async () => {
    const router = makeRouter();
    const a = await runFuzz({ router, seed: 42, runs: 3 });
    petIdCounter = 0;
    const router2 = makeRouter();
    const b = await runFuzz({ router: router2, seed: 42, runs: 3 });
    expect(a.results.map((r) => r.scenario)).toEqual(
      b.results.map((r) => r.scenario),
    );
  });

  it('empty router produces zero scenarios', async () => {
    const router = createRouter({ title: 'EmptyAPI', version: '1.0.0' });
    const summary = await runFuzz({ router });
    expect(summary.total).toBe(0);
  });

  it('limits random runs via runs option', async () => {
    const router = makeRouter();
    const few = await runFuzz({ router, runs: 2, seed: 1 });
    const many = await runFuzz({ router: makeRouter(), runs: 5, seed: 1 });
    // 'many' should have more valid-category scenarios than 'few'
    const fewValid = few.results.filter((r) => r.scenario.includes('[auto:valid]'));
    const manyValid = many.results.filter((r) => r.scenario.includes('[auto:valid]'));
    expect(manyValid.length).toBeGreaterThan(fewValid.length);
  });

  it('categories option filters scenario types', async () => {
    const router = makeRouter();
    const summary = await runFuzz({ router, categories: 'missing' });
    for (const r of summary.results) {
      expect(r.scenario).toContain('[auto:missing]');
    }
  });

  it('fuzz results include endpoint name and path', async () => {
    const router = makeRouter();
    const summary = await runFuzz({ router });
    for (const r of summary.results) {
      expect(r.endpointName).toBeDefined();
      expect(r.path).toBeDefined();
    }
  });
});
