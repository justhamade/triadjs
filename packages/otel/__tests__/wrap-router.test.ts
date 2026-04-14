import { describe, it, expect, beforeEach } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import type { HandlerContext, HandlerResponse } from '@triadjs/core';
import { withOtelInstrumentation } from '../src/index.js';
import { createOtelHarness, type OtelTestHarness } from './test-helpers.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });

function buildCtx(): HandlerContext<
  unknown,
  unknown,
  unknown,
  unknown,
  { 200: { schema: typeof Pet; description: string } },
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
    } as never,
    state: {} as never,
  };
}

describe('withOtelInstrumentation — router-level integration', () => {
  let harness: OtelTestHarness;
  beforeEach(() => {
    harness = createOtelHarness();
    harness.reset();
  });

  it('wraps every endpoint in a multi-endpoint router', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
      endpoint({
        name: 'listPets',
        method: 'GET',
        path: '/pets',
        summary: 'List',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withOtelInstrumentation(router);

    for (const ep of router.allEndpoints()) {
      await ep.handler(buildCtx());
    }

    const spans = harness.spans();
    expect(spans).toHaveLength(2);
    expect(spans.map((s) => s.name).sort()).toEqual([
      'GET /pets',
      'GET /pets/:id',
    ]);
  });

  it('returns the same router instance it was given (mutation in place)', () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const result = withOtelInstrumentation(router);
    expect(result).toBe(router);
  });

  it('uses an explicit tracer when provided', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const { trace } = await import('@opentelemetry/api');
    const tracer = trace.getTracer('explicit-tracer');
    withOtelInstrumentation(router, { tracer });
    await router.allEndpoints()[0]!.handler(buildCtx());
    expect(harness.spans()).toHaveLength(1);
  });

  it('wraps endpoints declared inside bounded contexts', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.context('Pets', {}, (ctx) => {
      ctx.add(
        endpoint({
          name: 'getPet',
          method: 'GET',
          path: '/pets/:id',
          summary: 'Get',
          responses: { 200: { schema: Pet, description: 'OK' } },
          handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
        }),
      );
    });
    withOtelInstrumentation(router);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const span = harness.spans()[0]!;
    expect(span.attributes['triad.context']).toBe('Pets');
  });
});
