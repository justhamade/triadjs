/**
 * Behaviour tests for the TypeScript type emitter.
 *
 * Drives the `TypeEmitter` through the full SchemaNode surface to make
 * sure each primitive and combinator lowers to a sensible TS type.
 */

import { describe, it, expect } from 'vitest';
import { t } from '@triad/core';
import { TypeEmitter } from '../src/schema-to-ts.js';

describe('TypeEmitter', () => {
  it('emits primitives as TypeScript types', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.string())).toBe('string');
    expect(emitter.emitType(t.int32())).toBe('number');
    expect(emitter.emitType(t.int64())).toBe('number');
    expect(emitter.emitType(t.float32())).toBe('number');
    expect(emitter.emitType(t.float64())).toBe('number');
    expect(emitter.emitType(t.boolean())).toBe('boolean');
    expect(emitter.emitType(t.datetime())).toBe('string');
    expect(emitter.emitType(t.unknown())).toBe('unknown');
    expect(emitter.emitType(t.empty())).toBe('void');
  });

  it('emits enums as string literal unions', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.enum('dog', 'cat', 'bird'))).toBe('"dog" | "cat" | "bird"');
  });

  it('emits literals as their JSON value', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.literal('ok'))).toBe('"ok"');
    expect(emitter.emitType(t.literal(42))).toBe('42');
    expect(emitter.emitType(t.literal(true))).toBe('true');
  });

  it('emits arrays of primitives with [] notation', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.array(t.string()))).toBe('string[]');
    expect(emitter.emitType(t.array(t.int32()))).toBe('number[]');
  });

  it('wraps union element arrays in Array<T>', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.array(t.union(t.string(), t.int32())))).toBe(
      'Array<string | number>',
    );
  });

  it('emits records as Record<string, T>', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.record(t.string(), t.unknown()))).toBe('Record<string, unknown>');
  });

  it('emits tuples as positional tuple types', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.tuple(t.string(), t.int32(), t.boolean()))).toBe(
      '[string, number, boolean]',
    );
  });

  it('emits unions as pipe-separated types', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.union(t.string(), t.int32(), t.boolean()))).toBe(
      'string | number | boolean',
    );
  });

  it('wraps nullable in "(T) | null"', () => {
    const emitter = new TypeEmitter();
    expect(emitter.emitType(t.string().nullable())).toBe('(string) | null');
  });

  it('emits a named model as an interface and references it by name', () => {
    const emitter = new TypeEmitter();
    const Book = t.model('Book', {
      id: t.string().doc('Book id'),
      title: t.string(),
      publishedYear: t.int32(),
      tags: t.array(t.string()).optional(),
    });
    const ref = emitter.emitType(Book);
    expect(ref).toBe('Book');
    const named = emitter.namedTypes();
    expect(named.length).toBe(1);
    const src = named[0]!.source;
    expect(src).toContain('export interface Book {');
    expect(src).toContain('/** Book id */');
    expect(src).toContain('id: string;');
    expect(src).toContain('title: string;');
    expect(src).toContain('publishedYear: number;');
    expect(src).toContain('tags?: string[];');
  });

  it('emits nested named models once with references preserved', () => {
    const emitter = new TypeEmitter();
    const Review = t.model('Review', {
      id: t.string(),
      rating: t.int32(),
    });
    const Book = t.model('Book', {
      id: t.string(),
      title: t.string(),
      reviews: t.array(Review),
    });
    emitter.emitType(Book);
    const named = emitter.namedTypes();
    expect(named.map((n) => n.name).sort()).toEqual(['Book', 'Review']);
    const bookSrc = named.find((n) => n.name === 'Book')!.source;
    expect(bookSrc).toContain('reviews: Review[];');
  });

  it('emits enum field as a literal union inside an interface', () => {
    const emitter = new TypeEmitter();
    const Pet = t.model('Pet', {
      species: t.enum('dog', 'cat'),
    });
    emitter.emitType(Pet);
    const src = emitter.namedTypes()[0]!.source;
    expect(src).toContain('species: "dog" | "cat";');
  });

  it('treats t.value around a primitive as a transparent alias', () => {
    const emitter = new TypeEmitter();
    const Email = t.value('Email', t.string().format('email'));
    expect(emitter.emitType(Email)).toBe('string');
    expect(emitter.namedTypes().length).toBe(0);
  });

  it('treats t.value around a shape as a named interface', () => {
    const emitter = new TypeEmitter();
    const Money = t.value('Money', {
      amount: t.float64(),
      currency: t.enum('USD', 'EUR'),
    });
    expect(emitter.emitType(Money)).toBe('Money');
    const src = emitter.namedTypes()[0]!.source;
    expect(src).toContain('export interface Money {');
    expect(src).toContain('amount: number;');
    expect(src).toContain('currency: "USD" | "EUR";');
  });

  it('emits optional fields with a ? suffix', () => {
    const emitter = new TypeEmitter();
    const Thing = t.model('Thing', {
      required: t.string(),
      maybe: t.string().optional(),
    });
    emitter.emitType(Thing);
    const src = emitter.namedTypes()[0]!.source;
    expect(src).toContain('required: string;');
    expect(src).toContain('maybe?: string;');
  });

  it('registers a named type from a raw shape via emitNamedFromShape', () => {
    const emitter = new TypeEmitter();
    emitter.emitNamedFromShape('Params', {
      bookId: t.string().doc('Book id'),
      force: t.boolean().optional(),
    });
    const named = emitter.namedTypes();
    expect(named).toHaveLength(1);
    expect(named[0]!.name).toBe('Params');
    expect(named[0]!.source).toContain('bookId: string;');
    expect(named[0]!.source).toContain('force?: boolean;');
  });
});
