import { describe, it, expect } from 'vitest';
import { t } from '@triadjs/core';
import { describeSchema } from '../src/descriptor.js';

describe('describeSchema', () => {
  it('describes a string field', () => {
    const d = describeSchema(t.string());
    expect(d).toEqual({ kind: 'string', optional: false, nullable: false });
  });

  it('describes an optional number field', () => {
    const d = describeSchema(t.int32().optional());
    expect(d.kind).toBe('number');
    expect(d.optional).toBe(true);
  });

  it('describes a nullable boolean field', () => {
    const d = describeSchema(t.boolean().nullable());
    expect(d.kind).toBe('boolean');
    expect(d.nullable).toBe(true);
  });

  it('describes an enum with its values', () => {
    const d = describeSchema(t.enum('draft', 'published'));
    expect(d.kind).toBe('enum');
    expect(d.values).toEqual(['draft', 'published']);
  });

  it('describes a model as an object with nested field descriptors', () => {
    const Create = t.model('CreateBook', {
      title: t.string(),
      year: t.int32(),
      published: t.boolean().optional(),
    });
    const d = describeSchema(Create);
    expect(d.kind).toBe('object');
    expect(d.fields?.title).toMatchObject({ kind: 'string', optional: false });
    expect(d.fields?.year).toMatchObject({ kind: 'number' });
    expect(d.fields?.published).toMatchObject({ kind: 'boolean', optional: true });
  });

  it('describes arrays of strings', () => {
    const d = describeSchema(t.array(t.string()));
    expect(d.kind).toBe('array');
    expect(d.item?.kind).toBe('string');
  });

  it('describes nested models', () => {
    const Author = t.model('Author', { name: t.string() });
    const Book = t.model('Book', { title: t.string(), author: Author });
    const d = describeSchema(Book);
    expect(d.fields?.author?.kind).toBe('object');
    expect(d.fields?.author?.fields?.name?.kind).toBe('string');
  });
});
