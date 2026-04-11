import { describe, expect, it, expectTypeOf } from 'vitest';
import { t } from '../src/schema/index.js';
import { endpoint } from '../src/endpoint.js';
import { scenario } from '../src/behavior.js';
import { buildRespondMap, type ResponsesConfig } from '../src/context.js';
import { ValidationException } from '../src/schema/types.js';
import { ModelSchema } from '../src/schema/model.js';
import {
  invokeBeforeHandler,
  type BeforeHandler,
  type BeforeHandlerContext,
} from '../src/before-handler.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').identity(),
  name: t.string().minLength(1),
  species: t.enum('dog', 'cat', 'bird', 'fish'),
  age: t.int32().min(0).max(100),
});

const CreatePet = Pet.pick('name', 'species', 'age').named('CreatePet');

const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

describe('endpoint() — basic construction', () => {
  const createPet = endpoint({
    name: 'createPet',
    method: 'POST',
    path: '/pets',
    summary: 'Create a new pet',
    description: 'Adds a new pet to the store',
    tags: ['Pets'],
    request: { body: CreatePet },
    responses: {
      201: { schema: Pet, description: 'Pet created' },
      400: { schema: ApiError, description: 'Validation error' },
    },
    handler: async (ctx) => {
      return ctx.respond[201]({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: ctx.body.name,
        species: ctx.body.species,
        age: ctx.body.age,
      });
    },
    behaviors: [
      scenario('Pets can be created')
        .given('a valid payload')
        .body({ name: 'Buddy', species: 'dog', age: 3 })
        .when('I create a pet')
        .then('response status is 201'),
    ],
  });

  it('captures name, method, path, summary, description, tags', () => {
    expect(createPet.name).toBe('createPet');
    expect(createPet.method).toBe('POST');
    expect(createPet.path).toBe('/pets');
    expect(createPet.summary).toBe('Create a new pet');
    expect(createPet.description).toBe('Adds a new pet to the store');
    expect(createPet.tags).toEqual(['Pets']);
  });

  it('stores the body schema as-is', () => {
    expect(createPet.request.body).toBe(CreatePet);
  });

  it('stores the responses config', () => {
    expect(createPet.responses[201]?.schema).toBe(Pet);
    expect(createPet.responses[400]?.schema).toBe(ApiError);
  });

  it('stores behaviors', () => {
    expect(createPet.behaviors).toHaveLength(1);
    expect(createPet.behaviors[0]?.scenario).toBe('Pets can be created');
  });

  it('defaults missing optional fields', () => {
    const minimal = endpoint({
      name: 'ping',
      method: 'GET',
      path: '/ping',
      summary: 'Ping',
      responses: { 200: { schema: t.string(), description: 'pong' } },
      handler: async (ctx) => ctx.respond[200]('pong'),
    });
    expect(minimal.tags).toEqual([]);
    expect(minimal.behaviors).toEqual([]);
    expect(minimal.description).toBeUndefined();
  });
});

describe('endpoint() — inline request shapes are normalized to anonymous ModelSchemas', () => {
  const getPet = endpoint({
    name: 'getPet',
    method: 'GET',
    path: '/pets/:id',
    summary: 'Get a pet by ID',
    request: {
      params: {
        id: t.string().format('uuid'),
      },
      query: {
        includeDeleted: t.boolean().default(false),
      },
      headers: {
        authorization: t.string(),
      },
    },
    responses: {
      200: { schema: Pet, description: 'Found' },
      404: { schema: ApiError, description: 'Not found' },
    },
    handler: async (ctx) => {
      if (ctx.params.id === 'missing') {
        return ctx.respond[404]({ code: 'NOT_FOUND', message: 'Pet not found' });
      }
      return ctx.respond[200]({
        id: ctx.params.id,
        name: 'Buddy',
        species: 'dog',
        age: 3,
      });
    },
  });

  it('wraps inline params into an anonymous ModelSchema', () => {
    expect(getPet.request.params).toBeInstanceOf(ModelSchema);
    expect(getPet.request.params?.name).toBe('getPetParams');
    expect('id' in (getPet.request.params?.shape ?? {})).toBe(true);
  });

  it('wraps inline query into an anonymous ModelSchema', () => {
    expect(getPet.request.query).toBeInstanceOf(ModelSchema);
    expect(getPet.request.query?.name).toBe('getPetQuery');
  });

  it('wraps inline headers into an anonymous ModelSchema', () => {
    expect(getPet.request.headers).toBeInstanceOf(ModelSchema);
    expect(getPet.request.headers?.name).toBe('getPetHeaders');
  });

  it('passes through an already-named ModelSchema for params', () => {
    const PetIdParams = t.model('PetIdParams', { id: t.string().format('uuid') });
    const ep = endpoint({
      name: 'getPet2',
      method: 'GET',
      path: '/pets/:id',
      summary: 'Get pet',
      request: { params: PetIdParams },
      responses: { 200: { schema: Pet, description: 'OK' } },
      handler: async (ctx) => ctx.respond[200]({
        id: ctx.params.id,
        name: 'x',
        species: 'dog',
        age: 1,
      }),
    });
    expect(ep.request.params).toBe(PetIdParams);
  });
});

