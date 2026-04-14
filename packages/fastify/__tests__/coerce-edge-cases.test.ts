/**
 * Phase 24 — extra coerce-helper edge cases for the Fastify adapter.
 */

import { describe, expect, it } from 'vitest';
import { t } from '@triadjs/core';
import { coerceScalar, coerceByShape } from '../src/coerce.js';

describe('coerceScalar — Fastify edge cases', () => {
  it('returns the empty string unchanged for number schemas', () => {
    expect(coerceScalar(t.int32(), '')).toBe('');
  });

  it('does not coerce "on"/"off" for boolean schemas', () => {
    expect(coerceScalar(t.boolean(), 'on')).toBe('on');
    expect(coerceScalar(t.boolean(), 'off')).toBe('off');
  });

  it('does not coerce arrays passed through for string schemas', () => {
    const arr = ['a', 'b'];
    expect(coerceScalar(t.string(), arr)).toBe(arr);
  });

  it('coerces "0" to the number 0 for number schemas', () => {
    expect(coerceScalar(t.int32(), '0')).toBe(0);
  });

  it('coerces "-0" to -0 for float64 schemas', () => {
    const result = coerceScalar(t.float64(), '-0');
    expect(Object.is(result, -0)).toBe(true);
  });

  it('leaves model and array schema values alone', () => {
    const model = t.model('M', { x: t.string() });
    expect(coerceScalar(model, '{"x":"y"}')).toBe('{"x":"y"}');
  });
});

describe('coerceByShape — Fastify edge cases', () => {
  it('does not include keys absent from the shape', () => {
    const shape = { id: t.string() };
    const out = coerceByShape(shape, { id: 'x', extra: 'leak' });
    expect('extra' in out).toBe(false);
  });

  it('returns {} for non-object inputs', () => {
    const shape = { id: t.string() };
    expect(coerceByShape(shape, 0)).toEqual({});
    expect(coerceByShape(shape, false)).toEqual({});
  });

  it('passes already-typed values through untouched', () => {
    const shape = { limit: t.int32(), active: t.boolean() };
    const out = coerceByShape(shape, { limit: 5, active: false });
    expect(out).toEqual({ limit: 5, active: false });
  });
});
