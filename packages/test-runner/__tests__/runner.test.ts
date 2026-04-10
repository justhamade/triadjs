import { describe, expect, it, vi } from 'vitest';
import { createRouter, endpoint, scenario, t } from '@triad/core';
import type { ServiceContainer } from '@triad/core';
import { runBehaviors } from '../src/runner.js';

// ---------------------------------------------------------------------------
// In-memory petstore for integration testing the runner
// ---------------------------------------------------------------------------

interface PetRecord {
  id: string;
  name: string;
  species: 'dog' | 'cat' | 'bird' | 'fish';
  age: number;
}

class InMemoryPetRepo {
  private readonly pets = new Map<string, PetRecord>();

  async create(data: Omit<PetRecord, 'id'>): Promise<PetRecord> {
    const id = `pet-${this.pets.size + 1}`;
    const pet: PetRecord = { id, ...data };
    this.pets.set(id, pet);
    return pet;
  }

  async findById(id: string): Promise<PetRecord | null> {
    return this.pets.get(id) ?? null;
  }

  async findByName(name: string): Promise<PetRecord | null> {
    for (const pet of this.pets.values()) {
      if (pet.name === name) return pet;
    }
    return null;
  }

  async list(): Promise<PetRecord[]> {
    return [...this.pets.values()];
  }
}

declare module '@triad/core' {
  interface ServiceContainer {
    petRepo?: InMemoryPetRepo;
  }
}

// ---------------------------------------------------------------------------
// Schemas & endpoints
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string(),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
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
  summary: 'Create',
  tags: ['Pets'],
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    409: { schema: ApiError, description: 'Duplicate' },
  },
  handler: async (ctx) => {
    const existing = await ctx.services.petRepo!.findByName(ctx.body.name);
    if (existing) {
      return ctx.respond[409]({
        code: 'DUPLICATE',
        message: `Pet "${ctx.body.name}" already exists`,
      });
    }
    const pet = await ctx.services.petRepo!.create(ctx.body);
    return ctx.respond[201](pet);
  },
  behaviors: [
    scenario('Pets can be created with valid data')
      .given('a valid pet payload')
      .body({ name: 'Buddy', species: 'dog', age: 3 })
      .when('I create a pet')
      .then('response status is 201')
      .and('response body matches Pet')
      .and('response body has name "Buddy"'),

    scenario('Duplicate pet names are rejected')
      .given('a pet named "Buddy" already exists')
      .setup(async (services) => {
        await services.petRepo!.create({ name: 'Buddy', species: 'dog', age: 3 });
      })
      .body({ name: 'Buddy', species: 'dog', age: 5 })
      .when('I create a pet')
      .then('response status is 409')
      .and('response body has code "DUPLICATE"'),
  ],
});

const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get',
  tags: ['Pets'],
  request: { params: { id: t.string() } },
  responses: {
    200: { schema: Pet, description: 'Found' },
    404: { schema: ApiError, description: 'Not found' },
  },
  handler: async (ctx) => {
    const pet = await ctx.services.petRepo!.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });
    }
    return ctx.respond[200](pet);
  },
  behaviors: [
    scenario('Existing pets can be retrieved by ID')
      .given('a pet exists with id {petId}')
      .setup(async (services) => {
        const pet = await services.petRepo!.create({
          name: 'Rex',
          species: 'dog',
          age: 5,
        });
        return { petId: pet.id };
      })
      .params({ id: '{petId}' })
      .when('I GET /pets/{petId}')
      .then('response status is 200')
      .and('response body has name "Rex"')
      .and('response body has id "{petId}"'),

    scenario('Unknown IDs return 404')
      .given('no pet exists with id {petId}')
      .fixtures({ petId: 'nonexistent' })
      .params({ id: '{petId}' })
      .when('I GET /pets/{petId}')
      .then('response status is 404')
      .and('response body has code "NOT_FOUND"'),
  ],
});

const listPets = endpoint({
  name: 'listPets',
  method: 'GET',
  path: '/pets',
  summary: 'List',
  tags: ['Pets'],
  responses: { 200: { schema: t.array(Pet), description: 'List' } },
  handler: async (ctx) => ctx.respond[200](await ctx.services.petRepo!.list()),
  behaviors: [
    scenario('Lists all pets in the store')
      .given('two pets exist')
      .setup(async (services) => {
        await services.petRepo!.create({ name: 'Rex', species: 'dog', age: 5 });
        await services.petRepo!.create({ name: 'Whiskers', species: 'cat', age: 3 });
      })
      .when('I list all pets')
      .then('response status is 200')
      .and('response body is an array')
      .and('response body has length 2'),
  ],
});

function buildRouter() {
  const router = createRouter({ title: 'Petstore', version: '1' });
  router.add(createPet, getPet, listPets);
  return router;
}

function servicesFactory(): ServiceContainer {
  return { petRepo: new InMemoryPetRepo() };
}

// ---------------------------------------------------------------------------
// Integration tests — all scenarios should pass
// ---------------------------------------------------------------------------

