import { describe, expect, it, expectTypeOf } from 'vitest';
import { NumberSchema } from '../../src/schema/number.js';
import type { Infer } from '../../src/schema/types.js';

const t = {
  int32: () => new NumberSchema('int32'),
  int64: () => new NumberSchema('int64'),
  float32: () => new NumberSchema('float32'),
  float64: () => new NumberSchema('float64'),
};

describe('NumberSchema — type inference', () => {
  it('infers number by default', () => {
    const s = t.int32();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<number>();
  });

  it('widens via optional/nullable', () => {
    const a = t.int32().optional();
    const b = t.float64().nullable();
    expectTypeOf<Infer<typeof a>>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Infer<typeof b>>().toEqualTypeOf<number | null>();
  });
});

describe('NumberSchema — int32 validation', () => {
  it('accepts integers in range', () => {
    expect(t.int32().validate(42).success).toBe(true);
    expect(t.int32().validate(-2_147_483_648).success).toBe(true);
    expect(t.int32().validate(2_147_483_647).success).toBe(true);
  });

  it('rejects floats', () => {
    const r = t.int32().validate(3.14);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]?.code).toBe('not_integer');
  });

  it('rejects values outside int32 range', () => {
    const r = t.int32().validate(2_147_483_648);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.some((e) => e.code === 'out_of_range')).toBe(true);
  });

  it('rejects NaN and non-numbers', () => {
    expect(t.int32().validate(NaN).success).toBe(false);
    expect(t.int32().validate('42').success).toBe(false);
    expect(t.int32().validate(null).success).toBe(false);
  });

  it('rejects Infinity', () => {
    const r = t.int32().validate(Infinity);
    expect(r.success).toBe(false);
  });
});

describe('NumberSchema — constraints', () => {
  it('enforces min/max', () => {
    const schema = t.int32().min(1).max(100);
    expect(schema.validate(0).success).toBe(false);
    expect(schema.validate(101).success).toBe(false);
    expect(schema.validate(50).success).toBe(true);
  });

  it('enforces exclusiveMin/exclusiveMax', () => {
    const schema = t.float64().exclusiveMin(0).exclusiveMax(1);
    expect(schema.validate(0).success).toBe(false);
    expect(schema.validate(1).success).toBe(false);
    expect(schema.validate(0.5).success).toBe(true);
  });

  it('enforces multipleOf', () => {
    expect(t.int32().multipleOf(5).validate(25).success).toBe(true);
    expect(t.int32().multipleOf(5).validate(26).success).toBe(false);
  });
});

describe('NumberSchema — defaults', () => {
  it('applies default when undefined', () => {
    const result = t.int32().default(20).validate(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(20);
  });
});

describe('NumberSchema — OpenAPI output', () => {
  it('maps int32 to integer/int32', () => {
    expect(t.int32().toOpenAPI()).toMatchObject({ type: 'integer', format: 'int32' });
  });
  it('maps int64 to integer/int64', () => {
    expect(t.int64().toOpenAPI()).toMatchObject({ type: 'integer', format: 'int64' });
  });
  it('maps float32 to number/float', () => {
    expect(t.float32().toOpenAPI()).toMatchObject({ type: 'number', format: 'float' });
  });
  it('maps float64 to number/double', () => {
    expect(t.float64().toOpenAPI()).toMatchObject({ type: 'number', format: 'double' });
  });

  it('emits constraints', () => {
    const schema = t.int32().min(1).max(100).multipleOf(5).toOpenAPI();
    expect(schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      multipleOf: 5,
    });
  });
});
