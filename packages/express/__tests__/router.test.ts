/**
 * End-to-end Express integration tests using supertest.
 *
 * Each test mounts a fresh express app with the Triad router middleware
 * and issues a real HTTP request through supertest. This exercises the
 * full pipeline: express.json() body parsing, the Triad middleware
 * chain, coercion, validation, handler dispatch, and error formatting.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createRouter, endpoint, t } from '@triad/core';
import { createTriadRouter, triadErrorHandler } from '../src/index.js';

// ---------------------------------------------------------------------------
// In-memory petstore
// ---------------------------------------------------------------------------

interface PetRow {
  id: string;
  name: string;
  species: 'dog' | 'cat' | 'bird' | 'fish';
  age: number;
}

class InMemoryPetRepo {
  private readonly pets = new Map<string, PetRow>();
  private nextId = 1;

  create(data: Omit<PetRow, 'id'>): PetRow {
    const id = `00000000-0000-0000-0000-${String(this.nextId++).padStart(12, '0')}`;
    const pet = { id, ...data };
    this.pets.set(id, pet);
    return pet;
  }

  findById(id: string): PetRow | undefined {
    return this.pets.get(id);
  }

  findByName(name: string): PetRow | undefined {
    for (const pet of this.pets.values()) if (pet.name === name) return pet;
    return undefined;
  }

  list(filter: {
    species?: 'dog' | 'cat' | 'bird' | 'fish';
    limit: number;
  }): PetRow[] {
    let result = [...this.pets.values()];
    if (filter.species) result = result.filter((p) => p.species === filter.species);
    return result.slice(0, filter.limit);
  }
}

declare module '@triad/core' {
  interface ServiceContainer {
    petRepo?: InMemoryPetRepo;
    tenantId?: string;
  }
}

// ---------------------------------------------------------------------------
// Schemas and endpoints
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
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
  summary: 'Create a pet',
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
    409: { schema: ApiError, description: 'Duplicate' },
  },
  handler: async (ctx) => {
    const existing = ctx.services.petRepo!.findByName(ctx.body.name);
    if (existing) {
      return ctx.respond[409]({
        code: 'DUPLICATE',
        message: `Pet "${ctx.body.name}" already exists`,
      });
    }
    const pet = ctx.services.petRepo!.create(ctx.body);
    return ctx.respond[201](pet);
  },
});

const getPet = endpoint({
  name: 'getPet',
  method: 'GET',
  path: '/pets/:id',
  summary: 'Get a pet by ID',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    200: { schema: Pet, description: 'Found' },
    404: { schema: ApiError, description: 'Not found' },
  },
  handler: async (ctx) => {
    const pet = ctx.services.petRepo!.findById(ctx.params.id);
    if (!pet) {
      return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });
    }
    return ctx.respond[200](pet);
  },
});

const listPets = endpoint({
  name: 'listPets',
  method: 'GET',
  path: '/pets',
  summary: 'List pets',
  request: {
    query: {
      species: t.enum('dog', 'cat', 'bird', 'fish').optional(),
      limit: t.int32().min(1).max(100).default(20),
    },
  },
  responses: {
    200: { schema: t.array(Pet), description: 'List of pets' },
  },
  handler: async (ctx) => {
    const pets = ctx.services.petRepo!.list({
      limit: ctx.query.limit,
      ...(ctx.query.species !== undefined && { species: ctx.query.species }),
    });
    return ctx.respond[200](pets);
  },
});

const echoHeader = endpoint({
  name: 'echoHeader',
  method: 'GET',
  path: '/echo',
  summary: 'Echo an incoming header via response body',
  request: {
    headers: { 'x-trace-id': t.string() },
  },
  responses: {
    200: {
      schema: t.model('EchoResponse', { traceId: t.string() }),
      description: 'Echo',
    },
  },
  handler: async (ctx) =>
    ctx.respond[200]({ traceId: ctx.headers['x-trace-id'] }),
});

const tenantEcho = endpoint({
  name: 'tenantEcho',
  method: 'GET',
  path: '/tenant',
  summary: 'Echo the current services.tenantId',
  responses: {
    200: {
      schema: t.model('TenantResponse', { tenantId: t.string() }),
      description: 'Tenant',
    },
  },
  handler: async (ctx) =>
    ctx.respond[200]({ tenantId: ctx.services.tenantId ?? 'none' }),
});

// Handler that returns an invalid body — exercises the ValidationException
// path via ctx.respond.
const badResponse = endpoint({
  name: 'badResponse',
  method: 'GET',
  path: '/bad',
  summary: 'Returns an invalid body through ctx.respond',
  responses: { 200: { schema: Pet, description: 'Will fail validation' } },
  handler: async (ctx) =>
    ctx.respond[200]({
      // Missing/invalid fields — ctx.respond will throw ValidationException.
      id: 'not-a-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRouter() {
  const r = createRouter({ title: 'Petstore', version: '1.0.0' });
  r.add(createPet, getPet, listPets, echoHeader, tenantEcho, badResponse);
  return r;
}

function buildApp(overrides: { repo?: InMemoryPetRepo } = {}): {
  app: Express;
  repo: InMemoryPetRepo;
} {
  const repo = overrides.repo ?? new InMemoryPetRepo();
  const app = express();
  app.use(express.json());
  app.use(
    createTriadRouter(buildRouter(), {
      services: { petRepo: repo },
    }),
  );
  app.use(triadErrorHandler());
  return { app, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTriadRouter — registration', () => {
  it('throws a clear TypeError when given a non-Router value', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createTriadRouter({} as any),
    ).toThrow(/must be a Triad Router instance/);
  });
});

describe('createTriadRouter — happy path', () => {
  let app: Express;
  let repo: InMemoryPetRepo;

  beforeEach(() => {
    ({ app, repo } = buildApp());
  });

  it('POST /pets creates a pet and returns 201', async () => {
    const res = await request(app)
      .post('/pets')
      .send({ name: 'Buddy', species: 'dog', age: 3 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Buddy');
    expect(res.body.species).toBe('dog');
    expect(res.body.age).toBe(3);
    expect(res.body.id).toMatch(/^[0-9a-f-]+$/);
  });

  it('GET /pets/:id retrieves an existing pet', async () => {
    const pet = repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const res = await request(app).get(`/pets/${pet.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Rex');
  });

  it('GET /pets/:id returns 404 for unknown IDs', async () => {
    const res = await request(app).get(
      '/pets/00000000-0000-0000-0000-999999999999',
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST /pets returns 409 on duplicate names', async () => {
    repo.create({ name: 'Buddy', species: 'dog', age: 3 });
    const res = await request(app)
      .post('/pets')
      .send({ name: 'Buddy', species: 'dog', age: 5 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE');
  });
});

describe('createTriadRouter — query coercion', () => {
  it('coerces numeric query strings to integers', async () => {
    const { app, repo } = buildApp();
    repo.create({ name: 'Rex', species: 'dog', age: 5 });
    repo.create({ name: 'Whiskers', species: 'cat', age: 3 });
    repo.create({ name: 'Buddy', species: 'dog', age: 2 });

    const res = await request(app).get('/pets?limit=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('applies the default when a query param is missing', async () => {
    const { app, repo } = buildApp();
    for (let i = 0; i < 5; i++) {
      repo.create({ name: `Pet${i}`, species: 'dog', age: 1 });
    }
    const res = await request(app).get('/pets');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });

  it('filters by optional enum query param', async () => {
    const { app, repo } = buildApp();
    repo.create({ name: 'Dog1', species: 'dog', age: 1 });
    repo.create({ name: 'Dog2', species: 'dog', age: 2 });
    repo.create({ name: 'Cat1', species: 'cat', age: 3 });

    const res = await request(app).get('/pets?species=cat');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Cat1');
  });
});

describe('createTriadRouter — request validation errors', () => {
  it('returns 400 for a missing required field in the body', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/pets')
      .send({ species: 'dog', age: 3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors).toBeInstanceOf(Array);
    expect(
      res.body.errors.some((e: { path: string }) => e.path === 'name'),
    ).toBe(true);
  });

  it('returns 400 for an invalid enum value', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post('/pets')
      .send({ name: 'X', species: 'dragon', age: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a non-UUID path parameter', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/pets/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an out-of-range query param', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/pets?limit=9999');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('createTriadRouter — response validation safety net', () => {
  it('returns 500 when the handler produces an invalid body via ctx.respond', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/bad');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });
});

describe('createTriadRouter — headers pass through', () => {
  it('exposes request headers to the handler', async () => {
    const { app } = buildApp();
    const res = await request(app)
      .get('/echo')
      .set('x-trace-id', 'trace-123');
    expect(res.status).toBe(200);
    expect(res.body.traceId).toBe('trace-123');
  });
});

describe('createTriadRouter — per-request services factory', () => {
  it('calls the factory for each request', async () => {
    let calls = 0;
    const repo = new InMemoryPetRepo();
    const app = express();
    app.use(express.json());
    app.use(
      createTriadRouter(buildRouter(), {
        services: () => {
          calls++;
          return { petRepo: repo };
        },
      }),
    );
    app.use(triadErrorHandler());

    await request(app).get('/pets');
    await request(app).get('/pets');
    await request(app).get('/pets');
    expect(calls).toBe(3);
  });

  it('supports async factories', async () => {
    const repo = new InMemoryPetRepo();
    const app = express();
    app.use(express.json());
    app.use(
      createTriadRouter(buildRouter(), {
        services: async () => {
          await Promise.resolve();
          return { petRepo: repo };
        },
      }),
    );
    app.use(triadErrorHandler());

    const res = await request(app).get('/pets');
    expect(res.status).toBe(200);
  });

  it('passes the express request to the factory', async () => {
    const repo = new InMemoryPetRepo();
    const app = express();
    app.use(express.json());
    app.use(
      createTriadRouter(buildRouter(), {
        services: (req) => ({
          petRepo: repo,
          tenantId: req.header('x-tenant-id') ?? 'default',
        }),
      }),
    );
    app.use(triadErrorHandler());

    const res = await request(app)
      .get('/tenant')
      .set('x-tenant-id', 'acme');
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('acme');
  });
});

describe('createTriadRouter — mount prefix', () => {
  it('supports being mounted under an express sub-path', async () => {
    const repo = new InMemoryPetRepo();
    repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const app = express();
    app.use(express.json());
    app.use(
      '/api/v1',
      createTriadRouter(buildRouter(), { services: { petRepo: repo } }),
    );
    app.use(triadErrorHandler());

    const ok = await request(app).get('/api/v1/pets');
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(1);

    const notFound = await request(app).get('/pets');
    expect(notFound.status).toBe(404);
  });
});
