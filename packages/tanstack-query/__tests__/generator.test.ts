import { describe, it, expect } from 'vitest';
import { createRouter, endpoint, t } from '@triad/core';
import { generate } from '../src/generator.js';

const Book = t.model('Book', {
  id: t.string(),
  title: t.string(),
});
const CreateBook = t.model('CreateBook', { title: t.string() });
const BookPage = t.model('BookPage', {
  items: t.array(Book),
  nextCursor: t.string().nullable(),
});
const ApiError = t.model('ApiError', { code: t.string(), message: t.string() });

function buildRouter() {
  const router = createRouter({ title: 'Test', version: '1.0.0' });
  router.context('Library', { models: [Book, BookPage, CreateBook, ApiError] }, (ctx) => {
    ctx.add(
      endpoint({
        name: 'listBooks',
        method: 'GET',
        path: '/books',
        summary: 'List',
        request: { query: { limit: t.int32().default(20) } },
        responses: { 200: { schema: BookPage, description: 'OK' } },
        handler: async (c) => c.respond[200]({ items: [], nextCursor: null }),
      }),
      endpoint({
        name: 'getBook',
        method: 'GET',
        path: '/books/:bookId',
        summary: 'Get',
        request: { params: { bookId: t.string() } },
        responses: { 200: { schema: Book, description: 'OK' } },
        handler: async (c) => c.respond[200]({ id: '1', title: 't' }),
      }),
      endpoint({
        name: 'createBook',
        method: 'POST',
        path: '/books',
        summary: 'Create',
        request: { body: CreateBook },
        responses: { 201: { schema: Book, description: 'Created' } },
        handler: async (c) => c.respond[201]({ id: '1', title: 't' }),
      }),
      endpoint({
        name: 'deleteBook',
        method: 'DELETE',
        path: '/books/:bookId',
        summary: 'Delete',
        request: { params: { bookId: t.string() } },
        responses: { 204: { schema: t.empty(), description: 'No content' } },
        handler: async (c) => c.respond[204](),
      }),
    );
  });
  router.context('Accounts', { models: [ApiError] }, (ctx) => {
    ctx.add(
      endpoint({
        name: 'login',
        method: 'POST',
        path: '/auth/login',
        summary: 'Login',
        request: { body: t.model('LoginInput', { email: t.string(), password: t.string() }) },
        responses: { 200: { schema: t.model('AuthResult', { token: t.string() }), description: 'OK' } },
        handler: async (c) => c.respond[200]({ token: 'x' }),
      }),
    );
  });
  return router;
}

describe('generate', () => {
  it('produces the expected file set', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out', baseUrl: '/api' });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toContain('types.ts');
    expect(paths).toContain('query-keys.ts');
    expect(paths).toContain('client.ts');
    expect(paths).toContain('index.ts');
    expect(paths).toContain('library.ts');
    expect(paths).toContain('accounts.ts');
  });

  it('emits every named schema into types.ts', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out' });
    const types = files.find((f) => f.path === 'types.ts')!.contents;
    expect(types).toContain('export interface Book {');
    expect(types).toContain('export interface BookPage {');
    expect(types).toContain('export interface CreateBook {');
    expect(types).toContain('export interface LoginInput {');
    expect(types).toContain('export interface AuthResult {');
    expect(types).toContain('export interface ListBooksQuery {');
    expect(types).toContain('export interface GetBookParams {');
  });

  it('emits a per-resource key factory in query-keys.ts', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out' });
    const keys = files.find((f) => f.path === 'query-keys.ts')!.contents;
    expect(keys).toContain('export const bookKeys');
    expect(keys).toContain('detail: (id: string)');
    expect(keys).toContain('export const loginKey');
  });

  it('emits hooks in the right bounded-context file', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out' });
    const library = files.find((f) => f.path === 'library.ts')!.contents;
    expect(library).toContain('useListBooks');
    expect(library).toContain('useBook');
    expect(library).toContain('useCreateBook');
    expect(library).toContain('useDeleteBook');
    expect(library).toContain("from '@tanstack/react-query'");
    expect(library).toContain("from './client.js'");
    expect(library).toContain("from './query-keys.js'");

    const accounts = files.find((f) => f.path === 'accounts.ts')!.contents;
    expect(accounts).toContain('useLogin');
  });

  it('includes the runtime client with the configured base URL', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out', baseUrl: '/my-api' });
    const client = files.find((f) => f.path === 'client.ts')!.contents;
    expect(client).toContain('"/my-api"');
    expect(client).toContain('export class TriadClient');
  });

  it('can disable runtime emission', () => {
    const router = buildRouter();
    const files = generate(router, { outputDir: '/tmp/out', emitRuntime: false });
    expect(files.find((f) => f.path === 'client.ts')).toBeUndefined();
  });
});
