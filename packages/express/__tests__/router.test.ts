/**
 * End-to-end Express integration tests using supertest.
 *
 * Each test mounts a fresh express app with the Triad router middleware
 * and issues a real HTTP request through supertest. This exercises the
 * full pipeline: express.json() body parsing, the Triad middleware
 * chain, coercion, validation, handler dispatch, and error formatting.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createRouter, endpoint, t } from '@triadjs/core';
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

declare module '@triadjs/core' {
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

const deletePet = endpoint({
  name: 'deletePet',
  method: 'DELETE',
  path: '/pets/:id',
  summary: 'Delete a pet',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    204: { schema: t.empty(), description: 'Pet deleted' },
  },
  handler: async (ctx) => {
    void ctx.params.id;
    return ctx.respond[204]();
  },
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
  r.add(createPet, getPet, listPets, echoHeader, tenantEcho, deletePet, badResponse);
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

describe('createTriadRouter — t.empty() responses', () => {
  it('DELETE returns 204 with empty body and no content-type header', async () => {
    const { app } = buildApp();
    const res = await request(app).delete(
      '/pets/00000000-0000-0000-0000-000000000001',
    );
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    // Critical: res.end() must not advertise a JSON content-type.
    expect(res.headers['content-type']).toBeUndefined();
  });

  it('non-empty responses still advertise application/json', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/pets');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
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

describe('beforeHandler', () => {
  it('short-circuits with a 401 without invoking the main handler', async () => {
    let handlerCalled = false;
    const ep = endpoint({
      name: 'protected',
      method: 'GET',
      path: '/protected',
      summary: 'x',
      beforeHandler: async (ctx) => {
        if (!ctx.rawHeaders['authorization']) {
          return {
            ok: false,
            response: ctx.respond[401]({ code: 'UNAUTH', message: 'no' }),
          };
        }
        return { ok: true, state: { userId: 'u1' } };
      },
      responses: {
        200: { schema: t.model('OkPx', { userId: t.string() }), description: 'ok' },
        401: { schema: ApiError, description: 'unauth' },
      },
      handler: async (ctx) => {
        handlerCalled = true;
        return ctx.respond[200]({ userId: ctx.state.userId });
      },
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const app = express();
    app.use(express.json());
    app.use(createTriadRouter(router));
    app.use(triadErrorHandler());

    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTH' });
    expect(handlerCalled).toBe(false);
  });

  it('threads state into ctx.state on success', async () => {
    const ep = endpoint({
      name: 'whoami',
      method: 'GET',
      path: '/whoami',
      summary: 'x',
      beforeHandler: async () => ({
        ok: true,
        state: { userId: 'bob-9' },
      }),
      responses: {
        200: { schema: t.model('Wami', { userId: t.string() }), description: 'ok' },
      },
      handler: async (ctx) => ctx.respond[200]({ userId: ctx.state.userId }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const app = express();
    app.use(express.json());
    app.use(createTriadRouter(router));
    app.use(triadErrorHandler());

    const res = await request(app).get('/whoami');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'bob-9' });
  });
});

// ---------------------------------------------------------------------------
// File upload tests
// ---------------------------------------------------------------------------

const AvatarUpload = t.model('AvatarUpload', {
  name: t.string().minLength(1),
  avatar: t.file().maxSize(1024).mimeTypes('image/png', 'image/jpeg'),
});

const uploadAvatar = endpoint({
  name: 'uploadAvatar',
  method: 'POST',
  path: '/avatars',
  summary: 'Upload an avatar',
  request: { body: AvatarUpload },
  responses: {
    201: {
      schema: t.model('AvatarOk', {
        name: t.string(),
        size: t.int32(),
        mimeType: t.string(),
      }),
      description: 'ok',
    },
  },
  handler: async (ctx) =>
    ctx.respond[201]({
      name: ctx.body.name,
      size: ctx.body.avatar.size,
      mimeType: ctx.body.avatar.mimeType,
    }),
});

function buildFileApp(): Express {
  const router = createRouter({ title: 'Uploads', version: '1.0.0' });
  router.add(uploadAvatar);
  const app = express();
  app.use(express.json());
  app.use(createTriadRouter(router));
  app.use(triadErrorHandler());
  return app;
}

describe('createTriadRouter — file uploads', () => {
  it('accepts a multipart body and passes TriadFile to the handler', async () => {
    const app = buildFileApp();
    const res = await request(app)
      .post('/avatars')
      .field('name', 'alice')
      .attach('avatar', Buffer.from('hello'), {
        filename: 'a.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'alice', size: 5, mimeType: 'image/png' });
  });

  it('rejects a file exceeding maxSize with a 400 envelope', async () => {
    const app = buildFileApp();
    const res = await request(app)
      .post('/avatars')
      .field('name', 'alice')
      .attach('avatar', Buffer.alloc(2048, 1), {
        filename: 'big.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(
      res.body.errors.some((e: { code: string }) => e.code === 'file_too_large'),
    ).toBe(true);
  });

  it('rejects a file with a disallowed mime type', async () => {
    const app = buildFileApp();
    const res = await request(app)
      .post('/avatars')
      .field('name', 'alice')
      .attach('avatar', Buffer.from('hi'), {
        filename: 'a.gif',
        contentType: 'image/gif',
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(
      res.body.errors.some((e: { code: string }) => e.code === 'invalid_mime_type'),
    ).toBe(true);
  });

  it('rejects a multipart request missing the required file field', async () => {
    const app = buildFileApp();
    const res = await request(app).post('/avatars').field('name', 'alice');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(
      res.body.errors.some(
        (e: { code: string; path: string }) => e.path === 'avatar',
      ),
    ).toBe(true);
  });

  it('rejects a JSON body on a file-bearing endpoint', async () => {
    const app = buildFileApp();
    const res = await request(app).post('/avatars').send({ name: 'alice' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Swagger UI / docs option
// ---------------------------------------------------------------------------

describe('createTriadRouter — docs (Swagger UI)', () => {
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
  });

  function buildDocsApp(
    options: Parameters<typeof createTriadRouter>[1] = {},
  ): Express {
    const triad = createRouter({ title: 'Petstore API', version: '1.0.0' });
    triad.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        request: { params: { id: t.string() } },
        responses: {
          200: {
            schema: t.model('Pet', { id: t.string(), name: t.string() }),
            description: 'OK',
          },
        },
        handler: async (ctx) => ctx.respond[200]({ id: ctx.params.id, name: 'Buddy' }),
      }),
    );
    const app = express();
    app.use(express.json());
    app.use(createTriadRouter(triad, options));
    return app;
  }

  it('serves Swagger UI HTML at /api-docs with docs: true', async () => {
    const app = buildDocsApp({ docs: true });
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('SwaggerUIBundle');
    expect(res.text).toContain("url: '/api-docs/openapi.json'");
    expect(res.text).toContain('Petstore API — API docs');
  });

  it('serves the OpenAPI 3.1 JSON at /api-docs/openapi.json', async () => {
    const app = buildDocsApp({ docs: true });
    const res = await request(app).get('/api-docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('Petstore API');
    expect(res.body.paths['/pets/{id}']).toBeDefined();
  });

  it('defaults to on when NODE_ENV is unset', async () => {
    const app = buildDocsApp();
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(200);
  });

  it('defaults to off when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = buildDocsApp();
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(404);
  });

  it('docs: true forces on even in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = buildDocsApp({ docs: true });
    const res = await request(app).get('/api-docs');
    expect(res.status).toBe(200);
  });

  it('docs: false disables in development', async () => {
    const app = buildDocsApp({ docs: false });
    const htmlRes = await request(app).get('/api-docs');
    expect(htmlRes.status).toBe(404);
    const jsonRes = await request(app).get('/api-docs/openapi.json');
    expect(jsonRes.status).toBe(404);
  });

  it('accepts a custom path', async () => {
    const app = buildDocsApp({ docs: { path: '/internal/docs' } });
    const htmlRes = await request(app).get('/internal/docs');
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.text).toContain("url: '/internal/docs/openapi.json'");
    const jsonRes = await request(app).get('/internal/docs/openapi.json');
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.openapi).toBe('3.1.0');
    const notFound = await request(app).get('/api-docs');
    expect(notFound.status).toBe(404);
  });

  it('throws when a user endpoint collides with the docs path', () => {
    const triad = createRouter({ title: 'API', version: '1.0.0' });
    triad.add(
      endpoint({
        name: 'getApiDocs',
        method: 'GET',
        path: '/api-docs',
        summary: 'Collides',
        responses: {
          200: { schema: t.model('Ok', { ok: t.boolean() }), description: 'ok' },
        },
        handler: async (ctx) => ctx.respond[200]({ ok: true }),
      }),
    );
    expect(() => createTriadRouter(triad, { docs: true })).toThrow(
      /collides with the Swagger UI docs path/,
    );
  });
});
