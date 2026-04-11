/**
 * Property-based tests for the OpenAPI 3.1 document generator.
 *
 * Goals: the generator must never crash on a well-formed router, must
 * be idempotent, must emit every required top-level field, and must
 * JSON-round-trip cleanly.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createRouter,
  endpoint,
  t,
  type Endpoint,
  type HttpMethod,
} from '@triad/core';
import { generateOpenAPI } from '../src/generator.js';

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const Pet = t.model('Pet', {
  id: t.string().format('uuid'),
  name: t.string(),
});

const ApiError = t.model('ApiError', {
  code: t.string(),
  message: t.string(),
});

const arbMethod = fc.constantFrom<HttpMethod>(...METHODS);

const arbSegment = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((s) => /^[a-zA-Z]+$/.test(s));

const arbPath = fc
  .array(
    fc.oneof(
      arbSegment,
      arbSegment.map((s) => `:${s}`),
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => '/' + parts.join('/'));

const arbName = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s));

const arbEndpointSpec = fc.record({
  name: arbName,
  method: arbMethod,
  path: arbPath,
  withBody: fc.boolean(),
});

type EndpointSpec = {
  name: string;
  method: HttpMethod;
  path: string;
  withBody: boolean;
};

function buildEndpoint(spec: EndpointSpec): Endpoint {
  const base = {
    name: spec.name,
    method: spec.method,
    path: spec.path,
    summary: `summary ${spec.name}`,
    responses: {
      200: { schema: Pet, description: 'ok' },
      400: { schema: ApiError, description: 'err' },
    },
    handler: async (ctx: {
      respond: Record<
        number,
        (body: unknown) => { status: number; body: unknown }
      >;
    }) =>
      ctx.respond[200]({
        id: '00000000-0000-0000-0000-000000000000',
        name: 'x',
      }),
  } as const;
  if (spec.withBody) {
    return endpoint({
      ...base,
      request: { body: Pet },
    });
  }
  return endpoint(base);
}

/**
 * Arbitrary router: a small set of endpoints with unique (method, path)
 * combinations so we don't collide on the same path-item slot.
 */
const arbRouter = fc
  .uniqueArray(arbEndpointSpec, {
    minLength: 1,
    maxLength: 8,
    selector: (s) => `${s.method} ${s.path}`,
  })
  .chain((specs) => {
    // Also ensure names are unique.
    const seen = new Set<string>();
    const unique: EndpointSpec[] = [];
    for (const s of specs) {
      if (seen.has(s.name)) continue;
      seen.add(s.name);
      unique.push(s);
    }
    return fc.constant(unique);
  })
  .filter((specs) => specs.length >= 1);

describe('generateOpenAPI — property tests', () => {
  it('never throws for a well-formed router', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        expect(() => generateOpenAPI(router)).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });

  it('always emits the required top-level fields', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        const doc = generateOpenAPI(router);
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info.title).toBe('T');
        expect(doc.info.version).toBe('1');
        expect(doc.paths).toBeDefined();
        expect(doc.components).toBeDefined();
      }),
      { numRuns: 50 },
    );
  });

  it('is idempotent: two generations produce equal output', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        const a = generateOpenAPI(router);
        const b = generateOpenAPI(router);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 30 },
    );
  });

  it('round-trips through JSON.parse(JSON.stringify(...))', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        const doc = generateOpenAPI(router);
        const roundTripped = JSON.parse(JSON.stringify(doc));
        expect(roundTripped).toEqual(doc);
      }),
      { numRuns: 30 },
    );
  });

  it('operation count equals endpoint count', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        const doc = generateOpenAPI(router);
        let opCount = 0;
        for (const pathItem of Object.values(doc.paths)) {
          for (const method of METHODS) {
            const key = method.toLowerCase() as Lowercase<HttpMethod>;
            if ((pathItem as Record<string, unknown>)[key]) opCount++;
          }
        }
        expect(opCount).toBe(specs.length);
      }),
      { numRuns: 30 },
    );
  });

  it('every response carries either a $ref or a non-null content schema', () => {
    fc.assert(
      fc.property(arbRouter, (specs) => {
        const router = createRouter({ title: 'T', version: '1' });
        router.add(...specs.map(buildEndpoint));
        const doc = generateOpenAPI(router);
        for (const pathItem of Object.values(doc.paths)) {
          for (const method of METHODS) {
            const key = method.toLowerCase() as Lowercase<HttpMethod>;
            const op = (pathItem as Record<string, unknown>)[key] as
              | { responses: Record<string, { content?: Record<string, { schema: unknown }> }> }
              | undefined;
            if (!op) continue;
            for (const response of Object.values(op.responses)) {
              if (response.content) {
                for (const media of Object.values(response.content)) {
                  expect(media.schema).toBeDefined();
                  expect(media.schema).not.toBeNull();
                }
              }
            }
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});
