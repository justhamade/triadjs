import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import type { HandlerContext, HandlerResponse } from '@triad/core';
import {
  withLoggingInstrumentation,
  getLogger,
  tryGetLogger,
} from '../src/index.js';
import { FakeLogger } from './fake-logger.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });
const ApiError = t.model('ApiError', { message: t.string() });

const responses = {
  200: { schema: Pet, description: 'OK' },
  404: { schema: ApiError, description: 'Not found' },
  500: { schema: ApiError, description: 'Boom' },
} as const;

function makeEndpoint(
  overrides: {
    name?: string;
    handler?: (
      ctx: HandlerContext<unknown, unknown, unknown, unknown, typeof responses, unknown>,
    ) => Promise<HandlerResponse>;
  } = {},
) {
  return endpoint({
    name: overrides.name ?? 'getPet',
    method: 'GET',
    path: '/pets/:id',
    summary: 'Get a pet',
    responses,
    handler:
      overrides.handler ??
      (async (ctx) => ctx.respond[200]({ id: '1', name: 'Rex' })),
  });
}

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

describe('withLoggingInstrumentation — endpoint wrapping', () => {
  it('makes getLogger() inside handler return a child logger with endpoint context', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    let captured: Record<string, unknown> | undefined;
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          const log = getLogger();
          log.info('inside');
          captured = base.calls[base.calls.length - 1]?.context;
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    await router.allEndpoints()[0]!.handler(buildCtx());

    expect(captured).toBeDefined();
    expect(captured!['triad.endpoint.name']).toBe('getPet');
    expect(captured!['triad.endpoint.method']).toBe('GET');
    expect(captured!['triad.endpoint.path']).toBe('/pets/:id');
    expect(captured!['triad.context']).toBe('');
  });

  it('getLogger() throws when called outside a wrapped handler', () => {
    expect(() => getLogger()).toThrow(/outside/i);
  });

  it('tryGetLogger() returns undefined outside a wrapped handler', () => {
    expect(tryGetLogger()).toBeUndefined();
  });

  it('autoLog: true emits handler.start and handler.end lines', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(makeEndpoint());
    withLoggingInstrumentation(router, { logger: base, autoLog: true });
    await router.allEndpoints()[0]!.handler(buildCtx());

    const messages = base.calls.map((c) => c.message);
    expect(messages).toContain('handler.start');
    expect(messages).toContain('handler.end');
    const endCall = base.calls.find((c) => c.message === 'handler.end')!;
    expect(endCall.context['http.status_code']).toBe(200);
  });

  it('autoLog: true emits handler.error and rethrows when handler throws', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async () => {
          throw new Error('kaboom');
        },
      }),
    );
    withLoggingInstrumentation(router, { logger: base, autoLog: true });

    await expect(router.allEndpoints()[0]!.handler(buildCtx())).rejects.toThrow(
      'kaboom',
    );
    const err = base.calls.find((c) => c.message === 'handler.error');
    expect(err).toBeDefined();
    expect(err!.level).toBe('error');
    expect(err!.context['error']).toBe('kaboom');
  });

  it('extracts user id from state via includeUserFromState', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          getLogger().info('inside');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, {
      logger: base,
      includeUserFromState: (state) =>
        (state as { user?: { id: string } }).user?.id,
    });
    const ctx = buildCtx();
    (ctx as { state: unknown }).state = { user: { id: 'user-42' } };
    await router.allEndpoints()[0]!.handler(ctx);
    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['user.id']).toBe('user-42');
  });

  it('calls requestId extractor and attaches request.id', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          getLogger().info('inside');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, {
      logger: base,
      requestId: () => 'req-123',
    });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['request.id']).toBe('req-123');
  });

  it('omits user.id and request.id when extractors return undefined', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          getLogger().info('inside');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, {
      logger: base,
      requestId: () => undefined,
      includeUserFromState: () => undefined,
    });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['user.id']).toBeUndefined();
    expect(inside.context['request.id']).toBeUndefined();
  });

  it('staticFields are included on every log call inside the request', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          getLogger().info('inside');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, {
      logger: base,
      staticFields: { env: 'test', region: 'us-east-1' },
    });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['env']).toBe('test');
    expect(inside.context['region']).toBe('us-east-1');
  });

  it('tags bounded context name via triad.context', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.context('Pets', {}, (ctx) => {
      ctx.add(
        makeEndpoint({
          handler: async (c) => {
            getLogger().info('inside');
            return c.respond[200]({ id: '1', name: 'Rex' });
          },
        }),
      );
    });
    withLoggingInstrumentation(router, { logger: base });
    await router.allEndpoints()[0]!.handler(buildCtx());
    const inside = base.calls.find((c) => c.message === 'inside')!;
    expect(inside.context['triad.context']).toBe('Pets');
  });

  it('logger remains accessible across await boundaries inside the handler', async () => {
    const base = new FakeLogger();
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      makeEndpoint({
        handler: async (ctx) => {
          await new Promise((r) => setTimeout(r, 1));
          getLogger().info('after-await');
          return ctx.respond[200]({ id: '1', name: 'Rex' });
        },
      }),
    );
    withLoggingInstrumentation(router, { logger: base });
    await router.allEndpoints()[0]!.handler(buildCtx());
    expect(base.calls.find((c) => c.message === 'after-await')).toBeDefined();
  });
});
