import { describe, it, expect } from 'vitest';
import { endpoint, t } from '@triad/core';
import {
  collectEndpointShape,
  hookNameFor,
  renderHook,
  renderPathExpression,
} from '../src/hook-generator.js';
import { TypeEmitter } from '../src/schema-to-ts.js';
import { extractResource } from '../src/query-keys.js';

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

const HttpError = t.model('HttpError', {
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
  responses: {
    200: { schema: BookPage, description: 'OK' },
  },
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
    404: { schema: HttpError, description: 'Not found' },
  },
  handler: async (ctx) => ctx.respond[200]({ id: '1', title: 't', year: 2020 }),
});

const createBook = endpoint({
  name: 'createBook',
  method: 'POST',
  path: '/books',
  summary: 'Create a book',
  request: { body: CreateBook },
  responses: {
    201: { schema: Book, description: 'Created' },
  },
  handler: async (ctx) => ctx.respond[201]({ id: '1', title: 't', year: 2020 }),
});

const updateBook = endpoint({
  name: 'updateBook',
  method: 'PATCH',
  path: '/books/:bookId',
  summary: 'Update',
  request: { params: { bookId: t.string() }, body: CreateBook },
  responses: {
    200: { schema: Book, description: 'OK' },
  },
  handler: async (ctx) => ctx.respond[200]({ id: '1', title: 't', year: 2020 }),
});

const deleteBook = endpoint({
  name: 'deleteBook',
  method: 'DELETE',
  path: '/books/:bookId',
  summary: 'Delete',
  request: { params: { bookId: t.string() } },
  responses: {
    204: { schema: t.empty(), description: 'No content' },
  },
  handler: async (ctx) => ctx.respond[204](),
});

describe('hookNameFor', () => {
  it('drops get prefix for GET-by-id endpoints', () => {
    expect(hookNameFor(getBook)).toBe('useBook');
  });
  it('prepends use to other endpoint names', () => {
    expect(hookNameFor(listBooks)).toBe('useListBooks');
    expect(hookNameFor(createBook)).toBe('useCreateBook');
    expect(hookNameFor(updateBook)).toBe('useUpdateBook');
    expect(hookNameFor(deleteBook)).toBe('useDeleteBook');
  });
});

describe('renderPathExpression', () => {
  it('interpolates path params', () => {
    expect(renderPathExpression('/books/:bookId')).toBe('`/books/${params.bookId}`');
  });
  it('leaves static paths untouched', () => {
    expect(renderPathExpression('/books')).toBe('`/books`');
  });
});

function ctxFor(resourcePath: string) {
  const info = extractResource(resourcePath);
  return {
    availableResources: new Map<string, ReturnType<typeof extractResource> & object>(),
    ...(info !== undefined ? { resource: info } : {}),
  };
}

describe('renderHook', () => {
  it('renders a list GET hook into useQuery with query key factory', () => {
    const emitter = new TypeEmitter();
    const shape = collectEndpointShape(listBooks, emitter);
    const hook = renderHook(listBooks, shape, ctxFor('/books'));
    expect(hook.name).toBe('useListBooks');
    expect(hook.source).toContain('useQuery({');
    expect(hook.source).toContain('bookKeys.list(query)');
    expect(hook.source).toContain("client.get<BookPage>(`/books`, { query })");
    expect(hook.source).toContain('UseQueryResult<BookPage, HttpError>');
  });

  it('renders a GET-by-id hook with detail key', () => {
    const emitter = new TypeEmitter();
    const shape = collectEndpointShape(getBook, emitter);
    const hook = renderHook(getBook, shape, ctxFor('/books/:bookId'));
    expect(hook.source).toContain('bookKeys.detail(params.bookId)');
    expect(hook.source).toContain('client.get<Book>(`/books/${params.bookId}`)');
  });

  it('renders a POST into a useMutation with list invalidation', () => {
    const emitter = new TypeEmitter();
    const shape = collectEndpointShape(createBook, emitter);
    const hook = renderHook(createBook, shape, ctxFor('/books'));
    expect(hook.source).toContain('useMutation({');
    expect(hook.source).toContain('client.post<Book>(`/books`, { body: vars.body })');
    expect(hook.source).toContain('qc.invalidateQueries({ queryKey: bookKeys.lists() })');
    expect(hook.source).toContain('UseMutationResult<Book, HttpError, { body: CreateBook }>');
  });

  it('renders a PATCH with detail and list invalidation', () => {
    const emitter = new TypeEmitter();
    const shape = collectEndpointShape(updateBook, emitter);
    const hook = renderHook(updateBook, shape, ctxFor('/books/:bookId'));
    expect(hook.source).toContain('client.patch<Book>(`/books/${vars.params.bookId}`');
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
    expect(hook.source).toContain('bookKeys.lists()');
  });

  it('renders a DELETE returning void for 204 empty responses', () => {
    const emitter = new TypeEmitter();
    const shape = collectEndpointShape(deleteBook, emitter);
    const hook = renderHook(deleteBook, shape, ctxFor('/books/:bookId'));
    expect(hook.source).toContain('client.delete<void>');
    expect(hook.source).toContain('UseMutationResult<void, HttpError');
    expect(hook.source).toContain('bookKeys.detail(variables.params.bookId)');
  });
});
