import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import type { HandlerContext, HandlerResponse } from '@triad/core';
import { SpanStatusCode } from '@opentelemetry/api';
import { withOtelInstrumentation } from '../src/index.js';
import { createOtelHarness, type OtelTestHarness } from './test-helpers.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });
const ApiError = t.model('ApiError', { message: t.string() });

function makeEndpoint(
  overrides: {
    name?: string;
    path?: string;
    handler?: (
      ctx: HandlerContext<unknown, unknown, unknown, unknown, typeof responses, unknown>,
    ) => Promise<HandlerResponse>;
  } = {},
) {
  const responses = {
    200: { schema: Pet, description: 'OK' },
    404: { schema: ApiError, description: 'Not found' },
    500: { schema: ApiError, description: 'Boom' },
  } as const;
  return endpoint({
    name: overrides.name ?? 'getPet',
    method: 'GET',
    path: overrides.path ?? '/pets/:id',
    summary: 'Get a pet',
    responses,
    handler:
      overrides.handler ??
      (async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' })),
  });
}

// Locally scoped responses object used by the factory's type annotation.
const responses = {
  200: { schema: Pet, description: 'OK' },
  404: { schema: ApiError, description: 'Not found' },
  500: { schema: ApiError, description: 'Boom' },
} as const;

function buildCtx(): HandlerContext<
  unknown,
  unknown,
  unknown,
  unknown,
  typeof responses,
  unknown
> {
  return {
    params: {} as never,
    query: {} as never,
    body: undefined as never,
    headers: {} as never,
    services: {},
    respond: {
      200: (data: unknown): HandlerResponse => ({ status: 200, body: data }),
      404: (data: unknown): HandlerResponse => ({ status: 404, body: data }),
      500: (data: unknown): HandlerResponse => ({ status: 500, body: data }),
    } as never,
    state: {} as never,
  };
}

describe('withOtelInstrumentation — endpoint handler wrapping', () => {
  let harness: OtelTestHarness;
  beforeEach(() => {
    harness = createOtelHarness();
    harness.reset();
  });

  it('creates one span per handler invocation with method and route attributes', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withOtelInstrumentation(router);

    const ep = router.allEndpoints()[0]!;
    await ep.handler(buildCtx());

    const spans = harness.spans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe('GET /pets/:id');
    expect(span.attributes['http.method']).toBe('GET');
    expect(span.attributes['http.route']).toBe('/pets/:id');
    expect(span.attributes['triad.endpoint.name']).toBe('getPet');
  });

  it('uses endpoint.name in the span name when includeEndpointNameInSpanName is true (default)', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint({ name: 'fetchPet' }));
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.endpoint.name']).toBe('fetchPet');
  });

  it('records http.status_code from the handler response', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => ctx.respond[404]({ message: 'nope' }),
      }),
    );
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['http.status_code']).toBe(404);
    // 404 is still OK — only 5xx is ERROR
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it('marks 5xx responses as ERROR span status', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => ctx.respond[500]({ message: 'boom' }),
      }),
    );
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['http.status_code']).toBe(500);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('records exceptions thrown from the handler and rethrows', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async () => {
          throw new Error('kaboom');
        },
      }),
    );
    withOtelInstrumentation(router);

    await expect(router.allEndpoints()[0]!.handler(buildCtx())).rejects.toThrow(
      'kaboom',
    );
    const span = harness.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe('kaboom');
    expect(span.events.some((e) => e.name === 'exception')).toBe(true);
  });

  it('extracts user id from state via includeUserFromState', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withOtelInstrumentation(router, {
      includeUserFromState: (state) =>
        (state as { user?: { id: string } }).user?.id,
    });
    const ctx = buildCtx();
    (ctx as { state: unknown }).state = { user: { id: 'user-42' } };
    await router.allEndpoints()[0]!.handler(ctx);
    const span = harness.spans()[0]!;
    expect(span.attributes['enduser.id']).toBe('user-42');
  });

  it('skips enduser.id when includeUserFromState returns undefined', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withOtelInstrumentation(router, {
      includeUserFromState: () => undefined,
    });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['enduser.id']).toBeUndefined();
  });

  it('attaches staticAttributes to every span', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withOtelInstrumentation(router, {
      staticAttributes: { env: 'test', region: 'us-east-1' },
    });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['env']).toBe('test');
    expect(span.attributes['region']).toBe('us-east-1');
  });

  it('tags bounded context name via triad.context when endpoint is in a context', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.context('Pets', {}, (ctx) => {
      ctx.add(makeEndpoint());
    });
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.context']).toBe('Pets');
  });

  it('leaves triad.context empty for root endpoints', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.context']).toBe('');
  });
});
