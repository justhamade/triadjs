/**
 * Property-based tests for the `endpoint()` factory.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '../src/schema/index.js';
import { endpoint, type HttpMethod } from '../src/endpoint.js';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string(),
});

const arbMethod = fc.constantFrom<HttpMethod>(...METHODS);

const arbPath = fc
  .array(
    fc.oneof(
      fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
      fc.string({ minLength: 1, maxLength: 6 }).filter((s) => /^[a-zA-Z]+$/.test(s)).map((s) => `:${s}`),
    ),
    { minLength: 1, maxLength: 5 },
  )
  .map((parts) => '/' + parts.join('/'));

const arbName = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s));

describe('endpoint() — round-trip properties', () => {
  it('stores method, path, name, summary verbatim', () => {
    fc.assert(
      fc.property(
        arbMethod,
        arbPath,
        arbName,
        fc.string({ minLength: 1, maxLength: 40 }),
        (method, path, name, summary) => {
          const ep = endpoint({
            name,
            method,
            path,
            summary,
            responses: { 200: { schema: Pet, description: 'ok' } },
            handler: async (ctx) =>
              ctx.respond[200]({
                id: '00000000-0000-0000-0000-000000000000',
                name: 'x',
              }),
          });
          expect(ep.name).toBe(name);
          expect(ep.method).toBe(method);
          expect(ep.path).toBe(path);
          expect(ep.summary).toBe(summary);
        },
      ),
    );
  });

  it('tags default to an empty array when omitted', () => {
    fc.assert(
      fc.property(arbMethod, arbPath, arbName, (method, path, name) => {
        const ep = endpoint({
          name,
          method,
          path,
          summary: 'x',
          responses: { 200: { schema: Pet, description: 'ok' } },
          handler: async (ctx) =>
            ctx.respond[200]({ id: '00000000-0000-0000-0000-000000000000', name: 'x' }),
        });
        expect(ep.tags).toEqual([]);
      }),
    );
  });

  it('tags array is copied, not shared', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 5 }),
        (tags) => {
          const ep = endpoint({
            name: 'x',
            method: 'GET',
            path: '/x',
            summary: 'x',
            tags,
            responses: { 200: { schema: Pet, description: 'ok' } },
            handler: async (ctx) =>
              ctx.respond[200]({ id: '00000000-0000-0000-0000-000000000000', name: 'x' }),
          });
          expect(ep.tags).toEqual(tags);
          expect(ep.tags).not.toBe(tags);
        },
      ),
    );
  });

  it('accepts any numeric HTTP status as a response key', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        (status) => {
          const ep = endpoint({
            name: 'x',
            method: 'GET',
            path: '/x',
            summary: 'x',
            responses: {
              [status]: { schema: Pet, description: 'ok' },
            },
            handler: async () => ({ status, body: undefined }),
          });
          expect(ep.responses[status]).toBeDefined();
        },
      ),
    );
  });

  it('body schema is stored by identity', () => {
    const ep = endpoint({
      name: 'x',
      method: 'POST',
      path: '/x',
      summary: 'x',
      request: { body: Pet },
      responses: { 200: { schema: Pet, description: 'ok' } },
      handler: async (ctx) => ctx.respond[200](ctx.body),
    });
    expect(ep.request.body).toBe(Pet);
  });

  it('behaviors default to empty when omitted', () => {
    fc.assert(
      fc.property(arbMethod, arbName, (method, name) => {
        const ep = endpoint({
          name,
          method,
          path: '/x',
          summary: 'x',
          responses: { 200: { schema: Pet, description: 'ok' } },
          handler: async (ctx) =>
            ctx.respond[200]({ id: '00000000-0000-0000-0000-000000000000', name: 'x' }),
        });
        expect(ep.behaviors).toEqual([]);
      }),
    );
  });
});
