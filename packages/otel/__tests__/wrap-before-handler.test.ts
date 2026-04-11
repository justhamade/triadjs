import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import type { BeforeHandlerContext, ResponsesConfig } from '@triad/core';
import { SpanStatusCode } from '@opentelemetry/api';
import { withOtelInstrumentation } from '../src/index.js';
import { createOtelHarness, type OtelTestHarness } from './test-helpers.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });
const ApiError = t.model('ApiError', { message: t.string() });

function rawCtx(): BeforeHandlerContext<ResponsesConfig> {
  return {
    rawHeaders: {},
    rawQuery: {},
    rawParams: {},
    rawCookies: {},
    services: {},
    respond: {
      401: (data: unknown) => ({ status: 401, body: data }),
    } as never,
  };
}

describe('withOtelInstrumentation — beforeHandler wrapping', () => {
  let harness: OtelTestHarness;
  beforeEach(() => {
    harness = createOtelHarness();
    harness.reset();
  });

  it('creates a span for beforeHandler when it short-circuits', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get a pet',
        responses: {
          200: { schema: Pet, description: 'OK' },
          401: { schema: ApiError, description: 'Unauthorized' },
        },
        beforeHandler: async (ctx) => ({
          ok: false,
          response: ctx.respond[401]({ message: 'no token' }),
        }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);

    const ep = router.allEndpoints()[0]!;
    const result = await ep.beforeHandler!(rawCtx());
    expect(result.ok).toBe(false);

    const spans = harness.spans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe('getPet.beforeHandler');
    expect(spans[0]!.attributes['triad.endpoint.name']).toBe('getPet');
    expect(spans[0]!.status.code).toBe(SpanStatusCode.OK);
  });

  it('records exception when beforeHandler throws', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get a pet',
        responses: { 200: { schema: Pet, description: 'OK' } },
        beforeHandler: async () => {
          throw new Error('auth-broken');
        },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);

    await expect(
      router.allEndpoints()[0]!.beforeHandler!(rawCtx()),
    ).rejects.toThrow('auth-broken');
    const span = harness.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('tags the span with triad.beforeHandler.outcome="shortcircuit" on reject', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get a pet',
        responses: {
          200: { schema: Pet, description: 'OK' },
          401: { schema: ApiError, description: 'Unauthorized' },
        },
        beforeHandler: async (ctx) => ({
          ok: false,
          response: ctx.respond[401]({ message: 'no token' }),
        }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.beforeHandler!(rawCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.beforeHandler.outcome']).toBe('shortcircuit');
    expect(span.attributes['http.status_code']).toBe(401);
  });

  it('tags the span with triad.beforeHandler.outcome="ok" on success', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get a pet',
        responses: { 200: { schema: Pet, description: 'OK' } },
        beforeHandler: async () => ({ ok: true, state: { userId: 'u1' } }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);
    const result = await router.allEndpoints()[0]!.beforeHandler!(rawCtx());
    expect(result.ok).toBe(true);
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.beforeHandler.outcome']).toBe('ok');
  });

  it('is a no-op when no beforeHandler is declared', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get a pet',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);
    expect(router.allEndpoints()[0]!.beforeHandler).toBeUndefined();
  });
});
