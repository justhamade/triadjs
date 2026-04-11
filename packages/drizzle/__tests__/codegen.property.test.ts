/**
 * Property-based tests for the Drizzle codegen pipeline.
 *
 * Core invariants:
 *   - For any well-formed router (each model has a primary key field),
 *     `generateDrizzleSchema()` never throws.
 *   - The emitted source parses as valid TypeScript with zero syntax
 *     errors for every dialect.
 *   - Walking the router is deterministic across all three dialects.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import ts from 'typescript';
import { createRouter, endpoint, t, type Endpoint } from '@triad/core';
import { generateDrizzleSchema, walkRouter } from '../src/index.js';
import type { Dialect } from '../src/codegen/types.js';

const DIALECTS: readonly Dialect[] = ['sqlite', 'postgres', 'mysql'];

const arbModelName = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter((s) => /^[A-Z][a-zA-Z0-9]*$/.test(s));

const arbFieldName = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => /^[a-z][a-zA-Z0-9]*$/.test(s));

const arbColumnSchema = fc.oneof(
  fc.constant(t.string()),
  fc.constant(t.string().format('uuid')),
  fc.constant(t.int32()),
  fc.constant(t.int64()),
  fc.constant(t.float64()),
  fc.constant(t.boolean()),
  fc.constant(t.datetime()),
);

/**
 * Arbitrary model with a guaranteed primary-key field.
 */
const arbTableModel = fc
  .record({
    name: arbModelName,
    extraFields: fc.uniqueArray(arbFieldName, {
      minLength: 0,
      maxLength: 4,
    }),
  })
  .chain(({ name, extraFields }) =>
    fc
      .tuple(...extraFields.map(() => arbColumnSchema))
      .map((schemas) => {
        const shape: Record<string, ReturnType<typeof t.string>> = {
          id: t.string().format('uuid').storage({ primaryKey: true }),
        };
        for (let i = 0; i < extraFields.length; i++) {
          const field = extraFields[i]!;
          if (field === 'id') continue;
          shape[field] = schemas[i]! as ReturnType<typeof t.string>;
        }
        return t.model(name, shape);
      }),
  );

function buildRouter(models: ReturnType<typeof t.model>[]): {
  router: ReturnType<typeof createRouter>;
  endpoints: Endpoint[];
} {
  const router = createRouter({ title: 'T', version: '1' });
  const eps: Endpoint[] = [];
  for (const model of models) {
    const ep = endpoint({
      name: `list${model.name}`,
      method: 'GET',
      path: `/${model.name.toLowerCase()}`,
      summary: 'x',
      responses: {
        200: { schema: t.array(model), description: 'ok' },
      },
      handler: async (ctx) => ctx.respond[200]([]),
    });
    eps.push(ep);
    router.add(ep);
  }
  return { router, endpoints: eps };
}

/**
 * Unique-by-name array of table models — duplicate model names would
 * cause the walker to silently drop the duplicate, which isn't what we
 * want to exercise here.
 */
const arbModels = fc
  .uniqueArray(arbTableModel, {
    minLength: 1,
    maxLength: 4,
    selector: (m) => m.name,
  });

// ---------------------------------------------------------------------------
// Never crashes
// ---------------------------------------------------------------------------

describe('generateDrizzleSchema — never crashes', () => {
  it('accepts any router built from well-formed models for every dialect', () => {
    fc.assert(
      fc.property(arbModels, (models) => {
        const { router } = buildRouter(models);
        for (const dialect of DIALECTS) {
          expect(() => generateDrizzleSchema(router, { dialect })).not.toThrow();
        }
      }),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// Emitted TypeScript is syntactically valid
// ---------------------------------------------------------------------------

function hasSyntaxErrors(source: string): ts.Diagnostic[] {
  const sourceFile = ts.createSourceFile(
    'generated.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  // `parseDiagnostics` is attached by the parser when there are syntax
  // errors. It is not part of the public type — cast through unknown.
  const diagnostics =
    (sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  return diagnostics;
}

describe('generateDrizzleSchema — output is parseable TypeScript', () => {
  it('every dialect emits syntax-valid TypeScript', () => {
    fc.assert(
      fc.property(arbModels, (models) => {
        const { router } = buildRouter(models);
        for (const dialect of DIALECTS) {
          const { source } = generateDrizzleSchema(router, { dialect });
          const errors = hasSyntaxErrors(source);
          if (errors.length > 0) {
            const messages = errors
              .map((d) =>
                typeof d.messageText === 'string'
                  ? d.messageText
                  : d.messageText.messageText,
              )
              .join('; ');
            throw new Error(
              `Dialect ${dialect} produced TypeScript with syntax errors: ${messages}\n---\n${source}`,
            );
          }
          expect(errors).toHaveLength(0);
        }
      }),
      { numRuns: 15 },
    );
  });
});

// ---------------------------------------------------------------------------
// Walker is dialect-neutral
// ---------------------------------------------------------------------------

describe('walkRouter — dialect-neutral IR', () => {
  it('produces the same TableDescriptor[] regardless of dialect', () => {
    fc.assert(
      fc.property(arbModels, (models) => {
        const { router } = buildRouter(models);
        // The walker itself is dialect-independent — invoke twice and
        // confirm the two descriptor arrays match exactly.
        const a = walkRouter(router);
        const b = walkRouter(router);
        expect(a).toEqual(b);
        // Every model we registered should appear as a table.
        const tableNames = new Set(a.map((t) => t.modelName));
        for (const model of models) {
          expect(tableNames.has(model.name)).toBe(true);
        }
      }),
      { numRuns: 25 },
    );
  });
});
