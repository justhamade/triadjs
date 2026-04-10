import { describe, expect, it, expectTypeOf } from 'vitest';
import { StringSchema } from '../../src/schema/string.js';
import type { Infer } from '../../src/schema/types.js';
import { ValidationException } from '../../src/schema/types.js';

const t = {
  string: () => new StringSchema(),
};

describe('StringSchema — construction and type inference', () => {
  it('infers string type by default', () => {
    const s = t.string();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<string>();
  });

  it('widens to string | undefined with .optional()', () => {
    const s = t.string().optional();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<string | undefined>();
  });

  it('widens to string | null with .nullable()', () => {
    const s = t.string().nullable();
    expectTypeOf<Infer<typeof s>>().toEqualTypeOf<string | null>();
  });

  it('is immutable — chaining returns new instances', () => {
    const a = t.string();
    const b = a.minLength(3);
    expect(a).not.toBe(b);
    expect(a.constraints.minLength).toBeUndefined();
    expect(b.constraints.minLength).toBe(3);
  });
});

describe('StringSchema — validation', () => {
  it('accepts a string', () => {
    const result = t.string().validate('hello');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('hello');
  });

  it('rejects non-strings with invalid_type', () => {
    const result = t.string().validate(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]?.code).toBe('invalid_type');
    }
  });

  it('enforces minLength', () => {
    const result = t.string().minLength(3).validate('hi');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]?.code).toBe('min_length');
  });

  it('enforces maxLength', () => {
    const result = t.string().maxLength(3).validate('hello');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]?.code).toBe('max_length');
  });

  it('enforces pattern', () => {
    const result = t.string().pattern(/^\d+$/).validate('abc');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]?.code).toBe('pattern');
  });

  it('collects multiple errors', () => {
    const result = t.string().minLength(5).pattern(/^\d+$/).validate('ab');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.map((e) => e.code).sort()).toEqual(['min_length', 'pattern']);
    }
  });

  it('treats undefined as missing for required schemas', () => {
    const result = t.string().validate(undefined);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]?.code).toBe('required');
  });

  it('accepts undefined for optional schemas', () => {
    const result = t.string().optional().validate(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeUndefined();
  });

  it('accepts null for nullable schemas', () => {
    const result = t.string().nullable().validate(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('rejects null for non-nullable schemas', () => {
    const result = t.string().validate(null);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0]?.code).toBe('not_nullable');
  });

  it('applies default when value is undefined', () => {
    const result = t.string().default('fallback').validate(undefined);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe('fallback');
  });
});

describe('StringSchema — formats', () => {
  const cases: Array<[Parameters<StringSchema['format']>[0], string, string]> = [
    ['uuid', '550e8400-e29b-41d4-a716-446655440000', 'not-a-uuid'],
    ['email', 'alice@example.com', 'not-an-email'],
    ['url', 'https://example.com', 'not a url'],
    ['date', '2026-04-10', '2026/04/10'],
    ['date-time', '2026-04-10T12:00:00Z', 'yesterday'],
    ['ipv4', '192.168.1.1', '999.999.999.999'],
  ];

  for (const [format, valid, invalid] of cases) {
    it(`accepts valid ${format}`, () => {
      expect(t.string().format(format).validate(valid).success).toBe(true);
    });
    it(`rejects invalid ${format}`, () => {
      expect(t.string().format(format).validate(invalid).success).toBe(false);
    });
  }
});

describe('StringSchema — parse()', () => {
  it('returns data on success', () => {
    expect(t.string().parse('hi')).toBe('hi');
  });

  it('throws ValidationException on failure', () => {
    expect(() => t.string().parse(42)).toThrow(ValidationException);
  });
});

describe('StringSchema — OpenAPI output', () => {
  it('emits type: string', () => {
    expect(t.string().toOpenAPI()).toEqual({ type: 'string' });
  });

  it('emits constraints', () => {
    const schema = t.string().minLength(1).maxLength(100).pattern(/^[a-z]+$/).format('email').toOpenAPI();
    expect(schema).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-z]+$',
      format: 'email',
    });
  });

  it('emits description, example, deprecated, default', () => {
    const schema = t
      .string()
      .doc('The pet name')
      .example('Buddy')
      .deprecated()
      .default('Rex')
      .toOpenAPI();
    expect(schema).toMatchObject({
      type: 'string',
      description: 'The pet name',
      example: 'Buddy',
      deprecated: true,
      default: 'Rex',
    });
  });

  it('represents nullable as union type in 3.1', () => {
    const schema = t.string().nullable().toOpenAPI();
    expect(schema.type).toEqual(['string', 'null']);
  });

  it('marks identity fields with x-triad-identity', () => {
    const schema = t.string().identity().toOpenAPI();
    expect(schema['x-triad-identity']).toBe('true');
  });
});
