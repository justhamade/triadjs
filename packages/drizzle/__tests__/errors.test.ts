import { describe, it, expect } from 'vitest';
import { isUniqueViolation } from '../src/errors.js';

describe('isUniqueViolation', () => {
  it('detects better-sqlite3 errors and parses table.column', () => {
    const err = Object.assign(new Error('UNIQUE constraint failed: users.email'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(isUniqueViolation(err)).toEqual({ table: 'users', column: 'email' });
  });

  it('detects SQLITE_CONSTRAINT with a UNIQUE message (WASM/edge build)', () => {
    const err = Object.assign(
      new Error('UNIQUE constraint failed: books.isbn'),
      { code: 'SQLITE_CONSTRAINT' },
    );
    expect(isUniqueViolation(err)).toEqual({ table: 'books', column: 'isbn' });
  });

  it('returns {} for better-sqlite3 when the message cannot be parsed', () => {
    const err = Object.assign(new Error('something bad'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(isUniqueViolation(err)).toEqual({});
  });

  it('detects node-postgres errors by SQLSTATE 23505 and reads structured fields', () => {
    const err = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      table: 'users',
      column: 'email',
      constraint: 'users_email_key',
    });
    expect(isUniqueViolation(err)).toEqual({
      table: 'users',
      column: 'email',
      constraint: 'users_email_key',
    });
  });

  it('falls back to parsing pg `detail` for the column name', () => {
    const err = Object.assign(new Error('duplicate'), {
      code: '23505',
      detail: 'Key (email)=(alice@example.com) already exists.',
    });
    expect(isUniqueViolation(err)).toEqual({ column: 'email' });
  });

  it('detects mysql2 errors and parses the `key` into table/constraint', () => {
    const err = Object.assign(
      new Error(
        "Duplicate entry 'alice@example.com' for key 'users.email_unique'",
      ),
      { code: 'ER_DUP_ENTRY' },
    );
    expect(isUniqueViolation(err)).toEqual({
      table: 'users',
      constraint: 'email_unique',
    });
  });

  it('detects mysql2 errors with a single-part key (older mysql)', () => {
    const err = Object.assign(
      new Error("Duplicate entry 'alice' for key 'email_unique'"),
      { code: 'ER_DUP_ENTRY' },
    );
    expect(isUniqueViolation(err)).toEqual({ constraint: 'email_unique' });
  });

  it('returns null for non-unique constraint errors', () => {
    const err = Object.assign(new Error('permission denied'), {
      code: '42501',
    });
    expect(isUniqueViolation(err)).toBeNull();
  });

  it('returns null for plain Error objects with no code', () => {
    expect(isUniqueViolation(new Error('random'))).toBeNull();
  });

  it('returns null for undefined and null', () => {
    expect(isUniqueViolation(undefined)).toBeNull();
    expect(isUniqueViolation(null)).toBeNull();
  });

  it('returns null for non-object throwables (strings, numbers)', () => {
    expect(isUniqueViolation('boom')).toBeNull();
    expect(isUniqueViolation(42)).toBeNull();
  });
});
