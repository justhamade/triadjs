/**
 * End-to-end tests for `createLambdaHandler` — invoke the returned
 * handler directly with synthetic Lambda events across v1, v2, and ALB
 * shapes. Mirrors the scenarios in `packages/express/__tests__/router.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import {
  createLambdaHandler,
  type LambdaContext,
  type LambdaEvent,
  type APIGatewayProxyEventV1,
  type APIGatewayProxyEventV2,
  type APIGatewayProxyResultV1,
  type APIGatewayProxyResultV2,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// In-memory petstore (same shape as express tests)
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
  summary: 'Get a pet',
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
    200: { schema: t.array(Pet), description: 'Pets' },
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
  summary: 'Echo header',
  request: { headers: { 'x-trace-id': t.string() } },
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
  summary: 'Tenant',
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
    204: { schema: t.empty(), description: 'Deleted' },
  },
  handler: async (ctx) => {
    void ctx.params.id;
    return ctx.respond[204]();
  },
});

const badResponse = endpoint({
  name: 'badResponse',
  method: 'GET',
  path: '/bad',
  summary: 'Invalid response body',
  responses: { 200: { schema: Pet, description: 'Will fail' } },
  handler: async (ctx) =>
    ctx.respond[200]({
      id: 'not-a-uuid',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
});

const handlerThrows = endpoint({
  name: 'handlerThrows',
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

const responseHeaders = endpoint({
  name: 'responseHeaders',
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

function buildRouter() {
  const r = createRouter({ title: 'Petstore', version: '1.0.0' });
  r.add(
    createPet, getPet, listPets, echoHeader, tenantEcho, deletePet,
    badResponse, handlerThrows, responseHeaders,
  );
  return r;
}

// ---------------------------------------------------------------------------
// Event fixture builders
// ---------------------------------------------------------------------------

function makeContext(): LambdaContext {
  return {
    awsRequestId: 'req-1',
    functionName: 'test',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:test',
    memoryLimitInMB: '128',
    logGroupName: '/aws/lambda/test',
    logStreamName: 'stream',
    getRemainingTimeInMillis: () => 30_000,
  };
}

interface V1Opts {
  method: string;
  path: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  multiValueQuery?: Record<string, string[]>;
  asAlb?: boolean;
}

function makeV1Event(opts: V1Opts): APIGatewayProxyEventV1 {
  return {
    httpMethod: opts.method,
    path: opts.path,
    headers: opts.headers ?? {},
    multiValueHeaders: {},
    queryStringParameters: opts.query ?? null,
    multiValueQueryStringParameters: opts.multiValueQuery ?? null,
    pathParameters: null,
    body: opts.body ?? null,
    isBase64Encoded: opts.isBase64Encoded ?? false,
    ...(opts.asAlb && {
      requestContext: {
        elb: { targetGroupArn: 'arn:aws:elasticloadbalancing:...' },
      },
    }),
  };
}

interface V2Opts {
  method: string;
  path: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

function makeV2Event(opts: V2Opts): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    rawPath: opts.path,
    rawQueryString: opts.query
      ? new URLSearchParams(opts.query).toString()
      : '',
    headers: opts.headers ?? {},
    queryStringParameters: opts.query,
    body: opts.body,
    isBase64Encoded: opts.isBase64Encoded ?? false,
    requestContext: {
      http: {
        method: opts.method,
        path: opts.path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
    },
  };
}

function bodyJson(result: APIGatewayProxyResultV1 | APIGatewayProxyResultV2): unknown {
  const body = result.body;
  if (body === undefined || body === '') return undefined;
  return JSON.parse(body);
}

function buildHandler(
  servicesOverride?: ConstructorParameters<typeof Object>[0],
  repo: InMemoryPetRepo = new InMemoryPetRepo(),
): {
  handler: ReturnType<typeof createLambdaHandler>;
  repo: InMemoryPetRepo;
} {
  void servicesOverride;
  return {
    handler: createLambdaHandler(buildRouter(), {
      services: { petRepo: repo },
    }),
    repo,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLambdaHandler — registration', () => {
  it('throws a clear TypeError when given a non-Router value', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createLambdaHandler({} as any),
    ).toThrow(/must be a Triad Router instance/);
  });
});

describe('createLambdaHandler — v1 (API Gateway REST)', () => {
  it('GET /pets/:id returns the pet with a v1 result shape', async () => {
    const { handler, repo } = buildHandler();
    const pet = repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const result = (await handler(
      makeV1Event({ method: 'GET', path: `/pets/${pet.id}` }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
    expect(result.isBase64Encoded).toBe(false);
    expect(typeof result.body).toBe('string');
    expect(bodyJson(result)).toMatchObject({ name: 'Rex', species: 'dog' });
  });

  it('POST /pets creates with JSON body', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Buddy', species: 'dog', age: 3 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(201);
    const body = bodyJson(result) as { name: string; species: string };
    expect(body.name).toBe('Buddy');
    expect(body.species).toBe('dog');
  });

  it('returns 400 with VALIDATION_ERROR envelope on invalid body', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ species: 'dog', age: 3 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(400);
    const body = bodyJson(result) as {
      code: string;
      errors: Array<{ path: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.path === 'name')).toBe(true);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(400);
    expect((bodyJson(result) as { code: string }).code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('coerces numeric query strings to integers', async () => {
    const { handler, repo } = buildHandler();
    repo.create({ name: 'A', species: 'dog', age: 1 });
    repo.create({ name: 'B', species: 'dog', age: 2 });
    repo.create({ name: 'C', species: 'dog', age: 3 });

    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets', query: { limit: '2' } }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(200);
    expect((bodyJson(result) as unknown[]).length).toBe(2);
  });

  it('validates enum query params', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'GET',
        path: '/pets',
        query: { species: 'dragon' },
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for out-of-range limit', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets', query: { limit: '9999' } }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for non-UUID path param', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets/not-a-uuid' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 with NOT_FOUND envelope for unknown routes', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/nope' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(404);
    expect(bodyJson(result)).toEqual({
      code: 'NOT_FOUND',
      message: 'No handler for GET /nope.',
    });
  });

  it('supports multiValueQueryStringParameters', async () => {
    const { handler, repo } = buildHandler();
    repo.create({ name: 'A', species: 'dog', age: 1 });
    const result = (await handler(
      makeV1Event({
        method: 'GET',
        path: '/pets',
        multiValueQuery: { limit: ['5'] },
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
  });

  it('decodes base64-encoded request bodies', async () => {
    const { handler } = buildHandler();
    const payload = JSON.stringify({ name: 'Enc', species: 'cat', age: 2 });
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(payload).toString('base64'),
        isBase64Encoded: true,
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(201);
    expect((bodyJson(result) as { name: string }).name).toBe('Enc');
  });

  it('handles ALB events (v1 shape with elb context)', async () => {
    const { handler, repo } = buildHandler();
    repo.create({ name: 'Alb', species: 'dog', age: 2 });
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets', asAlb: true }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
  });
});

describe('createLambdaHandler — v2 (HTTP API / Function URL)', () => {
  it('GET /pets/:id returns a v2 result shape', async () => {
    const { handler, repo } = buildHandler();
    const pet = repo.create({ name: 'Rex', species: 'dog', age: 5 });
    const result = (await handler(
      makeV2Event({ method: 'GET', path: `/pets/${pet.id}` }),
      makeContext(),
    )) as APIGatewayProxyResultV2;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
    expect(result.isBase64Encoded).toBe(false);
    expect((bodyJson(result) as { name: string }).name).toBe('Rex');
  });

  it('POST /pets works on v2', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV2Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'V2', species: 'cat', age: 4 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV2;
    expect(result.statusCode).toBe(201);
  });

  it('returns 404 for unknown route on v2', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV2Event({ method: 'GET', path: '/missing' }),
      makeContext(),
    )) as APIGatewayProxyResultV2;
    expect(result.statusCode).toBe(404);
  });
});

describe('createLambdaHandler — t.empty() responses', () => {
  it('DELETE returns 204 with empty body and no content-type', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'DELETE',
        path: '/pets/00000000-0000-0000-0000-000000000001',
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(result.headers?.['content-type']).toBeUndefined();
  });
});

describe('createLambdaHandler — response validation safety net', () => {
  it('returns 500 with INTERNAL_ERROR when ctx.respond throws', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/bad' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(500);
    expect(bodyJson(result)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The server produced an invalid response.',
    });
  });
});

describe('createLambdaHandler — headers pass-through', () => {
  it('exposes request headers to the handler', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'GET',
        path: '/echo',
        headers: { 'x-trace-id': 'trace-xyz' },
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
    expect((bodyJson(result) as { traceId: string }).traceId).toBe('trace-xyz');
  });
});

describe('createLambdaHandler — services', () => {
  it('accepts a static services object', async () => {
    const repo = new InMemoryPetRepo();
    const handler = createLambdaHandler(buildRouter(), {
      services: { petRepo: repo },
    });
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
  });

  it('calls a sync factory per request', async () => {
    const repo = new InMemoryPetRepo();
    let calls = 0;
    const handler = createLambdaHandler(buildRouter(), {
      services: () => {
        calls++;
        return { petRepo: repo };
      },
    });

    await handler(makeV1Event({ method: 'GET', path: '/pets' }), makeContext());
    await handler(makeV1Event({ method: 'GET', path: '/pets' }), makeContext());
    await handler(makeV1Event({ method: 'GET', path: '/pets' }), makeContext());
    expect(calls).toBe(3);
  });

  it('supports async factories', async () => {
    const repo = new InMemoryPetRepo();
    const handler = createLambdaHandler(buildRouter(), {
      services: async () => {
        await Promise.resolve();
        return { petRepo: repo };
      },
    });
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/pets' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
  });

  it('passes the Lambda event to the factory for tenant resolution', async () => {
    const repo = new InMemoryPetRepo();
    const handler = createLambdaHandler(buildRouter(), {
      services: (event: LambdaEvent) => {
        const headers = (event as { headers?: Record<string, string | undefined> })
          .headers;
        return {
          petRepo: repo,
          tenantId: headers?.['x-tenant-id'] ?? 'default',
        };
      },
    });
    const result = (await handler(
      makeV1Event({
        method: 'GET',
        path: '/tenant',
        headers: { 'x-tenant-id': 'acme' },
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
    expect((bodyJson(result) as { tenantId: string }).tenantId).toBe('acme');
  });
});

describe('createLambdaHandler — basePath stripping', () => {
  it('strips the basePath prefix before matching', async () => {
    const repo = new InMemoryPetRepo();
    repo.create({ name: 'Base', species: 'dog', age: 1 });
    const handler = createLambdaHandler(buildRouter(), {
      services: { petRepo: repo },
      basePath: '/prod',
    });

    const ok = (await handler(
      makeV1Event({ method: 'GET', path: '/prod/pets' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(ok.statusCode).toBe(200);

    const notFound = (await handler(
      makeV1Event({ method: 'GET', path: '/pets-other' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(notFound.statusCode).toBe(404);
  });
});

describe('createLambdaHandler — beforeHandler', () => {
  it('short-circuits without invoking the main handler', async () => {
    let called = false;
    const ep = endpoint({
      name: 'protected',
      method: 'GET',
      path: '/protected',
      summary: 'x',
      beforeHandler: async (ctx) => {
        if (!ctx.rawHeaders['authorization']) {
          return {
            ok: false,
            response: ctx.respond[401]({
              code: 'UNAUTH',
              message: 'no',
            }),
          };
        }
        return { ok: true, state: { userId: 'u1' } };
      },
      responses: {
        200: {
          schema: t.model('OkPx', { userId: t.string() }),
          description: 'ok',
        },
        401: { schema: ApiError, description: 'unauth' },
      },
      handler: async (ctx) => {
        called = true;
        return ctx.respond[200]({ userId: ctx.state.userId });
      },
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const handler = createLambdaHandler(router);
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/protected' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;

    expect(result.statusCode).toBe(401);
    expect(bodyJson(result)).toMatchObject({ code: 'UNAUTH' });
    expect(called).toBe(false);
  });

  it('threads state into ctx.state on success', async () => {
    const ep = endpoint({
      name: 'whoami',
      method: 'GET',
      path: '/whoami',
      summary: 'x',
      beforeHandler: async () => ({ ok: true, state: { userId: 'bob-9' } }),
      responses: {
        200: {
          schema: t.model('Wami', { userId: t.string() }),
          description: 'ok',
        },
      },
      handler: async (ctx) => ctx.respond[200]({ userId: ctx.state.userId }),
    });
    const router = createRouter({ title: 'x', version: '1' });
    router.add(ep);

    const handler = createLambdaHandler(router);
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/whoami' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
    expect(bodyJson(result)).toEqual({ userId: 'bob-9' });
  });
});

describe('createLambdaHandler — handler throws unexpected error', () => {
  it('returns 500 INTERNAL_ERROR on v1 when handler throws', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/boom' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(500);
    expect(bodyJson(result)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The server produced an unexpected error.',
    });
  });

  it('returns 500 INTERNAL_ERROR on v2 when handler throws', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV2Event({ method: 'GET', path: '/boom' }),
      makeContext(),
    )) as APIGatewayProxyResultV2;
    expect(result.statusCode).toBe(500);
    expect(bodyJson(result)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The server produced an unexpected error.',
    });
  });
});

describe('createLambdaHandler — wrong content-type', () => {
  it('returns 400 VALIDATION_ERROR with invalid_content_type for text/plain on a JSON endpoint (v1)', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(400);
    const body = bodyJson(result) as {
      code: string;
      errors: Array<{ code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'invalid_content_type')).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR with invalid_content_type for text/plain on a JSON endpoint (v2)', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV2Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV2;
    expect(result.statusCode).toBe(400);
    const body = bodyJson(result) as {
      code: string;
      errors: Array<{ code: string }>;
    };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors.some((e) => e.code === 'invalid_content_type')).toBe(true);
  });

  it('accepts application/vnd.api+json as a valid JSON content-type', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({
        method: 'POST',
        path: '/pets',
        headers: { 'content-type': 'application/vnd.api+json' },
        body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
      }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(201);
  });
});

describe('createLambdaHandler — response headers from handler', () => {
  it('merges HandlerResponse.headers into the v1 response', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV1Event({ method: 'GET', path: '/with-headers' }),
      makeContext(),
    )) as APIGatewayProxyResultV1;
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['x-custom-header']).toBe('hello');
    expect(result.headers?.['x-request-id']).toBe('abc-123');
    expect((bodyJson(result) as { ok: boolean }).ok).toBe(true);
  });

  it('merges HandlerResponse.headers into the v2 response', async () => {
    const { handler } = buildHandler();
    const result = (await handler(
      makeV2Event({ method: 'GET', path: '/with-headers' }),
      makeContext(),
    )) as APIGatewayProxyResultV2;
    expect(result.statusCode).toBe(200);
    expect(result.headers?.['x-custom-header']).toBe('hello');
    expect(result.headers?.['x-request-id']).toBe('abc-123');
  });
});
