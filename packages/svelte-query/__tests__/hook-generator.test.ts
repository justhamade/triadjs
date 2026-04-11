import { describe, it, expect } from 'vitest';
import { endpoint, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { renderSvelteHook, svelteFactoryName } from '../src/hook-generator.js';

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

const listBooks = endpoint({
  name: 'listBooks',
  method: 'GET',
  path: '/books',
  summary: 'List',
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
  summary: 'Get',
  request: { params: { bookId: t.string() } },
  responses: { 200: { schema: Book, description: 'OK' } },
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

const bookResource = { factoryName: 'bookKeys', resource: 'books', base: 'Book', idParam: 'bookId' };

describe('svelteFactoryName', () => {
  it('returns createXxxQuery for GET endpoints', () => {
    expect(svelteFactoryName(listBooks)).toBe('createListBooksQuery');
  });

  it('drops the Get prefix for GET-by-id endpoints', () => {
    expect(svelteFactoryName(getBook)).toBe('createBookQuery');
  });

  it('returns createXxxMutation for mutations', () => {
    expect(svelteFactoryName(createBook)).toBe('createCreateBookMutation');
    expect(svelteFactoryName(deleteBook)).toBe('createDeleteBookMutation');
  });
});

describe('renderSvelteHook — queries', () => {
  it('emits createQuery with plain value args', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(listBooks, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('export function createListBooksQuery');
    expect(hook.source).toContain('query: ListBooksQuery');
    expect(hook.source).toContain('createQuery({');
    expect(hook.source).toContain('bookKeys.list(query)');
  });

  it('uses params directly in detail query paths', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(getBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('params: GetBookParams');
    expect(hook.source).toContain('`/books/${params.bookId}`');
    expect(hook.source).toContain('bookKeys.detail(params.bookId)');
  });
});

describe('renderSvelteHook — mutations', () => {
  it('emits createMutation for POST', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(createBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('export function createCreateBookMutation');
    expect(hook.source).toContain('createMutation({');
    expect(hook.source).toContain('{ body: CreateBook }');
  });

  it('invalidates resource lists on POST', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(createBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('qc.invalidateQueries({ queryKey: bookKeys.lists() });');
  });

  it('invalidates detail + lists on PATCH', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
    expect(hook.source).toContain('bookKeys.lists()');
  });

  it('invalidates detail + lists on DELETE', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(deleteBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
  });

  it('mutation paths reference vars.params', () => {
    const emitter = new TypeEmitter();
    const hook = renderSvelteHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('`/books/${vars.params.bookId}`');
  });
});
