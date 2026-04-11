/**
 * Phase 24 — behavior-coverage audit: error-branch edge cases across the
 * schema DSL. Every test exercises a narrowly-scoped failure path or
 * boundary that earlier tests did not cover.
 */

import { describe, expect, it } from 'vitest';
import { t } from '../../src/schema/index.js';
import { ValidationException } from '../../src/schema/types.js';

describe('StringSchema — boundary and format edge cases', () => {
  it('accepts a string at exactly minLength', () => {
    const r = t.string().minLength(3).validate('abc');
    expect(r.success).toBe(true);
  });

  it('accepts a string at exactly maxLength', () => {
    const r = t.string().maxLength(3).validate('abc');
    expect(r.success).toBe(true);
  });

  it('rejects a string one below minLength with min_length code', () => {
    const r = t.string().minLength(5).validate('abcd');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('min_length');
  });

  it('rejects a string one above maxLength with max_length code', () => {
    const r = t.string().maxLength(3).validate('abcd');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('max_length');
  });

  it('accepts the empty string when no constraints are set', () => {
    expect(t.string().validate('').success).toBe(true);
  });

  it('rejects the empty string against minLength(1) with min_length code', () => {
    const r = t.string().minLength(1).validate('');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('min_length');
  });

  it('rejects an IPv4 with out-of-range octets', () => {
    const r = t.string().format('ipv4').validate('256.0.0.1');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('format');
  });

  it('rejects a UUID that is structurally plausible but wrong length', () => {
    const r = t
      .string()
      .format('uuid')
      .validate('550e8400-e29b-41d4-a716-44665544000'); // 35 chars
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('format');
  });

  it('rejects a date-time without a time component', () => {
    const r = t.string().format('date-time').validate('2026-04-10');
    expect(r.success).toBe(false);
  });

  it('reports invalid_type for an array passed to a string', () => {
    const r = t.string().validate([]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.code).toBe('invalid_type');
      expect(r.errors[0]?.message).toContain('array');
    }
  });

  it('reports invalid_type for null (not_nullable) distinctly from missing', () => {
    const r1 = t.string().validate(null);
    const r2 = t.string().validate(undefined);
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    if (!r1.success && !r2.success) {
      expect(r1.errors[0]?.code).toBe('not_nullable');
      expect(r2.errors[0]?.code).toBe('required');
    }
  });
});

describe('NumberSchema — boundary edge cases', () => {
  it('rejects -Infinity with not_finite', () => {
    const r = t.float64().validate(-Infinity);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('not_finite');
  });

  it('int64 rejects values above Number.MAX_SAFE_INTEGER', () => {
    const r = t.int64().validate(Number.MAX_SAFE_INTEGER + 1);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'out_of_range')).toBe(true);
  });

  it('int32 accepts exactly -2^31 and 2^31-1 (inclusive boundary)', () => {
    expect(t.int32().validate(-2147483648).success).toBe(true);
    expect(t.int32().validate(2147483647).success).toBe(true);
  });

  it('int32 rejects -2^31 - 1 with out_of_range', () => {
    const r = t.int32().validate(-2147483649);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'out_of_range')).toBe(true);
  });

  it('exclusiveMin rejects exactly the boundary value', () => {
    const r = t.float64().exclusiveMin(0).validate(0);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('exclusive_min');
  });

  it('exclusiveMax rejects exactly the boundary value', () => {
    const r = t.float64().exclusiveMax(1).validate(1);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('exclusive_max');
  });

  it('describes NaN in the invalid_type error message', () => {
    const r = t.int32().validate(NaN);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.message).toContain('NaN');
  });

  it('multipleOf reports multiple_of when the value is off by any amount', () => {
    const r = t.int32().multipleOf(5).validate(7);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('multiple_of');
  });
});

describe('ArraySchema — edge cases', () => {
  it('accepts an empty array when no constraints are set', () => {
    expect(t.array(t.string()).validate([]).success).toBe(true);
  });

  it('rejects an empty array when minItems(1) is required', () => {
    const r = t.array(t.string()).minItems(1).validate([]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('min_items');
  });

  it('uniqueItems treats deep-equal objects as duplicates', () => {
    const r = t
      .array(t.model('P', { x: t.int32() }))
      .uniqueItems()
      .validate([{ x: 1 }, { x: 1 }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'duplicate_item')).toBe(true);
  });

  it('reports nested element errors with positional path', () => {
    const r = t.array(t.int32()).validate([1, 'two', 3]);
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.errors.find((e) => e.code === 'invalid_type');
      expect(err?.path).toBe('[1]');
    }
  });
});

describe('TupleSchema — arity and position edge cases', () => {
  it('rejects a shorter tuple with tuple_length', () => {
    const r = t.tuple(t.string(), t.int32()).validate(['a']);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'tuple_length')).toBe(true);
  });

  it('rejects a longer tuple with tuple_length', () => {
    const r = t.tuple(t.string(), t.int32()).validate(['a', 1, 'extra']);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'tuple_length')).toBe(true);
  });

  it('reports per-position invalid_type errors with indexed paths', () => {
    const r = t.tuple(t.string(), t.int32()).validate([42, 'nope']);
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.errors.map((e) => e.path);
      expect(paths).toContain('[0]');
      expect(paths).toContain('[1]');
    }
  });

  it('rejects a non-array value with invalid_type', () => {
    const r = t.tuple(t.string(), t.int32()).validate({ 0: 'a', 1: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_type');
  });
});

