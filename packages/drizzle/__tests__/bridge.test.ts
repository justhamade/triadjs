import { describe, expect, it } from 'vitest';
import { t, ValidationException } from '@triadjs/core';
import {
  validateAgainst,
  validateAgainstSafe,
  findPrimaryKey,
} from '../src/index.js';

const Pet = t.model('Pet', {
  id: t.string().format('uuid').storage({ primaryKey: true }),
  name: t.string().minLength(1),
  age: t.int32().min(0),
});

describe('validateAgainst', () => {
  it('returns typed data when the row matches', () => {
    const row = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Buddy',
      age: 3,
    };
    const pet = validateAgainst(Pet, row);
    expect(pet.id).toBe(row.id);
    expect(pet.name).toBe('Buddy');
    expect(pet.age).toBe(3);
  });

  it('throws ValidationException when the row drifts from the schema', () => {
    const row = { id: 'not-a-uuid', name: 'Buddy', age: 3 };
    expect(() => validateAgainst(Pet, row)).toThrow(ValidationException);
  });

  it('throws when required fields are missing', () => {
    expect(() =>
      validateAgainst(Pet, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Buddy',
      }),
    ).toThrow(ValidationException);
  });
});

describe('validateAgainstSafe', () => {
  it('returns success:true with data when valid', () => {
    const result = validateAgainstSafe(Pet, {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Rex',
      age: 5,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Rex');
  });

  it('returns success:false with errors when invalid', () => {
    const result = validateAgainstSafe(Pet, { id: 'bad', name: '', age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('findPrimaryKey', () => {
  it('returns the field marked with storage.primaryKey', () => {
    expect(findPrimaryKey(Pet)).toBe('id');
  });

  it('returns undefined when no field is marked', () => {
    const Unmarked = t.model('Unmarked', {
      a: t.string(),
      b: t.int32(),
    });
    expect(findPrimaryKey(Unmarked)).toBeUndefined();
  });

  it('returns the first marked field for composite scenarios', () => {
    const Composite = t.model('Composite', {
      tenantId: t.string().storage({ primaryKey: true }),
      userId: t.string().storage({ primaryKey: true }),
      name: t.string(),
    });
    expect(findPrimaryKey(Composite)).toBe('tenantId');
  });
});
