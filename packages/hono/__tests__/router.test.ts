/**
 * End-to-end Hono integration tests using `app.fetch()`.
 *
 * Hono is Web Fetch API native — no server is needed for tests. Each
 * test builds a fresh Hono app via `createTriadApp`, dispatches a
 * standard `Request` via `app.fetch()`, and asserts the returned
 * `Response`. This exercises the full pipeline: JSON body parsing,
 * coercion, validation, handler dispatch, and error formatting.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createRouter, endpoint, t } from '@triad/core';
import { createTriadApp } from '../src/index.js';

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

const deletePet = endpoint({
  name: 'deletePet',
  method: 'DELETE',
  path: '/pets/:id',
  summary: 'Delete a pet',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    204: { schema: t.unknown().optional(), description: 'Deleted' },
  },
  handler: async (ctx) => ctx.respond[204](undefined),
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

const badResponse = endpoint({
  name: 'badResponse',
  method: 'GET',
  path: '/bad',
  summary: 'Returns an invalid body through ctx.respond',
  responses: { 200: { schema: Pet, description: 'Will fail validation' } },
  handler: async (ctx) =>
    ctx.respond[200]({
      id: 'not-a-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRouter() {
  const r = createRouter({ title: 'Petstore', version: '1.0.0' });
  r.add(createPet, getPet, listPets, deletePet, echoHeader, tenantEcho, badResponse);
  return r;
}

function buildApp(overrides: { repo?: InMemoryPetRepo } = {}): {
  app: Hono;
  repo: InMemoryPetRepo;
} {
  const repo = overrides.repo ?? new InMemoryPetRepo();
  const app = createTriadApp(buildRouter(), {
    services: { petRepo: repo },
  });
  return { app, repo };
}

async function get(
  app: Hono,
  path: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return await app.fetch(
    new Request(`http://localhost${path}`, { method: 'GET', headers }),
  );
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTriadApp — registration', () => {
  it('throws a clear TypeError when given a non-Router value', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createTriadApp({} as any),
    ).toThrow(/must be a Triad Router instance/);
  });

  it('returns a Hono instance', () => {
    const { app } = buildApp();
    expect(app).toBeInstanceOf(Hono);
  });
});

describe('createTriadApp — happy path', () => {
  let app: Hono;
  let repo: InMemoryPetRepo;

  beforeEach(() => {
    ({ app, repo } = buildApp());
  });

  it('POST /pets creates a pet and returns 201', async () => {
    const res = await postJson(app, '/pets', { name: 'Buddy', species: 'dog', age: 3 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PetRow;
    expect(body.name).toBe('Buddy');
    expect(body.species).toBe('dog');
    expect(body.age).toBe(3);
    expect(body.id).toMatch(/^[0-9a-f-]+$/);
  });

  it('GET /pets/:id retrieves an existing pet', async () => {
    const pet = repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const res = await get(app, `/pets/${pet.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PetRow;
    expect(body.name).toBe('Rex');
  });

  it('GET /pets/:id returns 404 for unknown IDs', async () => {
    const res = await get(app, '/pets/00000000-0000-0000-0000-999999999999');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });

  it('POST /pets returns 409 on duplicate names', async () => {
    repo.create({ name: 'Buddy', species: 'dog', age: 3 });
    const res = await postJson(app, '/pets', { name: 'Buddy', species: 'dog', age: 5 });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('DUPLICATE');
  });

  it('DELETE /pets/:id returns 204 with empty body', async () => {
    const del = await app.fetch(
      new Request('http://localhost/pets/00000000-0000-0000-0000-000000000001', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(204);
    const text = await del.text();
    expect(text).toBe('');
  });
});

describe('createTriadApp — query coercion', () => {
  it('coerces numeric query strings to integers', async () => {
    const { app, repo } = buildApp();
    repo.create({ name: 'Rex', species: 'dog', age: 5 });
    repo.create({ name: 'Whiskers', species: 'cat', age: 3 });
    repo.create({ name: 'Buddy', species: 'dog', age: 2 });

    const res = await get(app, '/pets?limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });

  it('applies the default when a query param is missing', async () => {
    const { app, repo } = buildApp();
    for (let i = 0; i < 5; i++) {
      repo.create({ name: `Pet${i}`, species: 'dog', age: 1 });
    }
    const res = await get(app, '/pets');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(5);
  });

  it('filters by optional enum query param', async () => {
    const { app, repo } = buildApp();
    repo.create({ name: 'Dog1', species: 'dog', age: 1 });
    repo.create({ name: 'Dog2', species: 'dog', age: 2 });
    repo.create({ name: 'Cat1', species: 'cat', age: 3 });

    const res = await get(app, '/pets?species=cat');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe('Cat1');
  });
});

describe('createTriadApp — request validation errors', () => {
  it('returns 400 for a missing required field in the body', async () => {
    const { app } = buildApp();
    const res = await postJson(app, '/pets', { species: 'dog', age: 3 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ path: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.some((e) => e.path === 'name')).toBe(true);
  });

  it('returns 400 for an invalid enum value', async () => {
    const { app } = buildApp();
    const res = await postJson(app, '/pets', { name: 'X', species: 'dragon', age: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a non-UUID path parameter', async () => {
    const { app } = buildApp();
    const res = await get(app, '/pets/not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an out-of-range query param', async () => {
    const { app } = buildApp();
    const res = await get(app, '/pets?limit=9999');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when POST body is not valid JSON', async () => {
    const { app } = buildApp();
    const res = await app.fetch(
      new Request('http://localhost/pets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

describe('createTriadApp — response validation safety net', () => {
  it('returns 500 when the handler produces an invalid body via ctx.respond', async () => {
    const { app } = buildApp();
    const res = await get(app, '/bad');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});

describe('createTriadApp — headers pass through', () => {
  it('exposes request headers to the handler', async () => {
    const { app } = buildApp();
    const res = await get(app, '/echo', { 'x-trace-id': 'trace-123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traceId: string };
    expect(body.traceId).toBe('trace-123');
  });
});

describe('createTriadApp — per-request services factory', () => {
  it('calls the factory for each request', async () => {
    let calls = 0;
    const repo = new InMemoryPetRepo();
    const app = createTriadApp(buildRouter(), {
      services: () => {
        calls++;
        return { petRepo: repo };
      },
    });

    await get(app, '/pets');
    await get(app, '/pets');
    await get(app, '/pets');
    expect(calls).toBe(3);
  });

  it('supports async factories', async () => {
    const repo = new InMemoryPetRepo();
    const app = createTriadApp(buildRouter(), {
      services: async () => {
        await Promise.resolve();
        return { petRepo: repo };
      },
    });

    const res = await get(app, '/pets');
    expect(res.status).toBe(200);
  });

  it('passes the standard Request to the factory', async () => {
    const repo = new InMemoryPetRepo();
    const app = createTriadApp(buildRouter(), {
      services: (req) => ({
        petRepo: repo,
        tenantId: req.headers.get('x-tenant-id') ?? 'default',
      }),
    });

    const res = await get(app, '/tenant', { 'x-tenant-id': 'acme' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string };
    expect(body.tenantId).toBe('acme');
  });
});

describe('createTriadApp — mount prefix', () => {
  it('supports being mounted via app.route under a prefix', async () => {
    const repo = new InMemoryPetRepo();
    repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const triadApp = createTriadApp(buildRouter(), { services: { petRepo: repo } });

    const parent = new Hono();
    parent.route('/api/v1', triadApp);

    const ok = await parent.fetch(new Request('http://localhost/api/v1/pets'));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as unknown[];
    expect(body).toHaveLength(1);

    const notFound = await parent.fetch(new Request('http://localhost/pets'));
    expect(notFound.status).toBe(404);
  });
});
