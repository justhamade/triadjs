import { describe, expect, it } from 'vitest';
import { t, EmptySchema, isEmptySchema } from '../../src/schema/index.js';
import { ValidationException } from '../../src/schema/types.js';

describe('EmptySchema', () => {
  it('parse(undefined) returns undefined and does not throw', () => {
    expect(t.empty().parse(undefined)).toBeUndefined();
  });

  it('validate(undefined) succeeds', () => {
    const result = t.empty().validate(undefined);
    expect(result.success).toBe(true);
  });

  it.each([
    ['null', null],
    ['empty object', {}],
    ['empty string', ''],
    ['number 0', 0],
    ['false', false],
    ['array', []],
  ])('rejects %s', (_label, value) => {
    expect(() => t.empty().parse(value)).toThrow(ValidationException);
    expect(t.empty().validate(value).success).toBe(false);
  });

  it('reports a descriptive error on non-empty input', () => {
    const result = t.empty().validate({ oops: true });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.errors[0]?.code).toBe('empty_body_expected');
    }
  });

  it('emits a marker OpenAPI shape (consumed by the generator)', () => {
    const openapi = t.empty().toOpenAPI() as unknown as Record<string, unknown>;
    expect(openapi['x-triad-empty']).toBe(true);
  });

  it('is recognized by isEmptySchema', () => {
    expect(isEmptySchema(t.empty())).toBe(true);
  });

  it('isEmptySchema returns false for unrelated schemas', () => {
    expect(isEmptySchema(t.unknown())).toBe(false);
    expect(isEmptySchema(t.string())).toBe(false);
    expect(isEmptySchema(t.unknown().optional())).toBe(false);
    expect(isEmptySchema(undefined)).toBe(false);
    expect(isEmptySchema(null)).toBe(false);
    expect(isEmptySchema({})).toBe(false);
  });

  it('instances satisfy the EmptySchema class check', () => {
    expect(t.empty()).toBeInstanceOf(EmptySchema);
  });
});
