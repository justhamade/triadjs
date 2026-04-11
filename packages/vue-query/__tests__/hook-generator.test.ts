import { describe, it, expect } from 'vitest';
import { endpoint, t } from '@triad/core';
import { TypeEmitter } from '@triad/tanstack-query';
import { renderVueHook } from '../src/hook-generator.js';

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

describe('renderVueHook — queries', () => {
  it('accepts MaybeRefOrGetter inputs and uses toValue inside the fetcher', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(listBooks, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('query: MaybeRefOrGetter<ListBooksQuery>');
    expect(hook.source).toContain('query: toValue(query)');
    expect(hook.source).toContain('bookKeys.list(toValue(query))');
  });

  it('wraps the queryKey in computed()', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(listBooks, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('queryKey: computed(() => bookKeys.list(toValue(query)))');
  });

  it('unwraps detail params via toValue inside the path literal', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(getBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('`/books/${toValue(params).bookId}`');
    expect(hook.source).toContain('bookKeys.detail(toValue(params).bookId)');
  });

  it('uses useQuery (not createQuery)', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(listBooks, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('return useQuery(');
  });
});

describe('renderVueHook — mutations', () => {
  it('emits useMutation with typed variables and fetches body from vars.body', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(createBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('return useMutation(');
    expect(hook.source).toContain('{ body: CreateBook }');
    expect(hook.source).toContain('client.post<Book>(`/books`, { body: vars.body })');
  });

  it('invalidates resource lists on POST', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(createBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('qc.invalidateQueries({ queryKey: bookKeys.lists() });');
  });

  it('invalidates detail + lists on PATCH', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
    expect(hook.source).toContain('bookKeys.lists()');
  });

  it('invalidates detail + lists on DELETE', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(deleteBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
  });

  it('mutation paths reference vars.params (not params)', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(updateBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.source).toContain('`/books/${vars.params.bookId}`');
  });
});

describe('renderVueHook — naming', () => {
  it('strips the Get prefix for GET-by-id endpoints', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(getBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.name).toBe('useBook');
  });

  it('prepends use- for mutations', () => {
    const emitter = new TypeEmitter();
    const hook = renderVueHook(createBook, emitter, {
      availableResources: new Map(),
      resource: bookResource,
    });
    expect(hook.name).toBe('useCreateBook');
  });
});
