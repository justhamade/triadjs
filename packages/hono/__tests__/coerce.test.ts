/**
 * Phase 24 — unit tests for the Hono coerce helper. Exercises the
 * type-coercion branches that the existing integration test only
 * covers indirectly.
 */

import { describe, expect, it } from 'vitest';
import { t } from '@triadjs/core';
import { coerceScalar, coerceByShape } from '../src/coerce.js';

describe('coerceScalar — Hono', () => {
  it('parses "42" to 42 for int32', () => {
    expect(coerceScalar(t.int32(), '42')).toBe(42);
  });

  it('parses "3.14" to 3.14 for float64', () => {
    expect(coerceScalar(t.float64(), '3.14')).toBe(3.14);
  });

  it('leaves the empty string alone for number schemas', () => {
    expect(coerceScalar(t.int32(), '')).toBe('');
  });

  it('leaves non-numeric strings alone for number schemas', () => {
    expect(coerceScalar(t.int32(), 'abc')).toBe('abc');
  });

  it('converts "true" and "false" to booleans', () => {
    expect(coerceScalar(t.boolean(), 'true')).toBe(true);
    expect(coerceScalar(t.boolean(), 'false')).toBe(false);
  });

  it('leaves "1" and "0" alone for boolean schemas (no numeric truthiness)', () => {
    expect(coerceScalar(t.boolean(), '1')).toBe('1');
    expect(coerceScalar(t.boolean(), '0')).toBe('0');
  });

  it('passes non-string inputs through unchanged', () => {
    expect(coerceScalar(t.int32(), 42)).toBe(42);
    expect(coerceScalar(t.boolean(), true)).toBe(true);
    expect(coerceScalar(t.string(), null)).toBeNull();
  });

  it('passes string schemas through untouched', () => {
    expect(coerceScalar(t.string(), '42')).toBe('42');
    expect(coerceScalar(t.string(), '')).toBe('');
  });
});

describe('coerceByShape — Hono', () => {
  const shape = {
    id: t.string(),
    limit: t.int32(),
    active: t.boolean(),
  };

  it('coerces every field according to its declared kind', () => {
    expect(
      coerceByShape(shape, { id: 'abc', limit: '10', active: 'true' }),
    ).toEqual({ id: 'abc', limit: 10, active: true });
  });

  it('returns {} for null, undefined, and primitive inputs', () => {
    expect(coerceByShape(shape, null)).toEqual({});
    expect(coerceByShape(shape, undefined)).toEqual({});
    expect(coerceByShape(shape, 'string')).toEqual({});
    expect(coerceByShape(shape, 42)).toEqual({});
  });

  it('surfaces missing fields as undefined', () => {
    const out = coerceByShape(shape, { id: 'abc' });
    expect(out.limit).toBeUndefined();
    expect(out.active).toBeUndefined();
  });

  it('does not mutate the input object', () => {
    const input = { id: 'a', limit: '5', active: 'true' };
    coerceByShape(shape, input);
    expect(input).toEqual({ id: 'a', limit: '5', active: 'true' });
  });
});
