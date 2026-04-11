/**
 * Property-based tests for `ModelSchema` composition operators:
 * `pick`, `omit`, `partial`, `extend`, `named`.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { t, type ModelSchema } from '../../src/schema/index.js';
import type { SchemaNode } from '../../src/schema/types.js';

// ---------------------------------------------------------------------------
// Arbitrary primitive schemas
// ---------------------------------------------------------------------------

const arbPrimitive = (): fc.Arbitrary<SchemaNode> =>
  fc.oneof(
    fc.constant(t.string()),
    fc.constant(t.int32()),
    fc.constant(t.boolean()),
  );

// KNOWN BUG (surfaced by property tests): `ModelSchema._validate` reads
// field values via `input[fieldName]`, which pulls in Object.prototype
// members when the field name is `valueOf`, `toString`, `hasOwnProperty`,
// etc. This causes a partial({}) model with a `valueOf: t.int32()` field
// to reject `{}` because `{}.valueOf` resolves to the inherited function.
//
// Minimal counterexample:
//   t.model('X', { valueOf: t.int32() }).partial().parse({})
//     → throws: "valueOf: Expected int32, received function"
//
// Fix: read fields via `Object.prototype.hasOwnProperty.call(input, k)`
// or `Object.hasOwn(input, k)` before dispatching to the field schema.
// Filing a fix is outside the scope of property tests — for now we just
// exclude these names from the generator so the composition properties
// can run cleanly. See `it.skip` below for the documented failing case.
const RESERVED = new Set([
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const arbFieldName = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s) && !RESERVED.has(s));

/**
 * Arbitrary model shape — a non-empty object of 1..5 fields, each a
 * primitive schema. Keeps the search space small enough for quick runs.
 */
const arbShape = (): fc.Arbitrary<Record<string, SchemaNode>> =>
  fc
    .uniqueArray(arbFieldName, { minLength: 1, maxLength: 5 })
    .chain((keys) =>
      fc
        .tuple(...keys.map(() => arbPrimitive()))
        .map((schemas) => {
          const out: Record<string, SchemaNode> = {};
          for (let i = 0; i < keys.length; i++) {
            out[keys[i]!] = schemas[i]!;
          }
          return out;
        }),
    );

const arbModel = (): fc.Arbitrary<ModelSchema<Record<string, SchemaNode>>> =>
  arbShape().map((shape) => t.model('Arb', shape));

// ---------------------------------------------------------------------------
// pick / omit
// ---------------------------------------------------------------------------

