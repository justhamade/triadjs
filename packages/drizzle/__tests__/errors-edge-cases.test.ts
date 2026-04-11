/**
 * Phase 24 — behavior-coverage audit: isUniqueViolation edge cases
 * across driver-error shapes that the main test suite skipped.
 */

import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';

describe('isUniqueViolation — edge cases on the input shape', () => {
  it('returns null for a plain string throwable', () => {
    expect(isUniqueViolation('boom')).toBeNull();
  });

  it('returns null for a numeric throwable', () => {
    expect(isUniqueViolation(0)).toBeNull();
    expect(isUniqueViolation(404)).toBeNull();
  });

  it('returns null for a boolean throwable', () => {
    expect(isUniqueViolation(false)).toBeNull();
    expect(isUniqueViolation(true)).toBeNull();
  });

  it('returns null for an object whose code is a non-string type', () => {
    const err = { code: 23505, message: 'duplicate key' };
    // readString requires code to be string; 23505 as a number is not recognized.
    expect(isUniqueViolation(err)).toBeNull();
  });

  it('returns null for an object with an unrelated code', () => {
    expect(isUniqueViolation({ code: '42P01', message: 'relation does not exist' })).toBeNull();
  });

  it('returns {} for better-sqlite3 when the message lacks a table.column phrase', () => {
    const err = Object.assign(new Error('constraint violated'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(isUniqueViolation(err)).toEqual({});
  });

  it('returns {} for pg 23505 when there is no structured detail', () => {
    const err = { code: '23505', message: 'duplicate' };
    expect(isUniqueViolation(err)).toEqual({});
  });

  it('parses pg detail fallback when column field is absent', () => {
    const err = {
      code: '23505',
      message: 'dup',
      detail: 'Key (slug)=(my-post) already exists.',
    };
    expect(isUniqueViolation(err)).toEqual({ column: 'slug' });
  });

  it('ignores pg detail when it has no "Key (...)" clause', () => {
    const err = { code: '23505', message: 'dup', detail: 'something vague' };
    expect(isUniqueViolation(err)).toEqual({});
  });

  it('detects SQLITE_CONSTRAINT only when the message references UNIQUE', () => {
    const foreign = {
      code: 'SQLITE_CONSTRAINT',
      message: 'FOREIGN KEY constraint failed',
    };
    expect(isUniqueViolation(foreign)).toBeNull();
  });

  it('survives a frozen error object without throwing', () => {
    const err = Object.freeze(
      Object.assign(new Error('UNIQUE constraint failed: t.c'), {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
      }),
    );
    expect(() => isUniqueViolation(err)).not.toThrow();
    expect(isUniqueViolation(err)).toEqual({ table: 't', column: 'c' });
  });

  it('returns null for a circular object with no recognised code', () => {
    const err: Record<string, unknown> = { message: 'x' };
    err['self'] = err;
    expect(isUniqueViolation(err)).toBeNull();
  });
});
