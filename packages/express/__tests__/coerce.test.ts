import { describe, expect, it } from 'vitest';
import { t } from '@triad/core';
import { coerceScalar, coerceByShape } from '../src/coerce.js';

describe('coerceScalar', () => {
  it('parses numeric strings for number schemas', () => {
    expect(coerceScalar(t.int32(), '42')).toBe(42);
    expect(coerceScalar(t.float64(), '3.14')).toBe(3.14);
  });

  it('leaves non-numeric strings alone so validation can reject them', () => {
    expect(coerceScalar(t.int32(), 'abc')).toBe('abc');
  });

  it('converts "true"/"false" to booleans', () => {
    expect(coerceScalar(t.boolean(), 'true')).toBe(true);
    expect(coerceScalar(t.boolean(), 'false')).toBe(false);
  });

  it('leaves other boolean-ish strings alone', () => {
    expect(coerceScalar(t.boolean(), 'maybe')).toBe('maybe');
    expect(coerceScalar(t.boolean(), '1')).toBe('1');
  });

  it('passes strings through for string schemas', () => {
    expect(coerceScalar(t.string(), 'hello')).toBe('hello');
    expect(coerceScalar(t.string(), '42')).toBe('42');
  });

  it('passes non-string input through unchanged', () => {
    expect(coerceScalar(t.int32(), 42)).toBe(42);
    expect(coerceScalar(t.boolean(), true)).toBe(true);
  });
});

describe('coerceByShape', () => {
  const shape = {
    id: t.string(),
    limit: t.int32(),
    active: t.boolean(),
  };

  it('coerces each field based on its schema', () => {
    expect(
      coerceByShape(shape, { id: 'abc', limit: '10', active: 'true' }),
    ).toEqual({ id: 'abc', limit: 10, active: true });
  });

  it('preserves fields whose schema is not coercible', () => {
    expect(coerceByShape(shape, { id: 'abc', limit: '5', active: 'false' })).toEqual({
      id: 'abc',
      limit: 5,
      active: false,
    });
  });

  it('returns empty object when input is null/undefined/non-object', () => {
    expect(coerceByShape(shape, null)).toEqual({});
    expect(coerceByShape(shape, undefined)).toEqual({});
    expect(coerceByShape(shape, 'string')).toEqual({});
  });

  it('missing fields come through as undefined', () => {
    const result = coerceByShape(shape, { id: 'abc' });
    expect(result.id).toBe('abc');
    expect(result.limit).toBeUndefined();
    expect(result.active).toBeUndefined();
  });
});