describe('UnionSchema — discrimination failure', () => {
  it('rejects a value matching no option with no_union_match', () => {
    const r = t.union(t.string(), t.int32()).validate(true);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('no_union_match');
  });

  it('accepts the first matching option without emitting errors', () => {
    const r = t.union(t.string(), t.int32()).validate('hello');
    expect(r.success).toBe(true);
  });

  it('handles a union of models', () => {
    const A = t.model('A', { kind: t.literal('a'), a: t.string() });
    const B = t.model('B', { kind: t.literal('b'), b: t.int32() });
    const u = t.union(A, B);
    expect(u.validate({ kind: 'a', a: 'x' }).success).toBe(true);
    expect(u.validate({ kind: 'b', b: 42 }).success).toBe(true);
    expect(u.validate({ kind: 'c' }).success).toBe(false);
  });
});

describe('RecordSchema — edge cases', () => {
  it('accepts an empty object', () => {
    expect(t.record(t.string(), t.int32()).validate({}).success).toBe(true);
  });

  it('reports invalid_type for array values', () => {
    const r = t.record(t.string(), t.int32()).validate([1, 2]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_type');
  });

  it('reports per-key errors for invalid values with dot paths', () => {
    const r = t.record(t.string(), t.int32()).validate({ a: 1, b: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const err = r.errors.find((e) => e.path === 'b');
      expect(err?.code).toBe('invalid_type');
    }
  });
});

describe('LiteralSchema — exact-equality edge cases', () => {
  it('rejects a differing string with invalid_literal', () => {
    const r = t.literal('active').validate('inactive');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_literal');
  });

  it('rejects 0 when the literal is false (strict equality)', () => {
    const r = t.literal(false).validate(0);
    expect(r.success).toBe(false);
  });

  it('rejects the string "1" when the literal is the number 1', () => {
    const r = t.literal(1).validate('1');
    expect(r.success).toBe(false);
  });
});

describe('EnumSchema — case sensitivity', () => {
  it('rejects a value whose case does not match', () => {
    const r = t.enum('dog', 'cat').validate('DOG');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_enum');
  });

  it('rejects a numeric value that happens to be present as a string', () => {
    const r = t.enum('1', '2').validate(1);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_enum');
  });
});

describe('DateTimeSchema — format and type edge cases', () => {
  it('rejects an unparseable ISO-looking string', () => {
    const r = t.datetime().validate('2026-13-40T99:99:99Z');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_datetime');
  });

  it('rejects a number (Date.now-style timestamp) with invalid_type', () => {
    const r = t.datetime().validate(1712770800000);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_type');
  });
});

describe('BooleanSchema — type rejection', () => {
  it('rejects the string "true" with invalid_type', () => {
    const r = t.boolean().validate('true');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_type');
  });

  it('rejects 0 and 1 with invalid_type (no number coercion)', () => {
    expect(t.boolean().validate(0).success).toBe(false);
    expect(t.boolean().validate(1).success).toBe(false);
  });
});

describe('ModelSchema — composition edge cases', () => {
  const Pet = t.model('Pet', {
    id: t.string(),
    name: t.string(),
    age: t.int32(),
  });

  it('pick() with zero keys produces an empty-shape model', () => {
    const Empty = Pet.pick();
    expect(Object.keys(Empty.shape)).toEqual([]);
    expect(Empty.validate({}).success).toBe(true);
  });

  it('omit() with every field leaves an empty shape', () => {
    const Empty = Pet.omit('id', 'name', 'age');
    expect(Object.keys(Empty.shape)).toEqual([]);
  });

  it('partial() accepts {} and original required shape still works', () => {
    const P = Pet.partial();
    expect(P.validate({}).success).toBe(true);
    // Original model is unchanged
    expect(Pet.validate({}).success).toBe(false);
  });

  it('extend() overwrites an existing field of the same name', () => {
    const Renamed = Pet.extend({ name: t.int32() });
    const r = Renamed.validate({ id: 'x', name: 42, age: 1 });
    expect(r.success).toBe(true);
  });

  it('nested model validation reports dotted paths', () => {
    const Outer = t.model('Outer', { inner: Pet });
    const r = Outer.validate({ inner: { id: 'x', name: 5, age: 1 } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.path === 'inner.name' && e.code === 'invalid_type')).toBe(
        true,
      );
    }
  });

  it('rejects an array as a model value', () => {
    const r = Pet.validate([]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.message).toContain('array');
  });
});

describe('FileSchema — metadata edge cases', () => {
  it('rejects a plain object missing a Buffer', () => {
    const r = t
      .file()
      .validate({ name: 'x.txt', mimeType: 'text/plain', size: 3, buffer: 'not-a-buffer' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('invalid_type');
  });

  it('rejects a size of 0 when minSize is set to 1', () => {
    const buffer = Buffer.alloc(0);
    const r = t.file().minSize(1).validate({
      name: 'x.txt',
      mimeType: 'text/plain',
      size: 0,
      buffer,
      stream: () => {
        throw new Error('no');
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('file_too_small');
  });

  it('parse throws ValidationException when mime is not in allowlist', () => {
    const file = {
      name: 'x.pdf',
      mimeType: 'application/pdf',
      size: 1,
      buffer: Buffer.from('x'),
      stream: () => {
        throw new Error('no');
      },
    };
    expect(() => t.file().mimeTypes('image/png').parse(file)).toThrow(ValidationException);
  });
});
