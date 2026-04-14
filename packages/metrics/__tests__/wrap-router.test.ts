import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, channel, t } from '@triadjs/core';
import type { HandlerContext, HandlerResponse } from '@triadjs/core';
import {
  createMetricsCollector,
  withMetricsInstrumentation,
} from '../src/index.js';

const Pet = t.model('Pet', { id: t.string(), name: t.string() });
const ApiError = t.model('ApiError', { message: t.string() });

function buildCtx(): HandlerContext<
  unknown,
  unknown,
  unknown,
  unknown,
  never,
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

describe('withMetricsInstrumentation', () => {
  it('records one request per endpoint invocation', async () => {
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
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    await router.allEndpoints()[0]!.handler(buildCtx());

    const snap = collector.snapshot();
    expect(snap.totalRequests).toBe(1);
    const series = snap.series[0]!;
    expect(series.labels['method']).toBe('GET');
    expect(series.labels['route']).toBe('/pets/:id');
    expect(series.labels['status']).toBe('200');
    expect(series.labels['context']).toBe('');
  });

  it('records per-endpoint series across multiple endpoints', async () => {
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
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    for (const ep of router.allEndpoints()) {
      await ep.handler(buildCtx());
    }
    expect(collector.snapshot().series).toHaveLength(2);
  });

  it('labels context name for endpoints in bounded contexts', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.context('Library', {}, (ctx) => {
      ctx.add(
        endpoint({
          name: 'listBooks',
          method: 'GET',
          path: '/books',
          summary: 'list',
          responses: { 200: { schema: Pet, description: 'OK' } },
          handler: async (c) => c.respond[200]({ id: '1', name: 'Rex' }),
        }),
      );
    });
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    await router.allEndpoints()[0]!.handler(buildCtx());
    expect(collector.snapshot().series[0]!.labels['context']).toBe('Library');
  });

  it('records an error and rethrows on thrown handler', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'broken',
        method: 'POST',
        path: '/x',
        summary: 'b',
        responses: {
          200: { schema: Pet, description: 'OK' },
          500: { schema: ApiError, description: 'oops' },
        },
        handler: async () => {
          throw new Error('boom');
        },
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);

    await expect(router.allEndpoints()[0]!.handler(buildCtx())).rejects.toThrow(
      'boom',
    );
    const snap = collector.snapshot();
    expect(snap.totalErrors).toBe(1);
    const series = snap.series[0]!;
    expect(series.labels['status']).toBe('500');
    expect(series.errorCount).toBe(1);
  });

  it('measures latency with non-negative values', async () => {
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      endpoint({
        name: 'slow',
        method: 'GET',
        path: '/slow',
        summary: 's',
        responses: { 200: { schema: Pet, description: 'OK' } },
        handler: async (ctx) => {
          await new Promise((r) => setTimeout(r, 5));
          return ctx.respond[200]({ id: '1', name: 'x' });
        },
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    await router.allEndpoints()[0]!.handler(buildCtx());
    const series = collector.snapshot().series[0]!;
    expect(series.sum).toBeGreaterThan(0);
    expect(series.sum).toBeLessThan(1); // generous upper bound
  });

  it('returns the same router instance (mutation in place)', () => {
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
    const collector = createMetricsCollector();
    const result = withMetricsInstrumentation(router, collector);
    expect(result).toBe(router);
  });

  it('wraps channel message handlers when instrumentChannels is true', async () => {
    const ChatMessage = t.model('ChatMessage', {
      text: t.string(),
      userId: t.string(),
    });
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      channel({
        name: 'chat',
        path: '/ws',
        summary: 'c',
        clientMessages: {
          message: { schema: ChatMessage, description: 'c' },
        },
        serverMessages: {
          message: { schema: ChatMessage, description: 's' },
        },
        handlers: {
          message: async () => {
            /* noop */
          },
        },
      }),
    );
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector, { instrumentChannels: true });
    const ch = router.allChannels()[0]!;
    await ch.handlers['message']!({ state: {} }, { text: 'hi', userId: '1' });
    const text = collector.render();
    expect(text).toContain('triad_channel_message_duration_seconds');
    expect(text).toContain('channel="chat"');
    expect(text).toContain('messageType="message"');
  });

  it('leaves channel handlers alone when instrumentChannels is false (default)', () => {
    const ChatMessage = t.model('ChatMessage', {
      text: t.string(),
      userId: t.string(),
    });
    const router = createRouter({ title: 'T', version: '1' });
    router.add(
      channel({
        name: 'chat',
        path: '/ws',
        summary: 'c',
        clientMessages: {
          message: { schema: ChatMessage, description: 'c' },
        },
        serverMessages: {
          message: { schema: ChatMessage, description: 's' },
        },
        handlers: {
          message: async () => {
            /* noop */
          },
        },
      }),
    );
    const originalHandler = router.allChannels()[0]!.handlers['message'];
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    expect(router.allChannels()[0]!.handlers['message']).toBe(originalHandler);
  });
});
