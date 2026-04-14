import { describe, it, expect } from 'vitest';
import { endpoint, t } from '@triadjs/core';
import { TypeEmitter } from '@triadjs/tanstack-query';
import { renderSolidHook } from '../src/hook-generator.js';

const Book = t.model('Book', {
  id: t.string(),
  title: t.string(),
  year: t.int32(),
});

const CreateBook = t.model('CreateBook', {
  title: t.string(),
  year: t.int32(),
});

const BookPage = t.model('BookPage', {
  items: t.array(Book),
  nextCursor: t.string().nullable(),
});

const HttpErrorModel = t.model('HttpErrorModel', {
  code: t.string(),
  message: t.string(),
});

const listBooks = endpoint({
  name: 'listBooks',
  method: 'GET',
  path: '/books',
  summary: 'List books',
  request: {
    query: { limit: t.int32().default(20), cursor: t.string().optional() },
  },
  responses: { 200: { schema: BookPage, description: 'OK' } },
  handler: async (ctx) => ctx.respond[200]({ items: [], nextCursor: null }),
});

const getBook = endpoint({
  name: 'getBook',
  method: 'GET',
  path: '/books/:bookId',
  summary: 'Get a book',
  request: { params: { bookId: t.string() } },
  responses: {
    200: { schema: Book, description: 'OK' },
    404: { schema: HttpErrorModel, description: 'Not found' },
  },
  handler: async (ctx) => ctx.respond[200]({ id: '1', title: 't', year: 2020 }),
});

const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Create',
  request: { body: CreateBook },
  responses: { 201: { schema: Book, description: 'Created' } },
  handler: async (ctx) => ctx.respond[201]({ id: '1', title: 't', year: 2020 }),
});

const updateBook = endpoint({
  name: 'updateBook',
  method: 'PATCH',
  path: '/books/:bookId',
  summary: 'Update',
  request: { params: { bookId: t.string() }, body: CreateBook },
  responses: { 200: { schema: Book, description: 'OK' } },
  handler: async (ctx) => ctx.respond[200]({ id: '1', title: 't', year: 2020 }),
});

const deleteBook = endpoint({
  name: 'deleteBook',
  method: 'DELETE',
  path: '/books/:bookId',
  summary: 'Delete',
  request: { params: { bookId: t.string() } },
  responses: { 204: { schema: t.empty(), description: 'Gone' } },
  handler: async (ctx) => ctx.respond[204](),
});

function resource(name: string): { factoryName: string; resource: string; base: string; idParam?: string } {
  return { factoryName: `${name}Keys`, resource: `${name}s`, base: name, idParam: `${name}Id` };
}

describe('renderSolidHook — queries', () => {
  it('emits createQuery wrapped in a thunk for a list endpoint', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(listBooks, emitter, {
      availableResources: new Map([['books', { factoryName: 'bookKeys', resource: 'books', base: 'Book' }]]),
      resource: { factoryName: 'bookKeys', resource: 'books', base: 'Book' },
    });
    expect(hook.source).toContain('export function useListBooks');
    expect(hook.source).toContain('createQuery(() => (');
    expect(hook.source).toContain('query: () => ListBooksQuery');
    expect(hook.source).toContain('bookKeys.list(query())');
  });

  it('passes path params as an accessor and unwraps inside the path', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(getBook, emitter, {
      availableResources: new Map(),
      resource: { factoryName: 'bookKeys', resource: 'books', base: 'Book', idParam: 'bookId' },
    });
    expect(hook.source).toContain('params: () => GetBookParams');
    expect(hook.source).toContain('`/books/${params().bookId}`');
    expect(hook.source).toContain('bookKeys.detail(params().bookId)');
  });

  it('hook name drops the Get prefix for GET-by-id endpoints', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(getBook, emitter, {
      availableResources: new Map(),
      resource: { factoryName: 'bookKeys', resource: 'books', base: 'Book', idParam: 'bookId' },
    });
    expect(hook.name).toBe('useBook');
  });
});

describe('renderSolidHook — mutations', () => {
  it('emits createMutation for POST with typed variables', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(createBook, emitter, {
      availableResources: new Map(),
      resource: resource('book'),
    });
    expect(hook.source).toContain('export function useCreateBook');
    expect(hook.source).toContain('createMutation(() => (');
    expect(hook.source).toContain('{ body: CreateBook }');
    expect(hook.source).toContain("client.post<Book>(`/books`, { body: vars.body })");
  });

  it('invalidates the list query on successful create', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(createBook, emitter, {
      availableResources: new Map(),
      resource: resource('book'),
    });
    expect(hook.source).toContain('qc.invalidateQueries({ queryKey: bookKeys.lists() });');
  });

  it('invalidates detail + lists on PATCH', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: resource('book'),
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
    expect(hook.source).toContain('bookKeys.lists()');
  });

  it('invalidates detail + lists on DELETE', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(deleteBook, emitter, {
      availableResources: new Map(),
      resource: resource('book'),
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
    expect(hook.source).toContain('bookKeys.lists()');
  });

  it('uses void variables type when there are no args', () => {
    const ping = endpoint({
      name: 'ping',
      method: 'POST',
      path: '/ping',
      summary: 'ping',
      request: {},
      responses: { 200: { schema: t.empty(), description: 'ok' } },
      handler: async (ctx) => ctx.respond[200](),
    });
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(ping, emitter, { availableResources: new Map() });
    expect(hook.source).toContain('export function usePing');
    expect(hook.source).toContain(', void');
  });

  it('path params in mutation paths use vars.params (not params)', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: resource('book'),
    });
    expect(hook.source).toContain('`/books/${vars.params.bookId}`');
  });
});

describe('renderSolidHook — type refs', () => {
  it('collects type references for named success bodies', () => {
    const emitter = new TypeEmitter();
    const hook = renderSolidHook(getBook, emitter, {
      availableResources: new Map(),
      resource: { factoryName: 'bookKeys', resource: 'books', base: 'Book', idParam: 'bookId' },
    });
    expect(hook.typeRefs.has('Book')).toBe(true);
    expect(hook.typeRefs.has('GetBookParams')).toBe(true);
  });
});
