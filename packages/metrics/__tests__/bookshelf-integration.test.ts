import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import type { HandlerContext, HandlerResponse } from '@triad/core';
import {
  createMetricsCollector,
  withMetricsInstrumentation,
  renderMetrics,
} from '../src/index.js';

const Book = t.model('Book', { id: t.string(), title: t.string() });
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
      201: (data: unknown): HandlerResponse => ({ status: 201, body: data }),
      404: (data: unknown): HandlerResponse => ({ status: 404, body: data }),
    } as never,
    state: {} as never,
  };
}

function buildBookshelfLikeRouter() {
  const router = createRouter({ title: 'Bookshelf', version: '1.0.0' });
  router.context('Library', {}, (ctx) => {
    ctx.add(
      endpoint({
        name: 'listBooks',
        method: 'GET',
        path: '/books',
        summary: 'List',
        responses: { 200: { schema: Book, description: 'OK' } },
        handler: async (c) => c.respond[200]({ id: '1', title: 'Dune' }),
      }),
      endpoint({
        name: 'getBook',
        method: 'GET',
        path: '/books/:bookId',
        summary: 'Get',
        responses: {
          200: { schema: Book, description: 'OK' },
          404: { schema: ApiError, description: 'Not found' },
        },
        handler: async (c) => c.respond[200]({ id: '1', title: 'Dune' }),
      }),
      endpoint({
        name: 'createBook',
        method: 'POST',
        path: '/books',
        summary: 'Create',
        responses: { 201: { schema: Book, description: 'Created' } },
        handler: async (c) => c.respond[201]({ id: '2', title: 'New' }),
      }),
    );
  });
  return router;
}

describe('bookshelf-like integration', () => {
  it('instruments a multi-endpoint router and renders Prometheus output', async () => {
    const router = buildBookshelfLikeRouter();
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);

    // Invoke each endpoint handler
    for (const ep of router.allEndpoints()) {
      await ep.handler(buildCtx());
    }

    const text = renderMetrics(collector);
    // Each endpoint should appear in the rendered output
    expect(text).toContain('route="/books"');
    expect(text).toContain('route="/books/:bookId"');
    expect(text).toContain('context="Library"');
    // Both counter and histogram series should be present
    expect(text).toContain('triad_http_requests_total');
    expect(text).toContain('triad_http_request_duration_seconds_bucket');
    // Sanity: totalRequests matches endpoint count
    expect(collector.snapshot().totalRequests).toBe(3);
  });

  it('renderMetrics is equivalent to collector.render()', async () => {
    const router = buildBookshelfLikeRouter();
    const collector = createMetricsCollector();
    withMetricsInstrumentation(router, collector);
    await router.allEndpoints()[0]!.handler(buildCtx());
    expect(renderMetrics(collector)).toBe(collector.render());
  });
});
