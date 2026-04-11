import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import type {
  BeforeHandlerContext,
  HandlerContext,
  HandlerResponse,
  ResponsesConfig,
} from '@triad/core';
import {
  createMetricsCollector,
  withMetricsInstrumentation,
} from '../src/index.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });
const ApiError = t.model('ApiError', { message: t.string() });

const responses = {
  200: { schema: Pet, description: 'OK' },
  401: { schema: ApiError, description: 'Unauthorized' },
} as const;

function rawBeforeCtx(): BeforeHandlerContext<ResponsesConfig> {
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

function buildHandlerCtx(): HandlerContext<
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
      401: (data: unknown): HandlerResponse => ({ status: 401, body: data }),
    } as never,
    state: {} as never,
  };
}

describe('withMetricsInstrumentation — beforeHandler wrapping', () => {
  it('records a beforeHandler observation with outcome="ok" on success', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => ({ ok: true, state: { userId: 'u1' } }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    const ep = router.allEndpoints()[0]!;
    const result = await ep.beforeHandler!(rawBeforeCtx());
    expect(result.ok).toBe(true);

    const text = collector.render();
    expect(text).toContain('triad_http_before_handler_duration_seconds');
    expect(text).toContain('outcome="ok"');
    expect(text).toContain('route="/pets/:id"');
  });

  it('records outcome="shortcircuit" when beforeHandler returns ok:false', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async (ctx) => ({
          ok: false,
          response: ctx.respond[401]({ message: 'no token' }),
        }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    const ep = router.allEndpoints()[0]!;
    await ep.beforeHandler!(rawBeforeCtx());
    const text = collector.render();
    expect(text).toContain('outcome="shortcircuit"');
  });

  it('records outcome="error" when beforeHandler throws, and rethrows', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => {
          throw new Error('boom');
        },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    const ep = router.allEndpoints()[0]!;
    await expect(ep.beforeHandler!(rawBeforeCtx())).rejects.toThrow('boom');
    const text = collector.render();
    expect(text).toContain('outcome="error"');
  });

  it('is a no-op when no beforeHandler is declared', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    expect(router.allEndpoints()[0]!.beforeHandler).toBeUndefined();
    // Run the main handler — the metrics output should not contain any
    // before-handler histogram family.
    await router.allEndpoints()[0]!.handler(buildHandlerCtx());
    expect(collector.render()).not.toContain(
      'triad_http_before_handler_duration_seconds',
    );
  });

  it('main handler runs with the beforeHandler unchanged outside the wrapper', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => ({ ok: true, state: { userId: 'u1' } }),
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    const ep = router.allEndpoints()[0]!;
    // beforeHandler + main handler both run, and both observations land
    // in the collector.
    await ep.beforeHandler!(rawBeforeCtx());
    await ep.handler(buildHandlerCtx());
    const snap = collector.snapshot();
    expect(snap.totalRequests).toBe(1);
    const text = collector.render();
    expect(text).toContain('triad_http_before_handler_duration_seconds');
    expect(text).toContain('triad_http_request_duration_seconds');
  });
});