describe('runBehaviors — happy path', () => {
  it('runs all scenarios and reports all passed', async () => {
    const summary = await runBehaviors(buildRouter(), { servicesFactory });
    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(0);
  });

  it('result entries carry endpoint, scenario, and status info', async () => {
    const summary = await runBehaviors(buildRouter(), { servicesFactory });
    const first = summary.results[0]!;
    expect(first.endpointName).toBe('createPet');
    expect(first.method).toBe('POST');
    expect(first.path).toBe('/pets');
    expect(first.status).toBe('passed');
    expect(first.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('isolates scenarios via servicesFactory (fresh store each time)', async () => {
    // If services weren't isolated, the duplicate-name scenario would fail
    // because previous scenarios already created a Buddy.
    const summary = await runBehaviors(buildRouter(), { servicesFactory });
    expect(summary.failed).toBe(0);
  });
});

describe('runBehaviors — failure reporting', () => {
  it('reports an assertion failure without crashing', async () => {
    const broken = endpoint({
      name: 'broken',
      method: 'GET',
      path: '/broken',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('hello'),
      behaviors: [
        scenario('Expects the wrong status')
          .given('nothing')
          .when('I GET /broken')
          .then('response status is 404'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(broken);
    const summary = await runBehaviors(router);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain(
      'Expected response status 404, got 200',
    );
  });

  it('reports handler exceptions as errored', async () => {
    const broken = endpoint({
      name: 'crashy',
      method: 'GET',
      path: '/crashy',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async () => {
        throw new Error('boom');
      },
      behaviors: [
        scenario('Handler crashes')
          .given('nothing')
          .when('I GET /crashy')
          .then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(broken);
    const summary = await runBehaviors(router);
    expect(summary.errored).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain('boom');
  });

  it('fails on custom assertions by default', async () => {
    const ep = endpoint({
      name: 'customy',
      method: 'GET',
      path: '/c',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
      behaviors: [
        scenario('Uses unparseable assertion')
          .given('x')
          .when('y')
          .then('response does a backflip'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const summary = await runBehaviors(router);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain('Unrecognized assertion');
  });

  it('bail: true stops at the first failure', async () => {
    const good = endpoint({
      name: 'good',
      method: 'GET',
      path: '/good',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
      behaviors: [
        scenario('Passes')
          .given('x')
          .when('y')
          .then('response status is 200'),
      ],
    });
    const bad = endpoint({
      name: 'bad',
      method: 'GET',
      path: '/bad',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
      behaviors: [
        scenario('Fails')
          .given('x')
          .when('y')
          .then('response status is 500'),
        scenario('Never runs')
          .given('x')
          .when('y')
          .then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(good, bad);
    const summary = await runBehaviors(router, { bail: true });
    // good.Passes (1) + bad.Fails (1) then bail
    expect(summary.results).toHaveLength(2);
    expect(summary.results[0]?.status).toBe('passed');
    expect(summary.results[1]?.status).toBe('failed');
  });
});

describe('runBehaviors — teardown', () => {
  it('calls teardown for every scenario even on failure', async () => {
    const teardown = vi.fn();
    const ep = endpoint({
      name: 'tearTest',
      method: 'GET',
      path: '/t',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200]('ok'),
      behaviors: [
        scenario('First').given('x').when('y').then('response status is 200'),
        scenario('Second fails').given('x').when('y').then('response status is 500'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    await runBehaviors(router, { servicesFactory, teardown });
    expect(teardown).toHaveBeenCalledTimes(2);
  });
});

describe('runBehaviors — filter', () => {
  it('filter skips endpoints that do not match', async () => {
    const router = buildRouter();
    const summary = await runBehaviors(router, {
      servicesFactory,
      filter: (ep) => ep.name === 'createPet',
    });
    // createPet has 2 scenarios
    expect(summary.total).toBe(2);
  });
});

describe('runBehaviors — response schema safety net', () => {
  it('fails when handler returns an undeclared status', async () => {
    const ep = endpoint({
      name: 'weird',
      method: 'GET',
      path: '/w',
      summary: 'x',
      responses: { 200: { schema: t.string(), description: 'ok' } },
      handler: async () => ({ status: 418, body: "I'm a teapot" }),
      behaviors: [
        scenario('Undeclared status').given('x').when('y').then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const summary = await runBehaviors(router);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain('not declared');
  });

  it('fails when handler sidesteps ctx.respond and returns invalid body', async () => {
    const ep = endpoint({
      name: 'cheater',
      method: 'GET',
      path: '/c',
      summary: 'x',
      responses: {
        200: { schema: t.int32().min(0), description: 'ok' },
      },
      // handler returns a number that doesn't meet min(0)
      handler: async () => ({ status: 200, body: -5 }),
      behaviors: [
        scenario('Bad payload').given('x').when('y').then('response status is 200'),
      ],
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const summary = await runBehaviors(router);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.failure?.message).toContain('does not match declared schema');
  });
});
