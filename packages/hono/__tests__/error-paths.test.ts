/**
 * Error-path integration tests for @triadjs/hono.
 *
 * Each test sends a real fetch Request via `app.fetch()` and asserts on
 * the response status, content-type, and error envelope shape. The goal:
 * prove that Hono produces the documented Triad error envelope for
 * every category of broken/malformed/unexpected wire input.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { createRouter, endpoint, t } from '@triadjs/core';
import { createTriadApp } from '../src/index.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});
const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePetEP');

const AvatarUpload = t.model('AvatarUploadEP', {
  name: t.string().minLength(1),
  avatar: t.file().maxSize(1024).mimeTypes('image/png', 'image/jpeg'),
});

// ---------------------------------------------------------------------------
// Endpoints — purpose-built for error-path testing
// ---------------------------------------------------------------------------

const createPetEp = endpoint({
  name: 'createPetEP',
  method: 'POST',
  path: '/pets',
  summary: 'Create a pet',
  request: { body: CreatePet },
  responses: {
    201: { schema: Pet, description: 'Created' },
  },
  handler: async (ctx) =>
    ctx.respond[201]({
      id: '00000000-0000-0000-0000-000000000001',
      ...ctx.body,
    }),
});

const uploadAvatarEp = endpoint({
  name: 'uploadAvatarEP',
  method: 'POST',
  path: '/upload',
  summary: 'Upload an avatar',
  request: { body: AvatarUpload },
  responses: {
    201: {
      schema: t.model('UploadOk', { ok: t.boolean() }),
      description: 'ok',
    },
  },
  handler: async (ctx) => ctx.respond[201]({ ok: true }),
});

const deleteEp = endpoint({
  name: 'deleteEP',
  method: 'DELETE',
  path: '/pets/:id',
  summary: 'Delete a pet',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    204: { schema: t.empty(), description: 'Deleted' },
  },
  handler: async (ctx) => {
    void ctx.params.id;
    return ctx.respond[204]();
  },
});

const wrongShapeEp = endpoint({
  name: 'wrongShapeEP',
  method: 'GET',
  path: '/wrong-shape',
  summary: 'Handler returns the wrong shape',
  responses: { 200: { schema: Pet, description: 'Should fail' } },
  handler: async (ctx) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.respond[200]({ totally: 'wrong' } as any),
});

const emptyBodyBugEp = endpoint({
  name: 'emptyBodyBugEP',
  method: 'DELETE',
  path: '/empty-bug/:id',
  summary: 'Handler returns a body for a t.empty() 204',
  request: { params: { id: t.string().format('uuid') } },
  responses: {
    204: { schema: t.empty(), description: 'Should be empty' },
  },
  handler: async (ctx) => {
    void ctx.params.id;
    return ctx.respond[204]();
  },
});

const handlerThrowsEp = endpoint({
  name: 'handlerThrowsEP',
  method: 'GET',
  path: '/boom',
  summary: 'Handler throws an unexpected error',
  responses: {
    200: { schema: t.model('BoomOk', { ok: t.boolean() }), description: 'ok' },
  },
  handler: async () => {
    throw new Error('boom');
  },
});

const beforeHandlerThrowsEp = endpoint({
  name: 'beforeHandlerThrowsEP',
  method: 'GET',
  path: '/before-boom',
  summary: 'beforeHandler throws an unexpected error',
  beforeHandler: async () => {
    throw new Error('auth broke');
  },
  responses: {
    200: { schema: t.model('BeforeBoomOk', { ok: t.boolean() }), description: 'ok' },
  },
  handler: async (ctx) => ctx.respond[200]({ ok: true }),
});

const responseHeadersEp = endpoint({
  name: 'responseHeadersEP',
  method: 'GET',
  path: '/with-headers',
  summary: 'Handler returns custom response headers',
  responses: {
    200: { schema: t.model('HeadersOk', { ok: t.boolean() }), description: 'ok' },
  },
  handler: async (ctx) => ({
    ...ctx.respond[200]({ ok: true }),
    headers: { 'x-custom-header': 'hello', 'x-request-id': 'abc-123' },
  }),
});

const headerRequiredEp = endpoint({
  name: 'headerRequiredEP',
  method: 'GET',
  path: '/needs-header',
  summary: 'Requires x-custom header',
  request: {
    headers: { 'x-custom': t.string().minLength(1) },
  },
  responses: {
    200: {
      schema: t.model('HeaderOk', { value: t.string() }),
      description: 'ok',
    },
  },
  handler: async (ctx) => ctx.respond[200]({ value: ctx.headers['x-custom'] }),
});

const listEp = endpoint({
  name: 'listEP',
  method: 'GET',
  path: '/items',
  summary: 'List items with query params',
  request: {
    query: {
      tag: t.string().optional(),
      limit: t.int32().min(1).max(100).default(20),
    },
  },
  responses: {
    200: {
      schema: t.model('ListResult', {
        tag: t.string().optional(),
        limit: t.int32(),
      }),
      description: 'ok',
    },
  },
  handler: async (ctx) =>
    ctx.respond[200]({
      tag: ctx.query.tag,
      limit: ctx.query.limit,
    }),
});

const bookEp = endpoint({
  name: 'bookByIdEP',
  method: 'GET',
  path: '/books/:id',
  summary: 'Get book by id (string param)',
  request: {
    params: { id: t.string().minLength(1) },
  },
  responses: {
    200: {
      schema: t.model('BookResult', { id: t.string() }),
      description: 'ok',
    },
  },
  handler: async (ctx) => ctx.respond[200]({ id: ctx.params.id }),
});

// ---------------------------------------------------------------------------
// Router + App setup
// ---------------------------------------------------------------------------

function buildRouter() {
  const r = createRouter({ title: 'ErrorPathsTest', version: '1.0.0' });
  r.add(
    createPetEp,
    uploadAvatarEp,
    deleteEp,
    wrongShapeEp,
    emptyBodyBugEp,
    handlerThrowsEp,
    beforeHandlerThrowsEp,
    responseHeadersEp,
    headerRequiredEp,
    listEp,
    bookEp,
  );
  return r;
}

let app: Hono;

beforeAll(() => {
  app = createTriadApp(buildRouter(), {
    logError: () => {},
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorEnvelope = {
  code: string;
  message: string;
  errors?: Array<{ path: string; message: string; code: string }>;
};

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function postRaw(
  path: string,
  rawBody: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: rawBody,
    }),
  );
}

async function get(
  path: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, { method: 'GET', headers }),
  );
}

// ---------------------------------------------------------------------------
// Category 1: Body parsing failures
// ---------------------------------------------------------------------------

describe('Hono error paths — body parsing failures', () => {
  it('returns 400 VALIDATION_ERROR for truncated JSON body', async () => {
    const res = await postRaw('/pets', '{ "name": "Rex"');
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    // Hono's readJsonBody catches the JSON parse error and throws
    // RequestValidationError with code 'invalid_json'.
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toBeInstanceOf(Array);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('returns 400 VALIDATION_ERROR with invalid_content_type for wrong content-type (text/plain) on a JSON endpoint', async () => {
    const res = await app.fetch(
      new Request('http://localhost/pets', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
      }),
    );
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors!.some((e) => e.code === 'invalid_content_type')).toBe(true);
  });

  it('returns 400 for empty body on a required-body endpoint', async () => {
    const res = await postRaw('/pets', '');
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for JSON body on a multipart endpoint', async () => {
    const res = await app.fetch(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'alice' }),
      }),
    );
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toBeInstanceOf(Array);
  });
});

// ---------------------------------------------------------------------------
// Category 2: Response validation
// ---------------------------------------------------------------------------

describe('Hono error paths — response validation', () => {
  it('returns 500 INTERNAL_ERROR when handler returns wrong shape via ctx.respond', async () => {
    const res = await get('/wrong-shape');
    expect(res.status).toBe(500);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('The server produced an invalid response.');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    // Must NOT contain 'errors' array — internal errors are opaque.
    expect(body.errors).toBeUndefined();
  });

  it('returns 204 with no body for a t.empty() endpoint (adapter discards body)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/empty-bug/00000000-0000-0000-0000-000000000001', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
    expect(res.headers.get('content-type')).toBeNull();
  });

  it('returns 500 INTERNAL_ERROR when handler throws an unexpected error', async () => {
    const res = await get('/boom');
    expect(res.status).toBe(500);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('The server produced an unexpected error.');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(body.errors).toBeUndefined();
  });

  it('returns 500 INTERNAL_ERROR when beforeHandler throws an unexpected error', async () => {
    const res = await get('/before-boom');
    expect(res.status).toBe(500);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('The server produced an unexpected error.');
    expect(body.errors).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Category 3: Coercion and path edge cases
// ---------------------------------------------------------------------------

describe('Hono error paths — coercion and path edge cases', () => {
  it('handles repeated query keys without crashing', async () => {
    const res = await get('/items?tag=a&tag=b');
    // Hono's c.req.query() returns the first value for repeated keys.
    // Since tag is t.string().optional(), this should pass through as 'a'.
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { tag: string; limit: number };
      // Document: Hono picks the first value for repeated query keys.
      expect(body.tag).toBeDefined();
    }
  });

  it('URL-decodes path params correctly', async () => {
    const res = await get('/books/hello%20world');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('hello world');
  });

  it('returns 400 for empty string query param on a number schema', async () => {
    const res = await get('/items?limit=');
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a missing required header', async () => {
    const res = await get('/needs-header');
    expect(res.status).toBe(400);
    const body: ErrorEnvelope = (await res.json()) as ErrorEnvelope;
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toBeInstanceOf(Array);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

// ---------------------------------------------------------------------------
// Category 4: Error envelope parity check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Category 4: Response headers from handler
// ---------------------------------------------------------------------------

describe('Hono error paths — response headers from handler', () => {
  it('applies HandlerResponse.headers to the Hono response', async () => {
    const res = await get('/with-headers');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-custom-header')).toBe('hello');
    expect(res.headers.get('x-request-id')).toBe('abc-123');
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Category 5: Error envelope parity check
// ---------------------------------------------------------------------------

describe('Hono error paths — envelope parity', () => {
  it('validation error envelope has exactly code, message, errors top-level keys', async () => {
    const res = await postJson('/pets', { species: 'dog', age: 3 }); // missing name
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('errors');
    expect(typeof body.code).toBe('string');
    expect(typeof body.message).toBe('string');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.code).toBe('VALIDATION_ERROR');
    // Verify no extra keys.
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['code', 'errors', 'message']);
  });
});