describe('endpoint() — type-safe ctx.respond', () => {
  it('respond validates outgoing payloads against the schema', async () => {
    const ep = endpoint({
      name: 'validatedEndpoint',
      method: 'POST',
      path: '/test',
      summary: 'Test',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: 'not-a-uuid', // invalid!
        name: 'Buddy',
        species: 'dog',
        age: 3,
      }),
    });

    const respond = buildRespondMap(ep.responses);
    const ctx = {
      params: {},
      query: {},
      body: { name: 'Buddy', species: 'dog' as const, age: 3 },
      headers: {},
      services: {},
      respond,
    };
    await expect(ep.handler(ctx as never)).rejects.toThrow(ValidationException);
  });

  it('respond returns { status, body } with validated body', async () => {
    const ep = endpoint({
      name: 'okEndpoint',
      method: 'POST',
      path: '/test',
      summary: 'Test',
      request: { body: CreatePet },
      responses: {
        201: { schema: Pet, description: 'Created' },
      },
      handler: async (ctx) => ctx.respond[201]({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: ctx.body.name,
        species: ctx.body.species,
        age: ctx.body.age,
      }),
    });

    const respond = buildRespondMap(ep.responses);
    const ctx = {
      params: {},
      query: {},
      body: { name: 'Buddy', species: 'dog' as const, age: 3 },
      headers: {},
      services: {},
      respond,
    };
    const result = await ep.handler(ctx as never);
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ name: 'Buddy', species: 'dog', age: 3 });
  });
});

describe('endpoint() — type inference for ctx', () => {
  it('ctx.body is typed from CreatePet', () => {
    endpoint({
      name: 'typecheck1',
      method: 'POST',
      path: '/t',
      summary: 't',
      request: { body: CreatePet },
      responses: { 201: { schema: Pet, description: 'ok' } },
      handler: async (ctx) => {
        expectTypeOf(ctx.body).toMatchTypeOf<{
          name: string;
          species: 'dog' | 'cat' | 'bird' | 'fish';
          age: number;
        }>();
        return ctx.respond[201]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: ctx.body.name,
          species: ctx.body.species,
          age: ctx.body.age,
        });
      },
    });
  });

  it('ctx.params is typed from an inline shape', () => {
    endpoint({
      name: 'typecheck2',
      method: 'GET',
      path: '/t/:id',
      summary: 't',
      request: { params: { id: t.string() } },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) => {
        expectTypeOf(ctx.params).toMatchTypeOf<{ id: string }>();
        return ctx.respond[200]({
          id: ctx.params.id,
          name: 'x',
          species: 'dog',
          age: 1,
        });
      },
    });
  });

  it('ctx.respond[204] for t.empty() is a zero-arg function', () => {
    endpoint({
      name: 'typecheckEmpty',
      method: 'DELETE',
      path: '/t/:id',
      summary: 't',
      request: { params: { id: t.string() } },
      responses: {
        204: { schema: t.empty(), description: 'deleted' },
        404: { schema: ApiError, description: 'not found' },
      },
      handler: async (ctx) => {
        expectTypeOf(ctx.respond[204]).parameters.toEqualTypeOf<[]>();
        expectTypeOf(ctx.respond[404]).parameters.toMatchTypeOf<
          [{ code: string; message: string }]
        >();
        if (ctx.params.id === 'missing') {
          return ctx.respond[404]({ code: 'NOT_FOUND', message: 'x' });
        }
        return ctx.respond[204]();
      },
    });
  });

  it('buildRespondMap produces a zero-arg responder for t.empty() at runtime', async () => {
    const ep = endpoint({
      name: 'deleteThing',
      method: 'DELETE',
      path: '/things/:id',
      summary: 'Delete',
      request: { params: { id: t.string() } },
      responses: {
        204: { schema: t.empty(), description: 'deleted' },
      },
      handler: async (ctx) => ctx.respond[204](),
    });

    const respond = buildRespondMap(ep.responses);
    const result = await ep.handler({
      params: { id: 'abc' },
      query: {},
      body: undefined,
      headers: {},
      services: {},
      respond,
    } as never);
    expect(result.status).toBe(204);
    expect(result.body).toBeUndefined();
  });

  it('ctx.state defaults to {} when no beforeHandler is declared', () => {
    endpoint({
      name: 'noBeforeHandler',
      method: 'GET',
      path: '/t',
      summary: 't',
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) => {
        // ctx.state is the default empty-object type
        expectTypeOf(ctx.state).toEqualTypeOf<Readonly<{}>>();
        // @ts-expect-error — state has no declared properties
        ctx.state.user;
        return ctx.respond[200]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'x',
          species: 'dog',
          age: 1,
        });
      },
    });
  });

  it('ctx.state is typed from the beforeHandler return type', () => {
    endpoint({
      name: 'withBeforeHandler',
      method: 'GET',
      path: '/t',
      summary: 't',
      responses: {
        200: { schema: Pet, description: 'ok' },
        401: { schema: ApiError, description: 'unauth' },
      },
      beforeHandler: async (ctx) => {
        if (!ctx.rawHeaders['authorization']) {
          return {
            ok: false,
            response: ctx.respond[401]({
              code: 'UNAUTHENTICATED',
              message: 'x',
            }),
          };
        }
        return {
          ok: true,
          state: { user: { id: 'u1', email: 'a@b.c' } },
        };
      },
      handler: async (ctx) => {
        expectTypeOf(ctx.state.user).toEqualTypeOf<{
          id: string;
          email: string;
        }>();
        return ctx.respond[200]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: ctx.state.user.email,
          species: 'dog',
          age: 1,
        });
      },
    });
  });

  it('ctx.respond only exposes declared status codes', () => {
    endpoint({
      name: 'typecheck3',
      method: 'GET',
      path: '/t',
      summary: 't',
      responses: {
        200: { schema: Pet, description: 'ok' },
        404: { schema: ApiError, description: 'not found' },
      },
      handler: async (ctx) => {
        expectTypeOf(ctx.respond[200]).toBeFunction();
        expectTypeOf(ctx.respond[404]).toBeFunction();
        // @ts-expect-error — 500 is not declared
        ctx.respond[500]?.({ code: 'X', message: 'Y' });
        return ctx.respond[404]({ code: 'NOT_FOUND', message: 'missing' });
      },
    });
  });
});

