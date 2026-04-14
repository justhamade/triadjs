import { describe, it, expect } from 'vitest';
import { extractResource, flatKeyFor, emitKeyFactory, singularize, toPascal } from '../src/query-keys.js';
import { endpoint, t } from '@triadjs/core';

describe('extractResource', () => {
  it('returns resource info for a flat list path', () => {
    const info = extractResource('/books');
    expect(info?.resource).toBe('books');
    expect(info?.base).toBe('Book');
    expect(info?.factoryName).toBe('bookKeys');
    expect(info?.idParam).toBeUndefined();
  });

  it('returns id param for a detail path', () => {
    const info = extractResource('/books/:bookId');
    expect(info?.resource).toBe('books');
    expect(info?.idParam).toBe('bookId');
    expect(info?.factoryName).toBe('bookKeys');
  });

  it('uses the last non-parameter segment for nested routes', () => {
    const info = extractResource('/projects/:projectId/tasks');
    expect(info?.resource).toBe('tasks');
    expect(info?.base).toBe('Task');
  });

  it('handles a nested detail route', () => {
    const info = extractResource('/books/:bookId/reviews/:reviewId');
    expect(info?.resource).toBe('reviews');
    expect(info?.idParam).toBe('reviewId');
  });

  it('falls back to a non-plural resource without blowing up', () => {
    const info = extractResource('/me');
    expect(info?.resource).toBe('me');
    expect(info?.base).toBe('Me');
  });
});

describe('singularize', () => {
  it('handles common plural forms', () => {
    expect(singularize('books')).toBe('book');
    expect(singularize('stories')).toBe('story');
    expect(singularize('classes')).toBe('class');
    expect(singularize('boxes')).toBe('box');
    expect(singularize('user')).toBe('user');
  });
});

describe('toPascal', () => {
  it('converts kebab/snake/spaced names', () => {
    expect(toPascal('book-shelf')).toBe('BookShelf');
    expect(toPascal('book_shelf')).toBe('BookShelf');
    expect(toPascal('book shelf')).toBe('BookShelf');
  });
});

describe('flatKeyFor', () => {
  it('produces a flat tuple key from the endpoint path', () => {
    const login = endpoint({
      name: 'login',
      method: 'POST',
      path: '/auth/login',
      summary: 'Log in',
      request: { body: t.model('LoginBody', { email: t.string(), password: t.string() }) },
      responses: {
        200: { schema: t.model('AuthResult', { token: t.string() }), description: 'OK' },
      },
      handler: async (ctx) => ctx.respond[200]({ token: 't' }),
    });
    const key = flatKeyFor(login);
    expect(key.name).toBe('loginKey');
    expect(key.value).toBe('["auth", "login"] as const');
  });
});

describe('emitKeyFactory', () => {
  it('emits a list + detail factory for a resource with an id param', () => {
    const src = emitKeyFactory(
      { resource: 'books', base: 'Book', factoryName: 'bookKeys', idParam: 'bookId' },
      'ListBooksQuery',
    );
    expect(src).toContain(`export const bookKeys = {`);
    expect(src).toContain(`all: ["books"] as const,`);
    expect(src).toContain(`lists: () => [...bookKeys.all, 'list'] as const,`);
    expect(src).toContain(`list: (params?: ListBooksQuery)`);
    expect(src).toContain(`detail: (id: string)`);
  });

  it('omits the detail key when no id param is known', () => {
    const src = emitKeyFactory(
      { resource: 'things', base: 'Thing', factoryName: 'thingKeys' },
      undefined,
    );
    expect(src).toContain('export const thingKeys');
    expect(src).not.toContain('detail: (id: string)');
  });
});
