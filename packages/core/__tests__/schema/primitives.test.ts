import { describe, expect, it, expectTypeOf } from 'vitest';
import { BooleanSchema } from '../../src/schema/boolean.js';
import { DateTimeSchema } from '../../src/schema/datetime.js';
import { EnumSchema } from '../../src/schema/enum.js';
import { LiteralSchema } from '../../src/schema/literal.js';
import { UnknownSchema } from '../../src/schema/unknown.js';
import type { Infer } from '../../src/schema/types.js';

describe('BooleanSchema', () => {
  it('accepts booleans, rejects non-booleans', () => {
    const s = new BooleanSchema();
    expect(s.validate(true).success).toBe(true);
    expect(s.validate(false).success).toBe(true);
    expect(s.validate('true').success).toBe(false);
    expect(s.validate(1).success).toBe(false);
  });

  it('emits OpenAPI type: boolean', () => {
    expect(new BooleanSchema().toOpenAPI()).toEqual({ type: 'boolean' });
  });

  it('infers boolean type', () => {
    const s = new BooleanSchema();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<boolean>();
  });
});

describe('DateTimeSchema', () => {
  it('accepts ISO 8601 date-time strings', () => {
    const s = new DateTimeSchema();
    expect(s.validate('2026-04-10T12:00:00Z').success).toBe(true);
    expect(s.validate('2026-04-10T12:00:00.123+00:00').success).toBe(true);
  });

  it('rejects bare dates and junk', () => {
    const s = new DateTimeSchema();
    expect(s.validate('2026-04-10').success).toBe(false);
    expect(s.validate('yesterday').success).toBe(false);
    expect(s.validate(123).success).toBe(false);
  });

  it('emits OpenAPI string/date-time', () => {
    expect(new DateTimeSchema().toOpenAPI()).toEqual({
      type: 'string',
      format: 'date-time',
    });
  });
});

describe('EnumSchema', () => {
  it('accepts declared values, rejects others', () => {
    const s = new EnumSchema(['dog', 'cat', 'bird'] as const);
    expect(s.validate('dog').success).toBe(true);
    expect(s.validate('cat').success).toBe(true);
    expect(s.validate('dragon').success).toBe(false);
    expect(s.validate(42).success).toBe(false);
  });

  it('infers the literal union type', () => {
    const s = new EnumSchema(['dog', 'cat'] as const);
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<'dog' | 'cat'>();
  });

  it('emits OpenAPI enum', () => {
    const schema = new EnumSchema(['dog', 'cat'] as const).toOpenAPI();
    expect(schema).toMatchObject({ type: 'string', enum: ['dog', 'cat'] });
  });
});

describe('LiteralSchema', () => {
  it('accepts only the exact value', () => {
    const s = new LiteralSchema<'active'>('active');
    expect(s.validate('active').success).toBe(true);
    expect(s.validate('inactive').success).toBe(false);
  });

  it('infers the literal type', () => {
    const s = new LiteralSchema<'active'>('active');
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<'active'>();
  });

  it('supports numeric and boolean literals', () => {
    expect(new LiteralSchema<42>(42).validate(42).success).toBe(true);
    expect(new LiteralSchema<42>(42).validate(43).success).toBe(false);
    expect(new LiteralSchema<true>(true).validate(true).success).toBe(true);
  });

  it('emits OpenAPI const', () => {
    expect(new LiteralSchema('active').toOpenAPI()).toMatchObject({ const: 'active' });
  });
});

describe('UnknownSchema', () => {
  it('accepts any value including undefined/null', () => {
    const s = new UnknownSchema();
    expect(s.validate(42).success).toBe(true);
    expect(s.validate('hello').success).toBe(true);
    expect(s.validate({ any: 'thing' }).success).toBe(true);
  });

  it('infers unknown type', () => {
    const s = new UnknownSchema();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<unknown>();
  });

  it('emits empty OpenAPI schema', () => {
    expect(new UnknownSchema().toOpenAPI()).toEqual({});
  });
});
