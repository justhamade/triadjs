/**
 * Phase 24 — extra coerce-helper edge cases. These target value shapes
 * the existing coerce test didn't exercise: empty strings, mixed-case
 * booleans, and schema kinds that are not coerced at all.
 */

import { describe, expect, it } from 'vitest';
import { t } from '@triadjs/core';
import { coerceScalar, coerceByShape } from '../src/coerce.js';

describe('coerceScalar — extra edge cases', () => {
  it('returns the empty string unchanged for number schemas', () => {
    expect(coerceScalar(t.int32(), '')).toBe('');
  });

  it('does NOT coerce "TRUE" or "FALSE" (case sensitive)', () => {
    expect(coerceScalar(t.boolean(), 'TRUE')).toBe('TRUE');
    expect(coerceScalar(t.boolean(), 'False')).toBe('False');
  });

  it('passes through arrays for number schemas (validation handles them)', () => {
    const arr = ['1', '2'];
    expect(coerceScalar(t.int32(), arr)).toBe(arr);
  });

  it('does not touch strings for datetime schemas (no coercion branch)', () => {
    expect(coerceScalar(t.datetime(), '2026-04-10T12:00:00Z')).toBe(
      '2026-04-10T12:00:00Z',
    );
  });

  it('does not touch strings for enum schemas', () => {
    expect(coerceScalar(t.enum('a', 'b'), 'a')).toBe('a');
  });
});

describe('coerceByShape — extra edge cases', () => {
  it('does not add keys that are not in the shape', () => {
    const shape = { id: t.string() };
    const out = coerceByShape(shape, { id: 'x', extra: 'leak' });
    expect(out).toEqual({ id: 'x' });
    expect('extra' in out).toBe(false);
  });

  it('returns {} for boolean and number inputs', () => {
    const shape = { id: t.string() };
    expect(coerceByShape(shape, true)).toEqual({});
    expect(coerceByShape(shape, 42)).toEqual({});
  });

  it('preserves string fields whose raw value is already the right type', () => {
    const shape = { name: t.string(), count: t.int32() };
    const out = coerceByShape(shape, { name: 'a', count: 3 });
    expect(out).toEqual({ name: 'a', count: 3 });
  });
});