describe('ModelSchema — pick/omit properties', () => {
  it('pick with all keys preserves the field set', () => {
    fc.assert(
      fc.property(arbModel(), (model) => {
        const keys = Object.keys(model.shape) as Array<
          keyof typeof model.shape & string
        >;
        const picked = model.pick(...keys);
        expect(Object.keys(picked.shape).sort()).toEqual([...keys].sort());
      }),
    );
  });

  it('omit with zero keys equals the original shape', () => {
    fc.assert(
      fc.property(arbModel(), (model) => {
        const omitted = model.omit();
        expect(Object.keys(omitted.shape).sort()).toEqual(
          Object.keys(model.shape).sort(),
        );
      }),
    );
  });

  it('pick(keys) and omit(keys) partition the original field set', () => {
    fc.assert(
      fc.property(
        arbModel().chain((model) => {
          const keys = Object.keys(model.shape);
          return fc.tuple(fc.constant(model), fc.subarray(keys));
        }),
        ([model, picks]) => {
          const picked = model.pick(...(picks as [string, ...string[]]));
          const omitted = model.omit(...(picks as [string, ...string[]]));
          const union = new Set([
            ...Object.keys(picked.shape),
            ...Object.keys(omitted.shape),
          ]);
          expect([...union].sort()).toEqual(
            Object.keys(model.shape).sort(),
          );
          // Disjoint: no key appears in both
          for (const k of Object.keys(picked.shape)) {
            expect(Object.keys(omitted.shape)).not.toContain(k);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// partial
// ---------------------------------------------------------------------------

describe('ModelSchema — partial properties', () => {
  it('partial is idempotent on field optionality', () => {
    fc.assert(
      fc.property(arbModel(), (model) => {
        const once = model.partial();
        const twice = once.partial();
        for (const key of Object.keys(once.shape)) {
          expect(once.shape[key]?.isOptional).toBe(true);
          expect(twice.shape[key]?.isOptional).toBe(true);
        }
      }),
    );
  });

  it('partial() accepts an empty object for any shape', () => {
    fc.assert(
      fc.property(arbModel(), (model) => {
        const partial = model.partial();
        expect(() => partial.parse({})).not.toThrow();
      }),
    );
  });

  it('required() after partial() restores non-optionality', () => {
    fc.assert(
      fc.property(arbModel(), (model) => {
        const restored = model.partial().required();
        for (const key of Object.keys(restored.shape)) {
          expect(restored.shape[key]?.isOptional).toBe(false);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// extend
// ---------------------------------------------------------------------------

describe('ModelSchema — extend properties', () => {
  it('extend merges new fields while keeping originals', () => {
    fc.assert(
      fc.property(arbShape(), arbShape(), (a, b) => {
        const model = t.model('A', a);
        const extended = model.extend(b);
        const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
        expect(new Set(Object.keys(extended.shape))).toEqual(allKeys);
        // Fields from b overwrite fields from a on collision.
        for (const k of Object.keys(b)) {
          expect(extended.shape[k]).toBe(b[k]);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// named
// ---------------------------------------------------------------------------

describe('ModelSchema — named properties', () => {
  it('named() always sets the model name', () => {
    fc.assert(
      fc.property(arbModel(), fc.string({ minLength: 1 }), (model, newName) => {
        expect(model.named(newName).name).toBe(newName);
      }),
    );
  });

  it('named() preserves the shape', () => {
    fc.assert(
      fc.property(arbModel(), fc.string({ minLength: 1 }), (model, newName) => {
        expect(model.named(newName).shape).toEqual(model.shape);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Object.prototype name collision — fixed in model.ts via Object.hasOwn
// ---------------------------------------------------------------------------

describe('ModelSchema — Object.prototype field name handling', () => {
  it('partial({}) accepts an empty object for fields named valueOf / toString / etc.', () => {
    // Regression test for the prototype-chain bug Phase 25 discovered.
    // ModelSchema._validate now uses Object.hasOwn(input, fieldName)
    // instead of plain member access, so a field named `valueOf` no
    // longer resolves to Object.prototype.valueOf when the user input
    // doesn't have its own property of that name.
    expect(() => t.model('X', { valueOf: t.int32() }).partial().parse({})).not.toThrow();
    expect(() => t.model('X', { toString: t.string() }).partial().parse({})).not.toThrow();
    expect(() => t.model('X', { constructor: t.boolean() }).partial().parse({})).not.toThrow();
    expect(() => t.model('X', { hasOwnProperty: t.int32() }).partial().parse({})).not.toThrow();
  });

  it('required fields with prototype names still report missing correctly', () => {
    // The field is required and missing; we expect a validation failure,
    // NOT a "got Function instead of int32" error.
    const model = t.model('X', { valueOf: t.int32() });
    const result = model.validate({});
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error must be about a missing int, not about receiving a function
      const err = result.errors[0];
      expect(err).toBeDefined();
      expect(err?.message ?? '').not.toMatch(/function/i);
    }
  });

  it('own properties with prototype names are parsed correctly', () => {
    const model = t.model('X', { valueOf: t.int32() });
    const result = model.parse({ valueOf: 42 });
    expect(result).toEqual({ valueOf: 42 });
  });
});

// ---------------------------------------------------------------------------
// Field order independence
// ---------------------------------------------------------------------------

describe('ModelSchema — field order independence', () => {
  it('same fields in different orders parse the same inputs the same way', () => {
    fc.assert(
      fc.property(
        arbShape().chain((shape) => {
          const keys = Object.keys(shape);
          return fc
            .shuffledSubarray(keys, { minLength: keys.length, maxLength: keys.length })
            .map((reordered) => {
              const shuffled: Record<string, SchemaNode> = {};
              for (const k of reordered) shuffled[k] = shape[k]!;
              return { shape, shuffled };
            });
        }),
        ({ shape, shuffled }) => {
          const a = t.model('X', shape);
          const b = t.model('X', shuffled);
          // Build a plausible input by picking an empty object (partial
          // form) for both.
          const aPartial = a.partial();
          const bPartial = b.partial();
          expect(aPartial.parse({})).toEqual(bPartial.parse({}));
        },
      ),
    );
  });
});
