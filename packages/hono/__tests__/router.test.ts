/**
 * End-to-end Hono integration tests using `app.fetch()`.
 *
 * Hono is Web Fetch API native — no server is needed for tests. Each
 * test builds a fresh Hono app via `createTriadApp`, dispatches a
 * standard `Request` via `app.fetch()`, and asserts the returned
 * `Response`. This exercises the full pipeline: JSON body parsing,
 * coercion, validation, handler dispatch, and error formatting.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createRouter, endpoint, t } from '@triadjs/core';
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

const deletePet = endpoint({
  name: 'deletePet',
  method: 'DELETE',
  path: '/pets/:id',
  summary: 'Delete a pet',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    204: { schema: t.empty(), description: 'Deleted' },
  },
  handler: async (_ctx) => _ctx.respond[204](),
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

  it('DELETE /pets/:id returns 204 with empty body and no content-type', async () => {
    const del = await app.fetch(
      new Request('http://localhost/pets/00000000-0000-0000-0000-000000000001', {
        method: 'DELETE',
      }),
    );
    expect(del.status).toBe(204);
    const text = await del.text();
    expect(text).toBe('');
    // Critical: a t.empty() response must not advertise a body content-type.
    expect(del.headers.get('content-type')).toBeNull();
  });

  it('non-empty responses still advertise application/json', async () => {
    const res = await app.fetch(new Request('http://localhost/pets'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
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
    const app = createTriadApp(router);
    const res = await app.fetch(new Request('http://localhost/protected'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTH');
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
        state: { userId: 'carol-7' },
      }),
      responses: {
        200: { schema: t.model('WamiH', { userId: t.string() }), description: 'ok' },
      },
      handler: async (ctx) => ctx.respond[200]({ userId: ctx.state.userId }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);
    const app = createTriadApp(router);
    const res = await app.fetch(new Request('http://localhost/whoami'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe('carol-7');
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

function buildFileApp(): Hono {
  const router = createRouter({ title: 'Uploads', version: '1.0.0' });
  router.add(uploadAvatar);
  return createTriadApp(router);
}

function uploadFormData(
  fields: Record<string, string>,
  files: Array<{
    fieldname: string;
    filename: string;
    contentType: string;
    content: Uint8Array;
  }>,
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const f of files) {
    fd.append(
      f.fieldname,
      new File([f.content], f.filename, { type: f.contentType }),
    );
  }
  return fd;
}

describe('createTriadApp — file uploads', () => {
  it('accepts a multipart body and passes TriadFile to the handler', async () => {
    const app = buildFileApp();
    const fd = uploadFormData({ name: 'alice' }, [
      {
        fieldname: 'avatar',
        filename: 'a.png',
        contentType: 'image/png',
        content: new Uint8Array([1, 2, 3, 4, 5]),
      },
    ]);
    const res = await app.fetch(
      new Request('http://localhost/avatars', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      name: string;
      size: number;
      mimeType: string;
    };
    expect(body).toEqual({ name: 'alice', size: 5, mimeType: 'image/png' });
  });

  it('rejects a file exceeding maxSize with a 400 envelope', async () => {
    const app = buildFileApp();
    const fd = uploadFormData({ name: 'alice' }, [
      {
        fieldname: 'avatar',
        filename: 'big.png',
        contentType: 'image/png',
        content: new Uint8Array(2048),
      },
    ]);
    const res = await app.fetch(
      new Request('http://localhost/avatars', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'file_too_large')).toBe(true);
  });

  it('rejects a file with a disallowed mime type', async () => {
    const app = buildFileApp();
    const fd = uploadFormData({ name: 'alice' }, [
      {
        fieldname: 'avatar',
        filename: 'a.gif',
        contentType: 'image/gif',
        content: new Uint8Array([1, 2]),
      },
    ]);
    const res = await app.fetch(
      new Request('http://localhost/avatars', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'invalid_mime_type')).toBe(true);
  });

  it('rejects a multipart request missing the required file field', async () => {
    const app = buildFileApp();
    const fd = uploadFormData({ name: 'alice' }, []);
    const res = await app.fetch(
      new Request('http://localhost/avatars', { method: 'POST', body: fd }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      code: string;
      errors: Array<{ path: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.path === 'avatar')).toBe(true);
  });

  it('rejects a JSON body on a file-bearing endpoint', async () => {
    const app = buildFileApp();
    const res = await app.fetch(
      new Request('http://localhost/avatars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'alice' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Swagger UI / docs option
// ---------------------------------------------------------------------------

describe('createTriadApp — docs (Swagger UI)', () => {
  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['NODE_ENV'];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalEnv;
  });

  function buildDocsApp(
    options: Parameters<typeof createTriadApp>[1] = {},
  ): Hono {
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
        handler: async (ctx) =>
          ctx.respond[200]({ id: ctx.params.id, name: 'Buddy' }),
      }),
    );
    return createTriadApp(triad, options);
  }

  it('serves Swagger UI HTML at /api-docs with docs: true', async () => {
    const app = buildDocsApp({ docs: true });
    const res = await app.fetch(new Request('http://localhost/api-docs'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('SwaggerUIBundle');
    expect(body).toContain("url: '/api-docs/openapi.json'");
    expect(body).toContain('Petstore API — API docs');
  });

  it('serves the OpenAPI 3.1 JSON at /api-docs/openapi.json', async () => {
    const app = buildDocsApp({ docs: true });
    const res = await app.fetch(
      new Request('http://localhost/api-docs/openapi.json'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Petstore API');
    expect(doc.paths['/pets/{id}']).toBeDefined();
  });

  it('defaults to on when NODE_ENV is unset', async () => {
    const app = buildDocsApp();
    const res = await app.fetch(new Request('http://localhost/api-docs'));
    expect(res.status).toBe(200);
  });

  it('defaults to off when NODE_ENV=production', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = buildDocsApp();
    const res = await app.fetch(new Request('http://localhost/api-docs'));
    expect(res.status).toBe(404);
  });

  it('docs: true forces on even in production', async () => {
    process.env['NODE_ENV'] = 'production';
    const app = buildDocsApp({ docs: true });
    const res = await app.fetch(new Request('http://localhost/api-docs'));
    expect(res.status).toBe(200);
  });

  it('docs: false disables in development', async () => {
    const app = buildDocsApp({ docs: false });
    const html = await app.fetch(new Request('http://localhost/api-docs'));
    expect(html.status).toBe(404);
    const json = await app.fetch(
      new Request('http://localhost/api-docs/openapi.json'),
    );
    expect(json.status).toBe(404);
  });

  it('accepts a custom path', async () => {
    const app = buildDocsApp({ docs: { path: '/internal/docs' } });
    const html = await app.fetch(
      new Request('http://localhost/internal/docs'),
    );
    expect(html.status).toBe(200);
    expect(await html.text()).toContain("url: '/internal/docs/openapi.json'");
    const json = await app.fetch(
      new Request('http://localhost/internal/docs/openapi.json'),
    );
    expect(json.status).toBe(200);
    const notFound = await app.fetch(
      new Request('http://localhost/api-docs'),
    );
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
    expect(() => createTriadApp(triad, { docs: true })).toThrow(
      /collides with the API docs path/,
    );
  });
});
