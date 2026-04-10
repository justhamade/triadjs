import { describe, expect, it } from 'vitest';
import { substitute, substituteString } from '../src/substitute.js';

describe('substituteString', () => {
  it('replaces a single token with a string fixture', () => {
    expect(substituteString('pet {id}', { id: 'abc' })).toBe('pet abc');
  });

  it('replaces multiple tokens in one string', () => {
    expect(substituteString('/{a}/{b}', { a: 'x', b: 'y' })).toBe('/x/y');
  });

  it('whole-string token preserves native type for non-strings', () => {
    expect(substituteString('{limit}', { limit: 10 })).toBe(10);
    expect(substituteString('{active}', { active: true })).toBe(true);
    expect(substituteString('{data}', { data: { nested: 1 } })).toEqual({ nested: 1 });
  });

  it('partial token always produces a string', () => {
    expect(substituteString('limit={limit}', { limit: 10 })).toBe('limit=10');
  });

  it('unknown tokens pass through untouched', () => {
    expect(substituteString('pet {missing}', {})).toBe('pet {missing}');
  });

  it('ignores non-token curly braces', () => {
    expect(substituteString('a{b c}d', {})).toBe('a{b c}d');
  });
});

describe('substitute (recursive)', () => {
  it('walks arrays', () => {
    expect(substitute(['{a}', '{b}'], { a: 1, b: 2 })).toEqual([1, 2]);
  });

  it('walks objects', () => {
    expect(
      substitute({ id: '{petId}', name: 'Buddy' }, { petId: 'abc-123' }),
    ).toEqual({ id: 'abc-123', name: 'Buddy' });
  });

  it('walks deeply nested structures', () => {
    const input = {
      outer: { inner: ['{x}', { deep: '{y}' }] },
    };
    expect(substitute(input, { x: 1, y: 'z' })).toEqual({
      outer: { inner: [1, { deep: 'z' }] },
    });
  });

  it('leaves primitives unchanged', () => {
    expect(substitute(42, {})).toBe(42);
    expect(substitute(true, {})).toBe(true);
    expect(substitute(null, {})).toBe(null);
    expect(substitute(undefined, {})).toBe(undefined);
  });

  it('returns new objects (does not mutate input)', () => {
    const input = { a: '{x}' };
    const result = substitute(input, { x: 'y' });
    expect(result).not.toBe(input);
    expect(input.a).toBe('{x}');
  });
});
