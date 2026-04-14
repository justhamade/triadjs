import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triadjs/core';
import type {
  BeforeHandlerContext,
  HandlerContext,
  HandlerResponse,
  ResponsesConfig,
} from '@triadjs/core';
import {
  withLoggingInstrumentation,
  getLogger,
} from '../src/index.js';
import { FakeLogger } from './fake-logger.js';

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

describe('withLoggingInstrumentation — beforeHandler wrapping', () => {
  it('makes getLogger() inside a beforeHandler return a child logger with endpoint context', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    let captured: Record<string, unknown> | undefined;
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => {
          getLogger().info('inside-before');
          captured = base.calls[base.calls.length - 1]?.context;
          return { ok: true, state: { userId: 'u1' } };
        },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    await router.allEndpoints()[0]!.beforeHandler!(rawBeforeCtx());

    expect(captured).toBeDefined();
    expect(captured!['triad.endpoint.name']).toBe('getPet');
    expect(captured!['triad.phase']).toBe('beforeHandler');
  });

  it('autoLog emits beforeHandler.start / beforeHandler.end for a passing beforeHandler', async () => {
    const base = new FakeLogger();
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
    withLoggingInstrumentation(router, { logger: base, autoLog: true });
    await router.allEndpoints()[0]!.beforeHandler!(rawBeforeCtx());

    const messages = base.calls.map((c) => c.message);
    expect(messages).toContain('beforeHandler.start');
    expect(messages).toContain('beforeHandler.end');
  });

  it('autoLog emits beforeHandler.shortcircuit with the response status', async () => {
    const base = new FakeLogger();
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
    withLoggingInstrumentation(router, { logger: base, autoLog: true });
    await router.allEndpoints()[0]!.beforeHandler!(rawBeforeCtx());

    const shortcircuit = base.calls.find(
      (c) => c.message === 'beforeHandler.shortcircuit',
    );
    expect(shortcircuit).toBeDefined();
    expect(shortcircuit!.context['http.status_code']).toBe(401);
  });

  it('emits beforeHandler.error and rethrows on throw', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => {
          throw new Error('kaboom');
        },
        handler: async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' }),
      }),
    );
    withLoggingInstrumentation(router, { logger: base, autoLog: true });
    await expect(
      router.allEndpoints()[0]!.beforeHandler!(rawBeforeCtx()),
    ).rejects.toThrow('kaboom');
    const err = base.calls.find((c) => c.message === 'beforeHandler.error');
    expect(err).toBeDefined();
    expect(err!.level).toBe('error');
    expect(err!.context['error']).toBe('kaboom');
  });

  it('is a no-op when no beforeHandler is declared', async () => {
    const base = new FakeLogger();
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
    withLoggingInstrumentation(router, { logger: base });
    expect(router.allEndpoints()[0]!.beforeHandler).toBeUndefined();
    // Main handler still works and AsyncLocalStorage scope remains clean.
    await router.allEndpoints()[0]!.handler(buildHandlerCtx());
  });

  it('main handler still runs in its own logger scope after a successful beforeHandler', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'getPet',
        method: 'GET',
        path: '/pets/:id',
        summary: 'Get',
        responses,
        beforeHandler: async () => ({ ok: true, state: { userId: 'u1' } }),
        handler: async (ctx) => {
          getLogger().info('inside-handler');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    await router.allEndpoints()[0]!.beforeHandler!(rawBeforeCtx());
    await router.allEndpoints()[0]!.handler(buildHandlerCtx());
    const inside = base.calls.find((c) => c.message === 'inside-handler');
    expect(inside).toBeDefined();
    // The handler's scope should NOT carry the beforeHandler phase tag.
    expect(inside!.context['triad.phase']).toBeUndefined();
    expect(inside!.context['triad.endpoint.name']).toBe('getPet');
  });
});
