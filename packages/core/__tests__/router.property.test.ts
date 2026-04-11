/**
 * Property-based tests for `Router` registration, context nesting, and
 * stability.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t } from '../src/schema/index.js';
import { endpoint, type Endpoint } from '../src/endpoint.js';
import { createRouter } from '../src/router.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string(),
});

function makeEndpoint(name: string, path = `/${name}`): Endpoint {
  return endpoint({
    name,
    method: 'GET',
    path,
    summary: 'x',
    responses: { 200: { schema: Pet, description: 'ok' } },
    handler: async (ctx) =>
      ctx.respond[200]({ id: '00000000-0000-0000-0000-000000000000', name: 'x' }),
  });
}

const arbName = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s));

const arbEndpointNames = fc.uniqueArray(arbName, { minLength: 1, maxLength: 10 });

describe('Router — registration properties', () => {
  it('add() is monotonic: count grows by exactly one per call', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        for (let i = 0; i < names.length; i++) {
          r.add(makeEndpoint(names[i]!));
          expect(r.allEndpoints()).toHaveLength(i + 1);
        }
      }),
    );
  });

  it('allEndpoints() is stable: calling twice returns equal arrays', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        for (const n of names) r.add(makeEndpoint(n));
        expect(r.allEndpoints()).toEqual(r.allEndpoints());
      }),
    );
  });

  it('rootEndpoints preserves registration order', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        const eps = names.map((n) => makeEndpoint(n));
        r.add(...eps);
        expect([...r.rootEndpoints]).toEqual(eps);
      }),
    );
  });

  it('findEndpoint() returns exactly the endpoint registered under that name', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        const byName = new Map<string, Endpoint>();
        for (const n of names) {
          const ep = makeEndpoint(n);
          byName.set(n, ep);
          r.add(ep);
        }
        for (const n of names) {
          expect(r.findEndpoint(n)).toBe(byName.get(n));
        }
      }),
    );
  });
});

describe('Router — bounded context properties', () => {
  it('allEndpoints() = root endpoints + all context endpoints, in order', () => {
    fc.assert(
      fc.property(
        arbEndpointNames,
        arbEndpointNames,
        (rootNames, ctxNames) => {
          const r = createRouter({ title: 'x', version: '1' });
          const roots = rootNames.map((n) => makeEndpoint(`root_${n}`));
          r.add(...roots);
          const ctxEps = ctxNames.map((n) => makeEndpoint(`ctx_${n}`));
          r.context('C', {}, (ctx) => {
            ctx.add(...ctxEps);
          });
          expect(r.allEndpoints()).toEqual([...roots, ...ctxEps]);
        },
      ),
    );
  });

  it('contextOf() returns the declaring context for context endpoints', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        const eps = names.map((n) => makeEndpoint(n));
        r.context('Ctx', {}, (ctx) => ctx.add(...eps));
        for (const ep of eps) {
          expect(r.contextOf(ep)?.name).toBe('Ctx');
        }
      }),
    );
  });

  it('contextOf() returns undefined for root endpoints', () => {
    fc.assert(
      fc.property(arbEndpointNames, (names) => {
        const r = createRouter({ title: 'x', version: '1' });
        const eps = names.map((n) => makeEndpoint(n));
        r.add(...eps);
        for (const ep of eps) {
          expect(r.contextOf(ep)).toBeUndefined();
        }
      }),
    );
  });

  it('multiple contexts preserve declaration order in allEndpoints()', () => {
    fc.assert(
      fc.property(
        fc.array(arbEndpointNames, { minLength: 1, maxLength: 4 }),
        (groups) => {
          const r = createRouter({ title: 'x', version: '1' });
          const flat: Endpoint[] = [];
          groups.forEach((names, idx) => {
            const eps = names.map((n) => makeEndpoint(`g${idx}_${n}`));
            r.context(`Ctx${idx}`, {}, (ctx) => ctx.add(...eps));
            flat.push(...eps);
          });
          expect(r.allEndpoints()).toEqual(flat);
        },
      ),
    );
  });
});
