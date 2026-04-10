import { describe, expect, it, expectTypeOf } from 'vitest';
import { StringSchema } from '../../src/schema/string.js';
import { NumberSchema } from '../../src/schema/number.js';
import { ArraySchema } from '../../src/schema/array.js';
import { RecordSchema } from '../../src/schema/record.js';
import { TupleSchema } from '../../src/schema/tuple.js';
import { UnionSchema } from '../../src/schema/union.js';
import { UnknownSchema } from '../../src/schema/unknown.js';
import type { Infer } from '../../src/schema/types.js';

describe('ArraySchema', () => {
  it('validates each element', () => {
    const s = new ArraySchema(new StringSchema());
    expect(s.validate(['a', 'b']).success).toBe(true);
    const r = s.validate(['a', 42]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.path).toBe('[1]');
      expect(r.errors[0]?.code).toBe('invalid_type');
    }
  });

  it('rejects non-arrays', () => {
    expect(new ArraySchema(new StringSchema()).validate('nope').success).toBe(false);
  });

  it('enforces minItems / maxItems', () => {
    const s = new ArraySchema(new StringSchema()).minItems(2).maxItems(3);
    expect(s.validate(['a']).success).toBe(false);
    expect(s.validate(['a', 'b', 'c', 'd']).success).toBe(false);
    expect(s.validate(['a', 'b']).success).toBe(true);
  });

  it('enforces uniqueItems', () => {
    const s = new ArraySchema(new StringSchema()).uniqueItems();
    expect(s.validate(['a', 'a']).success).toBe(false);
    expect(s.validate(['a', 'b']).success).toBe(true);
  });

  it('infers array element type', () => {
    const s = new ArraySchema(new StringSchema());
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<string[]>();
  });

  it('emits OpenAPI array with items', () => {
    const schema = new ArraySchema(new StringSchema()).minItems(1).toOpenAPI();
    expect(schema).toMatchObject({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
    });
  });

  it('reports nested paths correctly', () => {
    const s = new ArraySchema(new ArraySchema(new NumberSchema('int32')));
    const r = s.validate([[1, 2], [3, 'oops']]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors[0]?.path).toBe('[1][1]');
    }
  });
});

describe('RecordSchema', () => {
  it('validates values', () => {
    const s = new RecordSchema(new StringSchema(), new NumberSchema('int32'));
    expect(s.validate({ a: 1, b: 2 }).success).toBe(true);
    expect(s.validate({ a: 1, b: 'nope' }).success).toBe(false);
  });

  it('accepts unknown values via UnknownSchema', () => {
    const s = new RecordSchema(new StringSchema(), new UnknownSchema());
    expect(s.validate({ anything: { nested: true }, other: 42 }).success).toBe(true);
  });

  it('rejects arrays and non-objects', () => {
    const s = new RecordSchema(new StringSchema(), new NumberSchema('int32'));
    expect(s.validate([]).success).toBe(false);
    expect(s.validate('nope').success).toBe(false);
  });

  it('infers Record type', () => {
    const s = new RecordSchema(new StringSchema(), new NumberSchema('int32'));
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<Record<string, number>>();
  });

  it('emits OpenAPI object with additionalProperties', () => {
    const schema = new RecordSchema(new StringSchema(), new NumberSchema('int32')).toOpenAPI();
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: { type: 'integer', format: 'int32' },
    });
  });
});

import { t } from '../../src/schema/index.js';

describe('TupleSchema', () => {
  it('validates fixed-length tuples by position', () => {
    const s = t.tuple(t.float64(), t.float64());
    expect(s.validate([1.5, 2.5]).success).toBe(true);
    expect(s.validate([1.5]).success).toBe(false);
    expect(s.validate([1.5, 2.5, 3.5]).success).toBe(false);
    expect(s.validate(['a', 'b']).success).toBe(false);
  });

  it('infers tuple type', () => {
    const s = t.tuple(t.string(), t.int32());
    expectTypeOf<Infer<typeof s>>().toMatchTypeOf<[string, number]>();
  });

  it('emits OpenAPI prefixItems', () => {
    const s = t.tuple(t.string(), t.int32()).toOpenAPI();
    expect(s).toMatchObject({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'integer', format: 'int32' }],
      minItems: 2,
      maxItems: 2,
    });
  });
});

describe('UnionSchema', () => {
  it('accepts values matching any option', () => {
    const s = t.union(t.string(), t.int32());
    expect(s.validate('hi').success).toBe(true);
    expect(s.validate(42).success).toBe(true);
    expect(s.validate(true).success).toBe(false);
  });

  it('infers union type', () => {
    const s = t.union(t.string(), t.int32());
    expectTypeOf<Infer<typeof s>>().toMatchTypeOf<string | number>();
  });

  it('emits OpenAPI oneOf', () => {
    const s = t.union(t.string(), t.int32()).toOpenAPI();
    expect(s).toMatchObject({
      oneOf: [{ type: 'string' }, { type: 'integer', format: 'int32' }],
    });
  });
});