describe('endpoint() — beforeHandler runtime', () => {
  const makeBeforeCtx = (
    overrides: Partial<BeforeHandlerContext<typeof responses>> = {},
  ): BeforeHandlerContext<typeof responses> => ({
    rawHeaders: {},
    rawQuery: {},
    rawParams: {},
    rawCookies: {},
    services: {},
    respond: buildRespondMap(responses) as never,
    ...overrides,
  });

  const responses = {
    200: { schema: Pet, description: 'ok' },
    401: { schema: ApiError, description: 'unauth' },
  } as const;

  it('stores the beforeHandler on the runtime endpoint', () => {
    const before: BeforeHandler<{ userId: string }, typeof responses> = async () => ({
      ok: true,
      state: { userId: 'u1' },
    });
    const ep = endpoint({
      name: 'withBefore',
      method: 'GET',
      path: '/t',
      summary: 't',
      beforeHandler: before,
      responses,
      handler: async (ctx) =>
        ctx.respond[200]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: ctx.state.userId,
          species: 'dog',
          age: 1,
        }),
    });
    expect(ep.beforeHandler).toBeDefined();
  });

  it('endpoint without beforeHandler has no beforeHandler field', () => {
    const ep = endpoint({
      name: 'noBefore',
      method: 'GET',
      path: '/t',
      summary: 't',
      responses,
      handler: async (ctx) =>
        ctx.respond[200]({
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'x',
          species: 'dog',
          age: 1,
        }),
    });
    expect(ep.beforeHandler).toBeUndefined();
  });

  it('invokeBeforeHandler returns empty success when no hook is present', async () => {
    const result = await invokeBeforeHandler(undefined, makeBeforeCtx());
    expect(result).toEqual({ ok: true, state: {} });
  });

  it('invokeBeforeHandler forwards the hook result on success', async () => {
    const before: BeforeHandler<{ u: number }, typeof responses> = async () => ({
      ok: true,
      state: { u: 42 },
    });
    const result = await invokeBeforeHandler(
      before as unknown as BeforeHandler<unknown, ResponsesConfig>,
      makeBeforeCtx() as unknown as BeforeHandlerContext<ResponsesConfig>,
    );
    expect(result).toEqual({ ok: true, state: { u: 42 } });
  });

  it('invokeBeforeHandler forwards a short-circuit result unchanged', async () => {
    const before: BeforeHandler<{ u: number }, typeof responses> = async (ctx) => ({
      ok: false,
      response: ctx.respond[401]({ code: 'UNAUTHENTICATED', message: 'no' }),
    });
    const result = await invokeBeforeHandler(
      before as unknown as BeforeHandler<unknown, ResponsesConfig>,
      makeBeforeCtx() as unknown as BeforeHandlerContext<ResponsesConfig>,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
});
