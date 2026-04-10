import { describe, expect, it } from 'vitest';
import { t } from '../../src/schema/index.js';

describe('.storage() metadata', () => {
  it('attaches storage hints without affecting validation', () => {
    const id = t.string().format('uuid').storage({ primaryKey: true });
    expect(id.metadata.storage?.primaryKey).toBe(true);
    expect(id.validate('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('merges repeated .storage() calls rather than overwriting', () => {
    const s = t
      .string()
      .storage({ columnName: 'user_id' })
      .storage({ indexed: true });
    expect(s.metadata.storage).toEqual({
      columnName: 'user_id',
      indexed: true,
    });
  });

  it('is immutable — chaining returns new instances', () => {
    const a = t.string();
    const b = a.storage({ primaryKey: true });
    expect(a).not.toBe(b);
    expect(a.metadata.storage).toBeUndefined();
    expect(b.metadata.storage?.primaryKey).toBe(true);
  });

  it('does not leak into OpenAPI output', () => {
    const s = t.string().doc('The user id').storage({ primaryKey: true, indexed: true });
    const openapi = s.toOpenAPI();
    expect(openapi).not.toHaveProperty('storage');
    expect(openapi).not.toHaveProperty('x-triad-storage');
    expect(openapi.description).toBe('The user id');
  });

  it('survives pick/omit/partial composition', () => {
    const Pet = t.model('Pet', {
      id: t.string().format('uuid').storage({ primaryKey: true }),
      name: t.string().storage({ indexed: true }),
    });
    const picked = Pet.pick('id');
    const field = picked.shape.id;
    expect(field.metadata.storage?.primaryKey).toBe(true);
  });

  it('works with every primitive schema', () => {
    expect(t.int32().storage({ primaryKey: true }).metadata.storage?.primaryKey).toBe(true);
    expect(t.boolean().storage({ indexed: true }).metadata.storage?.indexed).toBe(true);
    expect(t.datetime().storage({ defaultNow: true }).metadata.storage?.defaultNow).toBe(true);
  });

  it('accepts custom dialect-specific hints', () => {
    const s = t.string().storage({ custom: { collation: 'NOCASE' } });
    expect(s.metadata.storage?.custom).toEqual({ collation: 'NOCASE' });
  });
});
